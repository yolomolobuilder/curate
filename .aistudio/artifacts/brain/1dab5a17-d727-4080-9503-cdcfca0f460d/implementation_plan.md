# Share Collections Implementation Plan

Curate users can curate and publish public content boards ("Collections") from their existing library, share them with rich Pinterest-style responsive masonry cards and server-rendered social previews, and import other creators' collections into their Inbox with duplicate protection.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and UX choices have been confirmed based on the initial clarification:
> - **Item Selection Entry Point**: Users can multi-select items directly from their Inbox or Library via interactive checkboxes and a contextual bottom floating action bar.
> - **Public Collection Layout**: Responsive Pinterest-style masonry card grid featuring cover thumbnails, content type badges, source tags, and duration indicators.
> - **Collection Management**: Integrated directly into the top navigation as a dedicated **"Collections"** section for fast access, link copying, SEO indexing toggles, and collection deletion.

---

### 1. Overview & Core Concept

- **What It Does**: Enables users to group up to 50 items from their Curate library into a thematic public collection board (e.g., "Deep Dives in Neuroplasticity", "Essays on Architecture & Design", "Weekend Film & Documentary Watchlist").
- **Target Audience**: Curious knowledge workers, students, researchers, and creators who want to share curated playlists of multimedia resources with colleagues or their audience.
- **Key Value**: Provides a shareable, beautifully formatted media board without social networking bloat (no feeds, no follower counts, no comments, no algorithmic vanity metrics), coupled with a 1-click import into personal Curate accounts.

---

### 2. User Experience & Visual Design

#### A. Key User Flows

1. **Selection & Creation (In-App)**:
   - User clicks **"Select"** in the Library or Inbox toolbar to enter selection mode.
   - Multi-select checkboxes appear on items; clicking cards adds them to the selection batch.
   - A bottom floating action bar emerges: `"[X] items selected"`, `"+ Create Collection"`, and `"Clear"`.
   - Clicking `"+ Create Collection"` opens the **Create Collection Modal**:
     - Title input: Max 80 characters with live counter.
     - Description: Optional, max 300 characters, plain text only.
     - Reorderable item list with remove pills.
     - **"Allow search engines"** toggle switch (default: off).
     - Account limit badge: Free accounts limited to 3 active collections and 50 items per collection.
   - User hits **"Publish Collection"**; receives instant public link `/c/:id`, with quick actions to copy link, view public page, or close.

2. **Public Viewing (`/c/:id`)**:
   - Clean, editorial masthead in Newsreader / serif typography displaying the collection title and plain-text description.
   - Metadata bar: Item count (`X items`), total listening/reading duration (`Yh Zm`), and quiet attribution.
   - **Pinterest-Style Responsive Masonry Grid**:
     - Visual cards organized into CSS masonry columns with varied vertical rhythm.
     - Each card displays high-resolution thumbnail or type-specific fallback, item title, content type badge (`YouTube`, `Article`, `Podcast`, `Book`, etc.), source domain/channel, and duration.
     - Direct external link icon (`↗`) opening the original URL in a new tab.
     - **Strict Privacy**: Creator notes, completion dates, and private tags are completely excluded from the public render.
   - **Primary Action**: Sticky or hero-adjacent **"Save to my Curate"** button.
   - **Footer**: Curate brand signature, `"Plan your own week. Curate your curiosity."`, `"Open Curate →"` button with `?ref=collection`, a takedown notice, and a `"Report this page"` modal trigger.

3. **Collection Import ("Save to my Curate")**:
   - Clicking `"Save to my Curate"` checks for user authentication.
   - If not signed in: Opens the sign-in/sign-up modal with an informative notice: *"An account is required to save collections to your personal Curate library."*
   - Once authenticated:
     - Checks user's existing items using canonical URL deduplication (for YouTube: matching 11-character video ID; for web articles/podcasts: normalized URL stripped of UTM tags).
     - Imports all non-duplicate items directly to the user's **Inbox** (`status: 'inbox'`).
     - Preserves original durations and `durationIsEstimate` flags.
     - Never copies any private notes or annotations.
     - Refetches/triggers fresh YouTube duration metadata rather than relying on stale cached values.
     - Displays completion toast: `"Added 8 items to your Inbox (2 duplicates skipped)"`.

4. **Collections Management (`Collections` Nav Tab)**:
   - Accessible via the main top navigation alongside `Home` and `Calendar`.
   - Displays all collections created by the current user with status pills (Active / Deactivated), search engine indexing status, item count, and creation date.
   - Inline controls:
     - Toggle Active / Inactive (deactivated links immediately serve HTTP 410 Gone).
     - Toggle "Allow search engines" (switches `<meta name="robots">` between `noindex, nofollow` and `index, follow`).
     - "Copy Link" to clipboard.
     - "Delete" (permanently deletes record; subsequent visits return HTTP 410 Gone).

#### B. Visual Identity & Anti-Slop Styling

- **Typography**: Editorial serif (`Newsreader`, Georgia) for collection titles; clean geometric sans (`Plus Jakarta Sans` / system UI) for body and UI elements; tabular figures (`tabular-nums`) for all item counters and duration totals.
- **Color Tokens**: 60-30-10 distribution utilizing Curate's warm paper canvas (`#FAF9F6` in light mode, `#0C0C0C` in dark mode), subtle stone hairline borders (`#E7E5E4` / `#292524`), and high-intent stone-900 / white primary actions.
- **Zero-Pill Restraint**: Item cards show clean unboxed metadata with subtle typographic separators (`⏱ 24m · youtube.com ↗`).
- **No Social Gimmicks**: Strictly zero likes, follower counts, comment threads, public user profiles, or discovery feeds.

---

### 3. Key Product Decisions & Trade-Offs

| Decision | Chosen Approach | Rationale | Alternatives Considered |
| :--- | :--- | :--- | :--- |
| **Public URL Structure** | `/c/:id` (128-bit hex UUID) | Clean separation from weekly shares (`/w/:id`); unguessable 32-hex ID prevents scraping. | Slug-based URLs `/c/my-title` (risk of namespace collisions and user impersonation). |
| **Masonry Grid Engine** | CSS Column Layout (`columns-1 sm:columns-2 lg:columns-3 xl:columns-4`) with `break-inside-avoid` | Native browser performance without layout jank or heavy JavaScript Masonry libraries. | Absolute-positioned JS layout (heavy DOM reflows and bundle size penalty). |
| **SEO & Indexing** | Default `noindex, nofollow` with user toggle | Preserves user privacy by default while providing an opt-in path for creators testing organic search traffic. | Always indexed (violates user privacy) or always noindexed (blocks creator SEO experiments). |
| **Import Deduplication** | Dual-key canonical matching (YouTube Video ID + normalized URL) | Prevents duplicate videos even if query strings differ; prevents duplicate articles across protocol/subdomain variants. | Naive full string URL match (fails when tracking query parameters differ). |
| **Account Gating for Imports** | Account required for import; guest creation allowed locally | Prevents spam imports, attaches saved items securely to user cloud library, and enforces the explicit prompt requirement. | Allow guest imports (risk of unauthenticated inbox pollution and loss of sync). |

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENT APP                                │
│                                                                        │
│   TopNav ─────────────► [Collections Tab] ──► Manage User Collections  │
│   Library / Inbox ────► [Multi-Select Bar] ─► Create Collection Modal   │
│   Auth Gateway ───────► Require Account for 'Save to my Curate'        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ REST API
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                              SERVER.TS                                 │
│                                                                        │
│   POST   /api/collections        (Validate, sanitize, rate-limit 10/hr)│
│   PATCH  /api/collections/:id    (Toggle active, toggle SEO index)    │
│   DELETE /api/collections/:id    (Permanent delete -> 410 Gone)        │
│   GET    /api/collections/:id    (JSON snapshot payload for import)    │
│   GET    /c/:id                  (Server-rendered HTML + SEO tags)     │
│   GET    /c/:id/poster.png       (Dynamic OpenGraph preview card)      │
│   POST   /api/report             (Process takedown & page reports)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                             PERSISTENCE                                │
│                                                                        │
│   Local Store: data/shared_collections.json                            │
│   Cloud Store: Supabase `shared_collections` table (if configured)     │
│   Browser: localStorage backup for offline & quick preview             │
└────────────────────────────────────────────────────────────────────────┘
```

#### A. Data Model

```typescript
export interface SharedCollectionItem {
  id: string;
  title: string;
  source: string;
  type: ContentType;
  duration: number; // minutes
  durationIsEstimate?: boolean;
  coverReference?: string; // image thumbnail URL
  url?: string;
  canonicalUrl?: string; // normalized URL or YouTube video ID
}

export interface SharedCollectionRecord {
  id: string; // 32-character hex ID
  userId: string;
  title: string; // max 80 characters, sanitized
  description?: string; // max 300 characters, plain text sanitized
  allowSearchEngines: boolean; // default: false
  items: SharedCollectionItem[]; // max 50 items
  isActive: boolean; // default: true; false returns 410 Gone
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

#### B. Constants & Limits

```typescript
export const COLLECTION_LIMITS = {
  FREE_ACCOUNT_COLLECTIONS: 3,
  MAX_ITEMS_PER_COLLECTION: 50,
  MAX_TITLE_LENGTH: 80,
  MAX_DESCRIPTION_LENGTH: 300,
  RATE_LIMIT_PER_HOUR: 10,
};
```

#### C. Deduplication Logic

- **YouTube**: Regex matches standard patterns:
  `/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/`
  Extracts 11-char Video ID as the deduplication key.
- **Web URLs**: Strip query tracking keys (`utm_*`, `ref`, `fbclid`), lowercase host, normalize trailing slash.

#### D. Analytics & Events

- `collection_created`: Emitted when collection is published.
- `collection_viewed`: Emitted when `/c/:id` is visited (logged server-side and client beacon).
- `collection_saved`: Emitted when an authenticated user imports collection (`{ itemCount: number }`).
- `collection_cta_clicked`: Emitted when public visitor clicks the footer CTA or hero CTA into the app (`?ref=collection`).

#### E. Legal, Safety & Takedown

- Public collection footer includes `"Report this page"` button and link to updated Terms of Service.
- Updated `TermsOfServiceModal.tsx` includes an explicit Content Takedown & DMCA Policy section with takedown contact address (`takedown@curate.app`).
- Server route `POST /api/report` receives report payload (collection ID, reason, reporter email) and logs it.

#### F. Automated Verification Tests

- **Deduplication Test**: Ensures identical YouTube IDs and canonical URLs are excluded from inbox insertion.
- **Privacy Audit Test**: Inspects payload sent to server to guarantee no notes, takeaways, or user-private fields exist.
- **HTTP 410 Gone Test**: Ensures deactivated or deleted collections return status 410 with the "This collection is no longer shared" view.
