import { APP_NAME } from '../types';

const BRAND_LOGO_KEY = 'curatecal_custom_brand_logo_v1';
const BRAND_NAME_KEY = 'curatecal_custom_brand_name_v1';

export function getCustomBrandLogo(): string | null {
  try {
    return localStorage.getItem(BRAND_LOGO_KEY);
  } catch {
    return null;
  }
}

export function saveCustomBrandLogo(logoUrlOrData: string | null): void {
  try {
    if (logoUrlOrData) {
      localStorage.setItem(BRAND_LOGO_KEY, logoUrlOrData);
    } else {
      localStorage.removeItem(BRAND_LOGO_KEY);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('curate:brand_updated'));
    }
  } catch (err) {
    console.warn('[Brand] Failed to save custom logo', err);
  }
}

export function getCustomBrandName(): string {
  try {
    return localStorage.getItem(BRAND_NAME_KEY) || APP_NAME;
  } catch {
    return APP_NAME;
  }
}

export function saveCustomBrandName(name: string): void {
  try {
    const trimmed = name.trim();
    if (trimmed) {
      localStorage.setItem(BRAND_NAME_KEY, trimmed);
    } else {
      localStorage.removeItem(BRAND_NAME_KEY);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('curate:brand_updated'));
    }
  } catch (err) {
    console.warn('[Brand] Failed to save custom brand name', err);
  }
}
