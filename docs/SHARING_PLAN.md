# Cloudflare Worker & Supabase Architecture Plan: Share My Week & Share Collections

This plan details the replacement of the Express backend (`server.ts`) and local JSON persistence (`data/`) with a TypeScript Cloudflare Worker entrypoint integrated with Supabase for **Share My Week** and **Share Collections**.

---

## 1. Overview & Architecture Strategy

- **Static Assets & SPA**: Cloudflare Workers serve static frontend assets built by Vite (`dist/`).
- **Routing**: `wrangler.jsonc` routes `/api/*`, `/w/*`, and `/c/*` directly to the Cloudflare Worker entrypoint before static assets or SPA fallback handling.
- **Data Access & Security Model**:
  - **No Public SELECT Policies**: Zero public read policies on `shared_weeks`, `collections`, and `collection_items`.
  - **Owner Operations**: Authenticated users write/modify data using their JWT access token via Supabase client with RLS (`auth.uid() = user_id`). Quotas (max 3 active shared weeks, max 3 active collections, max 50 items each) are enforced in database policies/triggers.
  - **Public Snapshot Reads**: Public access to active shared weeks (`/w/:id`) and collections (`/c/:id`) is provided strictly via database `SECURITY DEFINER` RPC functions (`get_shared_week(p_id)` and `get_shared_collection(p_id)`). These functions execute with `SET search_path = ''`, return snapshot columns for an exact ID only when `is_active = true`, and are granted to `anon` and `authenticated`. No listing functions exist.
  - **No Service-Role Key Needed**: The Cloudflare Worker uses `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` only.
- **Authentication**: Worker verifies user tokens by calling `supabase.auth.getUser(token)` with `SUPABASE_PUBLISHABLE_KEY`. Local JWKS verification is documented as a future latency optimization.

---

## 2. Migration Plan & Database Schema

Migrations must be applied in exact numerical order:

### Migration `002_share_my_week.sql` (Corrected In-Place)
*Note: Corrected in-place because it has never been applied to any environment.*
- **Table**: `public.shared_weeks`
  - Columns: `id` (text, primary key - 32 char random hex), `user_id` (uuid references auth.users), `week_start_date` (text), `week_end_date` (text), `week_label` (text), `display_name` (text, max 40 chars sanitized), `total_planned_minutes` (integer), `items` (jsonb array of sanitized items: title, source, type, duration, coverReference, day, dateStr - **NEVER** notes or internal URLs), `is_active` (boolean, default true), `created_at` (timestamptz), `updated_at` (timestamptz).
- **RLS Policies**:
  - Enable RLS on `shared_weeks`.
  - `SELECT`: `auth.uid() = user_id` (NO public SELECT policy).
  - `INSERT`: `auth.uid() = user_id` WITH CHECK (`auth.uid() = user_id` AND `(SELECT count(*) FROM shared_weeks WHERE user_id = auth.uid() AND is_active = true) < 3`).
  - `UPDATE`: `auth.uid() = user_id`.
  - `DELETE`: `auth.uid() = user_id`.
- **Public Read RPC**:
  ```sql
  CREATE OR REPLACE FUNCTION public.get_shared_week(p_id text)
  RETURNS TABLE (
    id text,
    week_start_date text,
    week_end_date text,
    week_label text,
    display_name text,
    total_planned_minutes integer,
    items jsonb,
    is_active boolean,
    created_at timestamptz
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
  BEGIN
    RETURN QUERY
    SELECT s.id, s.week_start_date, s.week_end_date, s.week_label, s.display_name,
           s.total_planned_minutes, s.items, s.is_active, s.created_at
    FROM public.shared_weeks s
    WHERE s.id = p_id AND s.is_active = true;
  END;
  $$;

  GRANT EXECUTE ON FUNCTION public.get_shared_week(text) TO anon, authenticated;
  ```

### Migration `003_item_tombstones.sql` (Separate Sync Task)
- Tracks soft-deletes/tombstones for client item sync across devices.

### Migration `004_collections_and_collection_items.sql`
- **Tables**: `public.collections` and `public.collection_items`
  - `collections`: `id` (text, primary key), `user_id` (uuid references auth.users), `title` (text max 80), `description` (text max 300), `display_name` (text max 40), `allow_search_engines` (boolean default false), `is_active` (boolean default true), `total_duration_minutes` (integer), `created_at`, `updated_at`.
  - `collection_items`: `id` (text, primary key), `collection_id` (text references public.collections on delete cascade), `title` (text), `source` (text), `type` (text), `duration` (integer), `duration_is_estimate` (boolean), `cover_reference` (text), `url` (text), `canonical_url` (text), `youtube_id` (text), `position` (integer). **NEVER** stores notes or private metadata.
- **Quota Enforcements & RLS Policies**:
  - Max 3 active collections per user enforced on INSERT in RLS or trigger (`count(*) < 3`).
  - Max 50 items per collection enforced on INSERT in `collection_items`.
  - `SELECT` on `collections` & `collection_items`: Only `auth.uid() = user_id`.
  - Owner `INSERT`, `UPDATE`, `DELETE`: `auth.uid() = user_id`.
- **Creation Rate Limit Table & Function (DB-Level)**:
  ```sql
  CREATE TABLE IF NOT EXISTS public.share_creation_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX idx_share_creation_logs_user_time ON public.share_creation_logs(user_id, created_at DESC);
  ```
- **Public Collection Read RPC**:
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
    WHERE c.id = p_id AND c.is_active = true;

    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    SELECT jsonb_agg(
      jsonb_build_object(
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
    )
    INTO v_items
    FROM public.collection_items i
    WHERE i.collection_id = p_id;

    RETURN jsonb_build_object(
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

  GRANT EXECUTE ON FUNCTION public.get_shared_collection(text) TO anon, authenticated;
  ```

---

## 3. Rate Limiting Strategy

1. **Per-User Creation Limit (10 per hour)**:
   - Enforced in database upon creation POST requests (`/api/share`, `/api/collections`).
   - The API checks `SELECT count(*) FROM share_creation_logs WHERE user_id = auth.uid() AND created_at > now() - interval '1 hour'`. If `>= 10`, returns HTTP 429.
2. **Per-IP Public Page Rate Limit**:
   - **Chosen Method**: Cloudflare Workers Rate Limiting binding (`ratelimit` binding in `wrangler.jsonc`), which provides native 100 req/min edge protection without database load.
   - **Fallback**: If running on a Cloudflare plan without Workers Rate Limiting bindings enabled, Cloudflare WAF Rate Limiting rules are configured in the Cloudflare Dashboard targeting `/w/*` and `/c/*`.

---

## 4. Worker Routes & Middleware

The Worker entrypoint (`src/worker/index.ts` replacing `worker.js`) handles:

### API Endpoints
- `POST /api/share`: Authenticates Bearer token -> checks DB creation log rate limit -> validates input -> saves `shared_weeks` -> logs creation. Returns 201 with URL.
- `PATCH /api/share/:id`: Authenticates Bearer token -> updates `shared_weeks` if owner (`auth.uid() = user_id`).
- `DELETE /api/share/:id`: Authenticates Bearer token -> deletes or deactivates `shared_weeks` if owner.
- `GET /api/share/:id`: Calls `get_shared_week(id)` RPC.
- `POST /api/collections`: Authenticates Bearer token -> checks rate limit & 50-item limit -> sanitizes title (max 80) & description (max 300) -> saves `collections` and `collection_items`. Returns 201 with URL.
- `PATCH /api/collections/:id`: Authenticates Bearer token -> updates collection if owner.
- `DELETE /api/collections/:id`: Authenticates Bearer token -> sets `is_active = false` (ensuring subsequent public GETs return HTTP 410 Gone).
- `GET /api/collections/:id`: Calls `get_shared_collection(id)` RPC. If deactivated (`is_active = false`), returns 410.
- `POST /api/analytics/event`: Public beacon endpoint for anonymous telemetry (`share_viewed`, `collection_viewed`, `share_cta_clicked`).

### Public Server-Rendered HTML Routes
- `GET /w/:id`:
  - Validates `id` format (alphanumeric/hex, max 64 chars).
  - Calls `get_shared_week(id)` RPC using publishable key client.
  - If null / deactivated: Returns **HTTP 410 Gone** rendered HTML page.
  - If active: Returns 200 HTML page with:
    - Escaped output (HTML entity encoding for title, display name, items).
    - Open Graph & Twitter meta tags built dynamically using `APP_URL` (`${APP_URL}/w/${id}`).
    - Open Graph image tag pointing to `${APP_URL}/og-image.png`.
    - `Robots` meta tag & header: `X-Robots-Tag: noindex, nofollow`.
    - Strict Security Headers:
      - `Cache-Control: public, max-age=300, s-maxage=600`
      - `Referrer-Policy: no-referrer`
      - `X-Content-Type-Options: nosniff`
      - `Content-Security-Policy: default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self' ${SUPABASE_URL};`
- `GET /c/:id`:
  - Validates `id` format.
  - Calls `get_shared_collection(id)` RPC.
  - If deactivated: Returns **HTTP 410 Gone** page.
  - If active: Returns 200 HTML page with Pinterest-style responsive masonry card grid layout.
  - If `allow_search_engines` is true, omits `noindex` and outputs `<meta name="robots" content="index, follow" />`.
  - Same strict security headers and Open Graph metadata using `APP_URL`.

---

## 5. Environment Variables & Wrangler Configuration

### `wrangler.jsonc` Setup
```jsonc
{
  "name": "curate",
  "main": "./src/worker/index.ts",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application"
  },
  "vars": {
    "SUPABASE_URL": "https://<your-project-ref>.supabase.co",
    "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_...",
    "APP_URL": "https://curate.app"
  },
  "ratelimits": [
    {
      "binding": "PUBLIC_RATE_LIMITER",
      "namespace_id": "public_pages_limiter",
      "simple": { "limit": 100, "period": 60 }
    }
  ],
  "previews": {}
}
```

### Secrets to set in Cloudflare (if needed)
- No secret keys are required in the Worker because all database access uses the Publishable key + JWT token / RLS / RPCs.

---

## 6. Frontend Wiring & Cleanup Plan

1. **Frontend Integration (`src/lib/sharing.ts` or API client)**:
   - Call `/api/share` and `/api/collections` relative endpoints (same-origin).
   - Pass the user's Supabase session access token in `Authorization: Bearer <token>` header.
   - Show user-friendly error toasts on 429 Rate Limit or 400 Quota Exceeded responses.
2. **Server & Data Directory Removal**:
   - `server.ts` and `data/` directory will be removed completely in the execution PR following plan approval.
   - `package.json` scripts updated:
     - `"dev": "vite"`
     - `"build": "tsc --noEmit && vite build"`
     - `"preview": "wrangler dev"`

---

## 7. Comprehensive Test Plan (Including Injection Cases)

1. **HTML & XSS Injection Verification**:
   - Injection payloads in titles, display names, and descriptions (e.g. `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `"><svg onload=alert(1)>`).
   - Verify all rendered values in `/w/:id` and `/c/:id` HTML are safely escaped and plain text only.
2. **Shell Metacharacter Safety**:
   - Inputs containing shell metacharacters (`$(id)`, `` `id` ``, `; rm -rf /`, `' OR '1'='1`, `\"`, `\\`) must render verbatim as plain text strings without triggering shell execution or SQL injection.
3. **Authentication & Authorization**:
   - Unauthenticated request to POST/PATCH/DELETE `/api/share` -> HTTP 401 Unauthorized.
   - Attempting to PATCH or DELETE another user's share with a valid token from User B -> HTTP 403 / 404.
   - Expired JWT token -> HTTP 401 Unauthorized.
   - Anonymous API calls attempting `SELECT * FROM shared_weeks` via Supabase REST API directly -> Empty array / HTTP 401/403 (verifying no public SELECT policies).
4. **Data Isolation & Sanitization**:
   - Private item fields (e.g., private notes, personal user metadata) -> Verify they are **never** included in snapshot payloads or rendered HTML.
   - Invalid `id` format (e.g. path traversal attempts `/w/../../etc/passwd` or excessive length) -> HTTP 400 / 404.
5. **Deactivation & HTTP 410 Gone**:
   - Deactivating a week or collection -> Subsequent GET `/w/:id` and GET `/c/:id` return **HTTP 410 Gone** with the deactivated message page.

---

## 8. Open Questions

1. *Cloudflare Workers Rate Limiting Plan*: Does the deployment target a Paid Cloudflare Workers plan supporting `ratelimit` bindings in `wrangler.jsonc`, or should default Cloudflare Dashboard WAF rules be used? (Plan defaults to `ratelimit` binding with WAF fallback instructions).
2. *Dynamic Social Image Generation*: Static `public/og-image.png` is planned initially. Is a future Cloudflare Worker HTML-Canvas / SVG renderer for dynamic OG images desired in a later phase?

---

## 9. Estimated Hours per Step

| Step | Description | Estimated Hours |
|---|---|---|
| **Step 1** | Supabase Migrations (`002_share_my_week.sql` corrected, `004_collections.sql`, RPC functions `get_shared_week` & `get_shared_collection`, rate limit table) | 2.5 hrs |
| **Step 2** | Cloudflare Worker Entrypoint & API Routes (`/api/share`, `/api/collections`, `/api/analytics`) with JWT token verification via `getUser` | 3.5 hrs |
| **Step 3** | Worker HTML Renderers (`/w/:id`, `/c/:id`) with HTML escaping, Open Graph tags, HTTP 410 Gone logic, and security headers | 3.0 hrs |
| **Step 4** | Frontend API Client Wiring & Toast Handling for quotas/rate limits | 2.0 hrs |
| **Step 5** | Removal of `server.ts` & `data/`, `wrangler.jsonc` update, and build script adjustments | 1.0 hr |
| **Step 6** | Execution of Security & Injection Test Suite (XSS, Shell metacharacters, RLS isolation, HTTP 410 verification) | 2.0 hrs |
| **Total** | | **14.0 hrs** |
