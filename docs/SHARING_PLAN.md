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
  - **Direct Client INSERT Disallowed**: To prevent users from bypassing creation rate limits or quotas via direct REST API calls, direct client `INSERT` is blocked via RLS (`WITH CHECK (false)`). All creations must flow through `SECURITY DEFINER` RPCs (`create_shared_week` and `create_collection`).
  - **Owner Updates & Deletions**: Authenticated owners update (`is_active = false` or title updates) and delete their records via RLS (`auth.uid() = user_id`).
  - **Parent-Derived Authorization**: `collection_items` has no `user_id` column; authorization is strictly derived via parent collection ownership: `collection_id IN (SELECT id FROM public.collections WHERE user_id = auth.uid())`.
  - **Concurrency-Safe Atomic Creations**:
    - `create_shared_week` and `create_collection` RPCs acquire an advisory lock at transaction start: `PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('user_share_lock:' || v_user_id::text));`
    - This serializes creation attempts per user, preventing race conditions on quotas (max 3 active shared weeks, max 3 active collections) and enforcing a combined rate limit (max 10 total creations/hour across both features).
    - Failed/rolled-back transactions automatically release the lock and undo rate-limit logging.
    - Server-side 128-bit random hex IDs (`pg_catalog.encode(pg_catalog.gen_random_bytes(16), 'hex')`) are generated inside the RPC.
  - **Server-Side Snapshot Sanitization**: RPCs explicitly validate and construct allowlisted snapshot payloads, stripping private notes, internal URLs, or unallowlisted JSON properties before storing.
  - **Public Reads via Status-Aware RPCs**:
    - `/w/:id` and `/c/:id` call `SECURITY DEFINER` RPCs `get_shared_week(p_id)` and `get_shared_collection(p_id)`.
    - Returns `{ "status": "not_found" }` if ID missing (Worker serves HTTP 404).
    - Returns `{ "status": "deactivated" }` with **NO item data, notes, titles, or user metadata** if `is_active = false` (Worker serves HTTP 410).
    - Returns `{ "status": "active", ...snapshotData }` if `is_active = true` (Worker serves HTTP 200).
    - Functions execute with `SET search_path = ''` and fully schema-qualified object references. Default `PUBLIC` execution privileges are explicitly revoked.
  - **No Service-Role Key**: Worker uses `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` exclusively.
- **Authentication**: Worker verifies user tokens via `supabase.auth.getUser(token)` with `SUPABASE_PUBLISHABLE_KEY`. Local JWKS verification is noted as a future latency optimization.

---

## 2. Database Schema & Migration Strategy

Migrations must be applied in exact numerical order:

### Migration `002_share_my_week.sql` (Corrected In-Place)
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
  BEGIN
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
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

    -- Server-Side Snapshot Sanitization: Allowlist only snapshot properties
    FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_items) LOOP
      v_sanitized_items := v_sanitized_items || pg_catalog.jsonb_build_object(
        'id', COALESCE(v_elem->>'id', pg_catalog.encode(pg_catalog.gen_random_bytes(16), 'hex')),
        'title', COALESCE(v_elem->>'title', 'Untitled'),
        'source', COALESCE(v_elem->>'source', 'Curate'),
        'type', COALESCE(v_elem->>'type', 'other'),
        'duration', COALESCE((v_elem->>'duration')::integer, 0),
        'coverReference', v_elem->>'coverReference',
        'day', COALESCE(v_elem->>'day', 'Monday'),
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

  REVOKE EXECUTE ON FUNCTION public.create_shared_week(text, text, text, text, integer, jsonb) FROM PUBLIC;
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
  BEGIN
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
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
      v_total_dur := v_total_dur + COALESCE((v_elem->>'duration')::integer, 0);

      -- Explicit field extraction stripping any private notes or unallowlisted properties
      INSERT INTO public.collection_items (
        id, collection_id, title, source, type, duration, duration_is_estimate,
        cover_reference, url, canonical_url, youtube_id, position
      ) VALUES (
        COALESCE(v_elem->>'id', pg_catalog.encode(pg_catalog.gen_random_bytes(16), 'hex')),
        v_new_id,
        COALESCE(v_elem->>'title', 'Untitled'),
        COALESCE(v_elem->>'source', 'Curate'),
        COALESCE(v_elem->>'type', 'other'),
        COALESCE((v_elem->>'duration')::integer, 0),
        COALESCE((v_elem->>'durationIsEstimate')::boolean, false),
        v_elem->>'coverReference',
        v_elem->>'url',
        v_elem->>'canonicalUrl',
        v_elem->>'youtubeId',
        v_idx
      );
    END LOOP;

    UPDATE public.collections SET total_duration_minutes = v_total_dur WHERE id = v_new_id;
    INSERT INTO public.share_creation_logs (user_id, created_at) VALUES (v_user_id, pg_catalog.now());

    RETURN pg_catalog.jsonb_build_object('id', v_new_id, 'success', true);
  END;
  $$;

  REVOKE EXECUTE ON FUNCTION public.create_collection(text, text, text, boolean, jsonb) FROM PUBLIC;
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

| RPC Name | Security Type | Default `PUBLIC` Revoked | Granted Roles | Intended Operations & Input Validation |
|---|---|---|---|---|
| `public.create_shared_week` | `SECURITY DEFINER` | **YES** | `authenticated` | Validates `auth.uid() IS NOT NULL`, acquires `pg_advisory_xact_lock`, checks 10/hr combined rate limit & 3-active quota, sanitizes snapshot items, generates 128-bit hex ID server-side, inserts snapshot & log. |
| `public.get_shared_week` | `SECURITY DEFINER` | **YES** | `anon`, `authenticated` | Public snapshot lookup by exact ID. Active -> sanitized snapshot (`status: 'active'`). Deactivated -> `{ "status": "deactivated" }` (NO user/item metadata). Missing -> `{ "status": "not_found" }`. No list functions. |
| `public.create_collection` | `SECURITY DEFINER` | **YES** | `authenticated` | Validates `auth.uid() IS NOT NULL` & item length <= 50, acquires advisory lock, checks 10/hr combined rate limit & 3-active quota, truncates title/desc, generates server-side hex ID, inserts header & items, logs creation. |
| `public.get_shared_collection` | `SECURITY DEFINER` | **YES** | `anon`, `authenticated` | Public snapshot lookup by exact ID. Active -> aggregated JSON snapshot of collection + items (`status: 'active'`). Deactivated -> `{ "status": "deactivated" }` (NO item/owner data). Missing -> `{ "status": "not_found" }`. |

---

## 4. Edge Rate Limiting & Cloudflare Configuration

- **Edge IP Protection**: 100 req/min per client IP address (`CF-Connecting-IP` header) targeting `/w/*` and `/c/*`.
- **Wrangler Rate Limiting Binding**:
  - `wrangler.jsonc` specifies `ratelimits` binding array.
  - Note: `"1001"` in the example below is an illustrative placeholder namespace ID. The actual numeric namespace ID must be provisioned via the Cloudflare Dashboard or API prior to deployment.
  - Requires a Workers Paid plan. On Workers Free plans, `ratelimits` is omitted from `wrangler.jsonc` and rate protection is configured via Cloudflare Dashboard WAF rules.

```jsonc
{
  "name": "curate",
  "main": "./src/worker/index.ts",
  "compatibility_date": "2026-10-01",
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
  "vars": {
    "SUPABASE_URL": "",
    "SUPABASE_PUBLISHABLE_KEY": "",
    "APP_URL": ""
  },
  "ratelimits": [
    {
      "binding": "PUBLIC_RATE_LIMITER",
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

---

## 5. Worker Routes, HTML Rendering & Caching

### Worker Handler Logic
- `POST /api/share` -> calls `create_shared_week` RPC -> 201 with URL.
- `PATCH /api/share/:id` & `DELETE /api/share/:id` -> updates/deactivates via Supabase client with RLS.
- `POST /api/collections` -> calls `create_collection` RPC -> 201 with URL.
- `PATCH /api/collections/:id` & `DELETE /api/collections/:id` -> updates/deactivates via RLS.
- `GET /w/:id` & `GET /c/:id`:
  - Validates ID format (`^[a-f0-9]{32}$`). Returns 400 Bad Request for malformed/path-traversal IDs.
  - Calls `get_shared_week(id)` or `get_shared_collection(id)` RPC.
  - Status `'not_found'` -> HTTP 404 Not Found.
  - Status `'deactivated'` -> HTTP 410 Gone (rendered page explaining link is deactivated, with zero private metadata).
  - Status `'active'` -> HTTP 200 OK HTML snapshot with escaped variables.

### Caching Header & Deactivation Propagation
- `Cache-Control: public, max-age=60, s-maxage=60`
- *Propagation Trade-off*: Setting `max-age=60` allows CDN edge caching for performance while guaranteeing that when an owner deactivates a link, any cached 200 OK response expires globally within **at most 60 seconds**, after which the edge serves 410 Gone.

---

## 6. Verification & Test Plan

1. **Wrangler Pre-Deployment Validation**: Run `npx wrangler types` and `npx wrangler deploy --dry-run` to validate syntax and bindings.
2. **Automated Worker HTML Escaping Tests (`src/worker/__tests__/escaping.test.ts`)**: Send `<script>`, `<img onerror>`, `"><svg>` payloads and verify output escapes `<` to `&lt;`, `>` to `&gt;`, `"` to `&quot;`.
3. **Shell Metacharacter Safety**: Verify `$(id)`, `` `id` ``, `;`, `' OR '1'='1` render strictly as plain text.
4. **Manual Two-Account & RLS Security Script (`supabase/tests/004_rls_sharing_test.sql`)**:
   - `anon` calling `create_shared_week` or `create_collection` -> throws exception `42501` (permission denied).
   - Direct `INSERT` on `shared_weeks`, `collections`, or `collection_items` -> blocked by RLS (`WITH CHECK (false)`).
   - User A reading/updating/deleting User B's collections or items -> blocked by RLS.
   - `anon` querying tables directly -> 0 rows.
   - `get_shared_week` & `get_shared_collection` -> verify active returns snapshot, deactivated returns `{ status: 'deactivated' }` with no payload, missing returns `{ status: 'not_found' }`.
5. **Concurrency & Rate Limit Tests**:
   - 5 simultaneous creation RPC calls -> advisory lock queues them; 3 succeed, 4th & 5th fail with quota error.
   - 11 creation calls in 1 hour -> 11th fails with rate limit error.
   - Failed transaction -> releases lock and rolls back creation log.
   - Deactivating a link -> recovers quota capacity up to max 3.
6. **HTTP Status Verification**: Malformed ID -> 400; Nonexistent ID -> 404; Deactivated ID -> 410.

---

## 7. Open Questions

1. *Cloudflare Rate Limiting Plan*: Confirm whether the target Cloudflare account is on Workers Paid (supporting `ratelimits` binding in `wrangler.jsonc`) or Workers Free (requiring WAF rate-limiting rules in Dashboard).

---

## 8. Realistic Estimated Hours

| Step | Description | Estimated Hours |
|---|---|---|
| **Step 1: Database Migrations & RPCs** | Correct `002_share_my_week.sql`, write `004_collections.sql`, `create_shared_week` & `create_collection` RPCs with advisory locking, server-side snapshot sanitization, direct INSERT blocking, explicit `REVOKE EXECUTE ... FROM PUBLIC`, schema qualification (`SET search_path = ''`), public status-aware RPCs | 3.5 hrs |
| **Step 2: Cloudflare Worker Core & API Routes** | TypeScript Worker entrypoint (`src/worker/index.ts`), token verification via `getUser`, `/api/share` and `/api/collections` endpoints, `wrangler.jsonc` `run_worker_first` config | 4.0 hrs |
| **Step 3: Worker HTML Rendering & Security Headers** | HTML renderers for `/w/:id` and `/c/:id`, strict CSP (`script-src 'none'`), status-aware 410 Gone vs 404 logic, `Cache-Control: max-age=60`, 'Report this page' and 'Plan your own week' links | 3.5 hrs |
| **Step 4: Frontend API Integration & Import Flow** | Wire frontend API calls, token headers, error toasts for quotas/rate limits, collection import flow wiring | 2.5 hrs |
| **Step 5: Automated & Manual Security Test Suite** | Write automated Worker HTML escaping tests, `supabase/tests/004_rls_sharing_test.sql` two-account, RPC permission & concurrency test script, XSS & metacharacter verification | 3.0 hrs |
| **Step 6: Config Validation, Cleanup & E2E Verification** | Remove `server.ts` & `data/`, validate `wrangler.jsonc` assets routing, local `wrangler dev` testing, security review | 2.5 hrs |
| **Total** | | **19.0 hrs** |
