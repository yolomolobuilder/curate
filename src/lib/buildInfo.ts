declare const __BUILD_TIME__: string | undefined;

export const APP_VERSION = '0.1.0';

export const BUILD_TIMESTAMP: string =
  typeof __BUILD_TIME__ !== 'undefined'
    ? __BUILD_TIME__
    : new Date().toISOString();

export function formatBuildDate(isoOrDate: string): string {
  try {
    const d = new Date(isoOrDate);
    if (isNaN(d.getTime())) return isoOrDate;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoOrDate;
  }
}

export const BUILD_DATE_STRING = formatBuildDate(BUILD_TIMESTAMP);
