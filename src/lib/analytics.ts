export interface AnalyticsEvent {
  id: string;
  name: string;
  timestamp: string;
  properties?: Record<string, unknown>;
}

const ANALYTICS_STORAGE_KEY = 'curatecal_analytics_events_v1';

/**
 * Lightweight client-side product analytics tracker.
 * Dispatches a window event, writes to localStorage event queue,
 * and logs to the console for instrumentation observability.
 */
export function trackEvent(name: string, properties?: Record<string, unknown>): AnalyticsEvent {
  const event: AnalyticsEvent = {
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name,
    timestamp: new Date().toISOString(),
    properties: properties || {},
  };

  try {
    const raw = localStorage.getItem(ANALYTICS_STORAGE_KEY);
    const existing: AnalyticsEvent[] = raw ? JSON.parse(raw) : [];
    // Keep most recent 150 events
    const updated = [event, ...existing].slice(0, 150);
    localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('[Analytics] Failed to save event to localStorage:', err);
  }

  // Console instrumentation: only log when dev flag is explicitly enabled (off by default)
  const isDevLogging =
    typeof window !== 'undefined' &&
    ((window as any).__CURATE_DEV_ANALYTICS__ === true ||
      localStorage.getItem('curatecal_dev_analytics') === 'true');

  if (isDevLogging && typeof console !== 'undefined' && console.info) {
    console.info(
      `%c[Analytics]%c ${name}`,
      'background: #1c1917; color: #f59e0b; font-weight: bold; padding: 2px 5px; border-radius: 3px;',
      'color: #78716c; font-weight: normal;',
      properties || {}
    );
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('curate:analytics', { detail: event }));
  }

  return event;
}

export function getStoredAnalyticsEvents(): AnalyticsEvent[] {
  try {
    const raw = localStorage.getItem(ANALYTICS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearAnalyticsEvents(): void {
  try {
    localStorage.removeItem(ANALYTICS_STORAGE_KEY);
  } catch (err) {
    console.warn('[Analytics] Failed to clear events:', err);
  }
}
