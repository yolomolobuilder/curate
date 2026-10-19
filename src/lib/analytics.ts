import { isAnalyticsDisabled, injectUmamiScript } from './analyticsConfig';

declare global {
  interface Window {
    umami?: {
      track: (name: string, data?: Record<string, unknown>) => void;
    };
  }
}

export interface AnalyticsEvent {
  id: string;
  name: string;
  timestamp: string; // ISO 8601 string
  properties?: Record<string, unknown>;
}

export const ANALYTICS_STORAGE_KEY = 'curatecal_analytics_events_v1';

// Timestamp of app startup / open
let appOpenTimestamp = Date.now();

export function getSecondsSinceOpen(): number {
  return Math.max(0, Math.round((Date.now() - appOpenTimestamp) / 1000));
}

/**
 * Strips URLs, titles, notes, and user-typed text strings before sending or storing.
 */
export function sanitizeAnalyticsProps(
  props?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!props) return undefined;

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    const lowerKey = key.toLowerCase();

    // Reject keys that imply user content, titles, notes, URLs, queries
    if (
      lowerKey.includes('url') ||
      lowerKey.includes('title') ||
      lowerKey.includes('note') ||
      lowerKey.includes('text') ||
      lowerKey.includes('desc') ||
      lowerKey.includes('query') ||
      lowerKey.includes('search') ||
      lowerKey.includes('input') ||
      lowerKey.includes('author') ||
      lowerKey.includes('message') ||
      lowerKey.includes('offer') ||
      lowerKey.includes('takeaway') ||
      lowerKey.includes('comment')
    ) {
      continue;
    }

    // Inspect values: reject any string that looks like a URL or URL protocol
    if (typeof value === 'string') {
      if (/https?:\/\//i.test(value) || /www\./i.test(value) || value.includes('://')) {
        continue;
      }
    }

    sanitized[key] = value;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/**
 * Primary product analytics tracking function.
 * 1. Sanitizes properties (no URLs, titles, notes, or typed text).
 * 2. Writes to the local event queue (JSON with ISO timestamps).
 * 3. Safely invokes window.umami?.track(name, props) unless opt-out flag is set.
 * 4. Never breaks if script fails to load (e.g. ad blocker).
 */
export function trackEvent(name: string, properties?: Record<string, unknown>): AnalyticsEvent {
  const sanitizedProps = sanitizeAnalyticsProps(properties);

  const event: AnalyticsEvent = {
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name,
    timestamp: new Date().toISOString(),
    properties: sanitizedProps,
  };

  // 1. Maintain local log in localStorage
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(ANALYTICS_STORAGE_KEY);
      const existing: AnalyticsEvent[] = raw ? JSON.parse(raw) : [];
      // Keep most recent 150 events
      const updated = [event, ...existing].slice(0, 150);
      localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(updated));
    }
  } catch (err) {
    console.warn('[Analytics] Failed to save event to localStorage:', err);
  }

  // 2. Dispatch custom event for in-app listeners
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('curate:analytics', { detail: event }));
    } catch {
      // Ignore
    }
  }

  // 3. Forward to Umami if not opted out
  if (!isAnalyticsDisabled()) {
    try {
      if (typeof window !== 'undefined' && window.umami && typeof window.umami.track === 'function') {
        window.umami.track(name, sanitizedProps);
      }
    } catch (err) {
      // Never throw if ad blocker or external network fails
      console.warn('[Analytics] Umami track skipped or blocked:', err);
    }
  }

  return event;
}

/**
 * Returns stored session events as an array.
 */
export function getStoredAnalyticsEvents(): AnalyticsEvent[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(ANALYTICS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Clears the local analytics event log.
 */
export function clearAnalyticsEvents(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(ANALYTICS_STORAGE_KEY);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('curate:analytics_cleared'));
    }
  } catch (err) {
    console.warn('[Analytics] Failed to clear events:', err);
  }
}

/**
 * Formats the local session log as pretty JSON with ISO timestamps.
 */
export function formatSessionLogJson(): string {
  const events = getStoredAnalyticsEvents();
  return JSON.stringify(events, null, 2);
}

/**
 * Copies the local event log to the clipboard as JSON with ISO timestamps.
 */
export async function copySessionLogToClipboard(): Promise<boolean> {
  const json = formatSessionLogJson();
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(json);
      return true;
    }
  } catch (err) {
    console.warn('[Analytics] navigator.clipboard failed, using fallback:', err);
  }

  try {
    if (typeof document !== 'undefined') {
      const el = document.createElement('textarea');
      el.value = json;
      el.setAttribute('readonly', '');
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export { injectUmamiScript };
