# Clickable Week Share Link & Pure Text-Based UI Refinement

Enhance the **Share My Week** experience by making the shared week link directly clickable to open in a new tab (both in the calendar week header and the share modal), while replacing all heavy button shapes, pill capsules, and footer images with pure, quiet editorial text links and clean typography.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following design decisions were confirmed during clarification and govern the implementation:

- **Confirmed Decision 1 (Clickable Link Action)**: Clicking the shared week link opens the public shared page (`/w/:id`) directly in a new tab (`target="_blank"`), while maintaining an adjacent one-click copy affordance.
- **Confirmed Decision 2 (Affordance Placement)**: The clickable link is positioned in **both** the calendar week header (giving instant access to view/share the published week) and inside the Share My Week modal.
- **Confirmed Decision 3 (Text-Based Styling & Anti-Shape Discipline)**: Absolutely no images in the footer, and no rounded pill capsule buttons or bulky container shapes. All footer actions, navigation, and secondary controls transition to pure quiet text links with subtle hover underlines and typographic mid-dot (`·`) separators.

---

## 1. Overview & Core Concept

- **What It Does**:
  - **Clickable Week in Calendar Header**: In the Week view header, if a share link has been generated for the active week, the week display features an elegant, clickable text link that opens the live `/w/:id` public view in a new tab. If no link exists yet, clicking "Share Week" opens the creation modal.
  - **Clickable Link in Share Modal**: The generated URL in `ShareWeekModal` is rendered as an interactive, clickable link opening directly in a new tab, alongside a clean "Copy" text trigger.
  - **Pure Text-Based Footer (Public `/w/:id` Page)**: Removes heavy pill buttons (`border-radius: 9999px`), background fills, and any footer graphics. Replaces them with a quiet editorial typographic footer: the Curate wordmark followed by pure inline text links (`Plan your own week on Curate`, `Report this page`), maintaining event tracking (`share_cta_clicked`).
  - **De-cluttered Modal & View Controls**: Simplifies status badges, item toggles, and modal actions from chunky button shapes into clean typographic text buttons adhering to the Universal Frontend Design Constitution (zero-pill discipline).

- **Target Audience / Workflow**:
  - Curate users sharing their weekly reading/watching plan with peers, colleagues, or social circles who want frictionless link access and a clean, high-taste editorial aesthetic.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Viewing & Opening Shared Week from Calendar**:
   - The user navigates to the Week view.
   - When the active week has an active public link, the week title or adjacent status indicator clearly shows a quiet, clickable link (e.g. `Shared ↗` or clickable week label).
   - Clicking the link opens `https://domain/w/:id` in a new tab.
   - Clicking `Share` or the settings icon opens the `ShareWeekModal` for updating snapshots or toggling privacy.

2. **Managing Link Inside Share Modal**:
   - In `ShareWeekModal`, the active link is presented as a clean, highlighted text link.
   - Clicking the link opens `/w/:id` in a new tab.
   - Next to it, quiet text actions (`Copy`, `Turn Off`, `Delete`) replace bulky nested button boxes.
   - Item hide/show toggles are styled as simple text links (`Hide` / `Show`) instead of heavy gray buttons.

3. **Public Shared Page Footer (`/w/:id`)**:
   - At the bottom of the public page, there are **no images** or decorative graphics.
   - No pill-shaped buttons with dark background fills.
   - Instead, a minimal hairline border separates the content stream from a quiet typographic footer:
     ```text
     Curate · Curate Your Curiosity

     Plan your own week on Curate ↗   ·   Report this page
     Snapshot · Read-only
     ```
   - Clicking `Plan your own week on Curate` navigates to `/?ref=share` and fires the `share_cta_clicked` beacon.

### Visual Identity & Theme Tokens

- **Typography**: Editorial serif headings (`Newsreader` / serif) paired with clean geometric body sans (`Plus Jakarta Sans`) and tabular numerals for durations.
- **Link Styling**: Plain text (`text-stone-700 dark:text-stone-300`) with subtle hover color transition (`hover:text-stone-900 dark:hover:text-white`) and underline offset (`hover:underline underline-offset-4`).
- **Zero Pill / Anti-Slop**:
  - Replace `rounded-full bg-emerald-500` status dots with subtle text labels: `Active` or `Inactive (410)`.
  - Replace pill button `.plan-cta-btn` with quiet text link styling: `text-stone-900 dark:text-stone-100 underline underline-offset-4 font-medium`.

---

## 3. Key Product Decisions & Trade-Offs

- **Click-to-Open vs Click-to-Copy**:
  - *Chosen Approach*: Link text directly navigates to the page in a new window (`target="_blank"`), with an explicit text button for copying to clipboard.
  - *Why*: Satisfies the user's explicit preference ("the link is the main thing that they may want to share. so it week should be clickable... Click to open the public shared page in new tab") while still allowing rapid link copying.
- **Header Affordance Integration**:
  - *Chosen Approach*: When a week has been shared, render a quiet, elegant clickable indicator directly in the week view toolbar: `Shared ↗` linking to `/w/:id`, alongside the `Share Week` modal toggle.
  - *Why*: Avoids modifying the calendar grid layout while providing immediate one-click verification of what viewers will see.
- **Server Rendered Footer Simplification**:
  - *Chosen Approach*: Strip all rounded container pills and CSS button shapes from `server.ts`'s HTML generator, using pure typographic layout with semantic `<a>` tags.
  - *Why*: Direct compliance with user guidance ("please do not add image in the footer like the attached image... the current design has too much buttons/shapes while it could be a simple text like the image attached").

---

## 4. Technical Architecture & Data Strategy

### Technical Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Calendar Week View                       │
│  - Week Date Range & Navigation                             │
│  - If Week Shared: "Shared ↗" Clickable Link (New Tab)     │
│  - "Share Week" Trigger ──► ShareWeekModal                  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      ShareWeekModal                         │
│  - Public Link Box: Direct Clickable <a> (New Tab)         │
│  - Quiet Text Actions: "Copy" | "Turn Off" | "Delete"       │
│  - Per-item Toggles: Minimal "Hide" / "Show" text links    │
│  - Zero bulky card-in-card shapes                           │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Server-Side HTML Renderer (/w/:id)              │
│  - Server.ts: clean responsive HTML with OpenGraph tags     │
│  - Body: Editorial Day Stream                               │
│  - Footer: NO images, NO pill buttons                       │
│  - Pure quiet text links with "share_cta_clicked" beacon    │
└──────────────────────────────┘
```

### Component & File Mapping

1. **`src/components/CalendarGrid.tsx`**:
   - Check local shared weeks store for active share matching current `weekStartDate`.
   - In the week view header, display an inline clickable text link `Shared ↗` (opening `/w/:id` in `_blank`) whenever a share exists for that week.
   - Keep the clean "Share" trigger button without changing the grid layout.

2. **`src/components/ShareWeekModal.tsx`**:
   - Update URL display: turn the link text into a direct `<a href="/w/:id" target="_blank">` element with hover underline.
   - Refactor buttons into minimalist text-first controls (replacing nested gray pill buttons with clean text links and subtle dividers).
   - Ensure "Hide" / "Show" controls are lightweight text triggers.

3. **`server.ts`**:
   - In `renderPublicWeekHtml`, update `.page-footer` styles: remove `.plan-cta-btn` rounded pill container and dark background.
   - Render the CTA as a refined, unboxed editorial text link: `<a href="/?ref=share" id="plan-cta" class="plan-cta-link">Plan your own week on Curate &rarr;</a>`.
   - Ensure no footer images or unnecessary badge shapes are present.
   - Verify OpenGraph tags and 410 Gone page match this refined aesthetic.

4. **Self-Check & Regression Suite**:
   - Update `src/lib/selfCheck.ts` to verify snapshot integrity and link generation.
   - Run compilation and verify dev server responsiveness on port 3000.
