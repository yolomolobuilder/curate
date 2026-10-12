export const APP_NAME = 'Curate';
export const PRODUCT_TITLE = 'Curate — Curate Your Curiosity.';

export type ContentType =
  | 'youtube'
  | 'podcast'
  | 'article'
  | 'book'
  | 'course'
  | 'documentary'
  | 'other';

export type ContentStatus =
  | 'inbox'
  | 'planned'
  | 'in_progress'
  | 'completed';

export interface ContentItem {
  id: string;
  url?: string;
  title: string;
  thumbnailUrl: string;
  contentType: ContentType;
  source?: string;
  platform?: string;
  author?: string;
  durationMinutes?: number;
  durationIsEstimate?: boolean; // True if auto-filled/estimated heuristic, false if user-edited
  durationFetchedAt?: string; // ISO 8601 timestamp when real duration was fetched from YouTube API
  userEditedFields?: string[]; // Fields explicitly edited by user: ['title', 'contentType', 'source', 'durationMinutes']
  editedFields?: string[]; // Alias for userEditedFields
  topic?: string;
  status: ContentStatus;
  scheduledDate?: string; // YYYY-MM-DD
  scheduledEndDate?: string; // YYYY-MM-DD (e.g. For reading a book across a week)
  notes?: string;
  keyTakeaway?: string;
  screenshots?: string[];
  spatialX?: number; // 2D coordinate on infinite cosmos canvas
  spatialY?: number; // 2D coordinate on infinite cosmos canvas
  createdAt: string;
  updatedAt?: string; // ISO 8601 timestamp tracking latest content or state modification
  completedAt?: string;
  isPriority?: boolean; // Starred high priority item
  isSample?: boolean; // Flagged sample item (e.g. from curated starter pack) - never counts toward 3-5-1 activation
}

export type BudgetPreset = '30m' | '1h' | '2h' | '3h' | '5h' | '7h' | '10h' | 'custom';

export const BUDGET_PRESET_MINUTES: Record<Exclude<BudgetPreset, 'custom'>, number> = {
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '3h': 180,
  '5h': 300,
  '7h': 420,
  '10h': 600,
};

export type PlanningStrategy =
  | 'priority_oldest'
  | 'shortest_first'
  | 'thematic_balanced'
  | 'oldest_first'
  | 'alternate_type';

export interface QuickPlanProposedItem {
  item: ContentItem;
  targetDateStr: string;
  dayLabel: string;
  explanation: string;
  isSelected: boolean;
}

export interface QuickPlanNotScheduledItem {
  item: ContentItem;
  reason: string;
}

export interface QuickPlanResult {
  proposedItems: QuickPlanProposedItem[];
  notScheduledItems: QuickPlanNotScheduledItem[];
  totalPlannedMinutes: number;
  initialScheduledMinutes: number;
  availableBudgetMinutes: number;
  remainingMinutes: number;
  isOverBudget: boolean;
  bufferPercentRemaining: number;
  strategyUsed: PlanningStrategy;
  noDaysRemainingThisWeek?: boolean;
}

export function getItemSource(item: { source?: string; author?: string; platform?: string }): string {
  return item.source || item.author || item.platform || 'Curate';
}

export interface DayTheme {
  dayOfWeek: number; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  topic: string;
  enabled: boolean;
}

export type CalendarView = 'month' | 'week' | 'day';

export interface FilterState {
  topic: string;
  contentType: string;
  status: string; // 'all' | 'planned' | 'in_progress' | 'completed' | 'inbox'
  searchQuery: string;
}

export const DEFAULT_TOPICS = [
  'Marketing',
  'UX/UI',
  'German',
  'English',
  'Health',
  'Fitness',
  'Psychology',
  'Business',
  'Economics',
  'History',
  'Science',
  'Philosophy',
  'Culture',
  'Deep Dive',
  'Technology',
  'Other',
];

export const CONTENT_TYPE_CONFIG: Record<
  ContentType,
  { label: string; icon: string; shortLabel: string; accentColor: string }
> = {
  youtube: {
    label: 'YouTube Video',
    icon: '▶',
    shortLabel: 'YouTube',
    accentColor: 'text-red-700 dark:text-red-400',
  },
  podcast: {
    label: 'Podcast',
    icon: '🎧',
    shortLabel: 'Podcast',
    accentColor: 'text-violet-700 dark:text-violet-400',
  },
  article: {
    label: 'Article',
    icon: '📖',
    shortLabel: 'Article',
    accentColor: 'text-emerald-700 dark:text-emerald-400',
  },
  book: {
    label: 'Book',
    icon: '📕',
    shortLabel: 'Book',
    accentColor: 'text-amber-800 dark:text-amber-400',
  },
  course: {
    label: 'Course',
    icon: '🎓',
    shortLabel: 'Course',
    accentColor: 'text-blue-700 dark:text-blue-400',
  },
  documentary: {
    label: 'Documentary',
    icon: '🎥',
    shortLabel: 'Documentary',
    accentColor: 'text-rose-800 dark:text-rose-400',
  },
  other: {
    label: 'Media',
    icon: '✦',
    shortLabel: 'Media',
    accentColor: 'text-stone-700 dark:text-stone-300',
  },
};
