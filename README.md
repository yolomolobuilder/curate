# Curate

> **Everything worth exploring. On your schedule.**

Curate is a visual-first personal media and learning planner. It lets you organize YouTube videos, articles, podcasts, books, and courses onto an editorial calendar with jewel-tone cards, honest time accounting, and drag-and-drop scheduling — avoiding the endless backlog overwhelm.

---

## What Curate Is

- **Visual Editorial Calendar**: View your planned content across Month, Week, and Day views with cover posters and rhythm indicators.
- **Honest Durations**: Auto-detected durations are marked as estimates (`est.`) until confirmed or edited. One-tap chips (`10m`, `20m`, `30m`, `45m`, `1h`, `90m`, `2h`, `3h`) and custom minutes allow rapid adjustments. User-customized durations are never overwritten by metadata refetches.
- **Quick Plan**: Intelligent, deterministic scheduling that respects daily time budgets and strictly caps load at 85% capacity to prevent burnout.
- **YouTube Duration Fetching**: Real durations can be retrieved via YouTube Data API v3 (`videos.list`), with 30-day client-side caching and fallback heuristics when offline or unconfigured.
- **Local-First & Resilient**: All data is saved safely in browser storage with quota protection, in-memory recovery, and JSON backup export/import.

---

## Getting Started

### Prerequisites

- Node.js 18+ (tested on Node 20 & 22)
- npm 9+

### Install Dependencies

```bash
npm install
```

Clean `npm install` runs smoothly without any special flags or peer-dependency conflicts.

### Run Development Server

```bash
npm run dev
```

Opens the local development server at `http://localhost:3000`.

### Build for Production

```bash
npm run build
```

Generates optimized, production-ready static assets in the `dist/` directory.

### Run Tests

```bash
npm test
```

Runs the automated Self-Check invariant test suite across time accounting, local timezone persistence, activation milestones, storage quotas, analytics sanitization, and honest duration mechanics.

---

## The Self-Check Page

Curate includes an automated test harness with 22 invariant tests. You can run them in two ways:

1. **In the Terminal**: Run `npm test` or `npx tsx src/lib/selfCheck.ts`.
2. **In the App**: Open **Settings** (top navigation bar) and click **Run Tests** under **Self-Check Verification Tests**.

The tests verify:
- Multi-day item duration counting (counted once on start date, 0 on later days).
- Completed item time accounting (`DONE` vs `PLANNED` vs `REMAINING`).
- Timezone safety across midnight boundaries without UTC rollbacks.
- Sample item exclusion from 3-5-1 activation metrics.
- Backup export/clear/import data integrity.
- Inbox backlog summaries, filtering, and priority handling.
- Quick Plan deterministic combination optimization and 85% budget limits.
- Safe storage handling during quota exceeded states.
- Safe media storage (IndexedDB references, strict 200 KB caps).
- Privacy protection (zero URLs, titles, or user text in telemetry).
- Honest duration schema migration, 1-tap editing, and metadata protection.
- YouTube ISO 8601 duration parsing, live stream detection, error fallbacks, and user-edit preservation.

---

## Privacy & Analytics Opt-Out

Curate is built with strict privacy discipline:

- **Zero Content Leakage**: Telemetry never transmits URLs, titles, notes, queries, or user-typed text. All event properties are stripped by a strict sanitizer before logging.
- **Device-Level Opt-Out**: Open **Settings** and toggle **Turn off analytics on this device**. This writes `curate.analytics.off` to `localStorage` and immediately stops any analytics tracking.
- **Transparent Local Log**: Review the local session event log in **Settings**, copy it as JSON with ISO timestamps, or clear it at any time.

---

## The No-AI Rule

Curate adheres strictly to a **no-AI rule**:

- **No LLM API calls, chatbots, or assistants**: The interface is focused entirely on user agency, calm reflection, and intentional media consumption.
- **Deterministic Algorithms**: Content suggestions, capacity calculations, and day distribution rhythms run entirely on predictable, client-side algorithms with zero artificial clutter.

---

## Configuration & Optional Keys

- **`VITE_YOUTUBE_API_KEY`** *(optional)*: To fetch real durations for YouTube links via the YouTube Data API v3, create a restricted key and set `VITE_YOUTUBE_API_KEY` in your environment. If no key is set, Curate gracefully uses heuristic duration estimates.

### Unit and E2E Testing

In addition to the invariant tests, we use Vitest and Playwright.

**Run Unit Tests (Vitest)**
```bash
npm run test:unit
```

**Run End-to-End Tests (Playwright)**
```bash
npm run test:e2e
```
