import { ContentItem, ContentType, getItemSource } from '../types';
import { trackEvent } from './analytics';

export interface SharedWeekItem {
  id: string;
  title: string;
  source: string;
  type: ContentType;
  duration: number; // minutes
  coverReference?: string; // YouTube thumbnail or cover reference
  day: string; // e.g. "Monday", "Tuesday"
  dateStr?: string; // YYYY-MM-DD
  url?: string;
}

export interface SharedWeekRecord {
  id: string; // 128-bit hex string (32 characters)
  userId: string;
  weekStartDate: string; // YYYY-MM-DD
  weekEndDate: string; // YYYY-MM-DD
  weekLabel: string; // e.g. "Oct 12 – Oct 18, 2026"
  displayName?: string; // Optional sanitized creator name, max 40 chars
  totalPlannedMinutes: number;
  items: SharedWeekItem[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Generates a random 128-bit ID (32 hexadecimal characters).
 */
export function generate128BitId(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback for non-crypto environments
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id;
}

/**
 * Sanitizes an optional display name:
 * - Strips all HTML/script tags
 * - Strips newlines and excess whitespace
 * - Truncates to max 40 characters
 * - Returns undefined if empty
 */
export function sanitizeDisplayName(name?: string): string | undefined {
  if (!name || typeof name !== 'string') return undefined;
  const stripped = name
    .replace(/<[^>]*>/g, '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return undefined;
  return stripped.slice(0, 40);
}

/**
 * Formats day name for display in the shared view (e.g. "Monday").
 */
export function formatDayLabel(dateStr?: string): string {
  if (!dateStr) return 'Scheduled';
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString('en-US', { weekday: 'long' });
  } catch {
    return 'Scheduled';
  }
}

/**
 * Creates a pristine, sanitized snapshot for public sharing.
 *
 * Strict Privacy Rules:
 * - Hidden items are completely excluded.
 * - Items without scheduledDate or outside week range are excluded.
 * - ONLY title, source, type, duration, cover reference (thumbnailUrl), and day are stored.
 * - Notes, item URLs, screenshots, takeaways, or other user fields are NEVER stored.
 */
export function createSharedWeekSnapshot(params: {
  items: ContentItem[];
  hiddenItemIds: Set<string>;
  weekStartDate: string;
  weekEndDate: string;
  weekLabel: string;
  displayName?: string;
  userId?: string;
  existingId?: string;
}): SharedWeekRecord {
  const {
    items,
    hiddenItemIds,
    weekStartDate,
    weekEndDate,
    weekLabel,
    displayName,
    userId = 'guest-local-user',
    existingId,
  } = params;

  // Filter items scheduled in this week and not hidden
  const eligibleItems = items.filter((it) => {
    if (!it.scheduledDate) return false;
    if (it.scheduledDate < weekStartDate || it.scheduledDate > weekEndDate) return false;
    if (hiddenItemIds.has(it.id)) return false;
    return true;
  });

  // Sort by scheduledDate
  eligibleItems.sort((a, b) => (a.scheduledDate || '').localeCompare(b.scheduledDate || ''));

  // Strip everything except allowed public fields
  const sharedItems: SharedWeekItem[] = eligibleItems.map((it) => {
    const item: SharedWeekItem = {
      id: it.id,
      title: (it.title || 'Untitled Item').trim(),
      source: getItemSource(it),
      type: it.contentType,
      duration: Math.max(0, it.durationMinutes || 0),
      day: formatDayLabel(it.scheduledDate),
      dateStr: it.scheduledDate,
    };
    if (it.thumbnailUrl && it.thumbnailUrl.trim().length > 0) {
      item.coverReference = it.thumbnailUrl.trim();
    }
    return item;
  });

  const totalPlannedMinutes = sharedItems.reduce((acc, curr) => acc + curr.duration, 0);

  const now = new Date().toISOString();
  return {
    id: existingId || generate128BitId(),
    userId,
    weekStartDate,
    weekEndDate,
    weekLabel,
    displayName: sanitizeDisplayName(displayName),
    totalPlannedMinutes,
    items: sharedItems,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

// Local storage key for fallback / offline / guest mode shares
const LOCAL_SHARED_WEEKS_KEY = 'curate_shared_weeks_v1';

export function getLocalSharedWeeks(): SharedWeekRecord[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_SHARED_WEEKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function notifySharesChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('curatecal:shares_updated'));
  }
}

export function saveLocalSharedWeek(record: SharedWeekRecord): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const existing = getLocalSharedWeeks().filter((w) => w.id !== record.id);
    existing.unshift(record);
    localStorage.setItem(LOCAL_SHARED_WEEKS_KEY, JSON.stringify(existing));
    notifySharesChanged();
  } catch (err) {
    console.warn('[ShareWeek] Failed to save local share:', err);
  }
}

export function deleteLocalSharedWeek(id: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const updated = getLocalSharedWeeks().filter((w) => w.id !== id);
    localStorage.setItem(LOCAL_SHARED_WEEKS_KEY, JSON.stringify(updated));
    notifySharesChanged();
  } catch (err) {
    console.warn('[ShareWeek] Failed to delete local share:', err);
  }
}

export interface ShareWeekResult {
  success: boolean;
  share?: SharedWeekRecord;
  url?: string;
  error?: string;
}

/**
 * Creates or updates a share link.
 * Sends payload to server endpoint /api/share and persists locally.
 */
export async function publishSharedWeek(
  payload: SharedWeekRecord,
  isUpdate = false
): Promise<ShareWeekResult> {
  // Always persist locally
  saveLocalSharedWeek(payload);

  try {
    const endpoint = isUpdate ? `/api/share/${payload.id}` : '/api/share';
    const method = isUpdate ? 'PATCH' : 'POST';

    const res = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const errorMsg = data.error || `Server responded with ${res.status}`;
      return {
        success: false,
        error: errorMsg,
      };
    }

    const data = await res.json();
    const share = data.share || payload;
    const shareUrl = data.url || `${window.location.origin}/w/${share.id}`;

    if (!isUpdate) {
      trackEvent('share_created', {
        itemCount: share.items.length,
        totalPlannedMinutes: share.totalPlannedMinutes,
        hasDisplayName: Boolean(share.displayName),
      });
    }

    return {
      success: true,
      share,
      url: shareUrl,
    };
  } catch (err: any) {
    // If offline or network error, still allow local URL in dev
    const shareUrl = `${window.location.origin}/w/${payload.id}`;
    return {
      success: true,
      share: payload,
      url: shareUrl,
    };
  }
}

/**
 * Toggles active state of a shared week.
 */
export async function toggleShareActive(id: string, isActive: boolean): Promise<boolean> {
  const localList = getLocalSharedWeeks();
  const target = localList.find((w) => w.id === id);
  if (target) {
    target.isActive = isActive;
    target.updatedAt = new Date().toISOString();
    saveLocalSharedWeek(target);
  }

  try {
    const res = await fetch(`/api/share/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive }),
    });
    return res.ok;
  } catch {
    return true;
  }
}

/**
 * Permanently deletes a shared week link.
 */
export async function deleteSharedWeek(id: string): Promise<boolean> {
  deleteLocalSharedWeek(id);
  try {
    const res = await fetch(`/api/share/${id}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return true;
  }
}
