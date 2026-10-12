/**
 * CloudStore & Supabase Auth Engine
 *
 * Implements the DataStore interface against Supabase PostgreSQL with
 * strict Row-Level Security (auth.uid() = user_id).
 *
 * Rules:
 * - Guest mode stays fully functional (no sign-in required).
 * - Never includes a service key in client code (uses public anon key only).
 * - Upload/migration excludes sample items, duration caches, and analytics logs.
 * - Handles Google OAuth and email magic link sign-in.
 */

import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { ContentItem, DayTheme, BudgetPreset, APP_NAME } from '../types';
import { DataStore, CurateSettings, DataSnapshot } from './dataStore';
import { migrateItem } from './storage';
import { compressBase64ToCap, MAX_MEDIA_BYTES } from './mediaStorage';
import { trackEvent } from './analytics';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

function getAppRedirectUrl(): string {
  // If running in development / cloud run, window.location.origin is the exact web URL
  if (typeof window !== 'undefined' && window.location?.origin) {
    // If inside an iframe or loaded via preview, return the top window or current origin
    return window.location.origin;
  }
  return '';
}


let clientInstance: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('https://'));
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (!clientInstance) {
    clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return clientInstance;
}

// In-memory cache for fast synchronous image rendering
const cloudMediaCache = new Map<string, string>();

/**
 * Converts a database user_items row into a typed ContentItem.
 */
export function rowToContentItem(row: any): ContentItem {
  return migrateItem({
    id: row.id,
    title: row.title,
    url: row.url || undefined,
    thumbnailUrl: row.thumbnail_url || '',
    contentType: row.content_type,
    source: row.source || undefined,
    platform: row.platform || undefined,
    author: row.author || undefined,
    durationMinutes: row.duration_minutes ?? undefined,
    durationIsEstimate: row.duration_is_estimate,
    durationFetchedAt: row.duration_fetched_at || undefined,
    userEditedFields: row.user_edited_fields || [],
    editedFields: row.user_edited_fields || [],
    topic: row.topic || undefined,
    status: row.status,
    scheduledDate: row.scheduled_date || undefined,
    scheduledEndDate: row.scheduled_end_date || undefined,
    notes: row.notes || undefined,
    keyTakeaway: row.key_takeaway || undefined,
    screenshots: row.screenshots || [],
    spatialX: row.spatial_x ?? undefined,
    spatialY: row.spatial_y ?? undefined,
    isPriority: Boolean(row.is_priority),
    isSample: false, // Cloud rows are never sample items
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
    completedAt: row.completed_at || undefined,
  });
}

/**
 * Converts a ContentItem into a database row payload for user_items.
 */
export function contentItemToRow(item: ContentItem, userId: string) {
  return {
    id: item.id,
    user_id: userId,
    title: item.title,
    url: item.url || null,
    thumbnail_url: item.thumbnailUrl || null,
    content_type: item.contentType,
    source: item.source || null,
    platform: item.platform || null,
    author: item.author || null,
    duration_minutes: item.durationMinutes ?? null,
    duration_is_estimate: item.durationIsEstimate !== false,
    duration_fetched_at: item.durationFetchedAt || null,
    user_edited_fields: item.userEditedFields || item.editedFields || [],
    topic: item.topic || null,
    status: item.status,
    scheduled_date: item.scheduledDate || null,
    scheduled_end_date: item.scheduledEndDate || null,
    notes: item.notes || null,
    key_takeaway: item.keyTakeaway || null,
    screenshots: item.screenshots || [],
    spatial_x: item.spatialX ?? null,
    spatial_y: item.spatialY ?? null,
    is_priority: Boolean(item.isPriority),
    is_sample: false, // Never store as sample
    created_at: item.createdAt,
    updated_at: item.updatedAt || new Date().toISOString(),
    completed_at: item.completedAt || null,
  };
}

/**
 * Converts ContentItems array into CSV format containing all item fields.
 */
export function exportItemsToCsv(items: ContentItem[]): string {
  const headers = [
    'ID',
    'Title',
    'Content Type',
    'Status',
    'Scheduled Date',
    'Scheduled End Date',
    'Duration (Minutes)',
    'Is Duration Estimate',
    'Topic',
    'Source',
    'Author',
    'Platform',
    'URL',
    'Notes',
    'Key Takeaway',
    'Is Starred',
    'Created At',
    'Updated At',
    'Completed At',
  ];

  const escapeCsv = (val: any): string => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = items.map((it) => [
    escapeCsv(it.id),
    escapeCsv(it.title),
    escapeCsv(it.contentType),
    escapeCsv(it.status),
    escapeCsv(it.scheduledDate || ''),
    escapeCsv(it.scheduledEndDate || ''),
    escapeCsv(it.durationMinutes ?? ''),
    escapeCsv(it.durationIsEstimate !== false ? 'Yes' : 'No'),
    escapeCsv(it.topic || ''),
    escapeCsv(it.source || ''),
    escapeCsv(it.author || ''),
    escapeCsv(it.platform || ''),
    escapeCsv(it.url || ''),
    escapeCsv(it.notes || ''),
    escapeCsv(it.keyTakeaway || ''),
    escapeCsv(it.isPriority ? 'Yes' : 'No'),
    escapeCsv(it.createdAt),
    escapeCsv(it.updatedAt || it.createdAt),
    escapeCsv(it.completedAt || ''),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

/**
 * CloudStore implements DataStore against Supabase PostgreSQL and Auth.
 */
export class CloudStore implements DataStore {
  private client: SupabaseClient | null;

  constructor() {
    this.client = getSupabaseClient();
  }

  private async getUserId(): Promise<string | null> {
    if (!this.client) return null;
    const { data } = await this.client.auth.getUser();
    return data.user?.id || null;
  }

  async loadAll(): Promise<{ items: ContentItem[]; settings: CurateSettings }> {
    const userId = await this.getUserId();
    if (!this.client || !userId) {
      return { items: [], settings: await this.loadSettings() };
    }

    try {
      const { data: itemRows, error: itemsError } = await this.client
        .from('user_items')
        .select('*')
        .order('created_at', { ascending: false });

      if (itemsError) throw itemsError;

      const items = (itemRows || []).map(rowToContentItem);
      const settings = await this.loadSettings();
      return { items, settings };
    } catch (err) {
      console.warn('[CloudStore] loadAll failed:', err);
      return { items: [], settings: await this.loadSettings() };
    }
  }

  async saveItem(item: ContentItem): Promise<boolean> {
    const userId = await this.getUserId();
    if (!this.client || !userId) return false;

    try {
      const payload = contentItemToRow(item, userId);
      const { error } = await this.client
        .from('user_items')
        .upsert(payload, { onConflict: 'user_id,id' });

      if (error) throw error;
      return true;
    } catch (err) {
      console.warn('[CloudStore] saveItem failed:', err);
      return false;
    }
  }

  async saveItems(items: ContentItem[]): Promise<boolean> {
    const userId = await this.getUserId();
    if (!this.client || !userId) return false;

    try {
      const payloads = items.map((it) => contentItemToRow(it, userId));
      const { error } = await this.client
        .from('user_items')
        .upsert(payloads, { onConflict: 'user_id,id' });

      if (error) throw error;
      return true;
    } catch (err) {
      console.warn('[CloudStore] saveItems failed:', err);
      return false;
    }
  }

  async deleteItem(id: string): Promise<boolean> {
    const userId = await this.getUserId();
    if (!this.client || !userId) return false;

    try {
      const { error } = await this.client
        .from('user_items')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return true;
    } catch (err) {
      console.warn('[CloudStore] deleteItem failed:', err);
      return false;
    }
  }

  async loadSettings(): Promise<CurateSettings> {
    const defaultSettings: CurateSettings = {
      dayThemes: [],
      customTopics: [],
      weekBudgets: {},
      dayPreferencesEnabled: true,
      darkMode: true,
    };

    const userId = await this.getUserId();
    if (!this.client || !userId) return defaultSettings;

    try {
      const { data, error } = await this.client
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      if (!data) return defaultSettings;

      return {
        dayThemes: data.day_themes || [],
        customTopics: data.custom_topics || [],
        weekBudgets: data.week_budgets || {},
        dayPreferencesEnabled: data.day_preferences_enabled ?? true,
        brandName: data.brand_name || undefined,
        brandLogo: data.brand_logo || undefined,
        darkMode: data.dark_mode ?? true,
      };
    } catch (err) {
      console.warn('[CloudStore] loadSettings failed:', err);
      return defaultSettings;
    }
  }

  async saveSettings(settings: Partial<CurateSettings>): Promise<boolean> {
    const userId = await this.getUserId();
    if (!this.client || !userId) return false;

    try {
      const current = await this.loadSettings();
      const updatedRow = {
        user_id: userId,
        day_themes: settings.dayThemes ?? current.dayThemes,
        custom_topics: settings.customTopics ?? current.customTopics,
        week_budgets: settings.weekBudgets ?? current.weekBudgets,
        day_preferences_enabled: settings.dayPreferencesEnabled ?? current.dayPreferencesEnabled,
        brand_name: settings.brandName !== undefined ? settings.brandName : current.brandName,
        brand_logo: settings.brandLogo !== undefined ? settings.brandLogo : current.brandLogo,
        dark_mode: settings.darkMode !== undefined ? settings.darkMode : current.darkMode,
        updated_at: new Date().toISOString(),
      };

      const { error } = await this.client
        .from('user_settings')
        .upsert(updatedRow, { onConflict: 'user_id' });

      if (error) throw error;
      return true;
    } catch (err) {
      console.warn('[CloudStore] saveSettings failed:', err);
      return false;
    }
  }

  async exportSnapshot(): Promise<DataSnapshot> {
    const { items, settings } = await this.loadAll();
    const imageRefs: string[] = [];
    for (const it of items) {
      if (it.screenshots) {
        for (const s of it.screenshots) {
          if (s.startsWith('idb:')) imageRefs.push(s);
        }
      }
      if (it.thumbnailUrl && it.thumbnailUrl.startsWith('idb:')) {
        imageRefs.push(it.thumbnailUrl);
      }
    }
    if (settings.brandLogo && settings.brandLogo.startsWith('idb:')) {
      imageRefs.push(settings.brandLogo);
    }

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      appName: APP_NAME,
      itemCount: items.length,
      items,
      settings,
      imageRefs: Array.from(new Set(imageRefs)),
    };
  }

  async importSnapshot(snapshot: DataSnapshot): Promise<boolean> {
    if (!snapshot || !Array.isArray(snapshot.items)) return false;
    const ok = await this.saveItems(snapshot.items);
    if (snapshot.settings) {
      await this.saveSettings(snapshot.settings);
    }
    return ok;
  }

  async saveMedia(id: string, dataUrl: string): Promise<string> {
    const refKey = id.startsWith('idb:') ? id : `idb:${id}`;
    const rawId = refKey.replace(/^idb:/, '');
    const capped = compressBase64ToCap(dataUrl, MAX_MEDIA_BYTES);
    cloudMediaCache.set(refKey, capped);

    const userId = await this.getUserId();
    if (this.client && userId) {
      try {
        await this.client.from('user_media').upsert({
          id: rawId,
          user_id: userId,
          media_data: capped,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        console.warn('[CloudStore] saveMedia to cloud failed:', err);
      }
    }
    return refKey;
  }

  async getMedia(refOrId: string): Promise<string | null> {
    if (!refOrId) return null;
    const rawId = refOrId.replace(/^idb:/, '');
    const refKey = `idb:${rawId}`;

    if (cloudMediaCache.has(refKey)) return cloudMediaCache.get(refKey)!;
    if (cloudMediaCache.has(rawId)) return cloudMediaCache.get(rawId)!;

    if (this.client) {
      try {
        const { data } = await this.client
          .from('user_media')
          .select('media_data')
          .eq('id', rawId)
          .maybeSingle();

        if (data && data.media_data) {
          cloudMediaCache.set(refKey, data.media_data);
          cloudMediaCache.set(rawId, data.media_data);
          return data.media_data;
        }
      } catch {
        // Fallback
      }
    }
    return null;
  }

  getMediaSync(refOrId: string): string | null {
    if (!refOrId) return null;
    if (refOrId.startsWith('http://') || refOrId.startsWith('https://') || refOrId.startsWith('data:image/')) {
      return refOrId;
    }
    const rawId = refOrId.replace(/^idb:/, '');
    const refKey = `idb:${rawId}`;
    return cloudMediaCache.get(refKey) || cloudMediaCache.get(rawId) || null;
  }

  async deleteMedia(refOrId: string): Promise<void> {
    const rawId = refOrId.replace(/^idb:/, '');
    cloudMediaCache.delete(`idb:${rawId}`);
    cloudMediaCache.delete(rawId);

    if (this.client) {
      try {
        await this.client.from('user_media').delete().eq('id', rawId);
      } catch {
        // Ignore
      }
    }
  }

  // --- AUTH SERVICES ---
  async signInWithGoogle(): Promise<{ error: Error | null }> {
    if (!this.client) {
      return { error: new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.') };
    }
    trackEvent('signup_started', { provider: 'google' });
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getAppRedirectUrl(),
      },
    });
    return { error: error ? new Error(error.message) : null };
  }

  async signInWithOtp(email: string): Promise<{ error: Error | null }> {
    if (!this.client) {
      return { error: new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.') };
    }
    trackEvent('signup_started', { provider: 'email_magic_link' });
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: getAppRedirectUrl(),
      },
    });
    return { error: error ? new Error(error.message) : null };
  }

  async signOut(): Promise<void> {
    if (this.client) {
      await this.client.auth.signOut();
    }
  }

  async deleteUserAccount(): Promise<{ success: boolean; error: string | null }> {
    const userId = await this.getUserId();
    if (!this.client || !userId) {
      return { success: false, error: 'No active authenticated session' };
    }

    try {
      // 1. Delete user rows
      await this.client.from('user_items').delete().eq('user_id', userId);
      await this.client.from('user_media').delete().eq('user_id', userId);
      await this.client.from('user_settings').delete().eq('user_id', userId);

      // 2. Call delete_user_account RPC or sign out
      try {
        await this.client.rpc('delete_user_account');
      } catch {
        // RPC might require higher grant; rows already deleted
      }

      await this.client.auth.signOut();
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to delete account' };
    }
  }

  onAuthStateChange(callback: (user: User | null) => void): () => void {
    if (!this.client) {
      callback(null);
      return () => {};
    }

    this.client.auth.getUser().then(({ data }) => {
      callback(data.user || null);
    });

    const { data: listener } = this.client.auth.onAuthStateChange((event, session) => {
      const user = session?.user || null;
      if (event === 'SIGNED_IN' && user) {
        trackEvent('signup_completed', { provider: user.app_metadata?.provider || 'email' });
      }
      callback(user);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }

  /**
   * First sign-in migration:
   * Migrates local guest items (excluding samples), settings, brand, day themes, and media images.
   * Caches (YouTube durations) and analytics log are NEVER migrated.
   */
  async migrateGuestDataToCloud(
    guestItems: ContentItem[],
    guestSettings: CurateSettings,
    guestImages: Map<string, string> = new Map()
  ): Promise<{ migratedCount: number; error?: string }> {
    const userId = await this.getUserId();
    if (!this.client || !userId) {
      return { migratedCount: 0, error: 'Not authenticated' };
    }

    try {
      // Exclude sample items
      const nonSampleItems = guestItems.filter((it) => !it.isSample);

      // Upload non-sample items
      if (nonSampleItems.length > 0) {
        await this.saveItems(nonSampleItems);
      }

      // Upload settings
      await this.saveSettings(guestSettings);

      // Upload image references
      for (const [id, data] of guestImages.entries()) {
        await this.saveMedia(id, data);
      }

      trackEvent('guest_migrated', { itemCount: nonSampleItems.length });

      return { migratedCount: nonSampleItems.length };
    } catch (err: any) {
      console.warn('[CloudStore] Guest migration failed:', err);
      return { migratedCount: 0, error: err?.message || 'Migration failed' };
    }
  }
}

export const cloudStore: CloudStore = new CloudStore();
