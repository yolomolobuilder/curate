export const UMAMI_SCRIPT_URL = 'https://cloud.umami.is/script.js';
export const UMAMI_WEBSITE_ID = 'b008d06f-e3cf-4a06-93b3-7afaf29b77a9';
export const UMAMI_DOMAINS = ['<https://curatecalendartest.ai.studio/>'];

export const ANALYTICS_OFF_STORAGE_KEY = 'curate.analytics.off';

/**
 * Returns true if analytics has been turned off by the user on this device.
 */
export function isAnalyticsDisabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(ANALYTICS_OFF_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Toggles analytics off/on on this device.
 */
export function setAnalyticsDisabled(disabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (disabled) {
      localStorage.setItem(ANALYTICS_OFF_STORAGE_KEY, 'true');
      if (typeof document !== 'undefined') {
        const existing = document.querySelector(`script[data-website-id="${UMAMI_WEBSITE_ID}"]`);
        if (existing) existing.remove();
      }
    } else {
      localStorage.removeItem(ANALYTICS_OFF_STORAGE_KEY);
      injectUmamiScript();
    }
  } catch (err) {
    console.warn('[Analytics] Failed to set analytics preference:', err);
  }
}

/**
 * Injects the Umami script tag at startup if analytics is enabled.
 * Keeps Umami's default pageview tracking (defer, data-website-id, data-domains).
 */
export function injectUmamiScript(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  if (isAnalyticsDisabled()) {
    return;
  }

  // Prevent duplicate script tags
  if (document.querySelector(`script[data-website-id="${UMAMI_WEBSITE_ID}"]`)) {
    return;
  }

  const script = document.createElement('script');
  script.defer = true;
  script.src = UMAMI_SCRIPT_URL;
  script.setAttribute('data-website-id', UMAMI_WEBSITE_ID);
  script.setAttribute('data-domains', UMAMI_DOMAINS.join(','));
  document.head.appendChild(script);
}

// Auto-inject at startup when running in browser
if (typeof window !== 'undefined') {
  injectUmamiScript();
}
