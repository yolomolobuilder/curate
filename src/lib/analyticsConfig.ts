declare const __ENABLE_CLARITY__: boolean | undefined;

export const UMAMI_SCRIPT_URL = 'https://cloud.umami.is/script.js';
export const UMAMI_WEBSITE_ID = 'b008d06f-e3cf-4a06-93b3-7afaf29b77a9';
export const UMAMI_DOMAINS = ['curatecalendartest.ai.studio'];

export const CLARITY_PROJECT_ID = 'yvg0r639gg';

// Build flag: defaults to false unless explicitly enabled via ENABLE_CLARITY=true
export const ENABLE_CLARITY: boolean =
  typeof __ENABLE_CLARITY__ !== 'undefined'
    ? __ENABLE_CLARITY__
    : (typeof process !== 'undefined' && process.env?.ENABLE_CLARITY === 'true');

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
 * Removes all third-party analytics script tags from the DOM and clears window globals.
 */
export function removeThirdPartyAnalyticsScripts(): void {
  if (typeof document === 'undefined') return;

  const umamiScript = document.querySelector(`script[data-website-id="${UMAMI_WEBSITE_ID}"]`);
  if (umamiScript) umamiScript.remove();

  const clarityScript = document.querySelector('script[data-clarity-id="curate-clarity"]');
  if (clarityScript) clarityScript.remove();

  if (typeof window !== 'undefined') {
    delete (window as any).clarity;
  }
}

/**
 * Single unified helper that loads Umami and Clarity.
 * Strictly respects 'curate.analytics.off'. If set, neither loads.
 */
export function loadThirdPartyAnalytics(): { umamiLoaded: boolean; clarityLoaded: boolean } {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { umamiLoaded: false, clarityLoaded: false };
  }

  // If user opted out, ensure nothing is loaded and remove any existing scripts
  if (isAnalyticsDisabled()) {
    removeThirdPartyAnalyticsScripts();
    return { umamiLoaded: false, clarityLoaded: false };
  }

  let umamiLoaded = false;
  let clarityLoaded = false;

  // 1. Umami Script (cookie-free anonymous metrics)
  if (!document.querySelector(`script[data-website-id="${UMAMI_WEBSITE_ID}"]`)) {
    const script = document.createElement('script');
    script.defer = true;
    script.src = UMAMI_SCRIPT_URL;
    script.setAttribute('data-website-id', UMAMI_WEBSITE_ID);
    script.setAttribute('data-domains', UMAMI_DOMAINS.join(','));
    document.head.appendChild(script);
    umamiLoaded = true;
  } else {
    umamiLoaded = true;
  }

  // 2. Microsoft Clarity (only if ENABLE_CLARITY build flag is enabled)
  if (ENABLE_CLARITY) {
    if (!document.querySelector('script[data-clarity-id="curate-clarity"]')) {
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.setAttribute('data-clarity-id', 'curate-clarity');
      script.text = `(function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");`;
      document.head.appendChild(script);
      clarityLoaded = true;
    } else {
      clarityLoaded = true;
    }
  }

  return { umamiLoaded, clarityLoaded };
}

/**
 * Toggles analytics off/on on this device.
 */
export function setAnalyticsDisabled(disabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (disabled) {
      localStorage.setItem(ANALYTICS_OFF_STORAGE_KEY, 'true');
      removeThirdPartyAnalyticsScripts();
    } else {
      localStorage.removeItem(ANALYTICS_OFF_STORAGE_KEY);
      loadThirdPartyAnalytics();
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('curate:analytics_pref_changed', { detail: { disabled } }));
    }
  } catch (err) {
    console.warn('[Analytics] Failed to set analytics preference:', err);
  }
}

// Backwards-compatible alias for existing imports
export const injectUmamiScript = loadThirdPartyAnalytics;

// Auto-inject at startup when running in browser
if (typeof window !== 'undefined') {
  loadThirdPartyAnalytics();
}
