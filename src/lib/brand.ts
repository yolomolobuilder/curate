import { APP_NAME } from '../types';
import {
  saveMediaItem,
  getMediaItemSync,
  deleteMediaItem,
} from './mediaStorage';

const BRAND_LOGO_KEY = 'curatecal_custom_brand_logo_v1';
const BRAND_NAME_KEY = 'curatecal_custom_brand_name_v1';

export function getCustomBrandLogo(): string | null {
  try {
    const stored = localStorage.getItem(BRAND_LOGO_KEY);
    if (!stored) return null;
    if (stored.startsWith('idb:')) {
      return getMediaItemSync(stored);
    }
    return stored;
  } catch {
    return null;
  }
}

export function saveCustomBrandLogo(logoUrlOrData: string | null): void {
  try {
    if (logoUrlOrData) {
      if (logoUrlOrData.startsWith('data:image/')) {
        // Stop storing raw base64 in localStorage! Store in IndexedDB and keep only a reference
        saveMediaItem('brand_logo', logoUrlOrData, 200 * 1024).then((ref) => {
          localStorage.setItem(BRAND_LOGO_KEY, ref);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('curate:brand_updated'));
          }
        });
        localStorage.setItem(BRAND_LOGO_KEY, 'idb:brand_logo');
      } else {
        localStorage.setItem(BRAND_LOGO_KEY, logoUrlOrData);
      }
    } else {
      localStorage.removeItem(BRAND_LOGO_KEY);
      deleteMediaItem('brand_logo');
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
