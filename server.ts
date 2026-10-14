import express, { type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
function getPort(): number {
  const portArgIdx = process.argv.indexOf('--port');
  if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
    return Number(process.argv[portArgIdx + 1]);
  }
  if (process.env.NODE_ENV !== 'production') {
    return 3000;
  }
  return Number(process.env.PORT) || 3000;
}
const PORT = getPort();
const isProd = process.env.NODE_ENV === 'production';

// Body parser
app.use(express.json({ limit: '2mb' }));

// Static files in public/ (e.g. /og-image.png, /logo.svg)
app.use(express.static(path.resolve(__dirname, 'public')));

// Supabase configuration
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
let supabase: SupabaseClient | null = null;
if (supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('https://')) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

// ---------------------------------------------------------------------------
// Local Persistence & Memory Store (ensures full functionality in guest mode & testing)
// ---------------------------------------------------------------------------
const DATA_DIR = path.resolve(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'shared_weeks.json');

interface SharedWeekItem {
  id: string;
  title: string;
  source: string;
  type: string;
  duration: number;
  coverReference?: string;
  day: string;
  dateStr?: string;
  url?: string;
}

interface SharedWeekRecord {
  id: string;
  userId: string;
  weekStartDate: string;
  weekEndDate: string;
  weekLabel: string;
  displayName?: string;
  totalPlannedMinutes: number;
  items: SharedWeekItem[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const COLLECTIONS_FILE = path.join(DATA_DIR, 'collections.json');

interface ServerCollectionItem {
  id: string;
  title: string;
  source: string;
  type: string;
  duration: number;
  durationIsEstimate?: boolean;
  coverReference?: string;
  url?: string;
  canonicalUrl?: string;
  youtubeId?: string;
}

interface ServerCollectionRecord {
  id: string;
  userId: string;
  title: string;
  description?: string;
  displayName?: string;
  items: ServerCollectionItem[];
  totalDurationMinutes: number;
  allowSearchEngines: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// In-memory store initialized from disk
const memoryShares = new Map<string, SharedWeekRecord>();
const memoryCollections = new Map<string, ServerCollectionRecord>();

function initDataStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      const list: SharedWeekRecord[] = JSON.parse(content);
      for (const rec of list) {
        memoryShares.set(rec.id, rec);
      }
    }
    if (fs.existsSync(COLLECTIONS_FILE)) {
      const colContent = fs.readFileSync(COLLECTIONS_FILE, 'utf-8');
      const colList: ServerCollectionRecord[] = JSON.parse(colContent);
      for (const col of colList) {
        memoryCollections.set(col.id, col);
      }
    }
  } catch (err) {
    console.error('[Server] Failed to initialize local share store:', err);
  }
}
initDataStore();

function persistLocalShares() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const arr = Array.from(memoryShares.values());
    fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Server] Failed to persist local shares to disk:', err);
  }
}

function persistLocalCollections() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const arr = Array.from(memoryCollections.values());
    fs.writeFileSync(COLLECTIONS_FILE, JSON.stringify(arr, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Server] Failed to persist local collections to disk:', err);
  }
}

async function getActiveCollectionCount(userId: string): Promise<number> {
  let count = 0;
  for (const c of memoryCollections.values()) {
    if (c.userId === userId && c.isActive) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Rate Limiting & Account Limits (Requirement 7)
// - Rate limit: max 10 creations per hour per user/IP
// - Free account active link limit: max 3 active links
// ---------------------------------------------------------------------------
const creationTimestamps = new Map<string, number[]>(); // key: userId or client IP

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const timestamps = (creationTimestamps.get(key) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= 10) {
    return false; // Exceeded 10/hour
  }
  timestamps.push(now);
  creationTimestamps.set(key, timestamps);
  return true;
}

async function getActiveLinkCount(userId: string): Promise<number> {
  // If Supabase is configured, check Supabase
  if (supabase && userId && !userId.startsWith('guest-')) {
    try {
      const { count, error } = await supabase
        .from('shared_weeks')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_active', true);
      if (!error && typeof count === 'number') {
        return count;
      }
    } catch {
      // Fallback to local
    }
  }

  // Local count
  let count = 0;
  for (const s of memoryShares.values()) {
    if (s.userId === userId && s.isActive) {
      count++;
    }
  }
  return count;
}

// Helper: Escape HTML strings
function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Helper: Format duration minutes
function formatDuration(mins: number): string {
  if (mins <= 0) return '0m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Content type badges
const CONTENT_BADGES: Record<string, { label: string; icon: string }> = {
  youtube: { label: 'YouTube', icon: '▶' },
  podcast: { label: 'Podcast', icon: '🎧' },
  article: { label: 'Article', icon: '📖' },
  book: { label: 'Book', icon: '📕' },
  course: { label: 'Course', icon: '🎓' },
  documentary: { label: 'Documentary', icon: '🎥' },
  other: { label: 'Media', icon: '✦' },
};

// Helper: Extract valid web image URL or YouTube cover
function resolveThumbnailUrl(coverReference?: string, url?: string): string | null {
  if (coverReference) {
    const trimmed = coverReference.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:image/')) {
      return trimmed;
    }
  }
  if (url) {
    const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch && ytMatch[1]) {
      return `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
    }
  }
  return null;
}

// Helper: Format day header with prominent date like "Oct 12" and weekday "Monday"
function formatDayInfo(dayName: string, items: SharedWeekItem[]): { dateLabel: string; weekday: string } {
  const itemWithDate = items.find((it) => it.dateStr && it.dateStr.trim().length > 0);
  if (itemWithDate && itemWithDate.dateStr) {
    const parts = itemWithDate.dateStr.split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      const dateObj = new Date(y, m, d);
      if (!isNaN(dateObj.getTime())) {
        const monthShort = dateObj.toLocaleDateString('en-US', { month: 'short' });
        const dayOfMonth = dateObj.getDate();
        const weekdayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
        return {
          dateLabel: `${monthShort} ${dayOfMonth}`,
          weekday: weekdayName,
        };
      }
    }
  }
  return {
    dateLabel: dayName,
    weekday: '',
  };
}

// Helper: Format headline e.g. "Oktay's week"
function formatHeadline(displayName?: string): string {
  const name = displayName && displayName.trim() ? displayName.trim() : 'Oktay';
  if (/['’]s?\s+week$/i.test(name)) {
    return name;
  }
  if (name.endsWith('s') || name.endsWith('S')) {
    return `${name}' week`;
  }
  return `${name}'s week`;
}

// Helper: Format week range dates e.g. "Oct 12 – Oct 18, 2026"
function formatWeekRange(share: { weekLabel?: string; weekStartDate?: string; weekEndDate?: string }): string {
  if (share.weekLabel && share.weekLabel.trim().length > 0) {
    return share.weekLabel.trim();
  }
  if (share.weekStartDate && share.weekEndDate) {
    try {
      const s = new Date(share.weekStartDate + 'T00:00:00');
      const e = new Date(share.weekEndDate + 'T00:00:00');
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        const sStr = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const eStr = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return `${sStr} – ${eStr}`;
      }
    } catch {}
    return `${share.weekStartDate} – ${share.weekEndDate}`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// HTML Renderer for Shared Week (Requirements 3, 5, 6, 7, 8)
// ---------------------------------------------------------------------------
function renderSharedWeekHtml(share: SharedWeekRecord, origin: string): string {
  const headline = formatHeadline(share.displayName);
  const weekDatesStr = formatWeekRange(share);
  const pageTitle = `${headline} — Curate`;
  const formattedTotal = formatDuration(share.totalPlannedMinutes);
  const pageDescription = `${formattedTotal} thoughtfully planned across ${share.items.length} ${share.items.length === 1 ? 'item' : 'items'}: articles, videos, and podcasts curated with mindful intention.`;
  const shareUrl = `${origin}/w/${share.id}`;
  const ogImageUrl = `${origin}/w/${share.id}/poster.png`;

  // Group items by day
  const daysMap = new Map<string, SharedWeekItem[]>();
  for (const item of share.items) {
    const dayKey = item.day || 'This Week';
    if (!daysMap.has(dayKey)) {
      daysMap.set(dayKey, []);
    }
    daysMap.get(dayKey)!.push(item);
  }

  let daysHtml = '';
  for (const [dayName, dayItems] of daysMap.entries()) {
    const dayMinutes = dayItems.reduce((acc, it) => acc + (it.duration || 0), 0);
    const dayTimeStr = formatDuration(dayMinutes);
    const dayInfo = formatDayInfo(dayName, dayItems);

    let itemsHtml = '';
    for (const item of dayItems) {
      const badge = CONTENT_BADGES[item.type] || CONTENT_BADGES.other;
      const isYouTube = item.type === 'youtube';
      const resolvedThumb = resolveThumbnailUrl(item.coverReference, item.url);

      const thumbHtml = resolvedThumb
        ? (item.url
            ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="item-thumb-link" aria-label="${escapeHtml(item.title)}">
                 <img src="${escapeHtml(resolvedThumb)}" alt="${escapeHtml(item.title)}" loading="lazy" />
                 ${isYouTube ? '<span class="youtube-tag">YouTube</span>' : ''}
               </a>`
            : `<div class="item-thumb">
                 <img src="${escapeHtml(resolvedThumb)}" alt="${escapeHtml(item.title)}" loading="lazy" />
                 ${isYouTube ? '<span class="youtube-tag">YouTube</span>' : ''}
               </div>`)
        : `<div class="item-thumb-fallback type-${escapeHtml(item.type)}">
             <span class="fallback-icon">${badge.icon}</span>
           </div>`;

      const titleHtml = item.url
        ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="item-title-link">
             ${escapeHtml(item.title)} <span class="ext-icon" aria-hidden="true">↗</span>
           </a>`
        : `<span class="item-title-text">${escapeHtml(item.title)}</span>`;

      itemsHtml += `
        <article class="stream-item">
          ${thumbHtml}
          <div class="item-body">
            <div class="item-tag-row">
              <span class="category-tag category-${escapeHtml(item.type)}">${escapeHtml(badge.label)}</span>
              ${item.source ? `<span class="source-tag">${escapeHtml(item.source)}</span>` : ''}
            </div>
            <h3 class="item-title-heading">
              ${titleHtml}
            </h3>
            <div class="item-meta">
              <span class="meta-duration">⏱ ${formatDuration(item.duration)}</span>
              ${item.url ? `<span class="dot">&middot;</span><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="meta-source-link">${escapeHtml(item.source || 'Original')} ↗</a>` : ''}
            </div>
          </div>
        </article>
      `;
    }

    daysHtml += `
      <section class="day-group">
        <div class="day-col-left">
          <h2 class="day-date">${escapeHtml(dayInfo.dateLabel)}</h2>
          ${dayInfo.weekday ? `<div class="day-weekday">${escapeHtml(dayInfo.weekday)}</div>` : ''}
        </div>
        <div class="day-col-items">
          ${itemsHtml}
        </div>
      </section>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(pageDescription)}" />
  
  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(pageTitle)}" />
  <meta property="og:description" content="${escapeHtml(pageDescription)}" />
  <meta property="og:image" content="${ogImageUrl}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${shareUrl}" />
  <meta property="og:site_name" content="Curate" />
  
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(pageDescription)}" />
  <meta name="twitter:image" content="${ogImageUrl}" />
  
  <link rel="icon" type="image/svg+xml" href="/logo.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">

  <style>
    :root {
      --bg: #FAF9F6;
      --card-bg: #FFFFFF;
      --text-main: #1C1917;
      --text-muted: #78716C;
      --text-subtle: #A8A29E;
      --border: #E7E5E4;
      --border-subtle: #F5F5F4;
      --accent: #292524;
      --accent-hover: #1C1917;
      --pill-bg: #F5F5F4;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0C0C0C;
        --card-bg: #171717;
        --text-main: #F5F5F4;
        --text-muted: #A8A29E;
        --text-subtle: #78716C;
        --border: #262626;
        --border-subtle: #1F1F1F;
        --accent: #FAFAFA;
        --accent-hover: #E5E5E5;
        --pill-bg: #262626;
      }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      padding: 0 1rem 3rem;
    }

    .container {
      max-width: 720px;
      margin: 0 auto;
    }

    /* Top brand & nav */
    .header-nav {
      padding: 1.5rem 0 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
    }
    .brand-wrap {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      text-decoration: none;
      color: var(--text-main);
    }
    .brand-logo {
      width: 28px;
      height: 28px;
    }
    .brand-name {
      font-weight: 700;
      font-size: 1.15rem;
      letter-spacing: -0.02em;
    }
    .top-cta,
    .top-cta-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 1.05rem;
      border-radius: 9999px;
      background: var(--text-main);
      color: var(--bg);
      font-size: 0.84rem;
      font-weight: 600;
      text-decoration: none;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
      transition: all 0.18s ease;
    }
    .top-cta:hover,
    .top-cta-btn:hover {
      opacity: 0.9;
      transform: translateY(-1px);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.14);
    }
    .top-cta:active,
    .top-cta-btn:active {
      transform: translateY(0);
    }

    /* Hero / week header */
    .week-hero {
      padding: 2.25rem 0 1.5rem;
    }
    .hero-header-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1.5rem;
      flex-wrap: wrap;
    }
    .hero-title-area {
      flex: 1;
      min-width: 260px;
    }
    .week-title {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 2.5rem;
      font-weight: 400;
      line-height: 1.15;
      letter-spacing: -0.02em;
      color: var(--text-main);
      margin: 0 0 0.35rem 0;
    }
    .week-dates {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 1.25rem;
      font-weight: 400;
      font-style: italic;
      color: var(--text-muted);
      letter-spacing: -0.01em;
      margin: 0 0 0.75rem 0;
      line-height: 1.3;
    }
    .hero-action-col {
      display: flex;
      align-items: center;
      margin-top: 0.25rem;
      shrink-0: 0;
    }
    .hero-cta-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.55rem 1.15rem;
      border-radius: 9999px;
      background: var(--text-main);
      color: var(--bg);
      font-size: 0.86rem;
      font-weight: 600;
      text-decoration: none;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      transition: all 0.18s ease;
      white-space: nowrap;
    }
    .hero-cta-btn:hover {
      opacity: 0.92;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.14);
    }
    .hero-cta-btn:active {
      transform: translateY(0);
    }
    .hero-metrics-text {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.25rem;
      font-size: 0.82rem;
      color: var(--text-muted);
    }
    .metric-icon-wrap {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .mini-icon {
      width: 14px;
      height: 14px;
      display: inline-block;
      vertical-align: middle;
      opacity: 0.75;
    }
    .hero-metrics-text strong {
      color: var(--text-main);
      font-weight: 600;
    }
    .hero-metrics-text .sep {
      color: var(--border);
    }

    /* Day stream - Left day column + Right content list, simple text layout */
    .day-stream {
      margin-top: 1rem;
      display: flex;
      flex-direction: column;
    }
    .day-group {
      border-top: 1px solid var(--border);
      padding: 1.75rem 0;
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 1.75rem;
      align-items: flex-start;
    }
    @media (max-width: 620px) {
      .day-group {
        grid-template-columns: 1fr;
        gap: 0.85rem;
        padding: 1.35rem 0;
      }
    }
    .day-col-left {
      position: sticky;
      top: 1rem;
    }
    .day-date {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 1.45rem;
      font-weight: 500;
      line-height: 1.15;
      color: var(--text-main);
    }
    .day-weekday {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin-top: 0.2rem;
    }
    .day-col-items {
      display: flex;
      flex-direction: column;
      gap: 1.35rem;
    }

    /* Stream items - Clean text, serif titles, clickable links, thumbnail cards */
    .stream-item {
      display: flex;
      gap: 1.1rem;
      align-items: flex-start;
    }
    .item-thumb-link,
    .item-thumb {
      width: 120px;
      height: 75px;
      flex-shrink: 0;
      border-radius: 8px;
      overflow: hidden;
      position: relative;
      background: var(--pill-bg);
      border: 1px solid var(--border);
      display: block;
      text-decoration: none;
    }
    .item-thumb-link img,
    .item-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .item-thumb-link:hover img {
      opacity: 0.88;
    }
    .item-thumb-fallback {
      width: 120px;
      height: 75px;
      flex-shrink: 0;
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--pill-bg);
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 1.25rem;
    }
    .youtube-tag {
      position: absolute;
      bottom: 4px;
      right: 4px;
      background: rgba(0, 0, 0, 0.75);
      color: #FFF;
      font-size: 9px;
      font-weight: 600;
      padding: 1px 4px;
      border-radius: 3px;
    }
    .item-body {
      flex: 1;
      min-width: 0;
    }
    .item-tag-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.35rem;
    }
    .category-tag {
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      background: var(--pill-bg);
      color: var(--text-muted);
      border: 1px solid var(--border);
    }
    .source-tag {
      font-size: 0.78rem;
      color: var(--text-muted);
      font-weight: 500;
    }
    .item-title-heading {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 1.22rem;
      font-weight: 500;
      line-height: 1.35;
      margin-bottom: 0.4rem;
    }
    .item-title-link {
      color: var(--text-main);
      text-decoration: none;
      transition: color 0.15s;
      cursor: pointer;
    }
    .item-title-link:hover {
      text-decoration: underline;
      text-underline-offset: 3px;
      color: var(--accent-hover);
    }
    .item-title-text {
      color: var(--text-main);
    }
    .ext-icon {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-left: 0.2rem;
      display: inline-block;
      text-decoration: none !important;
    }
    .item-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.78rem;
      color: var(--text-muted);
    }
    .meta-duration {
      font-weight: 500;
    }
    .meta-source-link {
      color: var(--text-muted);
      text-decoration: none;
    }
    .meta-source-link:hover {
      text-decoration: underline;
      color: var(--text-main);
    }
    .dot {
      color: var(--border);
    }

    /* Footer */
    .page-footer {
      margin-top: 4rem;
      padding-top: 2.75rem;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 1.5rem;
    }
    .footer-cta-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.15rem;
      max-width: 520px;
    }
    .footer-heading {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 1.75rem;
      font-weight: 400;
      line-height: 1.3;
      letter-spacing: -0.015em;
      color: var(--text-main);
    }
    .footer-cta-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      padding: 0.65rem 1.45rem;
      border-radius: 9999px;
      background: var(--text-main);
      color: var(--bg);
      font-size: 0.92rem;
      font-weight: 600;
      text-decoration: none;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      transition: all 0.18s ease;
      cursor: pointer;
    }
    .footer-cta-btn:hover {
      opacity: 0.9;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .footer-cta-btn:active {
      transform: translateY(0);
    }
    .footer-meta-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }
    .report-link {
      color: var(--text-muted);
      text-decoration: underline;
      text-underline-offset: 4px;
      transition: color 0.15s;
    }
    .report-link:hover {
      color: var(--text-main);
    }
    .status-note {
      color: var(--text-muted);
    }
    .sep {
      color: var(--border);
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Navigation -->
    <header class="header-nav">
      <a href="/?ref=share" class="brand-wrap">
        <svg class="brand-logo" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g fill="currentColor">
            <path d="M 22 18 C 22 13.5 25 10 30 10 L 70 10 C 75 10 78 13.5 78 18 L 78 20 C 74 15 65 11 54 11 C 41 11 31 19 25 32 C 23 37 22 42 22 45 Z" />
            <path d="M 51 11.5 C 62.5 11.5 68.5 22 66.5 35 C 64.5 48 53.5 57 42 57 C 32.5 57 28.5 47 30.5 34 C 32.5 21 40 11.5 51 11.5 Z" />
            <path d="M 78 17 L 63.5 39.5 L 76 32.5 L 78 32.5 Z" />
            <path d="M 22 59 C 28 62 42 63.5 56 62.5 C 67 61.5 74 58 78 57 L 78 86 C 78 88.5 75.5 90 73.5 88.5 L 50 69.5 L 26.5 88.5 C 24.5 90 22 88.5 22 86 Z" />
          </g>
        </svg>
        <span class="brand-name">Curate</span>
      </a>
    </header>

    <!-- Hero -->
    <main>
      <div class="week-hero">
        <div class="hero-header-row">
          <div class="hero-title-area">
            <h1 class="week-title">${escapeHtml(headline)}</h1>
            ${weekDatesStr ? `<div class="week-dates">${escapeHtml(weekDatesStr)}</div>` : ''}
            <div class="hero-metrics-text">
              <span class="metric-icon-wrap">
                <svg class="mini-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <strong>${formattedTotal}</strong> planned
              </span>
              <span class="sep">&middot;</span>
              <span class="metric-icon-wrap">
                <svg class="mini-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10M6 10h10"/></svg>
                <strong>${share.items.length}</strong> ${share.items.length === 1 ? 'item' : 'items'}
              </span>
            </div>
          </div>
          <div class="hero-action-col">
            <a href="/?ref=share" class="hero-cta-btn">Plan your own week &rarr;</a>
          </div>
        </div>
      </div>

      <!-- Days -->
      <div class="day-stream">
        ${daysHtml}
      </div>
    </main>

    <!-- Footer -->
    <footer class="page-footer">
      <div class="footer-cta-container">
        <h2 class="footer-heading">Plan your own week. Curate your curiosity</h2>
        <a href="/?ref=share" id="plan-cta" class="footer-cta-btn">Open Curate &rarr;</a>
      </div>
      <div class="footer-meta-row">
        <a href="mailto:support@curate.app?subject=Report%20Shared%20Week%20${share.id}" class="report-link">Report this page</a>
        <span class="sep">&middot;</span>
        <span class="status-note">Snapshot &middot; Read-only</span>
      </div>
    </footer>
  </div>

  <script>
    // Requirement 9: share_cta_clicked event tracking
    document.getElementById('plan-cta')?.addEventListener('click', function() {
      try {
        navigator.sendBeacon('/api/analytics/event', JSON.stringify({
          name: 'share_cta_clicked',
          properties: { ref: 'share_footer' }
        }));
      } catch (e) {}
    });
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTML Renderer for HTTP 410 (Requirement 6)
// ---------------------------------------------------------------------------
function renderGoneHtml(subject: 'week' | 'collection' = 'week'): string {
  const isCol = subject === 'collection';
  const heading = isCol ? 'This collection is no longer shared' : 'This week is no longer shared';
  const desc = isCol
    ? 'The creator of this collection has deactivated or removed this board.'
    : 'The owner of this weekly plan has deactivated or removed this share link.';
  const linkRef = isCol ? '/?ref=collection' : '/?ref=share';
  const ctaText = isCol ? 'Curate your curiosity on Curate &rarr;' : 'Plan your own week on Curate &rarr;';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(heading)} — Curate</title>
  <link rel="icon" type="image/svg+xml" href="/logo.svg" />
  <style>
    body {
      background-color: #FAF9F6;
      color: #1C1917;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1.5rem;
      text-align: center;
    }
    @media (prefers-color-scheme: dark) {
      body { background-color: #0C0C0C; color: #F5F5F4; }
    }
    .box { max-width: 480px; }
    h1 { font-family: Georgia, serif; font-size: 2rem; margin-bottom: 0.75rem; font-weight: normal; }
    p { color: #78716C; margin-bottom: 2rem; font-size: 1rem; line-height: 1.5; }
    a {
      display: inline-block;
      color: #1C1917;
      text-decoration: underline;
      text-underline-offset: 4px;
      font-weight: 500;
      font-size: 0.95rem;
      transition: opacity 0.15s;
    }
    a:hover { opacity: 0.7; }
    @media (prefers-color-scheme: dark) {
      a { color: #F5F5F4; }
    }
  </style>
</head>
<body>
  <div class="box">
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(desc)}</p>
    <a href="${linkRef}">${ctaText}</a>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTML Renderer for Shared Collection (Pinterest-style responsive masonry card grid)
// ---------------------------------------------------------------------------
function renderSharedCollectionHtml(collection: ServerCollectionRecord, origin: string): string {
  const pageTitle = `${collection.title} — Curate Collection`;
  const formattedTotal = formatDuration(collection.totalDurationMinutes);
  const defaultDesc = `A curated board of ${collection.items.length} ${collection.items.length === 1 ? 'item' : 'items'} (${formattedTotal} total duration) on Curate.`;
  const pageDescription = collection.description && collection.description.trim() ? collection.description.trim() : defaultDesc;
  const collectionUrl = `${origin}/c/${collection.id}`;
  const ogImageUrl = `${origin}/c/${collection.id}/poster.png`;
  const robotsMeta = collection.allowSearchEngines
    ? '<meta name="robots" content="index, follow" />'
    : '<meta name="robots" content="noindex, nofollow" />';

  let cardsHtml = '';
  for (const item of collection.items) {
    const badge = CONTENT_BADGES[item.type] || CONTENT_BADGES.other;
    const isYouTube = item.type === 'youtube';
    const resolvedThumb = resolveThumbnailUrl(item.coverReference, item.url);
    const durationStr = item.durationIsEstimate ? `~${formatDuration(item.duration)}` : formatDuration(item.duration);

    const mediaHtml = resolvedThumb
      ? (item.url
          ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="card-media" aria-label="${escapeHtml(item.title)}">
               <img src="${escapeHtml(resolvedThumb)}" alt="${escapeHtml(item.title)}" loading="lazy" />
               ${isYouTube ? '<span class="youtube-tag">YouTube</span>' : ''}
             </a>`
          : `<div class="card-media">
               <img src="${escapeHtml(resolvedThumb)}" alt="${escapeHtml(item.title)}" loading="lazy" />
               ${isYouTube ? '<span class="youtube-tag">YouTube</span>' : ''}
             </div>`)
      : `<div class="card-media-fallback type-${escapeHtml(item.type)}">
           <span class="fallback-icon">${badge.icon}</span>
         </div>`;

    const titleHtml = item.url
      ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="card-title-link">
           ${escapeHtml(item.title)} <span class="ext-icon" aria-hidden="true">↗</span>
         </a>`
      : `<span>${escapeHtml(item.title)}</span>`;

    cardsHtml += `
      <article class="board-card">
        ${mediaHtml}
        <div class="card-body">
          <div class="card-tags">
            <span class="category-tag category-${escapeHtml(item.type)}">${escapeHtml(badge.label)}</span>
            ${item.source ? `<span class="source-tag">${escapeHtml(item.source)}</span>` : ''}
          </div>
          <h3 class="card-title">${titleHtml}</h3>
          <div class="card-meta">
            <span class="meta-duration">⏱ ${escapeHtml(durationStr)}</span>
            <a href="/?import_collection=${collection.id}&ref=collection" class="card-save-link" title="Save to Inbox via Curate">
              Save &rarr;
            </a>
          </div>
        </div>
      </article>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${robotsMeta}
  
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(pageDescription)}" />
  
  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(pageTitle)}" />
  <meta property="og:description" content="${escapeHtml(pageDescription)}" />
  <meta property="og:image" content="${ogImageUrl}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${collectionUrl}" />
  <meta property="og:site_name" content="Curate" />
  
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(pageDescription)}" />
  <meta name="twitter:image" content="${ogImageUrl}" />
  
  <link rel="icon" type="image/svg+xml" href="/logo.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">

  <style>
    :root {
      --bg: #FAF9F6;
      --card-bg: #FFFFFF;
      --text-main: #1C1917;
      --text-muted: #78716C;
      --text-subtle: #A8A29E;
      --border: #E7E5E4;
      --border-subtle: #F5F5F4;
      --accent: #292524;
      --pill-bg: #F5F5F4;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0C0C0C;
        --card-bg: #171717;
        --text-main: #F5F5F4;
        --text-muted: #A8A29E;
        --text-subtle: #78716C;
        --border: #262626;
        --border-subtle: #1F1F1F;
        --accent: #FAFAFA;
        --pill-bg: #262626;
      }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      padding: 0 1.25rem 3.5rem;
    }

    .container {
      max-width: 1160px;
      margin: 0 auto;
    }

    /* Top navigation */
    .header-nav {
      padding: 1.5rem 0 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
    }
    .brand-wrap {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      text-decoration: none;
      color: var(--text-main);
    }
    .brand-logo { width: 28px; height: 28px; }
    .brand-name {
      font-weight: 700;
      font-size: 1.15rem;
      letter-spacing: -0.02em;
    }
    .top-cta-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 1.15rem;
      border-radius: 9999px;
      background: var(--text-main);
      color: var(--bg);
      font-size: 0.84rem;
      font-weight: 600;
      text-decoration: none;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
      transition: all 0.18s ease;
    }
    .top-cta-btn:hover {
      opacity: 0.9;
      transform: translateY(-1px);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.14);
    }

    /* Hero section */
    .collection-hero {
      padding: 2.75rem 0 2rem;
      max-width: 780px;
    }
    .hero-meta-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
    }
    .collection-title {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 2.85rem;
      font-weight: 400;
      line-height: 1.15;
      letter-spacing: -0.02em;
      color: var(--text-main);
      margin-bottom: 0.85rem;
    }
    @media (max-width: 640px) {
      .collection-title { font-size: 2.15rem; }
    }
    .collection-desc {
      font-size: 1.05rem;
      color: var(--text-muted);
      line-height: 1.6;
      margin-bottom: 1.5rem;
    }
    .hero-stats-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1.25rem;
      font-size: 0.88rem;
      color: var(--text-muted);
    }
    .stats-item strong {
      color: var(--text-main);
      font-weight: 600;
    }
    .sep { color: var(--border); }

    .save-all-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.65rem 1.45rem;
      border-radius: 9999px;
      background: var(--text-main);
      color: var(--bg);
      font-size: 0.92rem;
      font-weight: 600;
      text-decoration: none;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
      transition: all 0.18s ease;
      cursor: pointer;
    }
    .save-all-btn:hover {
      opacity: 0.92;
      transform: translateY(-1px);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
    }

    /* Pinterest-Style Responsive Masonry Card Grid */
    .masonry-grid {
      column-count: 3;
      column-gap: 1.5rem;
      margin-top: 2rem;
    }
    @media (max-width: 960px) {
      .masonry-grid { column-count: 2; column-gap: 1.25rem; }
    }
    @media (max-width: 580px) {
      .masonry-grid { column-count: 1; }
    }

    .board-card {
      break-inside: avoid;
      margin-bottom: 1.5rem;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .board-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
    }
    .card-media {
      position: relative;
      width: 100%;
      background: var(--pill-bg);
      overflow: hidden;
      display: block;
      text-decoration: none;
    }
    .card-media img {
      width: 100%;
      height: auto;
      display: block;
      object-fit: cover;
      max-height: 260px;
      transition: opacity 0.2s ease;
    }
    .card-media:hover img {
      opacity: 0.92;
    }
    .youtube-tag {
      position: absolute;
      bottom: 6px;
      right: 6px;
      background: rgba(0, 0, 0, 0.75);
      color: #FFF;
      font-size: 9px;
      font-weight: 600;
      padding: 1px 5px;
      border-radius: 3px;
    }
    .card-media-fallback {
      height: 110px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--pill-bg);
      font-size: 1.75rem;
      color: var(--text-muted);
    }
    .card-body {
      padding: 1.15rem;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .card-tags {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      flex-wrap: wrap;
    }
    .category-tag {
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      background: var(--pill-bg);
      color: var(--text-muted);
      border: 1px solid var(--border);
    }
    .source-tag {
      font-size: 0.78rem;
      color: var(--text-muted);
      font-weight: 500;
    }
    .card-title {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 1.18rem;
      font-weight: 500;
      line-height: 1.35;
      color: var(--text-main);
    }
    .card-title-link {
      color: inherit;
      text-decoration: none;
      transition: color 0.15s;
    }
    .card-title-link:hover {
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .ext-icon {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-left: 0.15rem;
    }
    .card-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 0.4rem;
      padding-top: 0.6rem;
      border-top: 1px solid var(--border-subtle);
    }
    .meta-duration { font-weight: 500; }
    .card-save-link {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-main);
      background: var(--pill-bg);
      border: 1px solid var(--border);
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      text-decoration: none;
      transition: all 0.15s;
    }
    .card-save-link:hover {
      background: var(--text-main);
      color: var(--bg);
    }

    /* Footer */
    .page-footer {
      margin-top: 4.5rem;
      padding-top: 2.75rem;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 1.5rem;
    }
    .footer-cta-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.15rem;
      max-width: 520px;
    }
    .footer-heading {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 1.75rem;
      font-weight: 400;
      line-height: 1.3;
      letter-spacing: -0.015em;
      color: var(--text-main);
    }
    .footer-cta-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      padding: 0.65rem 1.45rem;
      border-radius: 9999px;
      background: var(--text-main);
      color: var(--bg);
      font-size: 0.92rem;
      font-weight: 600;
      text-decoration: none;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      transition: all 0.18s ease;
      cursor: pointer;
    }
    .footer-cta-btn:hover {
      opacity: 0.9;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .footer-meta-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }
    .report-link {
      color: var(--text-muted);
      text-decoration: underline;
      text-underline-offset: 4px;
      transition: color 0.15s;
    }
    .report-link:hover { color: var(--text-main); }
    .status-note { color: var(--text-muted); }
  </style>
</head>
<body>
  <div class="container">
    <!-- Top Navigation -->
    <header class="header-nav">
      <a href="/?ref=collection" class="brand-wrap">
        <svg class="brand-logo" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g fill="currentColor">
            <path d="M 22 18 C 22 13.5 25 10 30 10 L 70 10 C 75 10 78 13.5 78 18 L 78 20 C 74 15 65 11 54 11 C 41 11 31 19 25 32 C 23 37 22 42 22 45 Z" />
            <path d="M 51 11.5 C 62.5 11.5 68.5 22 66.5 35 C 64.5 48 53.5 57 42 57 C 32.5 57 28.5 47 30.5 34 C 32.5 21 40 11.5 51 11.5 Z" />
            <path d="M 78 17 L 63.5 39.5 L 76 32.5 L 78 32.5 Z" />
            <path d="M 22 59 C 28 62 42 63.5 56 62.5 C 67 61.5 74 58 78 57 L 78 86 C 78 88.5 75.5 90 73.5 88.5 L 50 69.5 L 26.5 88.5 C 24.5 90 22 88.5 22 86 Z" />
          </g>
        </svg>
        <span class="brand-name">Curate</span>
      </a>
      <a href="/?import_collection=${collection.id}&ref=collection" class="top-cta-btn">
        Save to my Curate &rarr;
      </a>
    </header>

    <!-- Hero -->
    <main>
      <div class="collection-hero">
        <div class="hero-meta-badge">
          <span>Curated Collection</span>
          ${collection.displayName ? `<span>&middot; by ${escapeHtml(collection.displayName)}</span>` : ''}
        </div>
        <h1 class="collection-title">${escapeHtml(collection.title)}</h1>
        ${collection.description ? `<p class="collection-desc">${escapeHtml(collection.description)}</p>` : ''}
        <div class="hero-stats-row">
          <div class="stats-item">
            <strong>${formattedTotal}</strong> total duration
          </div>
          <span class="sep">&middot;</span>
          <div class="stats-item">
            <strong>${collection.items.length}</strong> ${collection.items.length === 1 ? 'item' : 'items'}
          </div>
          <a href="/?import_collection=${collection.id}&ref=collection" id="hero-save-btn" class="save-all-btn">
            Save to my Curate &rarr;
          </a>
        </div>
      </div>

      <!-- Pinterest-style Responsive Masonry Grid -->
      <div class="masonry-grid">
        ${cardsHtml}
      </div>
    </main>

    <!-- Footer -->
    <footer class="page-footer">
      <div class="footer-cta-container">
        <h2 class="footer-heading">Plan your own week. Curate your curiosity</h2>
        <a href="/?ref=collection" id="plan-cta" class="footer-cta-btn">Open Curate &rarr;</a>
      </div>
      <div class="footer-meta-row">
        <a href="mailto:takedown@curate.app?subject=Report%20Collection%20${collection.id}" class="report-link">Report this page</a>
        <span class="sep">&middot;</span>
        <span class="status-note">Snapshot &middot; Read-only</span>
      </div>
    </footer>
  </div>

  <script>
    // Event: collection_viewed
    try {
      navigator.sendBeacon('/api/analytics/event', JSON.stringify({
        name: 'collection_viewed',
        properties: { id: '${collection.id}', itemCount: ${collection.items.length}, ref: 'collection' }
      }));
    } catch (e) {}

    // Event: collection_cta_clicked
    document.querySelectorAll('.save-all-btn, .top-cta-btn, .card-save-link, #plan-cta').forEach(function(el) {
      el.addEventListener('click', function() {
        try {
          navigator.sendBeacon('/api/analytics/event', JSON.stringify({
            name: 'collection_cta_clicked',
            properties: { id: '${collection.id}', ref: 'collection' }
          }));
        } catch (e) {}
      });
    });
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Dynamic Poster / OpenGraph Image Route (Requirement 4)
// Generates per-week Curate poster style SVG/PNG without 3rd-party thumbnails
// ---------------------------------------------------------------------------
app.get('/w/:id/poster.png', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const share = memoryShares.get(id);

  // If static og-image exists and share not found, serve static
  const staticPath = path.resolve(__dirname, 'public/og-image.png');
  if (!share && fs.existsSync(staticPath)) {
    return res.sendFile(staticPath);
  }

  // Generate dynamic SVG poster for this week
  const headline = formatHeadline(share?.displayName);
  const total = share ? formatDuration(share.totalPlannedMinutes) : 'Time-budgeted';
  const itemCount = share ? `${share.items.length} items` : 'Mindful media';

  const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="630" fill="#141413"/>
    <rect x="36" y="36" width="1128" height="558" rx="20" fill="none" stroke="#2E2C29" stroke-width="2"/>
    
    <!-- Wordmark -->
    <text x="90" y="115" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="700" fill="#FBF9F5" letter-spacing="-0.5">Curate</text>
    <text x="90" y="150" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#A8A29E" letter-spacing="2">CURATE YOUR CURIOSITY</text>
    
    <!-- Week Title -->
    <text x="90" y="270" font-family="serif, Georgia" font-size="62" font-style="italic" fill="#FBF9F5">${escapeHtml(headline)}</text>
    
    <!-- Metrics -->
    <rect x="90" y="420" width="180" height="46" rx="23" fill="#292724" stroke="#3D3A35" stroke-width="1"/>
    <text x="180" y="450" text-anchor="middle" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="#FBF9F5">${escapeHtml(total)}</text>
    
    <rect x="290" y="420" width="160" height="46" rx="23" fill="#292724" stroke="#3D3A35" stroke-width="1"/>
    <text x="370" y="450" text-anchor="middle" font-family="system-ui, sans-serif" font-size="16" font-weight="500" fill="#A8A29E">${escapeHtml(itemCount)}</text>
    
    <text x="1100" y="550" text-anchor="end" font-family="system-ui, sans-serif" font-size="18" fill="#78716C">curate.app</text>
  </svg>`;

  // Try to render with ImageMagick convert, else fallback to static og-image.png
  try {
    const tmpSvg = path.join('/tmp', `poster_${id}.svg`);
    const tmpPng = path.join('/tmp', `poster_${id}.png`);
    fs.writeFileSync(tmpSvg, svg, 'utf-8');
    
    const { execSync } = await import('child_process');
    execSync(`convert -size 1200x630 xc:"#141413" -stroke "#2E2C29" -strokewidth 2 -fill none -draw "roundrectangle 30,30 1170,600 24,24" -stroke none -fill "#FBF9F5" -pointsize 34 -font "Liberation-Sans-Bold" -gravity NorthWest -annotate +90+80 "Curate" -fill "#A8A29E" -pointsize 14 -font "Liberation-Sans" -gravity NorthWest -annotate +90+128 "CURATE YOUR CURIOSITY" -fill "#FBF9F5" -pointsize 54 -font "Liberation-Serif-Italic" -gravity NorthWest -annotate +90+240 "${escapeHtml(headline)}" -fill "#292724" -draw "roundrectangle 90,370 280,416 16,16" -fill "#E7E5E4" -pointsize 15 -font "Liberation-Sans-Bold" -gravity NorthWest -annotate +115+385 "${escapeHtml(total)}" -fill "#78716C" -pointsize 18 -font "Liberation-Sans" -gravity SouthEast -annotate +90+80 "curate.app" "${tmpPng}"`);

    if (fs.existsSync(tmpPng)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.sendFile(tmpPng);
    }
  } catch (err) {
    // If convert fails, stream static og-image.png
  }

  if (fs.existsSync(staticPath)) {
    return res.sendFile(staticPath);
  }
  return res.status(404).send('Not found');
});

// ---------------------------------------------------------------------------
// Public Server-Rendered HTML Route (Requirement 3, 5, 6, 7, 8, 9)
// ---------------------------------------------------------------------------
app.get('/w/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);

  // 1. Fetch from memory or Supabase
  let share = memoryShares.get(id);

  if (!share && supabase) {
    try {
      const { data, error } = await supabase
        .from('shared_weeks')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!error && data) {
        share = {
          id: data.id,
          userId: data.user_id,
          weekStartDate: data.week_start_date,
          weekEndDate: data.week_end_date,
          weekLabel: data.week_label,
          displayName: data.display_name,
          totalPlannedMinutes: data.total_planned_minutes,
          items: data.items || [],
          isActive: data.is_active,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
        memoryShares.set(id, share);
      }
    } catch (err) {
      console.warn('[Server] Failed to fetch share from Supabase:', err);
    }
  }

  // Requirement 7: noindex in X-Robots-Tag header
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  // If share not found at all
  if (!share) {
    res.status(404);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"><title>Shared Week Not Found — Curate</title>
  <meta name="robots" content="noindex, nofollow" />
  <link rel="icon" type="image/svg+xml" href="/logo.svg" />
  <style>body { font-family: system-ui, sans-serif; background: #FAF9F6; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }</style>
</head>
<body>
  <div style="text-align: center;">
    <h2>Shared week not found</h2>
    <p style="color: #78716C; margin: 1rem 0 2rem;">The link may be invalid or expired.</p>
    <a href="/?ref=share" style="background:#1C1917; color:#FFF; padding: 0.6rem 1.2rem; border-radius: 9999px; text-decoration:none;">Go to Curate</a>
  </div>
</body>
</html>`);
  }

  // Requirement 6: Turned-off or deleted link shows 'This week is no longer shared' with HTTP 410
  if (!share.isActive) {
    res.status(410);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderGoneHtml());
  }

  // Origin resolution
  const host = req.get('host') || `localhost:${PORT}`;
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const origin = `${protocol}://${host}`;

  // Requirement 3 & 9: Server rendered HTML + log share_viewed event (no personal data)
  console.log(`[Analytics] share_viewed id=${share.id} itemCount=${share.items.length}`);

  const html = renderSharedWeekHtml(share, origin);
  res.status(200);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

// ---------------------------------------------------------------------------
// Dynamic Poster / OpenGraph Image Route for Collections
// ---------------------------------------------------------------------------
app.get('/c/:id/poster.png', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const col = memoryCollections.get(id);

  const staticPath = path.resolve(__dirname, 'public/og-image.png');
  if (!col && fs.existsSync(staticPath)) {
    return res.sendFile(staticPath);
  }

  const title = col?.title || 'Curate Collection';
  const total = col ? formatDuration(col.totalDurationMinutes) : 'Curated';
  const itemCount = col ? `${col.items.length} items` : 'Public Collection';

  const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="630" fill="#141413"/>
    <rect x="36" y="36" width="1128" height="558" rx="20" fill="none" stroke="#2E2C29" stroke-width="2"/>
    <text x="90" y="115" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="700" fill="#FBF9F5" letter-spacing="-0.5">Curate</text>
    <text x="90" y="150" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#A8A29E" letter-spacing="2">CURATE YOUR CURIOSITY</text>
    <text x="90" y="270" font-family="serif, Georgia" font-size="52" font-style="italic" fill="#FBF9F5">${escapeHtml(title)}</text>
    <rect x="90" y="420" width="180" height="46" rx="23" fill="#292724" stroke="#3D3A35" stroke-width="1"/>
    <text x="180" y="450" text-anchor="middle" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="#FBF9F5">${escapeHtml(total)}</text>
    <rect x="290" y="420" width="160" height="46" rx="23" fill="#292724" stroke="#3D3A35" stroke-width="1"/>
    <text x="370" y="450" text-anchor="middle" font-family="system-ui, sans-serif" font-size="16" font-weight="500" fill="#A8A29E">${escapeHtml(itemCount)}</text>
    <text x="1100" y="550" text-anchor="end" font-family="system-ui, sans-serif" font-size="18" fill="#78716C">curate.app</text>
  </svg>`;

  try {
    const tmpSvg = path.join('/tmp', `col_poster_${id}.svg`);
    const tmpPng = path.join('/tmp', `col_poster_${id}.png`);
    fs.writeFileSync(tmpSvg, svg, 'utf-8');

    const { execSync } = await import('child_process');
    execSync(`convert -size 1200x630 xc:"#141413" -stroke "#2E2C29" -strokewidth 2 -fill none -draw "roundrectangle 30,30 1170,600 24,24" -stroke none -fill "#FBF9F5" -pointsize 34 -font "Liberation-Sans-Bold" -gravity NorthWest -annotate +90+80 "Curate" -fill "#A8A29E" -pointsize 14 -font "Liberation-Sans" -gravity NorthWest -annotate +90+128 "CURATE YOUR CURIOSITY" -fill "#FBF9F5" -pointsize 46 -font "Liberation-Serif-Italic" -gravity NorthWest -annotate +90+240 "${escapeHtml(title)}" -fill "#292724" -draw "roundrectangle 90,370 280,416 16,16" -fill "#E7E5E4" -pointsize 15 -font "Liberation-Sans-Bold" -gravity NorthWest -annotate +115+385 "${escapeHtml(total)}" -fill "#78716C" -pointsize 18 -font "Liberation-Sans" -gravity SouthEast -annotate +90+80 "curate.app" "${tmpPng}"`);

    if (fs.existsSync(tmpPng)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.sendFile(tmpPng);
    }
  } catch {}

  if (fs.existsSync(staticPath)) {
    return res.sendFile(staticPath);
  }
  return res.status(404).send('Not found');
});

// ---------------------------------------------------------------------------
// Public Server-Rendered HTML Route for Collections
// ---------------------------------------------------------------------------
app.get('/c/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const col = memoryCollections.get(id);

  if (!col) {
    res.status(404);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"><title>Collection Not Found — Curate</title>
  <meta name="robots" content="noindex, nofollow" />
  <link rel="icon" type="image/svg+xml" href="/logo.svg" />
  <style>body { font-family: system-ui, sans-serif; background: #FAF9F6; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }</style>
</head>
<body>
  <div style="text-align: center;">
    <h2>Collection not found</h2>
    <p style="color: #78716C; margin: 1rem 0 2rem;">The link may be invalid or expired.</p>
    <a href="/?ref=collection" style="background:#1C1917; color:#FFF; padding: 0.6rem 1.2rem; border-radius: 9999px; text-decoration:none;">Go to Curate</a>
  </div>
</body>
</html>`);
  }

  // Requirement 8: 410 after deletion or deactivation
  if (!col.isActive) {
    res.status(410);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderGoneHtml('collection'));
  }

  // Requirement 3: Default noindex; allow search engines toggle
  if (!col.allowSearchEngines) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }

  const host = req.get('host') || `localhost:${PORT}`;
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const origin = `${protocol}://${host}`;

  console.log(`[Analytics] collection_viewed id=${col.id} itemCount=${col.items.length}`);

  const html = renderSharedCollectionHtml(col, origin);
  res.status(200);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

// ---------------------------------------------------------------------------
// API Routes: Creation, Updating, Deleting & Rate Limiting
// ---------------------------------------------------------------------------

// POST /api/share - Create a new share link
app.post('/api/share', async (req: Request, res: Response) => {
  const clientKey = req.body.userId || req.ip || 'anonymous';

  // Requirement 7: Rate-limit link creation to 10 per hour per user
  if (!checkRateLimit(clientKey)) {
    return res.status(429).json({
      error: 'Rate limit exceeded: You may create at most 10 share links per hour.',
    });
  }

  // Requirement 7: Free accounts may keep 3 active links
  const activeCount = await getActiveLinkCount(clientKey);
  if (activeCount >= 3) {
    return res.status(400).json({
      error: 'Free accounts may keep up to 3 active links. Please deactivate or delete an existing link before creating a new one.',
    });
  }

  const {
    id,
    userId = clientKey,
    weekStartDate,
    weekEndDate,
    weekLabel,
    displayName,
    totalPlannedMinutes,
    items = [],
  } = req.body;

  if (!id || !weekStartDate || !weekEndDate) {
    return res.status(400).json({ error: 'Missing required share fields.' });
  }

  // Strict Sanitization: Ensure items contain ONLY allowed fields (Requirement 2)
  const sanitizedItems: SharedWeekItem[] = items.map((it: any) => ({
    id: String(it.id || ''),
    title: String(it.title || 'Untitled Item').trim(),
    source: String(it.source || 'Curate'),
    type: String(it.type || 'other'),
    duration: Math.max(0, Number(it.duration) || 0),
    coverReference: it.coverReference ? String(it.coverReference).trim() : undefined,
    day: String(it.day || 'Monday'),
    dateStr: it.dateStr ? String(it.dateStr) : undefined,
    url: it.url ? String(it.url).trim() : undefined,
  }));

  const now = new Date().toISOString();
  const record: SharedWeekRecord = {
    id: String(id),
    userId: String(userId),
    weekStartDate: String(weekStartDate),
    weekEndDate: String(weekEndDate),
    weekLabel: String(weekLabel),
    displayName: displayName ? String(displayName).slice(0, 40).trim() : undefined,
    totalPlannedMinutes: Number(totalPlannedMinutes) || 0,
    items: sanitizedItems,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  // 1. Save to memory and disk
  memoryShares.set(record.id, record);
  persistLocalShares();

  // 2. Save to Supabase if available
  if (supabase && userId && !userId.startsWith('guest-')) {
    try {
      await supabase.from('shared_weeks').upsert({
        id: record.id,
        user_id: record.userId,
        week_start_date: record.weekStartDate,
        week_end_date: record.weekEndDate,
        week_label: record.weekLabel,
        display_name: record.displayName,
        total_planned_minutes: record.totalPlannedMinutes,
        items: record.items,
        is_active: record.isActive,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
    } catch (err) {
      console.warn('[Server] Supabase share upsert warning:', err);
    }
  }

  const host = req.get('host') || `localhost:${PORT}`;
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const url = `${protocol}://${host}/w/${record.id}`;

  return res.status(201).json({
    success: true,
    id: record.id,
    url,
    share: record,
  });
});

// PATCH /api/share/:id - Owner controls: update snapshot or toggle active state
app.patch('/api/share/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const existing = memoryShares.get(id);

  if (!existing) {
    return res.status(404).json({ error: 'Share link not found.' });
  }

  if (typeof req.body.isActive === 'boolean') {
    existing.isActive = req.body.isActive;
  }
  if (req.body.displayName !== undefined) {
    existing.displayName = req.body.displayName ? String(req.body.displayName).slice(0, 40).trim() : undefined;
  }
  if (Array.isArray(req.body.items)) {
    existing.items = req.body.items.map((it: any) => ({
      id: String(it.id || ''),
      title: String(it.title || 'Untitled Item').trim(),
      source: String(it.source || 'Curate'),
      type: String(it.type || 'other'),
      duration: Math.max(0, Number(it.duration) || 0),
      coverReference: it.coverReference ? String(it.coverReference).trim() : undefined,
      day: String(it.day || 'Monday'),
      dateStr: it.dateStr ? String(it.dateStr) : undefined,
      url: it.url ? String(it.url).trim() : undefined,
    }));
    existing.totalPlannedMinutes = existing.items.reduce((acc, it) => acc + it.duration, 0);
  }
  existing.updatedAt = new Date().toISOString();

  memoryShares.set(id, existing);
  persistLocalShares();

  if (supabase) {
    try {
      await supabase.from('shared_weeks').update({
        is_active: existing.isActive,
        display_name: existing.displayName,
        items: existing.items,
        total_planned_minutes: existing.totalPlannedMinutes,
        updated_at: existing.updatedAt,
      }).eq('id', id);
    } catch (err) {
      console.warn('[Server] Supabase share update warning:', err);
    }
  }

  return res.json({ success: true, share: existing });
});

// DELETE /api/share/:id - Owner controls: delete link permanently
app.delete('/api/share/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  memoryShares.delete(id);
  persistLocalShares();

  if (supabase) {
    try {
      await supabase.from('shared_weeks').delete().eq('id', id);
    } catch (err) {
      console.warn('[Server] Supabase share delete warning:', err);
    }
  }

  return res.json({ success: true });
});

// GET /api/share/:id - Get snapshot details
app.get('/api/share/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const share = memoryShares.get(id);
  if (!share) {
    return res.status(404).json({ error: 'Share not found' });
  }
  return res.json({ share });
});

// ---------------------------------------------------------------------------
// Collection API Routes
// ---------------------------------------------------------------------------

// POST /api/collections - Create a new public collection
app.post('/api/collections', async (req: Request, res: Response) => {
  const clientKey = req.body.userId || req.ip || 'anonymous';

  // Requirement 7: Rate-limit collection creation to 10 per hour
  if (!checkRateLimit(clientKey)) {
    return res.status(429).json({
      error: 'Rate limit exceeded: You may create at most 10 collections per hour.',
    });
  }

  // Requirement 5: Limits as constants: free accounts 3 collections
  const activeCount = await getActiveCollectionCount(clientKey);
  if (activeCount >= 3) {
    return res.status(400).json({
      error: 'Free accounts may keep up to 3 collections. Please delete an existing collection before creating a new one.',
    });
  }

  const {
    id,
    userId = clientKey,
    title,
    description,
    displayName,
    allowSearchEngines = false,
    items = [],
  } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Collection title is required.' });
  }

  // Requirement 5: Limits as constants: 50 items each
  if (items.length > 50) {
    return res.status(400).json({ error: 'Collections are limited to 50 items each.' });
  }

  // Requirement 1: Sanitization (title max 80, desc max 300 plain text)
  const safeTitle = String(title).replace(/<[^>]*>/g, '').trim().slice(0, 80);
  const safeDesc = description ? String(description).replace(/<[^>]*>/g, '').trim().slice(0, 300) : undefined;
  const safeDisplayName = displayName ? String(displayName).replace(/<[^>]*>/g, '').trim().slice(0, 40) : undefined;

  // Strict item sanitization: NEVER allow notes or private fields
  const sanitizedItems: ServerCollectionItem[] = items.slice(0, 50).map((it: any) => ({
    id: String(it.id || ''),
    title: String(it.title || 'Untitled Item').replace(/<[^>]*>/g, '').trim(),
    source: String(it.source || 'Curate'),
    type: String(it.type || 'other'),
    duration: Math.max(0, Number(it.duration) || 0),
    durationIsEstimate: Boolean(it.durationIsEstimate),
    coverReference: it.coverReference ? String(it.coverReference).trim() : undefined,
    url: it.url ? String(it.url).trim() : undefined,
    canonicalUrl: it.canonicalUrl ? String(it.canonicalUrl).trim() : undefined,
    youtubeId: it.youtubeId ? String(it.youtubeId).trim() : undefined,
  }));

  const totalDurationMinutes = sanitizedItems.reduce((acc, it) => acc + (it.duration || 0), 0);
  const now = new Date().toISOString();

  const record: ServerCollectionRecord = {
    id: String(id || Date.now().toString(16) + Math.random().toString(16).slice(2)),
    userId: String(userId),
    title: safeTitle,
    description: safeDesc,
    displayName: safeDisplayName,
    items: sanitizedItems,
    totalDurationMinutes,
    allowSearchEngines: Boolean(allowSearchEngines),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  memoryCollections.set(record.id, record);
  persistLocalCollections();

  const host = req.get('host') || `localhost:${PORT}`;
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const url = `${protocol}://${host}/c/${record.id}`;

  return res.status(201).json({
    success: true,
    id: record.id,
    url,
    collection: record,
  });
});

// PATCH /api/collections/:id - Update collection details or search engine indexing
app.patch('/api/collections/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const existing = memoryCollections.get(id);

  if (!existing) {
    return res.status(404).json({ error: 'Collection not found.' });
  }

  if (typeof req.body.isActive === 'boolean') {
    existing.isActive = req.body.isActive;
  }
  if (typeof req.body.allowSearchEngines === 'boolean') {
    existing.allowSearchEngines = req.body.allowSearchEngines;
  }
  if (req.body.title !== undefined) {
    existing.title = String(req.body.title).replace(/<[^>]*>/g, '').trim().slice(0, 80);
  }
  if (req.body.description !== undefined) {
    existing.description = req.body.description
      ? String(req.body.description).replace(/<[^>]*>/g, '').trim().slice(0, 300)
      : undefined;
  }
  if (Array.isArray(req.body.items)) {
    existing.items = req.body.items.slice(0, 50).map((it: any) => ({
      id: String(it.id || ''),
      title: String(it.title || 'Untitled Item').replace(/<[^>]*>/g, '').trim(),
      source: String(it.source || 'Curate'),
      type: String(it.type || 'other'),
      duration: Math.max(0, Number(it.duration) || 0),
      durationIsEstimate: Boolean(it.durationIsEstimate),
      coverReference: it.coverReference ? String(it.coverReference).trim() : undefined,
      url: it.url ? String(it.url).trim() : undefined,
      canonicalUrl: it.canonicalUrl ? String(it.canonicalUrl).trim() : undefined,
      youtubeId: it.youtubeId ? String(it.youtubeId).trim() : undefined,
    }));
    existing.totalDurationMinutes = existing.items.reduce((acc, it) => acc + (it.duration || 0), 0);
  }
  existing.updatedAt = new Date().toISOString();

  memoryCollections.set(id, existing);
  persistLocalCollections();

  return res.json({ success: true, collection: existing });
});

// DELETE /api/collections/:id - Deactivates/removes collection, ensuring 410 on subsequent requests (Requirement 8)
app.delete('/api/collections/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const existing = memoryCollections.get(id);
  if (existing) {
    existing.isActive = false;
    existing.updatedAt = new Date().toISOString();
    memoryCollections.set(id, existing);
    persistLocalCollections();
  }
  return res.json({ success: true });
});

// GET /api/collections/:id - Retrieve collection record
app.get('/api/collections/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const collection = memoryCollections.get(id);
  if (!collection) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  if (!collection.isActive) {
    return res.status(410).json({ error: 'This collection is no longer shared' });
  }
  return res.json({ collection });
});

// POST /api/analytics/event - Public beacon endpoint for events (no personal data)
app.post('/api/analytics/event', (req: Request, res: Response) => {
  const { name, properties } = req.body || {};
  console.log(`[Event Tracked] ${name}`, properties);
  return res.status(204).end();
});

// ---------------------------------------------------------------------------
// Static / Dev Middleware Setup
// ---------------------------------------------------------------------------
async function startServer() {
  if (!isProd) {
    // Development mode: Mount Vite middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

    app.use(vite.middlewares);

    app.use(async (req: Request, res: Response, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    // Production mode: Serve built dist assets
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Curate server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server Error] Failed to start:', err);
  process.exit(1);
});
