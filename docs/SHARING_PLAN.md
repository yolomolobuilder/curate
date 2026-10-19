# Cloudflare Worker & Supabase Architecture Plan: Share My Week & Share Collections

This plan details replacing the Express backend (`server.ts`) and local JSON persistence (`data/`) with a TypeScript Cloudflare Worker entrypoint integrated with Supabase for **Share My Week** and **Share Collections**.

This document is for architectural planning only. No code or deletions are performed in this PR.

---

## 1. Overview & Architecture Strategy

- **Static Assets & SPA Routing in Cloudflare Workers**:
  - Cloudflare's Asset Router normally handles static files in `dist/`. When `not_found_handling: "single-page-application"` is set, any URL not matching a physical static file (such as `/w/abc123hex` or `/c/def456hex`) is served `index.html` by default before reaching the Worker fetch handler.
  - To ensure the Worker executes and handles dynamic public HTML rendering and API endpoints, `wrangler.jsonc` specifies `assets.run_worker_first: ["/api/*", "/w/*", "/c/*"]`.
  - For all other requests (e.g. static JS/CSS bundles or root `/`), the Worker delegates to `env.ASSETS.fetch(request)`.
- **Data Access & Security Model**:
  - **Zero Public SELECT Policies**: Tables `shared_weeks`, `collections`, `collection_items`, and `share_creation_logs` have Row-Level Security (RLS) enabled with NO public `SELECT` policies.
  - **Parent-Derived Authorization for `collection_items`**: `collection_items` contains no `user_id` column. Access control is strictly derived through parent `collections` ownership via subquery:
    `collection_id IN (SELECT id FROM public.collections WHERE user_id = auth.uid())`.
    This guarantees a user cannot read, insert, update, or delete items in another user's collection even if they know or guess the `collection_id` or `item_id`.
  - **Owner Writes & Operations**: Authenticated owners perform updates and deactivations using their Supabase JWT access token (`auth.uid() = user_id`).
  - **Concurrency-Safe Atomic RPC Creations**:
    - Share creation (`create_shared_week`) and collection creation (`create_collection`) are executed via `SECURITY DEFINER` RPC functions.
    - **Transaction-Level Advisory Locking**: At the very beginning of execution, both RPCs acquire an explicit transaction-level PostgreSQL advisory lock scoped to the authenticated user ID:
      `PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('user_share_lock:' || v_user_id::text));`
    - This serializes all concurrent creation requests for a specific user. If multiple creation requests for the same user land simultaneously across worker threads or DB connections, PostgreSQL queues them sequentially.
    - **Combined Hourly Rate Limit (10 total / hour)**: The lock ensures an accurate, race-free count of rows in `public.share_creation_logs` across **both** features combined (shared weeks + collections).
    - **Race-Free Quota Checks**: Active quota counts (`count(*) WHERE user_id = v_user_id AND is_active = true`) are evaluated while holding the lock. A 4th concurrent request will strictly see 3 existing active links and fail with an exception.
    - **Rollback & Recovery Safety**: Transaction-level advisory locks are automatically released by PostgreSQL when the transaction ends (commit or rollback). If a transaction fails or rolls back, any inserted `share_creation_logs` row is undone, preventing failed/aborted requests from consuming the creation rate limit. Deactivating an active share (`is_active = false`) reduces the active count, immediately recovering quota capacity (up to max 3 active).
    - **ID Generation**: Generates a 128-bit cryptographically random hex ID server-side (`pg_catalog.encode(pg_catalog.gen_random_bytes(16), 'hex')`).
  - **Hardened RPC Permissions & Public Default Revocation**:
    - In PostgreSQL, newly created functions automatically grant `EXECUTE` privileges to the `PUBLIC` pseudorole by default.
    - To prevent unauthorized execution or privilege escalation, all sharing RPCs explicitly execute `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;` before granting granular access to specific roles.
    - Public read functions (`get_shared_week`, `get_shared_collection`) are granted to `anon` and `authenticated`.
    - Creation functions (`create_shared_week`, `create_collection`) are granted to `authenticated` ONLY.
    - All `SECURITY DEFINER` functions run with `SET search_path = ''` and fully schema-qualify all function and table references (e.g., `public.shared_weeks`, `pg_catalog.gen_random_bytes`, `auth.uid()`).
  - **Public Snapshot Reads via Status-Aware RPCs**:
    - Public reads to `/w/:id` and `/c/:id` call `SECURITY DEFINER` RPC functions `get_shared_week(p_id)` and `get_shared_collection(p_id)`.
    - To allow the Worker to accurately distinguish HTTP 404 (nonexistent ID) from HTTP 410 (deactivated share link) without exposing private data, the RPC checks for the ID's existence in the database regardless of `is_active`:
      - If ID is NOT found: Returns `status = 'not_found'` (or NULL JSON).
      - If ID exists BUT `is_active = false`: Returns `status = 'deactivated'`, accompanied by **NO item data, notes, titles, dates, or user metadata**.
      - If ID exists AND `is_active = true`: Returns `status = 'active'`, along with the sanitized snapshot data.
    - No listing or enumeration functions exist.
  - **No Service-Role Key Needed**: The Worker uses `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` exclusively.
- **Authentication**: Worker verifies user tokens via `supabase.auth.getUser(token)` using `SUPABASE_PUBLISHABLE_KEY`. Local JWKS signature verification is noted as a future latency optimization.

---

## 2. Migration Plan & Database Schema

Migrations must be applied in exact numerical order:

### Migration `002_share_my_week.sql` (Corrected In-Place)
*Note: Corrected in-place because it has never been applied in production.*
- **Table**: `public.shared_weeks`
  - Columns: `id` (text PRIMARY KEY - 32 char random hex), `user_id` (uuid REFERENCES auth.users ON DELETE CASCADE), `week_start_date` (text), `week_end_date` (text), `week_label` (text), `display_name` (text max 40), `total_planned_minutes` (integer), `items` (jsonb array of sanitized items: `title`, `source`, `type`, `duration`, `coverReference`, `day`, `dateStr` - **NEVER** private notes or internal URLs), `is_active` (boolean DEFAULT true), `created_at` (timestamptz DEFAULT now()), `updated_at` (timestamptz DEFAULT now()).
- **Creation Logging Table**:
  - `public.share_creation_logs`: `id` (uuid PRIMARY KEY DEFAULT gen_random_uuid()), `user_id` (uuid REFERENCES auth.users ON DELETE CASCADE), `created_at` (timestamptz DEFAULT now()).
  - **RLS Enforced**: Enabled RLS. Owner policy: `auth.uid() = user_id`. No public policies.
- **RLS Policies on `shared_weeks`**:
  - `SELECT`: `auth.uid() = user_id` (No public SELECT policy).
  - `INSERT`: Allowed only via `create_shared_week` RPC or owner `auth.uid() = user_id`.
  - `UPDATE`, `DELETE`: `auth.uid() = user_id`.
- **Concurrency-Safe Atomic Creation RPC (`create_shared_week`)**:
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

    -- Server-side 128-bit random hex ID generation (32 chars)
    v_new_id := pg_catalog.encode(pg_catalog.gen_random_bytes(16), 'hex');

    -- Insert snapshot
    INSERT INTO public.shared_weeks (
      id, user_id, week_start_date, week_end_date, week_label,
      display_name, total_planned_minutes, items, is_active, created_at, updated_at
    ) VALUES (
      v_new_id, v_user_id, p_week_start_date, p_week_end_date, p_week_label,
      pg_catalog.substring(pg_catalog.trim(p_display_name) from 1 for 40),
      p_total_planned_minutes, p_items, true, pg_catalog.now(), pg_catalog.now()
    );

    -- Log creation event (shared across both features)
    INSERT INTO public.share_creation_logs (user_id, created_at) VALUES (v_user_id, pg_catalog.now());

    RETURN pg_catalog.jsonb_build_object('id', v_new_id, 'success', true);
  END;
  $$;

  -- Revoke default PUBLIC privileges and grant exclusively to authenticated
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

    -- Case 1: ID does not exist in database -> HTTP 404
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('status', 'not_found');
    END IF;

    -- Case 2: ID exists but is deactivated -> HTTP 410 (Returns NO snapshot or user data)
    IF NOT v_row.is_active THEN
      RETURN pg_catalog.jsonb_build_object('status', 'deactivated');
    END IF;

    -- Case 3: ID exists and is active -> HTTP 200
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

  -- Revoke default PUBLIC privileges and grant to anon and authenticated
  REVOKE EXECUTE ON FUNCTION public.get_shared_week(text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.get_shared_week(text) TO anon, authenticated;
  ```

### Migration `003_item_tombstones.sql` (Separate Sync Task)
- Manages soft-deletes/tombstones for cross-device item sync.

### Migration `004_collections_and_collection_items.sql`
- **Tables**:
  - `public.collections`: `id` (text PRIMARY KEY), `user_id` (uuid REFERENCES auth.users ON DELETE CASCADE), `title` (text max 80), `description` (text max 300), `display_name` (text max 40), `allow_search_engines` (boolean DEFAULT false), `is_active` (boolean DEFAULT true), `total_duration_minutes` (integer), `created_at`, `updated_at`.
  - `public.collection_items`: `id` (text PRIMARY KEY), `collection_id` (text REFERENCES public.collections(id) ON DELETE CASCADE), `title` (text), `source` (text), `type` (text), `duration` (integer), `duration_is_estimate` (boolean), `cover_reference` (text), `url` (text), `canonical_url` (text), `youtube_id` (text), `position` (integer). **NEVER** stores private notes or metadata.

- **RLS Policies on `collections`**:
  ```sql
  ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "collections_select_policy" ON public.collections
    FOR SELECT USING (auth.uid() = user_id);

  CREATE POLICY "collections_insert_policy" ON public.collections
    FOR INSERT WITH CHECK (auth.uid() = user_id);

  CREATE POLICY "collections_update_policy" ON public.collections
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  CREATE POLICY "collections_delete_policy" ON public.collections
    FOR DELETE USING (auth.uid() = user_id);
  ```

- **RLS Policies on `collection_items` (Parent-Derived Authorization)**:
  ```sql
  ALTER TABLE public.collection_items ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "collection_items_select_policy" ON public.collection_items
    FOR SELECT USING (
      collection_id IN (
        SELECT c.id FROM public.collections c WHERE c.user_id = auth.uid()
      )
    );

  CREATE POLICY "collection_items_insert_policy" ON public.collection_items
    FOR INSERT WITH CHECK (
      collection_id IN (
        SELECT c.id FROM public.collections c WHERE c.user_id = auth.uid()
      )
    );

  CREATE POLICY "collection_items_update_policy" ON public.collection_items
    FOR UPDATE USING (
      collection_id IN (
        SELECT c.id FROM public.collections c WHERE c.user_id = auth.uid()
      )
    ) WITH CHECK (
      collection_id IN (
        SELECT c.id FROM public.collections c WHERE c.user_id = auth.uid()
      )
    );

  CREATE POLICY "collection_items_delete_policy" ON public.collection_items
    FOR DELETE USING (
      collection_id IN (
        SELECT c.id FROM public.collections c WHERE c.user_id = auth.uid()
      )
    );
  ```

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

    -- Concurrency Lock: Acquire per-user transaction advisory lock
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('user_share_lock:' || v_user_id::text));

    v_item_count := pg_catalog.jsonb_array_length(p_items);
    IF v_item_count > 50 THEN
      RAISE EXCEPTION 'Item limit exceeded: Collections may contain at most 50 items.' USING ERRCODE = 'P0003';
    END IF;

    -- Rate Limit: Max 10 combined creations (shared weeks + collections) per hour
    SELECT pg_catalog.count(*) INTO v_recent_creations
    FROM public.share_creation_logs
    WHERE user_id = v_user_id AND created_at > pg_catalog.now() - interval '1 hour';

    IF v_recent_creations >= 10 THEN
      RAISE EXCEPTION 'Rate limit exceeded: Max 10 creation actions per hour.' USING ERRCODE = 'P0001';
    END IF;

    -- Quota: Max 3 active collections
    SELECT pg_catalog.count(*) INTO v_active_collections
    FROM public.collections
    WHERE user_id = v_user_id AND is_active = true;

    IF v_active_collections >= 3 THEN
      RAISE EXCEPTION 'Collection quota exceeded: Free accounts may keep up to 3 active collections.' USING ERRCODE = 'P0004';
    END IF;

    v_new_id := pg_catalog.encode(pg_catalog.gen_random_bytes(16), 'hex');

    -- Insert collection header
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

    -- Insert collection items
    FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_items) LOOP
      v_idx := v_idx + 1;
      v_total_dur := v_total_dur + COALESCE((v_elem->>'duration')::integer, 0);

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

  -- Revoke default PUBLIC privileges and grant exclusively to authenticated
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

    -- Case 1: ID does not exist in database -> HTTP 404
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('status', 'not_found');
    END IF;

    -- Case 2: ID exists but is deactivated -> HTTP 410 (Returns NO item data or owner info)
    IF NOT v_col.is_active THEN
      RETURN pg_catalog.jsonb_build_object('status', 'deactivated');
    END IF;

    -- Case 3: ID exists and is active -> HTTP 200
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

  -- Revoke default PUBLIC privileges and grant to anon and authenticated
  REVOKE EXECUTE ON FUNCTION public.get_shared_collection(text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.get_shared_collection(text) TO anon, authenticated;
  ```

---

## 3. Function-by-Function Permission Matrix

| RPC Name | Function Signature | Security Type | Default `PUBLIC` Revoked | Granted Roles | Intended Operations & Input Validation |
|---|---|---|---|---|---|
| `public.create_shared_week` | `(text, text, text, text, integer, jsonb)` | `SECURITY DEFINER` | **YES** (`REVOKE ... FROM PUBLIC`) | `authenticated` ONLY | Validates `auth.uid() IS NOT NULL`, acquires `pg_advisory_xact_lock`, checks 10/hr combined limit & 3-active quota, generates 128-bit hex ID server-side, inserts snapshot into `shared_weeks` and log into `share_creation_logs`. |
| `public.get_shared_week` | `(text)` | `SECURITY DEFINER` | **YES** (`REVOKE ... FROM PUBLIC`) | `anon`, `authenticated` | Public snapshot lookup. Checks exact ID. If active, returns sanitized week snapshot. If deactivated, returns `{ "status": "deactivated" }` with NO user/item metadata. If missing, returns `{ "status": "not_found" }`. No list/enumeration functions. |
| `public.create_collection` | `(text, text, text, boolean, jsonb)` | `SECURITY DEFINER` | **YES** (`REVOKE ... FROM PUBLIC`) | `authenticated` ONLY | Validates `auth.uid() IS NOT NULL` & item array length <= 50, acquires advisory lock, checks 10/hr combined limit & 3-active quota, truncates title/description, generates server-side hex ID, inserts header & items, logs creation. |
| `public.get_shared_collection` | `(text)` | `SECURITY DEFINER` | **YES** (`REVOKE ... FROM PUBLIC`) | `anon`, `authenticated` | Public snapshot lookup. Checks exact ID. If active, returns aggregated JSON snapshot of collection + items. If deactivated, returns `{ "status": "deactivated" }` with NO item data or owner metadata. If missing, returns `{ "status": "not_found" }`. |

---

## 4. Rate Limiting Strategy & Cloudflare Binding Configuration

### Clear Distinction: Edge IP Protection vs. Database User Quotas
1. **Per-User Database Creation Limit (10 total / hour)**:
   - Enforced across **both** shared weeks and collections combined via transaction-level advisory locks inside database RPCs `create_shared_week` and `create_collection`.
   - Counts total rows in `share_creation_logs` for `v_user_id` in `now() - interval '1 hour'`. If `>= 10`, returns exception `P0001` (HTTP 429 in API).
2. **Per-Client Edge Rate Limiting (100 req / min per IP)**:
   - Enforced at the Cloudflare edge for public page routes `/w/*` and `/c/*` before hitting the Worker or database.
   - **Client Identification**: Identifies clients by client IP address derived from the `CF-Connecting-IP` request header provided by Cloudflare.
   - **Exceeded Limit Response**: When a client IP exceeds 100 requests in a 60-second window, the edge rate limiter immediately returns **HTTP 429 Too Many Requests** with header `Retry-After: 60` and body `{"error": "Too Many Requests"}` without invoking Worker compute or database RPCs.

### Verified Cloudflare Rate Limiting Binding Schema (Wrangler 4.x)
In Cloudflare Workers Rate Limiting bindings (Wrangler 4.x), `namespace_id` is an **integer string ID** (e.g. `"1001"`) assigned by Cloudflare when creating the Rate Limiting namespace via the Cloudflare Dashboard or API, rather than an arbitrary text string slug.

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

### Environment Setup & Prerequisites
- **Workers Paid Plan Prerequisite**: Native Cloudflare Workers Rate Limiting bindings (`env.PUBLIC_RATE_LIMITER.limit({ key: ip })`) require a Cloudflare Workers Paid plan and an established Rate Limiting namespace ID in the Cloudflare Dashboard.
- **Workers Free Plan Fallback**: If deployed on a Cloudflare Workers Free plan where Rate Limiting bindings are unavailable, the `ratelimits` block in `wrangler.jsonc` is omitted, and edge IP rate protection is configured directly via Cloudflare Dashboard **WAF Rate Limiting Rules** targeting path patterns `/w/*` and `/c/*`.
- **Preview vs Production Environments**:
  - In `preview` and local `wrangler dev` environments, Rate Limiting bindings are mocked in-memory or disabled to avoid rate-limiting test suites.
  - In `production`, the namespace ID (`"1001"`) is bound in Cloudflare Dashboard and specified in `wrangler.jsonc`.

---

## 5. Worker Routes, HTML Rendering & Security Headers

### API Routes
- `POST /api/share`: Extracts Bearer token -> calls `supabase.auth.getUser(token)` -> executes `create_shared_week` RPC -> returns 201 with `{ id, url: "${APP_URL}/w/${id}" }`.
- `PATCH /api/share/:id`: Authenticates -> updates `shared_weeks` via Supabase client with RLS.
- `DELETE /api/share/:id`: Authenticates -> sets `is_active = false` via RLS.
- `GET /api/share/:id`: Calls `get_shared_week(id)` RPC.
- `POST /api/collections`: Extracts Bearer token -> calls `create_collection` RPC -> returns 201 with `{ id, url: "${APP_URL}/c/${id}" }`.
- `PATCH /api/collections/:id`: Authenticates -> updates collection via RLS.
- `DELETE /api/collections/:id`: Authenticates -> sets `is_active = false`.
- `GET /api/collections/:id`: Calls `get_shared_collection(id)` RPC.

### Public Server-Rendered Pages (`GET /w/:id` and `GET /c/:id`)

The Worker handles requests strictly based on the ID format and RPC result status:

1. **Malformed ID Handling (HTTP 400 Bad Request)**:
   - Worker checks ID against regex `^[a-f0-9]{32}$` (128-bit hex).
   - If ID contains path traversal (`..`), shell metacharacters, non-hex characters, or length != 32: Worker immediately returns **HTTP 400 Bad Request** without querying the database.
2. **RPC Invocation**:
   - Worker invokes `get_shared_week(id)` or `get_shared_collection(id)`.
3. **Nonexistent ID Handling (HTTP 404 Not Found)**:
   - RPC returns `{ "status": "not_found" }`.
   - Worker returns **HTTP 404 Not Found** rendered HTML: *"Shared page not found. The link may be invalid."*
4. **Deactivated ID Handling (HTTP 410 Gone)**:
   - RPC returns `{ "status": "deactivated" }`.
   - **Security Guarantees**: The RPC payload contains **no titles, dates, duration, item lists, or user metadata**.
   - Worker returns **HTTP 410 Gone** rendered HTML: *"This week/collection is no longer shared. The owner has deactivated or removed this link."*
5. **Active ID Handling (HTTP 200 OK)**:
   - RPC returns `{ "status": "active", ...snapshotData }`.
   - Worker renders full HTML snapshot with escaped variables.

### Caching, Edge Invalidation & Deactivation Window
- **Cache Header**: `Cache-Control: public, max-age=60, s-maxage=60`
- **Revocation Window & Trade-off Analysis**:
  - Setting `max-age` to 60 seconds ensures edge CDN nodes and browser caches revalidate public pages at least once per minute.
  - When an owner deactivates a share link or collection, any CDN-cached 200 OK response will expire within **at most 60 seconds**.
  - Subsequent requests after 60 seconds hit the Worker, execute `get_shared_week`/`get_shared_collection`, receive `{ "status": "deactivated" }`, and serve an un-cachable or short-cached HTTP 410 Gone response (`Cache-Control: no-cache` or `max-age=0`).
  - This guarantees that revoked or deactivated content does not remain publicly accessible on the web beyond the intended 60-second window, while shielding the Supabase database from request surges.

### Page Elements & Links
- **Plan Your Own Week**: Header CTA button linking to `${APP_URL}/?ref=share`.
- **Report This Page**: Footer mailto link: `mailto:support@curate.app?subject=Report%20Shared%20Page%20${id}`.
- **Save to My Curate Import Flow**: Collection pages contain a link: `${APP_URL}/?import_collection=${id}&ref=collection`. When clicked, the SPA frontend detects `import_collection`, fetches the public JSON snapshot via `get_shared_collection(id)`, and populates the user's local Inbox or Collection builder.

### Strict Content Security Policy & Headers
- `Content-Security-Policy: default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://img.youtube.com https://i.ytimg.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';`
- `X-Robots-Tag: noindex, nofollow` (omitted on collections if `allow_search_engines = true`).
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`

---

## 6. Environment Variable Synchronization & Local Development

### Environment Variable Synchronization
- In `wrangler.jsonc`, `vars` contains empty placeholders (`""`).
- Production values are set via Cloudflare Dashboard / `wrangler secret`.
- Local development values are defined in `.dev.vars` (e.g. `APP_URL=http://localhost:8787`).
- **Sync with Frontend (`VITE_APP_URL`)**: `VITE_APP_URL` in `.env` is supplied to Vite during build time for client-side absolute URL generation, while `APP_URL` is read at runtime by the Worker. Both point to the root canonical origin (e.g. `https://curate.app`).

### Local Worker Development
- Dev dependencies include `@cloudflare/workers-types` and `wrangler`.
- Command `npm run preview` executes `wrangler dev` to run the Worker and static asset router locally on `http://localhost:8787`.
- `package.json` scripts remain unchanged:
  - `"build": "vite build"`
  - `"lint": "tsc --noEmit"`
  - `"preview": "wrangler dev"`

---

## 7. Verification & Test Plan

1. **Wrangler Configuration Pre-Deployment Validation**:
   - Prior to deployment, run `npx wrangler types` and `npx wrangler deploy --dry-run` in CI to validate `wrangler.jsonc` syntax, assets routes, and binding schemas.
2. **Automated HTML & XSS Injection Verification**:
   - Automated Worker unit tests (`src/worker/__tests__/escaping.test.ts`) sending malicious payloads: `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `"><svg/onload=alert(1)>`. Verify rendered HTML output escapes `<` to `&lt;`, `>` to `&gt;`, `"` to `&quot;`.
3. **Shell Metacharacter Safety**:
   - Input strings containing `$(id)`, `` `id` ``, `; rm -rf /`, `' OR '1'='1`, `\"`, `\\` verified to render strictly as verbatim plain text strings.
4. **Manual Two-Account & RPC Permission Test Script (`supabase/tests/004_rls_sharing_test.sql`)**:
   - Uses `tests.create_supabase_user` and `tests.authenticate_as`.
   - **RPC Execution Permission Tests**:
     - Verifies `anon` calling `create_shared_week` or `create_collection` fails with PostgreSQL exception `42501` ("permission denied for function...").
     - Verifies `anon` calling `get_shared_week` or `get_shared_collection` succeeds.
     - Verifies `authenticated` role can call `create_shared_week` and `create_collection`.
   - **RLS Isolation Tests**:
     - Verifies User A cannot read, update, or delete User B's `shared_weeks` or `collections` via direct API or SQL.
     - Verifies User A cannot read, insert, update, or delete items in User B's `collection_items` even if they guess User B's `collection_id` or `item_id`.
     - Verifies `anon` role receives zero rows querying `shared_weeks`, `collections`, or `collection_items` directly.
     - Verifies `get_shared_collection` returns `{ status: 'active' }` for active IDs, `{ status: 'deactivated' }` (with NO items/user metadata) for deactivated IDs, and `{ status: 'not_found' }` for nonexistent IDs.
5. **Concurrency & Rate Limit Integration Test Scenarios**:
   - **Simultaneous Share Creation**: Fires 5 concurrent `create_shared_week` calls for User A (who has 0 active shares). Transaction advisory lock serializes execution: requests 1, 2, 3 succeed; requests 4 and 5 fail with exception `P0002` ("Active link quota exceeded"). Exactly 3 active shares created.
   - **Simultaneous Collection Creation**: Fires 5 concurrent `create_collection` calls for User A. Lock serializes execution: 3 succeed, 2 fail. Exactly 3 active collections created.
   - **Combined Hourly Rate Limit**: Fires 6 `create_shared_week` RPCs followed by 5 `create_collection` RPCs within 1 hour for User A. Lock serializes execution: first 10 total creations log into `share_creation_logs`; the 11th creation attempt fails with exception `P0001` ("Rate limit exceeded").
   - **Transaction Rollback Behavior**: Simulates a creation attempt where `collection_items` insertion fails midway (e.g. invalid type). The entire RPC transaction rolls back, releasing the advisory lock and undoing the `share_creation_logs` insert. Creation log count remains unaffected.
   - **Quota Recovery After Deactivation**: User A deactivates 1 of 3 active shared weeks (`is_active = false`). Active share count drops to 2. Subsequent `create_shared_week` call acquires lock, sees 2 active shares, and succeeds.
6. **HTTP Status Code Verification**:
   - Malformed ID (`/w/invalid..id`) -> HTTP 400 Bad Request.
   - Nonexistent ID (`/w/00000000000000000000000000000000`) -> HTTP 404 Not Found.
   - Deactivated ID (`is_active = false`) -> HTTP 410 Gone.

---

## 8. Open Questions

1. *Cloudflare Rate Limiting Plan*: Is Cloudflare Workers Rate Limiting binding enabled on the production plan, or should Cloudflare WAF rules be configured in the dashboard? (Plan configures the binding schema with integer `namespace_id: "1001"` with fallback to WAF).

---

## 9. Realistic Estimated Hours

| Step | Description | Estimated Hours |
|---|---|---|
| **Step 1: Database Migrations & RPCs** | Correct `002_share_my_week.sql`, write `004_collections.sql`, concurrency-safe `create_shared_week` & `create_collection` RPCs with `pg_advisory_xact_lock`, explicit `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC`, schema qualification (`SET search_path = ''`), combined 10/hr rate limit logging, 128-bit hex generation, public status-aware RPCs `get_shared_week` & `get_shared_collection` | 3.5 hrs |
| **Step 2: Cloudflare Worker Core & API Routes** | TypeScript Worker entrypoint (`src/worker/index.ts`), token verification via `getUser`, `/api/share` and `/api/collections` endpoints, `wrangler.jsonc` `run_worker_first` config | 4.0 hrs |
| **Step 3: Worker HTML Rendering & Security Headers** | HTML renderers for `/w/:id` and `/c/:id`, strict CSP (`script-src 'none'`), status-aware 410 Gone vs 404 logic, `Cache-Control: max-age=60`, 'Report this page' and 'Plan your own week' links | 3.5 hrs |
| **Step 4: Frontend API Integration & Import Flow** | Wire frontend API calls, token headers, error toasts for quotas/rate limits, collection import flow wiring | 2.5 hrs |
| **Step 5: Automated & Manual Security Test Suite** | Write automated Worker HTML escaping tests, `supabase/tests/004_rls_sharing_test.sql` two-account, RPC permission & concurrency test script, XSS & metacharacter verification | 3.0 hrs |
| **Step 6: Config Validation, Cleanup & E2E Verification** | Remove `server.ts` & `data/`, validate `wrangler.jsonc` assets routing, local `wrangler dev` testing, security review | 2.5 hrs |
| **Total** | | **19.0 hrs** |
