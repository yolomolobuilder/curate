import { ContentItem, ContentType, getItemSource } from '../types';
import { extractYouTubeId } from './metadataExtractor';
import { trackEvent } from './analytics';

export const MAX_FREE_COLLECTIONS = 3;
export const MAX_COLLECTION_ITEMS = 50;
export const MAX_COLLECTION_TITLE_LENGTH = 80;
export const MAX_COLLECTION_DESC_LENGTH = 300;
export const COLLECTIONS_STORAGE_KEY = 'curate_user_collections_v1';

export interface CollectionItem {
  id: string;
  title: string;
  source: string;
  type: ContentType;
  duration: number; // minutes
  durationIsEstimate?: boolean;
  coverReference?: string;
  url?: string;
  canonicalUrl?: string;
  youtubeId?: string;
}

export interface SharedCollectionRecord {
  id: string; // 128-bit hex string (32 characters)
  userId: string;
  title: string; // max 80 characters
  description?: string; // max 300 characters, plain text sanitized
  displayName?: string; // creator name, max 40 characters
  items: CollectionItem[]; // max 50 items
  totalDurationMinutes: number;
  allowSearchEngines: boolean; // default false
  isActive: boolean; // default true
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
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id;
}

/**
 * Sanitizes collection title:
 * - Strips all HTML/script tags
 * - Collapses excessive whitespace
 * - Clamps to MAX_COLLECTION_TITLE_LENGTH (80 chars)
 */
export function sanitizeCollectionTitle(title?: string): string {
  if (!title || typeof title !== 'string') return 'Untitled Collection';
  const stripped = title
    .replace(/<[^>]*>/g, '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return 'Untitled Collection';
  return stripped.slice(0, MAX_COLLECTION_TITLE_LENGTH);
}

/**
 * Sanitizes optional collection description:
 * - Strips all HTML/script tags
 * - Converts newlines to spaces or clean single line breaks
 * - Collapses excessive whitespace
 * - Clamps to MAX_COLLECTION_DESC_LENGTH (300 chars)
 * - Returns undefined if empty
 */
export function sanitizeCollectionDescription(desc?: string): string | undefined {
  if (!desc || typeof desc !== 'string') return undefined;
  const stripped = desc
    .replace(/<[^>]*>/g, '')
    .replace(/[\r\t]/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
  if (!stripped) return undefined;
  return stripped.slice(0, MAX_COLLECTION_DESC_LENGTH);
}

/**
 * Normalizes a URL to a canonical format for deduplication:
 * - Lowercases scheme and host
 * - Removes common tracking parameters (utm_*, ref, source, si, fbclid, etc.)
 * - For YouTube URLs, canonicalizes to standard https://www.youtube.com/watch?v={id}
 * - Removes trailing slashes
 */
export function normalizeCanonicalUrl(url?: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  // Check for YouTube ID first
  const ytId = extractYouTubeId(trimmed);
  if (ytId) {
    return `https://www.youtube.com/watch?v=${ytId}`;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';

    // Strip common tracking parameters
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'ref',
      'ref_src',
      'si',
      'fbclid',
      'gclid',
      '_ga',
      'feature',
      'source',
    ];
    for (const p of trackingParams) {
      parsed.searchParams.delete(p);
    }

    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    const host = parsed.host.toLowerCase().replace(/^www\./, '');
    const search = parsed.searchParams.toString();
    const queryStr = search ? `?${search}` : '';

    return `${parsed.protocol.toLowerCase()}//${host}${pathname}${queryStr}`;
  } catch {
    // If invalid URL, return lowercased trimmed string
    return trimmed.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
}

/**
 * Creates a pristine, sanitized collection snapshot.
 *
 * Strict Privacy Rules:
 * - ONLY title, source, type, duration, durationIsEstimate, coverReference (thumbnailUrl),
 *   url, canonicalUrl, and youtubeId are stored.
 * - Notes, key takeaways, screenshots, spatial coordinates, user IDs, or private user fields
 *   are NEVER stored in the public snapshot.
 */
export function createCollectionSnapshot(params: {
  id?: string;
  userId?: string;
  title: string;
  description?: string;
  displayName?: string;
  items: ContentItem[];
  allowSearchEngines?: boolean;
}): SharedCollectionRecord {
  const {
    id = generate128BitId(),
    userId = 'guest-local-user',
    title,
    description,
    displayName,
    items,
    allowSearchEngines = false,
  } = params;

  // Limit to MAX_COLLECTION_ITEMS (50)
  const slicedItems = items.slice(0, MAX_COLLECTION_ITEMS);

  const sanitizedItems: CollectionItem[] = slicedItems.map((it) => {
    const rawUrl = it.url ? it.url.trim() : undefined;
    const ytId = rawUrl ? extractYouTubeId(rawUrl) || undefined : undefined;
    const canonical = rawUrl ? normalizeCanonicalUrl(rawUrl) : undefined;

    return {
      id: it.id,
      title: (it.title || 'Untitled Item').replace(/<[^>]*>/g, '').trim(),
      source: getItemSource(it),
      type: it.contentType || 'other',
      duration: Math.max(0, it.durationMinutes || 0),
      durationIsEstimate: it.durationIsEstimate,
      coverReference: it.thumbnailUrl ? it.thumbnailUrl.trim() : undefined,
      url: rawUrl,
      canonicalUrl: canonical,
      youtubeId: ytId,
    };
  });

  const totalDurationMinutes = sanitizedItems.reduce((acc, it) => acc + (it.duration || 0), 0);
  const now = new Date().toISOString();

  return {
    id,
    userId,
    title: sanitizeCollectionTitle(title),
    description: sanitizeCollectionDescription(description),
    displayName: displayName ? displayName.slice(0, 40).trim() : undefined,
    items: sanitizedItems,
    totalDurationMinutes,
    allowSearchEngines: Boolean(allowSearchEngines),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Imports items from a collection into the user's Inbox:
 * 1. Skips duplicates:
 *    - Matches YouTube video ID against existing items.
 *    - Matches canonical URL against existing items.
 * 2. Keeps duration and durationIsEstimate flags.
 * 3. NEVER copies another user's notes or private fields.
 * 4. Refetches YouTube metadata instead of reusing cached duration.
 */
export function importCollectionItemsToInbox(
  collectionItems: CollectionItem[],
  existingItems: ContentItem[]
): {
  newItems: ContentItem[];
  skippedDuplicatesCount: number;
} {
  // Build lookup index of existing YouTube IDs and canonical URLs
  const existingYtIds = new Set<string>();
  const existingCanonicalUrls = new Set<string>();

  for (const it of existingItems) {
    if (it.url) {
      const ytId = extractYouTubeId(it.url);
      if (ytId) {
        existingYtIds.add(ytId);
      }
      const canonical = normalizeCanonicalUrl(it.url);
      if (canonical) {
        existingCanonicalUrls.add(canonical);
      }
    }
  }

  const newItems: ContentItem[] = [];
  let skippedDuplicatesCount = 0;

  for (const colItem of collectionItems) {
    // 1. Check YouTube video ID match
    const ytId = colItem.youtubeId || (colItem.url ? extractYouTubeId(colItem.url) || undefined : undefined);
    if (ytId && existingYtIds.has(ytId)) {
      skippedDuplicatesCount++;
      continue;
    }

    // 2. Check canonical URL match
    const canonical = colItem.canonicalUrl || (colItem.url ? normalizeCanonicalUrl(colItem.url) : '');
    if (canonical && existingCanonicalUrls.has(canonical)) {
      skippedDuplicatesCount++;
      continue;
    }

    // Generate fresh ID
    const newId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `item_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Fresh import into Inbox:
    // Notice: notes, keyTakeaway, screenshots are intentionally NOT copied!
    // durationFetchedAt is omitted so YouTube data is refetched fresh.
    const importedItem: ContentItem = {
      id: newId,
      url: colItem.url,
      title: colItem.title,
      thumbnailUrl: colItem.coverReference || '',
      contentType: colItem.type,
      source: colItem.source,
      durationMinutes: colItem.duration,
      durationIsEstimate: colItem.durationIsEstimate,
      // Fresh refetch signal: do not copy cached durationFetchedAt
      durationFetchedAt: undefined,
      status: 'inbox',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notes: undefined,
      keyTakeaway: undefined,
      screenshots: undefined,
    };

    newItems.push(importedItem);

    // Add to existing lookup sets to prevent internal collection duplicates
    if (ytId) existingYtIds.add(ytId);
    if (canonical) existingCanonicalUrls.add(canonical);
  }

  return {
    newItems,
    skippedDuplicatesCount,
  };
}

// ---------------------------------------------------------------------------
// Local Persistence & API Integration
// ---------------------------------------------------------------------------

export function getStoredCollections(): SharedCollectionRecord[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(COLLECTIONS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveStoredCollections(collections: SharedCollectionRecord[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(collections));
    }
  } catch (err) {
    console.warn('[Collections] Failed to save collections locally:', err);
  }
}

export function saveSingleStoredCollection(collection: SharedCollectionRecord): void {
  const existing = getStoredCollections();
  const idx = existing.findIndex((c) => c.id === collection.id);
  let updated: SharedCollectionRecord[];
  if (idx >= 0) {
    updated = [...existing];
    updated[idx] = collection;
  } else {
    updated = [collection, ...existing];
  }
  saveStoredCollections(updated);
}

export function removeSingleStoredCollection(id: string): void {
  const existing = getStoredCollections();
  const updated = existing.filter((c) => c.id !== id);
  saveStoredCollections(updated);
}

/**
 * Creates or updates a collection on the server.
 */
export async function syncCollectionToServer(
  record: SharedCollectionRecord
): Promise<{ success: boolean; url: string; collection: SharedCollectionRecord }> {
  const resp = await fetch('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to create collection (${resp.status})`);
  }

  const data = await resp.json();
  // Save locally
  saveSingleStoredCollection(data.collection || record);

  // Track collection_created event
  trackEvent('collection_created', {
    itemCount: record.items.length,
    allowSearchEngines: record.allowSearchEngines,
  });

  return data;
}

/**
 * Updates collection settings on the server.
 */
export async function updateCollectionOnServer(
  id: string,
  updates: Partial<SharedCollectionRecord>
): Promise<{ success: boolean; collection: SharedCollectionRecord }> {
  const resp = await fetch(`/api/collections/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to update collection (${resp.status})`);
  }

  const data = await resp.json();
  if (data.collection) {
    saveSingleStoredCollection(data.collection);
  }
  return data;
}

/**
 * Deletes a collection from the server.
 */
export async function deleteCollectionOnServer(id: string): Promise<boolean> {
  removeSingleStoredCollection(id);

  try {
    const resp = await fetch(`/api/collections/${id}`, {
      method: 'DELETE',
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Fetches collection details from the server.
 */
export async function fetchCollectionFromServer(id: string): Promise<SharedCollectionRecord | null> {
  try {
    const resp = await fetch(`/api/collections/${id}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.collection || null;
  } catch {
    return null;
  }
}
