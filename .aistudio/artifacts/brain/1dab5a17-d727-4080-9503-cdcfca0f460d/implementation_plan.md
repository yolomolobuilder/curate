# Budget Status Neutral Styling & Custom Weekly Budget Fix

Align the calendar budget status and capacity indicators to Curate's minimal editorial brand palette (subtle stone gray tones, removing green and red accents), and repair the custom budget option on the week calendar view with flexible inline input parsing (e.g. `4h`, `240m`, `1h 30m`).

## User Review & Critical Decisions

> [!IMPORTANT]
> The following preferences were confirmed during clarification and will govern the implementation:

- **Confirmed Decision 1 (Custom Budget Input)**: Direct inline input supporting natural human expressions like `4h`, `240m`, `1.5h`, or `2h 30m` directly inside the weekly budget preset bar, auto-committing on Enter or blur with Escape cancellation.
- **Confirmed Decision 2 (Budget Status Aesthetics)**: Subtle stone gray typography for both remaining and over-budget states, paired with a sleek monochrome stone capacity bar (`stone-800` / `stone-200`) completely replacing green (`emerald`) and red (`rose`) tokens.

---

## 1. Overview & Core Concept

- **What It Does**:
  - Restyles the calendar's weekly time budget status metrics, over-budget warnings, and capacity progress bar to strictly use Curate's neutral editorial grayscale/stone palette.
  - Fixes the "Custom" weekly budget control in `TimeBudgetHeader` so users can seamlessly click "Custom", type their target weekly time in natural hours or minutes (e.g. `4h`, `90m`, `3.5h`), and have it instantly update the week's capacity calculations, remaining time metrics, and localStorage persistence.
- **Target Audience & Workflow**: Users managing their weekly media, reading, and learning commitments in Curate who need an accurate, friction-free budget planner matching the app's refined aesthetic.
- **Key Value**: Restores full control over weekly schedule capacity while preserving a clean, distraction-free monochrome visual tone.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Viewing Weekly Budget Status**:
   - The user opens the Week view on the calendar.
   - The header displays Available time, Planned time, Done time, and Remaining / Over Budget status.
   - All status readouts render in serene stone grays (`text-stone-600 dark:text-stone-300` / `text-stone-700 dark:text-stone-200`) instead of harsh emerald green and rose red.
   - The capacity bar fills with a smooth dark stone indicator (`bg-stone-800 dark:bg-stone-200`) against a subtle neutral track (`bg-stone-100 dark:bg-stone-800`).
2. **Setting a Custom Weekly Budget**:
   - The user clicks the **Custom** preset pill in the weekly budget header.
   - An inline input immediately appears in place of or adjacent to the Custom button, pre-populated with the current budget (e.g., `3h` or `180m`).
   - The user can type `4h`, `4.5h`, `250m`, or `3h 15m`.
   - Pressing **Enter**, clicking the check button, or unfocusing (blur) parses the input, stores the total minutes in localStorage, updates the week's budget state, and marks the Custom pill as actively selected.
   - Pressing **Escape** discards edits without modifying the existing budget.

### Visual Identity & Theme Tokens

- **Budget Status Text**:
  - Normal/Remaining: `text-stone-600 dark:text-stone-300 font-serif` (tabular numerals)
  - Over Budget: `text-stone-800 dark:text-stone-200 font-sans font-medium` with quiet `text-stone-500` secondary text and neutral alert icon
- **Capacity Bar**:
  - Track: `bg-stone-100 dark:bg-stone-800/80`
  - Fill: `bg-stone-800 dark:bg-stone-200` (neutral monochrome across all capacity levels)
- **Inline Custom Editor**:
  - Subtle stone container (`bg-stone-100 dark:bg-stone-850 border-stone-200 dark:border-stone-700`)
  - Crisp monospace font (`font-mono text-xs`) with placeholder `e.g. 4h or 240m`

---

## 3. Key Product Decisions & Trade-Offs

- **Flexible Time Parsing Function (`parseDurationInput`)**:
  - *Chosen Approach*: Implement a robust duration parser that understands raw numbers, decimals, and hour/minute units (`4`, `4h`, `4.5h`, `4 hrs`, `4 hours`, `90m`, `90 mins`, `2h 30m`). For bare numbers without units: $\le 16$ is interpreted as hours (e.g. entering `4` yields 240 minutes for a weekly budget), while $> 16$ is interpreted as minutes (e.g. entering `90` yields 90 minutes).
  - *Why*: Eliminates the previous failure where users typed `4` intending 4 hours, which was either rejected by `min="5"` or scheduled 4 minutes of weekly content.
- **Monochrome Capacity Bar**:
  - *Chosen Approach*: Replace green/amber/rose color shifts with a uniform stone charcoal bar.
  - *Why*: Satisfies the user's explicit branding requirement ("green and red are not part of the branding") while maintaining visual feedback via percentage label and bar width.

---

## 4. Technical Architecture & Data Strategy

### Component & Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                       CalendarGrid                          │
│  State: budgetState { availableMinutes, preset }            │
│  Storage: curatecal_week_budget_<weekKey>                   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    TimeBudgetHeader                         │
│  Props: availableMinutes, plannedMinutes, currentPreset     │
│  - Neutral Stone Gray Status Typography (No Green/Red)      │
│  - Monochrome Capacity Bar (bg-stone-800 / bg-stone-200)   │
│  - Preset Buttons: 30m | 1h | 2h | 3h | 5h | 7h | 10h       │
│  - Custom Preset Button & Inline Flexible Parser:           │
│      "4h" / "240m" / "1h 30m" ──► parseDurationInput()      │
│                                      │                      │
│                                      ▼                      │
│                           onBudgetChange(mins, 'custom')    │
└─────────────────────────────────────────────────────────────┘
```

### Component Adjustments

1. **`src/lib/timeAccounting.ts`**:
   - Add `parseDurationInput(input: string): number | null` to reliably parse user-entered strings (`"4h"`, `"4"`, `"90m"`, `"1h 30m"`, `"2.5h"`) into total minutes with bounds checking ($15\text{m} \le \text{mins} \le 6000\text{m}$).
   - Add `formatDurationCompact(minutes: number): string` to format numbers cleanly as `"4h"`, `"90m"`, or `"2h 30m"`.
2. **`src/components/TimeBudgetHeader.tsx`**:
   - Remove `text-rose-600`, `text-rose-400`, `text-emerald-700`, `text-emerald-400`, `bg-rose-500`, `bg-emerald-500`, and `bg-amber-500`.
   - Update Remaining & Over Budget status elements to use neutral `text-stone-600 dark:text-stone-300` and `text-stone-800 dark:text-stone-200`.
   - Update Capacity progress bar fill to `bg-stone-800 dark:bg-stone-200`.
   - Improve the "Custom" preset button behavior so clicking it opens the inline editor with current budget formatted (e.g. `4h`), auto-selects the text, allows inline editing, submits on Enter or blur, and properly updates the preset state to `'custom'`.
3. **`src/components/QuickPlanModal.tsx`**:
   - Ensure budget status text inside Quick Plan modal uses neutral stone styling instead of `text-rose-500` / `text-emerald-600`.
