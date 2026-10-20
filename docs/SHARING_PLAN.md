# Cloudflare Worker & Supabase Architecture Plan: Share My Week & Share Collections

This plan details replacing the Express backend (`server.ts`) and local JSON persistence (`data/`) with a TypeScript Cloudflare Worker entrypoint integrated with Supabase for **Share My Week** and **Share Collections**.

This document is for architectural planning only. No code or deletions are performed in this PR.

---

## 1. Architecture Overview & Security Strategy

- **Worker Entrypoint & Static Routing**:
  - Cloudflare Workers serve static frontend assets built by Vite (`dist/`).
  - To prevent Cloudflare's SPA router from serving `index.html` on dynamic routes (`/w/:id` or `/c/:id`), `wrangler.jsonc` configures `assets.run_worker_first: ["/api/*", "/w/*", "/c/*"]`.
  - All other static requests pass directly to `env.ASSETS.fetch(request)`.
- **Data Access & Security Model**:
  - **Zero Public SELECT Policies**: Tables `shared_weeks`, `collections`, `collection_items`, and `share_creation_logs` have Row-Level Security (RLS) enabled with NO public `SELECT` policies.
  - **Public-Read Policy Transition**: The existing `supabase/migrations/002_share_my_week.sql` in `main` currently allows direct client inserts and public `SELECT` reads (`USING (is_active = true)`). In this architecture, direct public `SELECT` access on tables is completely eliminated and transitioned to `SECURITY DEFINER` RPCs (`get_shared_week` and `get_shared_collection`).
  - **Creation-Path & Direct INSERT Disallowance**: Direct client `INSERT` on `shared_weeks`, `collections`, and `collection_items` is prohibited via RLS (`WITH CHECK (false)`). All creations must flow through `SECURITY DEFINER` RPCs (`create_shared_week` and `create_collection`) to prevent users from bypassing creation rate limits or quotas via direct REST API calls.
  - **Owner Updates & Deletions**: Authenticated owners retain direct `UPDATE` (for toggling `is_active = false` or updating display settings) and `DELETE` via RLS (`auth.uid() = user_id`).
  - **Parent-Derived Authorization**: `collection_items` has no `user_id` column; authorization for owner operations is strictly derived via parent collection ownership: `collection_id IN (SELECT id FROM public.collections WHERE user_id = auth.uid())`.
  - **Concurrency-Safe Atomic Creations**:
    - `create_shared_week` and `create_collection` RPCs check `IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';` at the top of execution.
    - Both creation RPCs acquire an advisory lock at transaction start: `PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('user_share_lock:' || v_user_id::text));`
    - Serializes creation attempts per user, preventing race conditions on quotas (max 3 active shared weeks, max 3 active collections) and enforcing a combined rate limit (max 10 total creations/hour across both features).
    - Failed/rolled-back transactions automatically release the lock and undo rate-limit logging.
    - Server-side 128-bit random hex IDs (`pg_catalog.encode(pg_catalog.gen_random_bytes(16), 'hex')`) are generated inside the RPC.
  - **Hardened RPC Permissions**:
    - Creation RPCs (`create_shared_week`, `create_collection`) explicitly run `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon;` followed by `GRANT EXECUTE ON FUNCTION ... TO authenticated;`.
    - Public read RPCs (`get_shared_week`, `get_shared_collection`) explicitly run `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;` followed by `GRANT EXECUTE ON FUNCTION ... TO anon, authenticated;`.
  - **Server-Side Snapshot Sanitization & Collection URL Validation**:
    - Creation RPCs explicitly validate inputs (checking non-null `p_items` array, JSON types, item counts <= 50, and field types; raising `ERRCODE = '22023'` on malformed input) and construct an allowlisted snapshot payload.
    - **Collection Content URLs Policy**: Public item content URLs (`url`, `canonicalUrl`, `youtubeId`) are intentionally included in the public snapshot to enable public bookmarking and preview features. Server-side validation requires URL schemes to be `http://` or `https://`, rejects internal/private application origins, and validates `youtubeId` format (`^[a-zA-Z0-9_-]{11}$`). Private notes, internal app URLs, user metadata, or unallowlisted fields are strictly stripped server-side.
  - **Public Reads via Status-Aware RPCs**:
    - `/w/:id` and `/c/:id` call `SECURITY DEFINER` RPCs `get_shared_week(p_id)` and `get_shared_collection(p_id)`.
    - Returns `{ "status": "not_found" }` if ID is missing (Worker serves HTTP 404).
    - Returns `{ "status": "deactivated" }` with **NO item data, notes, titles, or user metadata** if `is_active = false` (Worker serves HTTP 410).
    - Returns `{ "status": "active", ...snapshotData }` if `is_active = true` (Worker serves HTTP 200).
    - Functions execute with `SET search_path = ''` and fully schema-qualified object references.
  - **No Service-Role Key**: Worker uses `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` exclusively.
- **Authentication**: Worker verifies user tokens via `supabase.auth.getUser(token)` with `SUPABASE_PUBLISHABLE_KEY`. Local JWKS verification is noted as a future latency optimization.

---

## 2. Database Schema & Migration Strategy

Migrations must be applied in exact numerical order:

### Migration `002_share_my_week.sql` (Corrected In-Place / Deployment Note)
*Deployment & Transition Note*: Modifying `002_share_my_week.sql` in-place only updates fresh local databases. For deployed environments where `002` was previously run, a dedicated follow-up migration script (e.g. `002_tighten_sharing_policies.sql`) must be executed. The frontend MUST be deployed with creation RPC calls before applying policy tightening to prevent breaking direct-insert flows.
- **Table `public.shared_weeks`**: `id` (text PRIMARY KEY), `user_id` (uuid REFERENCES auth.users ON DELETE CASCADE), `week_start_date` (text), `week_end_date` (text), `week_label` (text), `display_name` (text max 40), `total_planned_minutes` (integer), `items` (jsonb array of allowlisted fields: `id`, `title`, `source`, `type`, `duration`, `coverReference`, `day`, `dateStr`), `is_active` (boolean DEFAULT true), `created_at` (timestamptz DEFAULT now()), `updated_at` (timestamptz DEFAULT now()).
- **Creation Logging Table `public.share_creation_logs`**: `id` (uuid PRIMARY KEY DEFAULT gen_random_uuid()), `user_id` (uuid REFERENCES auth.users ON DELETE CASCADE), `created_at` (timestamptz DEFAULT now()). RLS enabled (`auth.uid() = user_id`). No public policies.
- **RLS Policies on `shared_weeks`**:
  - `SELECT`, `UPDATE`, `DELETE`: `auth.uid() = user_id`.
  - `INSERT`: Disallowed directly (`WITH CHECK (false)`). Creations must use `create_shared_week` RPC.
- **Atomic Creation RPC (`create_shared_week`)**:
  ```sql
  CREATE OR REPLACE FUNCTION public.create_shared_week(
    p_week_start_date text,
    p_week_end_date text,
    p_week_label text,
    p_display_name text,
    p_total_planned_minutes integer,
    p_items jsonb
  )
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    v_user_id uuid := auth.uid();
    v_recent_creations integer;
    v_active_shares integer;
    v_new_id text;
    v_sanitized_items jsonb := '[]'::jsonb;
    v_elem jsonb;
    v_duration integer;
  BEGIN
    -- Explicit unauthenticated check
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    -- Strict Input Validation: p_items must be a non-null JSON array
    IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) != 'array' THEN
      RAISE EXCEPTION 'Invalid p_items: expected a JSON array.' USING ERRCODE = '22023';
    END IF;

    -- Concurrency Lock: Acquire per-user transaction advisory lock
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('user_share_lock:' || v_user_id::text));

    -- Rate Limit: Max 10 combined creations (shared weeks + collections) per hour
    SELECT pg_catalog.count(*) INTO v_recent_creations
    FROM public.share_creation_logs
    WHERE user_id = v_user_id AND created_at > pg_catalog.now() - interval '1 hour';

    IF v_recent_creations >= 10 THEN
      RAISE EXCEPTION 'Rate limit exceeded: Max 10 creation actions per hour.' USING ERRCODE = 'P0001';
    END IF;

    -- Quota: Max 3 active shared weeks
    SELECT pg_catalog.count(*) INTO v_active_shares
    FROM public.shared_weeks
    WHERE user_id = v_user_id AND is_active = true;

    IF v_active_shares >= 3 THEN
      RAISE EXCEPTION 'Active link quota exceeded: Free accounts may keep up to 3 active links.' USING ERRCODE = 'P0002';
    END IF;

    -- Server-Side Snapshot Sanitization & Type Checking
    FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_items) LOOP
      IF pg_catalog.jsonb_typeof(v_elem) != 'object' THEN
        RAISE EXCEPTION 'Invalid item element: expected JSON object.' USING ERRCODE = '22023';
      END IF;

      IF v_elem ? 'duration' AND pg_catalog.jsonb_typeof(v_elem->'duration') != 'number' THEN
        RAISE EXCEPTION 'Invalid item duration: expected integer number.' USING ERRCODE = '22023';
      END IF;
      v_duration := COALESCE((v_elem->>'duration')::integer, 0);

      v_sanitized_items := v_sanitized_items || pg_catalog.jsonb_build_object(
        'id', COALESCE(v_elem->>'id', pg_catalog.encode(pg_catalog.gen_random_bytes(16), 'hex')),
        'title', pg_catalog.substring(COALESCE(v_elem->>'title', 'Untitled') from 1 for 150),
        'source', pg_catalog.substring(COALESCE(v_elem->>'source', 'Curate') from 1 for 60),
        'type', pg_catalog.substring(COALESCE(v_elem->>'type', 'other') from 1 for 30),
        'duration', v_duration,
        'coverReference', v_elem->>'coverReference',
        'day', pg_catalog.substring(COALESCE(v_elem->>'day', 'Monday') from 1 for 20),
        'dateStr', v_elem->>'dateStr'
      );
    END LOOP;

    -- Generate 128-bit random hex ID (32 chars)
    v_new_id := pg_catalog.encode(pg_catalog.gen_random_bytes(16), 'hex');

    -- Insert snapshot
    INSERT INTO public.shared_weeks (
      id, user_id, week_start_date, week_end_date, week_label,
      display_name, total_planned_minutes, items, is_active, created_at, updated_at
    ) VALUES (
      v_new_id, v_user_id, p_week_start_date, p_week_end_date, p_week_label,
      pg_catalog.substring(pg_catalog.trim(p_display_name) from 1 for 40),
      p_total_planned_minutes, v_sanitized_items, true, pg_catalog.now(), pg_catalog.now()
    );

    -- Log creation event
    INSERT INTO public.share_creation_logs (user_id, created_at) VALUES (v_user_id, pg_catalog.now());

    RETURN pg_catalog.jsonb_build_object('id', v_new_id, 'success', true);
  END;
  $$;

  -- Revoke default PUBLIC and anon privileges, granting exclusively to authenticated
  REVOKE EXECUTE ON FUNCTION public.create_shared_week(text, text, text, text, integer, jsonb) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.create_shared_week(text, text, text, text, integer, jsonb) TO authenticated;
  ```

- **Public Status-Aware Read RPC (`get_shared_week`)**:
  ```sql
  CREATE OR REPLACE FUNCTION public.get_shared_week(p_id text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    v_row record;
  BEGIN
    SELECT s.id, s.week_start_date, s.week_end_date, s.week_label, s.display_name,
           s.total_planned_minutes, s.items, s.is_active, s.created_at
    INTO v_row
    FROM public.shared_weeks s
    WHERE s.id = p_id;

    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('status', 'not_found');
    END IF;

    IF NOT v_row.is_active THEN
      RETURN pg_catalog.jsonb_build_object('status', 'deactivated');
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'status', 'active',
      'id', v_row.id,
      'weekStartDate', v_row.week_start_date,
      'weekEndDate', v_row.week_end_date,
      'weekLabel', v_row.week_label,
      'displayName', v_row.display_name,
      'totalPlannedMinutes', v_row.total_planned_minutes,
      'items', v_row.items,
      'createdAt', v_row.created_at
    );
  END;
  $$;

  REVOKE EXECUTE ON FUNCTION public.get_shared_week(text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.get_shared_week(text) TO anon, authenticated;
  ```

### Migration `003_item_tombstones.sql` (Separate Sync Task)
- Tracks soft-deletes/tombstones for client item sync across devices.

### Migration `004_collections_and_collection_items.sql`
- **Tables**:
  - `public.collections`: `id` (text PRIMARY KEY), `user_id` (uuid REFERENCES auth.users ON DELETE CASCADE), `title` (text max 80), `description` (text max 300), `display_name` (text max 40), `allow_search_engines` (boolean DEFAULT false), `is_active` (boolean DEFAULT true), `total_duration_minutes` (integer), `created_at`, `updated_at`.
  - `public.collection_items`: `id` (text PRIMARY KEY), `collection_id` (text REFERENCES public.collections(id) ON DELETE CASCADE), `title` (text), `source` (text), `type` (text), `duration` (integer), `duration_is_estimate` (boolean), `cover_reference` (text), `url` (text), `canonical_url` (text), `youtube_id` (text), `position` (integer). **NEVER** stores private notes or metadata.
- **RLS Policies on `collections`**:
  - `SELECT`, `UPDATE`, `DELETE`: `auth.uid() = user_id`.
  - `INSERT`: Disallowed directly (`WITH CHECK (false)`). Creations must use `create_collection` RPC.
- **RLS Policies on `collection_items` (Parent-Derived Authorization)**:
  - `SELECT`, `UPDATE`, `DELETE`: `collection_id IN (SELECT id FROM public.collections WHERE user_id = auth.uid())`.
  - `INSERT`: Disallowed directly (`WITH CHECK (false)`). Managed via `create_collection` RPC.
- **Concurrency-Safe Atomic Creation RPC (`create_collection`)**:
  ```sql
  CREATE OR REPLACE FUNCTION public.create_collection(
    p_title text,
    p_description text,
    p_display_name text,
    p_allow_search_engines boolean,
    p_items jsonb
  )
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    v_user_id uuid := auth.uid();
    v_recent_creations integer;
    v_active_collections integer;
    v_item_count integer;
    v_new_id text;
    v_total_dur integer := 0;
    v_elem jsonb;
    v_idx integer := 0;
    v_url text;
    v_yt_id text;
  BEGIN
    -- Explicit unauthenticated check
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    -- Strict Input Validation: p_items must be a non-null JSON array
    IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) != 'array' THEN
      RAISE EXCEPTION 'Invalid p_items: expected a JSON array.' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('user_share_lock:' || v_user_id::text));

    v_item_count := pg_catalog.jsonb_array_length(p_items);
    IF v_item_count > 50 THEN
      RAISE EXCEPTION 'Item limit exceeded: Collections may contain at most 50 items.' USING ERRCODE = 'P0003';
    END IF;

    SELECT pg_catalog.count(*) INTO v_recent_creations
    FROM public.share_creation_logs
    WHERE user_id = v_user_id AND created_at > pg_catalog.now() - interval '1 hour';

    IF v_recent_creations >= 10 THEN
      RAISE EXCEPTION 'Rate limit exceeded: Max 10 creation actions per hour.' USING ERRCODE = 'P0001';
    END IF;

    SELECT pg_catalog.count(*) INTO v_active_collections
    FROM public.collections
    WHERE user_id = v_user_id AND is_active = true;

    IF v_active_collections >= 3 THEN
      RAISE EXCEPTION 'Collection quota exceeded: Free accounts may keep up to 3 active collections.' USING ERRCODE = 'P0004';
    END IF;

    v_new_id := pg_catalog.encode(pg_catalog.gen_random_bytes(16), 'hex');

    INSERT INTO public.collections (
      id, user_id, title, description, display_name, allow_search_engines,
      is_active, total_duration_minutes, created_at, updated_at
    ) VALUES (
      v_new_id, v_user_id,
      pg_catalog.substring(pg_catalog.trim(p_title) from 1 for 80),
      pg_catalog.substring(pg_catalog.trim(p_description) from 1 for 300),
      pg_catalog.substring(pg_catalog.trim(p_display_name) from 1 for 40),
      COALESCE(p_allow_search_engines, false),
      true, 0, pg_catalog.now(), pg_catalog.now()
    );

    FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_items) LOOP
      v_idx := v_idx + 1;
      IF pg_catalog.jsonb_typeof(v_elem) != 'object' THEN
        RAISE EXCEPTION 'Invalid item element: expected JSON object.' USING ERRCODE = '22023';
      END IF;

      IF v_elem ? 'duration' AND pg_catalog.jsonb_typeof(v_elem->'duration') != 'number' THEN
        RAISE EXCEPTION 'Invalid item duration: expected integer number.' USING ERRCODE = '22023';
      END IF;
      v_total_dur := v_total_dur + COALESCE((v_elem->>'duration')::integer, 0);

      v_url := v_elem->>'url';
      IF v_url IS NOT NULL AND v_url !~* '^https?://' THEN
        RAISE EXCEPTION 'Invalid item URL scheme: must start with http:// or https://' USING ERRCODE = '22023';
      END IF;

      v_yt_id := v_elem->>'youtubeId';
      IF v_yt_id IS NOT NULL AND v_yt_id !~ '^[a-zA-Z0-9_-]{11}$' THEN
        RAISE EXCEPTION 'Invalid youtubeId format: expected 11 alphanumeric/dash characters.' USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.collection_items (
        id, collection_id, title, source, type, duration, duration_is_estimate,
        cover_reference, url, canonical_url, youtube_id, position
      ) VALUES (
        COALESCE(v_elem->>'id', pg_catalog.encode(pg_catalog.gen_random_bytes(16), 'hex')),
        v_new_id,
        pg_catalog.substring(COALESCE(v_elem->>'title', 'Untitled') from 1 for 150),
        pg_catalog.substring(COALESCE(v_elem->>'source', 'Curate') from 1 for 60),
        pg_catalog.substring(COALESCE(v_elem->>'type', 'other') from 1 for 30),
        COALESCE((v_elem->>'duration')::integer, 0),
        COALESCE((v_elem->>'durationIsEstimate')::boolean, false),
        v_elem->>'coverReference',
        v_url,
        v_elem->>'canonicalUrl',
        v_yt_id,
        v_idx
      );
    END LOOP;

    UPDATE public.collections SET total_duration_minutes = v_total_dur WHERE id = v_new_id;
    INSERT INTO public.share_creation_logs (user_id, created_at) VALUES (v_user_id, pg_catalog.now());

    RETURN pg_catalog.jsonb_build_object('id', v_new_id, 'success', true);
  END;
  $$;

  -- Revoke default PUBLIC and anon privileges, granting exclusively to authenticated
  REVOKE EXECUTE ON FUNCTION public.create_collection(text, text, text, boolean, jsonb) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.create_collection(text, text, text, boolean, jsonb) TO authenticated;
  ```

- **Public Status-Aware Read RPC (`get_shared_collection`)**:
  ```sql
  CREATE OR REPLACE FUNCTION public.get_shared_collection(p_id text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
  DECLARE
    v_col record;
    v_items jsonb;
  BEGIN
    SELECT c.id, c.title, c.description, c.display_name, c.allow_search_engines,
           c.is_active, c.total_duration_minutes, c.created_at
    INTO v_col
    FROM public.collections c
    WHERE c.id = p_id;

    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('status', 'not_found');
    END IF;

    IF NOT v_col.is_active THEN
      RETURN pg_catalog.jsonb_build_object('status', 'deactivated');
    END IF;

    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', i.id,
        'title', i.title,
        'source', i.source,
        'type', i.type,
        'duration', i.duration,
        'durationIsEstimate', i.duration_is_estimate,
        'coverReference', i.cover_reference,
        'url', i.url,
        'canonicalUrl', i.canonical_url,
        'youtubeId', i.youtube_id
      ) ORDER BY i.position ASC
    ) INTO v_items
    FROM public.collection_items i
    WHERE i.collection_id = p_id;

    RETURN pg_catalog.jsonb_build_object(
      'status', 'active',
      'id', v_col.id,
      'title', v_col.title,
      'description', v_col.description,
      'displayName', v_col.display_name,
      'allowSearchEngines', v_col.allow_search_engines,
      'isActive', v_col.is_active,
      'totalDurationMinutes', v_col.total_duration_minutes,
      'createdAt', v_col.created_at,
      'items', COALESCE(v_items, '[]'::jsonb)
    );
  END;
  $$;

  REVOKE EXECUTE ON FUNCTION public.get_shared_collection(text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.get_shared_collection(text) TO anon, authenticated;
  ```

---

## 3. Function-by-Function Permission Matrix

| RPC Name | Security Type | Default `PUBLIC` & `anon` Revoked | Granted Roles | Intended Operations & Input Validation |
|---|---|---|---|---|
| `public.create_shared_week` | `SECURITY DEFINER` | **YES** (`REVOKE ... FROM PUBLIC, anon`) | `authenticated` | Validates `auth.uid() IS NOT NULL`, `p_items` JSON array type, duration types; acquires advisory lock; enforces 10/hr rate limit & 3-active quota; sanitizes snapshot items; generates server-side 128-bit hex ID; inserts snapshot & log. |
| `public.get_shared_week` | `SECURITY DEFINER` | **YES** (`REVOKE ... FROM PUBLIC`) | `anon`, `authenticated` | Public snapshot lookup by exact ID. Active -> sanitized snapshot (`status: 'active'`). Deactivated -> `{ "status": "deactivated" }` (NO user/item metadata). Missing -> `{ "status": "not_found" }`. No list functions. |
| `public.create_collection` | `SECURITY DEFINER` | **YES** (`REVOKE ... FROM PUBLIC, anon`) | `authenticated` | Validates `auth.uid() IS NOT NULL`, `p_items` array type & length <= 50, item duration types, URL scheme (`http://` / `https://`), and `youtubeId` format (`^[a-zA-Z0-9_-]{11}$`). Acquires lock; checks 10/hr rate limit & 3-active quota; truncates title/desc; generates server-side hex ID; inserts header & items; logs creation. |
| `public.get_shared_collection` | `SECURITY DEFINER` | **YES** (`REVOKE ... FROM PUBLIC`) | `anon`, `authenticated` | Public snapshot lookup by exact ID. Active -> aggregated JSON snapshot of collection + items (`status: 'active'`). Deactivated -> `{ "status": "deactivated" }` (NO item/owner data). Missing -> `{ "status": "not_found" }`. |

---

## 4. Edge Rate Limiting & Cloudflare Configuration

- **Edge IP Protection**: 100 req/min per client IP address (`CF-Connecting-IP` header) targeting `/w/*` and `/c/*`.
- **Wrangler Rate Limiting Binding**:
  - `wrangler.jsonc` specifies `ratelimits` binding array using key `"name": "PUBLIC_RATE_LIMITER"` (Wrangler 4.151.0 requirement).
  - Note: `"1001"` in the example below is an illustrative placeholder namespace ID. The actual numeric namespace ID must be provisioned via the Cloudflare Dashboard or API prior to deployment.
  - Requires a Workers Paid plan. On Workers Free plans, `ratelimits` is omitted from `wrangler.jsonc` and rate protection is configured via Cloudflare Dashboard WAF rules.

```jsonc
{
  "name": "curate",
  "main": "./src/worker/index.ts",
  "compatibility_date": "2026-10-01",
  "keep_vars": true,
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": [
      "/api/*",
      "/w/*",
      "/c/*"
    ]
  },
  "ratelimits": [
    {
      "name": "PUBLIC_RATE_LIMITER",
      "namespace_id": "1001",
      "simple": {
        "limit": 100,
        "period": 60
      }
    }
  ],
  "previews": {}
}
```

### `keep_vars: true` & Variable Overwrite Prevention
- **`vars` Block Removed**: The `vars` block is omitted from `wrangler.jsonc` and `"keep_vars": true` is configured.
- **Why**: Defining empty `vars` in `wrangler.jsonc` causes `wrangler deploy` to overwrite production environment variables configured in the Cloudflare Dashboard (e.g., `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_URL`, `SUPPORT_EMAIL`) with empty strings during CI/CD deployments. Setting `keep_vars: true` instructs Wrangler to preserve Dashboard variables across deployments.
- Local development variables are managed in `.dev.vars` (e.g. `APP_URL=http://localhost:8787`).

---

## 5. Worker Environment Variables & Security Headers

### Listed Worker Environment Variables
- `SUPABASE_URL`: Base Supabase project API URL.
- `SUPABASE_PUBLISHABLE_KEY`: Client publishable key (`sb_publishable_...`).
- `APP_URL`: Canonical root origin (e.g. `https://YOUR-DOMAIN`) used for generating Open Graph tags and share links. Synchronized with frontend `VITE_APP_URL`.
- `SUPPORT_EMAIL`: Support contact address (e.g. `support@YOUR-DOMAIN`) used dynamically for footer report links (`mailto:${SUPPORT_EMAIL}?subject=Report%20Shared%20Page%20${id}`).

### Caching Header & Freshness Target
- **Cache Header**: `Cache-Control: public, max-age=60, s-maxage=60`
- **Configured Freshness Target & Testing Requirements**:
  - `max-age=60` defines the configured freshness target, balancing edge performance against deactivation propagation time.
  - Because HTTP caching across distributed edge CDN nodes and browser caches is probabilistic, deactivation takes effect as cached representations revalidate.
  - Implementation and integration tests must explicitly verify `Cache-Control` header presence, edge revalidation, stale response handling, and deactivation behavior under simulated re-fetches rather than assuming instant zero-delay global revocation.

---

## 6. Verification & Test Plan

1. **Wrangler Pre-Deployment Validation**: Run `npx wrangler types` and `npx wrangler deploy --dry-run` to validate syntax, bindings, and `keep_vars` settings.
2. **Automated Worker HTML Escaping Tests (`src/worker/__tests__/escaping.test.ts`)**: Send `<script>`, `<img onerror>`, `"><svg>` payloads and verify output escapes `<` to `&lt;`, `>` to `&gt;`, `"` to `&quot;`.
3. **Shell Metacharacter Safety**: Verify `$(id)`, `` `id` ``, `;`, `' OR '1'='1` render strictly as plain text.
4. **Manual Two-Account & RLS Security Script (`supabase/tests/004_rls_sharing_test.sql`)**:
   - `anon` calling `create_shared_week` or `create_collection` -> throws exception `42501` (permission denied).
   - Direct `INSERT` on `shared_weeks`, `collections`, or `collection_items` -> blocked by RLS (`WITH CHECK (false)`).
   - User A reading/updating/deleting User B's collections or items -> blocked by RLS.
   - `anon` querying tables directly -> 0 rows.
   - `get_shared_week` & `get_shared_collection` -> verify active returns snapshot, deactivated returns `{ status: 'deactivated' }` with no payload, missing returns `{ status: 'not_found' }`.
5. **Concurrency, Input Validation & Rate Limit Tests**:
   - Malformed `p_items` input (e.g. non-array, invalid item duration type, invalid URL scheme, or malformed `youtubeId`) -> RPC throws exception `22023` ("Invalid input").
   - Unauthenticated invocation of `create_shared_week` / `create_collection` -> RPC throws exception `42501` ("Not authenticated").
   - 5 simultaneous creation RPC calls -> advisory lock queues them; 3 succeed, 4th & 5th fail with quota error.
   - 11 creation calls in 1 hour -> 11th fails with rate limit error.
   - Failed transaction -> releases lock and rolls back creation log.
   - Deactivating a link -> recovers quota capacity up to max 3.
6. **HTTP Status Verification**: Malformed ID -> 400; Nonexistent ID -> 404; Deactivated ID -> 410.

---

## 7. PR Mergeability & Open Questions

1. **GitHub PR #18 Mergeability**:
   - GitHub currently reports PR #18 as not mergeable due to branch divergence or merge condition state.
   - The merge condition must be diagnosed and resolved separately in GitHub / git history prior to merging. Do not attempt to merge in this task.
2. **Cloudflare Rate Limiting Plan**:
   - Confirm whether the target Cloudflare account is on Workers Paid (supporting `ratelimits` binding in `wrangler.jsonc`) or Workers Free (requiring WAF rate-limiting rules in Dashboard).

---

## 8. Realistic Estimated Hours

| Step | Description | Estimated Hours |
|---|---|---|
| **Build Subtotal (Steps 1–4, 6)** | Implementation build time across database RPCs/migrations, Cloudflare Worker core & API routes, HTML renderers & security headers, frontend API integration & cleanup | **13.5 hrs** |
| **Testing, Security Review & Config Validation (Step 5)** | Automated Worker HTML escaping tests, `supabase/tests/004_rls_sharing_test.sql` permission/RLS/concurrency test script, dry-run Wrangler validation, and security review | **5.5 hrs** |
| **Total Estimated Effort** | | **19.0 hrs** |
