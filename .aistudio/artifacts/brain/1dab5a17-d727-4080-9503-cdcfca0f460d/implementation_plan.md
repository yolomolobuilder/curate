# Inbox & Backlog Management for Larger Collections

A high-density, ergonomic inbox and backlog system designed to handle large content libraries without horizontal scrolling, featuring multi-dimensional filtering, dropdown controls for topics and durations, a single-click priority toggle, backlog summary metrics, and a direct "Plan 2h" Quick Plan workflow.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following user preferences were confirmed during the Phase 1 clarification interview:
> - **Filter Layout (No Horizontal Scroll)**: Replace the single horizontally scrolling row with a structured 2–3 line vertical header that wraps cleanly and prevents any horizontal scrolling (`overflow-x-hidden`).
> - **Filter Controls Hierarchy**: Keep primary Content Types and Statuses as compact wrapping chips on the top lines, while placing Topic and Duration selections into space-saving dropdown menus to preserve maximum vertical space for content cards.
> - **"Plan 2h" Action**: Opens the standard Quick Plan modal pre-configured with a 2-hour (120-minute) scheduling budget.
> - **Anti-Bloat Guardrail**: No folders, nested databases, complex tagging hierarchies, or AI categorizations.

---

### 1. Overview & Core Concept

- **What It Does**: Evolves the single-column Inbox drawer into a complete, scalable personal content backlog. Users can quickly filter hundreds of items across content format (Videos, Articles, Podcasts, Books), scheduling lifecycle (Unscheduled, Scheduled, Completed), topics (Marketing, UX/UI, German, English, Health, Fitness, and Other), and consumption duration (<15m, 15–30m, 30–60m, 1h+).
- **Target Audience / Persona**: Knowledge workers, self-directed learners, and media curators with extensive reading and viewing backlogs who need to triage, prioritize, and plan without feeling overwhelmed.
- **Key Value**: Eliminates horizontal scroll clutter, provides immediate backlog time inventory (e.g. `23 unplanned · 7h 42m total`), and offers a 1-click bridge from backlog to weekly calendar execution ("Plan 2h").

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Backlog Inspection & Metric Scannability**:
   - The user opens the Inbox drawer from the top navigation bar.
   - At the top, a clean summary header displays exact backlog volume: `{N} unplanned · {X}h {Y}m total` (with tabular figures), alongside the action button `Plan 2h →`.
2. **Multi-Dimensional Filtering (2–3 Lines, Zero Horizontal Scroll)**:
   - **Line 1 (Status & Priority)**: Segmented status tabs (`Unscheduled`, `Scheduled`, `Completed`, `All`) + single-click `★ Priority Only` toggle button.
   - **Line 2 (Content Types)**: Compact wrapping pill buttons (`All`, `Videos`, `Articles`, `Podcasts`, `Books`).
   - **Line 3 (Dropdowns & Sorting)**:
     - **Topic Dropdown**: `All Topics`, `Marketing`, `UX/UI`, `German`, `English`, `Health`, `Fitness`, `Other`.
     - **Duration Dropdown**: `Any Duration`, `<15m`, `15–30m`, `30–60m`, `1h+`.
     - **Sort Dropdown**: `Newest`, `Oldest`, `Shortest`, `Longest`, `Priority First`.
3. **One Simple Priority Toggle**:
   - On every content card and within the drawer filter header, users can toggle a high-visibility star priority flag (`isPriority: boolean`).
   - Toggling the drawer's `★ Priority` filter instantly isolates starred items.
4. **"Plan 2h" Quick Planning Flow**:
   - The user clicks `Plan 2h →`.
   - The Quick Plan modal immediately opens with a 120-minute (2-hour) budget preset, automatically proposing an optimized weekly schedule from their backlog.

#### Visual Identity & Layout Math
- **Container Geometry**: Fixed right drawer ($360\text{px}$–$390\text{px}$ on desktop, $100\%$ on mobile) with strictly `overflow-x-hidden` and `overflow-y-auto`.
- **Palette & Typography**:
  - Warm neutral canvas (`#FAF9F6` light / `#0C0C0C` dark) with hairline dividers (`border-stone-200/50 dark:border-stone-850`).
  - Serif headline (`font-serif`) for natural editorial feel; clean tabular numerals (`font-mono tabular-nums`) for duration counts and summaries.
  - Active filter chips use high-contrast solid black/white (`bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900`).
- **Interactive Feedback**:
  - Live filter count recalculations in $<50\text{ms}$.
  - Micro-animations on star toggle (`scale-110` pop).
  - Empty states explaining which specific filter combination resulted in zero matches, with a "Reset Filters" quick action.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Hoisting Quick Plan State to App Level**:
  - *Chosen Approach*: Move `QuickPlanModal` orchestration to `App.tsx` so both `CalendarGrid` and `InboxDrawer` can trigger planning with custom presets (such as `Plan 2h`).
  - *Why*: Eliminates prop drilling and allows the user to trigger "Plan 2h" directly while browsing the inbox on any view.
  - *Alternative Considered*: Only allowing Quick Plan from CalendarGrid view, which would force the user to close Inbox, switch tabs, and click Quick Plan.
- **Decision 2: Dropdowns for Topics and Durations vs. Wrapped Chip Wall**:
  - *Chosen Approach*: Use custom accessible `<select>` / popover menus for Topic and Duration, while keeping Format and Status as 1-click segmented chips.
  - *Why*: Preserves 120px+ of vertical card viewport height that would otherwise be consumed by 12+ individual topic and duration chips.
- **Decision 3: Single Priority Flag vs. Multi-Tier Priority (P1/P2/P3)**:
  - *Chosen Approach*: Binary `isPriority: boolean` (Starred vs. Unstarred).
  - *Why*: Directly honors the prompt requirement ("Add one simple Priority toggle, not a task-manager priority system"), preventing cognitive decision fatigue.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                                App.tsx                                 │
│  - allItems: ContentItem[]                                            │
│  - isQuickPlanOpen, quickPlanPresetMinutes (default 120m)             │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │
         ┌────────────────────────┴─────────────────────────┐
         ▼                                                  ▼
┌──────────────────────────────────┐      ┌──────────────────────────────┐
│           TopNav.tsx             │      │       CalendarGrid.tsx       │
│  - Inbox toggle with badge count │      │  - Week/Month grid           │
└──────────────────────────────────┘      └──────────────────────────────┘
         │                                                  ▲
         ▼                                                  │
┌───────────────────────────────────────────────────────────┴────────────┐
│                            InboxDrawer.tsx                             │
│  ├─ Header & Backlog Summary ("23 unplanned · 7h 42m total")           │
│  ├─ "Plan 2h →" Action Button                                          │
│  ├─ Line 1: Status Filter Tabs (Unscheduled, Scheduled, Done, All)     │
│  │          + Priority Toggle (★ Starred)                             │
│  ├─ Line 2: Content Type Chips (All, Videos, Articles, Podcasts, Books)│
│  ├─ Line 3: Dropdowns (Topic, Duration Range, Sort Order)             │
│  └─ Vertically Scrolling Card Stream (Zero Horizontal Scroll)          │
└────────────────────────────────────────────────────────────────────────┘
```

#### State & Data Filtering Pipeline
1. **Item Pool**:
   - Base items received from `App.tsx` (`items: ContentItem[]`).
2. **Filter Pipeline**:
   - `statusFilter`: `'unscheduled'` (`status === 'inbox'`), `'scheduled'` (`status === 'planned' || status === 'in_progress'`), `'completed'` (`status === 'completed'`), or `'all'`.
   - `typeFilter`: `'all' | 'video' | 'article' | 'podcast' | 'book'`.
   - `topicFilter`: `'all' | 'Marketing' | 'UX/UI' | 'German' | 'English' | 'Health' | 'Fitness' | 'other'`.
   - `durationFilter`: `'all' | '<15m' | '15-30m' | '30-60m' | '1h+'`.
   - `priorityOnly`: `boolean`.
   - `sortBy`: `'newest' | 'oldest' | 'shortest' | 'longest' | 'priority'`.
3. **Summary Metric Calculation**:
   - `unplannedCount`: Count of items where `status === 'inbox'` or `!scheduledDate`.
   - `unplannedMinutes`: Total duration of unplanned items formatted via `formatHoursMinutes`.
   - `filteredCount` and `filteredMinutes`: Dynamic totals reflecting current active filters.

---

### Verification Plan

- **Automated Tests (`npm test`)**:
  - Run the full existing 5-test Self-Check suite to ensure invariant accounting, local date formatting, activation rules, and export/import parity remain 100% passing.
  - Add self-check assertions for backlog duration calculation and filter sorting.
- **Codebase Linting & Compilation**:
  - `npm run lint` (`tsc --noEmit`): 0 syntax or type errors.
  - `compile_applet`: clean Vite build.
- **UX & Visual Inspection**:
  - Verify zero horizontal scrolling in the drawer across mobile ($375\text{px}$), laptop ($1024\text{px}$), and widescreen ($1440\text{px}$).
  - Test each filter (Content type, Status, Topic, Duration, Priority) and sorting option.
  - Click "Plan 2h" and verify Quick Plan modal opens with 120 minutes preset.
