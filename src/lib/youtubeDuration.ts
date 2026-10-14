import { ContentItem } from '../types';
import { trackEvent } from './analytics';
import { extractYouTubeId } from './metadataExtractor';

export const YT_DURATION_CACHE_KEY = 'curatecal_yt_duration_cache_v1';
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface CachedYouTubeDuration {
  durationMinutes: number | null;
  fetchedAt: string;
  isLiveOrMissing?: boolean;
}

/**
 * Reads the YouTube Data API v3 key from VITE_YOUTUBE_API_KEY.
 */
export function getYouTubeApiKey(): string | undefined {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_YOUTUBE_API_KEY) {
    const key = String(import.meta.env.VITE_YOUTUBE_API_KEY).trim();
    if (key) return key;
  }
  if (typeof process !== 'undefined' && process.env?.VITE_YOUTUBE_API_KEY) {
    const key = String(process.env.VITE_YOUTUBE_API_KEY).trim();
    if (key) return key;
  }
  return undefined;
}

/**
 * Parses ISO 8601 duration string into rounded minutes (minimum 1).
 * Handles days (P1DT2H), hours, minutes, seconds.
 * Returns null for live streams (PT0S, P0D), 0-duration, invalid or missing durations.
 */
export function parseIso8601DurationToMinutes(durationStr?: string | null): number | null {
  if (!durationStr || typeof durationStr !== 'string') return null;
  const trimmed = durationStr.trim();
  if (!trimmed.startsWith('P')) return null;

  // Standard YouTube ISO 8601 format: P(n)DT(n)H(n)M(n)S
  const match = trimmed.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) return null;

  const days = match[1] ? parseInt(match[1], 10) : 0;
  const hours = match[2] ? parseInt(match[2], 10) : 0;
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  const seconds = match[4] ? parseFloat(match[4]) : 0;

  const totalSeconds = days * 86400 + hours * 3600 + minutes * 60 + seconds;

  // Live streams or empty durations stay estimates
  if (totalSeconds <= 0) {
    return null;
  }

  // Convert to minutes, rounding to the nearest minute with a minimum of 1
  return Math.max(1, Math.round(totalSeconds / 60));
}

/**
 * Check if a timestamp is older than 30 days.
 */
export function isOlderThan30Days(fetchedAt?: string | null): boolean {
  if (!fetchedAt) return true;
  const timestamp = new Date(fetchedAt).getTime();
  if (isNaN(timestamp)) return true;
  return Date.now() - timestamp >= THIRTY_DAYS_MS;
}

/**
 * Retrieves the cached YouTube duration map from localStorage.
 */
export function getYouTubeDurationCache(): Record<string, CachedYouTubeDuration> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(YT_DURATION_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Returns a cached duration for a video ID if valid and not older than 30 days.
 */
export function getCachedYouTubeDuration(videoId: string): CachedYouTubeDuration | null {
  const cache = getYouTubeDurationCache();
  const entry = cache[videoId];
  if (!entry) return null;
  if (isOlderThan30Days(entry.fetchedAt)) return null;
  return entry;
}

/**
 * Saves a duration entry into the persistent cache.
 */
export function setCachedYouTubeDuration(
  videoId: string,
  durationMinutes: number | null,
  isLiveOrMissing = false
): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const cache = getYouTubeDurationCache();
    cache[videoId] = {
      durationMinutes,
      fetchedAt: new Date().toISOString(),
      isLiveOrMissing,
    };
    localStorage.setItem(YT_DURATION_CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('[YouTubeCache] Failed to save cache entry:', err);
  }
}

/**
 * Saves multiple duration entries into the persistent cache in a single operation.
 */
export function setCachedYouTubeDurations(
  entries: Array<{ videoId: string; durationMinutes: number | null; isLiveOrMissing?: boolean }>
): void {
  if (!entries || entries.length === 0) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const cache = getYouTubeDurationCache();
    const now = new Date().toISOString();
    for (const entry of entries) {
      cache[entry.videoId] = {
        durationMinutes: entry.durationMinutes,
        fetchedAt: now,
        isLiveOrMissing: entry.isLiveOrMissing || false,
      };
    }
    localStorage.setItem(YT_DURATION_CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('[YouTubeCache] Failed to save cache entries:', err);
  }
}

/**
 * Clears the persistent YouTube duration cache.
 */
export function clearYouTubeDurationCache(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(YT_DURATION_CACHE_KEY);
    }
  } catch {
    // Ignore
  }
}

/**
 * Determines whether the user manually edited the item's duration by hand.
 * Never overwrite a duration the user edited by hand.
 */
export function isDurationUserEdited(item: ContentItem): boolean {
  if (Array.isArray(item.userEditedFields) && item.userEditedFields.includes('durationMinutes')) {
    return true;
  }
  if (Array.isArray(item.editedFields) && item.editedFields.includes('durationMinutes')) {
    return true;
  }
  // If durationIsEstimate is false but durationFetchedAt was never set, user set it
  if (item.durationIsEstimate === false && !item.durationFetchedAt) {
    return true;
  }
  return false;
}

export interface FetchResult {
  durationMinutes: number | null;
  isLive: boolean;
  fetchedAt?: string;
}

/**
 * Batches YouTube video IDs (up to 50 per call) and queries the YouTube Data API v3.
 * Caches results and refetches entries older than 30 days.
 */
export async function fetchYouTubeDurationsBatch(
  videoIds: string[],
  options?: {
    apiKey?: string;
    fetchFn?: typeof fetch;
  }
): Promise<Map<string, FetchResult>> {
  const results = new Map<string, FetchResult>();
  const uniqueIds = Array.from(new Set(videoIds.filter(Boolean)));
  if (uniqueIds.length === 0) return results;

  const apiKey = options?.apiKey || getYouTubeApiKey();
  const fetcher = options?.fetchFn || fetch;

  const idsToFetch: string[] = [];

  // Check cache first
  for (const id of uniqueIds) {
    const cached = getCachedYouTubeDuration(id);
    if (cached) {
      results.set(id, {
        durationMinutes: cached.durationMinutes,
        isLive: Boolean(cached.isLiveOrMissing),
        fetchedAt: cached.fetchedAt,
      });
    } else {
      idsToFetch.push(id);
    }
  }

  // If no IDs need network fetch, return cached results
  if (idsToFetch.length === 0) {
    return results;
  }

  // If no API key configured, app behaves exactly as now (no network call, keep estimates)
  if (!apiKey) {
    return results;
  }

  // Batch up to 50 IDs per call
  const BATCH_SIZE = 50;
  for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
    const batch = idsToFetch.slice(i, i + BATCH_SIZE);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&fields=items(id,contentDetails/duration)&id=${encodeURIComponent(
      batch.join(',')
    )}&key=${encodeURIComponent(apiKey)}`;

    try {
      const response = await fetcher(url);
      if (!response.ok) {
        trackEvent('duration_fetched', { source: 'youtube', ok: false });
        console.warn(`[YouTube API] videos.list failed with HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      trackEvent('duration_fetched', { source: 'youtube', ok: true });

      const returnedItems: Array<{ id: string; contentDetails?: { duration?: string } }> =
        data?.items || [];
      const returnedMap = new Map<string, string | undefined>();
      for (const item of returnedItems) {
        if (item.id) {
          returnedMap.set(item.id, item.contentDetails?.duration);
        }
      }

      const now = new Date().toISOString();
      const cacheEntriesToSave: Array<{ videoId: string; durationMinutes: number | null; isLiveOrMissing?: boolean }> = [];

      for (const id of batch) {
        const rawDuration = returnedMap.get(id);
        const parsedMinutes = parseIso8601DurationToMinutes(rawDuration);
        const isLive = !parsedMinutes;

        cacheEntriesToSave.push({ videoId: id, durationMinutes: parsedMinutes, isLiveOrMissing: isLive });
        results.set(id, {
          durationMinutes: parsedMinutes,
          isLive,
          fetchedAt: now,
        });
      }

      setCachedYouTubeDurations(cacheEntriesToSave);
    } catch (err) {
      trackEvent('duration_fetched', { source: 'youtube', ok: false });
      console.warn('[YouTube API] Network failure or blocked request:', err);
    }
  }

  return results;
}

/**
 * Enriches a single ContentItem with YouTube duration if it is a YouTube link.
 * Never overwrites a user-edited duration.
 * On failure or live stream, preserves existing estimate.
 */
export async function enrichItemWithYouTubeDuration(
  item: ContentItem,
  options?: { apiKey?: string; fetchFn?: typeof fetch }
): Promise<ContentItem> {
  // If user edited duration by hand, never overwrite
  if (isDurationUserEdited(item)) {
    return item;
  }

  const url = item.url || '';
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    return item;
  }

  // If already fetched and less than 30 days old, keep existing
  if (item.durationFetchedAt && !isOlderThan30Days(item.durationFetchedAt) && item.durationIsEstimate === false) {
    return item;
  }

  const batchResult = await fetchYouTubeDurationsBatch([videoId], options);
  const result = batchResult.get(videoId);

  if (result && typeof result.durationMinutes === 'number' && result.durationMinutes > 0) {
    return {
      ...item,
      durationMinutes: result.durationMinutes,
      durationIsEstimate: false,
      durationFetchedAt: result.fetchedAt || new Date().toISOString(),
    };
  }

  // Live stream, missing duration, or failure: keep estimate
  return item;
}

/**
 * Refreshes estimated YouTube items across the collection in batch.
 * Used for Settings > 'Refresh YouTube durations'.
 */
export async function refreshAllEstimatedYouTubeItems(
  items: ContentItem[],
  options?: { apiKey?: string; fetchFn?: typeof fetch }
): Promise<{
  updatedCount: number;
  updatedItems: ContentItem[];
  error?: string;
}> {
  const apiKey = options?.apiKey || getYouTubeApiKey();
  if (!apiKey) {
    return {
      updatedCount: 0,
      updatedItems: items,
      error: 'No VITE_YOUTUBE_API_KEY configured',
    };
  }

  // Find candidate items
  const candidates: Array<{ item: ContentItem; videoId: string }> = [];
  for (const item of items) {
    if (isDurationUserEdited(item)) continue;
    const isYouTube =
      item.contentType === 'youtube' ||
      (item.url && (item.url.includes('youtube.com') || item.url.includes('youtu.be')));
    if (!isYouTube) continue;

    const videoId = item.url ? extractYouTubeId(item.url) : null;
    if (!videoId) continue;

    // Refresh if estimated or older than 30 days
    if (item.durationIsEstimate !== false || !item.durationFetchedAt || isOlderThan30Days(item.durationFetchedAt)) {
      candidates.push({ item, videoId });
    }
  }

  if (candidates.length === 0) {
    return { updatedCount: 0, updatedItems: items };
  }

  const videoIds = candidates.map((c) => c.videoId);
  const durationMap = await fetchYouTubeDurationsBatch(videoIds, options);

  let updatedCount = 0;
  const updatedItems = items.map((item) => {
    const candidate = candidates.find((c) => c.item.id === item.id);
    if (!candidate) return item;

    const res = durationMap.get(candidate.videoId);
    if (res && typeof res.durationMinutes === 'number' && res.durationMinutes > 0) {
      updatedCount++;
      return {
        ...item,
        durationMinutes: res.durationMinutes,
        durationIsEstimate: false,
        durationFetchedAt: res.fetchedAt || new Date().toISOString(),
      };
    }

    return item;
  });

  return { updatedCount, updatedItems };
}
