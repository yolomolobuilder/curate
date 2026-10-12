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

// In-memory store initialized from disk
const memoryShares = new Map<string, SharedWeekRecord>();

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

// ---------------------------------------------------------------------------
// HTML Renderer for Shared Week (Requirements 3, 5, 6, 7, 8)
// ---------------------------------------------------------------------------
function renderSharedWeekHtml(share: SharedWeekRecord, origin: string): string {
  const creatorPrefix = share.displayName ? `${share.displayName}’s ` : '';
  const pageTitle = `${creatorPrefix}Curated Week (${share.weekLabel}) — Curate`;
  const formattedTotal = formatDuration(share.totalPlannedMinutes);
  const pageDescription = `${formattedTotal} thoughtfully planned across ${share.items.length} items: articles, videos, and podcasts curated with mindful intention.`;
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

    let itemsHtml = '';
    for (const item of dayItems) {
      const badge = CONTENT_BADGES[item.type] || CONTENT_BADGES.other;
      const isYouTube = item.type === 'youtube';
      const hasThumb = Boolean(item.coverReference);

      itemsHtml += `
        <div class="item-card">
          ${
            hasThumb
              ? `<div class="card-thumb">
                   <img src="${escapeHtml(item.coverReference!)}" alt="${escapeHtml(item.title)}" loading="lazy" />
                   ${isYouTube ? '<span class="youtube-tag">YouTube</span>' : ''}
                 </div>`
              : ''
          }
          <div class="card-body">
            <div class="card-meta">
              <span class="type-badge"><span class="badge-icon">${badge.icon}</span> ${badge.label}</span>
              <span class="source-tag">${escapeHtml(item.source)}</span>
              ${item.duration > 0 ? `<span class="duration-tag">${formatDuration(item.duration)}</span>` : ''}
            </div>
            <h3 class="card-title">${escapeHtml(item.title)}</h3>
          </div>
        </div>
      `;
    }

    daysHtml += `
      <section class="day-group">
        <div class="day-header">
          <h2 class="day-name">${escapeHtml(dayName)}</h2>
          <span class="day-duration">${dayTimeStr}</span>
        </div>
        <div class="day-items">
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
      gap: 0.6rem;
      text-decoration: none;
      color: var(--text-main);
    }
    .brand-logo {
      width: 26px;
      height: 26px;
    }
    .brand-name {
      font-weight: 700;
      font-size: 1.1rem;
      letter-spacing: -0.02em;
    }
    .top-cta {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-main);
      background: var(--pill-bg);
      padding: 0.4rem 0.85rem;
      border-radius: 9999px;
      text-decoration: none;
      border: 1px solid var(--border);
      transition: opacity 0.2s;
    }
    .top-cta:hover { opacity: 0.85; }

    /* Hero / week header */
    .week-hero {
      padding: 2.5rem 0 1.5rem;
    }
    .eyebrow {
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }
    .week-title {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 2.25rem;
      font-weight: 400;
      line-height: 1.2;
      letter-spacing: -0.02em;
      color: var(--text-main);
      margin-bottom: 0.5rem;
    }
    .week-creator {
      font-size: 0.95rem;
      color: var(--text-muted);
      margin-bottom: 1rem;
    }
    .hero-metrics-text {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.75rem;
      font-size: 0.82rem;
      color: var(--text-muted);
    }
    .hero-metrics-text strong {
      color: var(--text-main);
      font-weight: 600;
    }
    .hero-metrics-text .sep {
      color: var(--border);
    }

    /* Day stream */
    .day-stream {
      margin-top: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }
    .day-group {
      border-top: 1px solid var(--border);
      padding-top: 1.25rem;
    }
    .day-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 0.85rem;
    }
    .day-name {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 1.35rem;
      font-weight: 500;
      color: var(--text-main);
    }
    .day-duration {
      font-size: 0.75rem;
      font-family: monospace;
      color: var(--text-muted);
    }
    .day-items {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    /* Cards */
    .item-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 1rem;
      display: flex;
      gap: 1rem;
      align-items: flex-start;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    @media (max-width: 480px) {
      .item-card { flex-direction: column; }
    }
    .card-thumb {
      width: 120px;
      height: 72px;
      flex-shrink: 0;
      border-radius: 8px;
      overflow: hidden;
      position: relative;
      background: var(--pill-bg);
    }
    @media (max-width: 480px) {
      .card-thumb { width: 100%; height: 160px; }
    }
    .card-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .youtube-tag {
      position: absolute;
      bottom: 4px;
      right: 4px;
      background: rgba(0, 0, 0, 0.75);
      color: #FFF;
      font-size: 9px;
      font-weight: 600;
      padding: 2px 5px;
      border-radius: 4px;
    }
    .card-body {
      flex: 1;
      min-width: 0;
    }
    .card-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.45rem;
      margin-bottom: 0.4rem;
    }
    .type-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: capitalize;
    }
    .badge-icon { font-size: 0.75rem; }
    .source-tag {
      font-size: 0.75rem;
      color: var(--text-muted);
      position: relative;
    }
    .source-tag::before {
      content: '·';
      margin-right: 0.35rem;
    }
    .duration-tag {
      font-size: 0.7rem;
      font-family: monospace;
      color: var(--text-subtle);
      background: var(--pill-bg);
      padding: 1px 6px;
      border-radius: 4px;
      margin-left: auto;
    }
    .card-title {
      font-size: 0.98rem;
      font-weight: 600;
      line-height: 1.35;
      color: var(--text-main);
      letter-spacing: -0.01em;
    }

    /* Footer (Pure text-based, no images or pill shapes) */
    .page-footer {
      margin-top: 3.5rem;
      padding-top: 2rem;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 1rem;
    }
    .footer-wordmark {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 1.25rem;
      font-style: italic;
      color: var(--text-main);
    }
    .footer-wordmark span {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-style: normal;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .footer-links {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.82rem;
      color: var(--text-muted);
    }
    .plan-cta-text-link {
      color: var(--text-main);
      font-weight: 500;
      text-decoration: underline;
      text-underline-offset: 4px;
      font-size: 0.88rem;
      transition: opacity 0.15s;
    }
    .plan-cta-text-link:hover {
      opacity: 0.7;
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
        <svg class="brand-logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="11" fill="currentColor" fill-opacity="0.1"/>
          <path d="M12 4V20M4 12H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span class="brand-name">Curate</span>
      </a>
      <a href="/?ref=share" class="top-cta">Plan your own week &rarr;</a>
    </header>

    <!-- Hero -->
    <main>
      <div class="week-hero">
        <div class="eyebrow">Weekly Flow Snapshot</div>
        <h1 class="week-title">${escapeHtml(share.weekLabel)}</h1>
        ${
          share.displayName
            ? `<div class="week-creator">Shared by <strong>${escapeHtml(share.displayName)}</strong></div>`
            : ''
        }
        <div class="hero-metrics-text">
          <span>Planned Time: <strong>${formattedTotal}</strong></span>
          <span class="sep">&middot;</span>
          <span>Items: <strong>${share.items.length}</strong></span>
        </div>
      </div>

      <!-- Days -->
      <div class="day-stream">
        ${daysHtml}
      </div>
    </main>

    <!-- Footer (Requirement 8: Pure text-based, no images or pill buttons) -->
    <footer class="page-footer">
      <div class="footer-wordmark">
        <span>Curate</span> &mdash; Curate Your Curiosity.
      </div>
      <div class="footer-links">
        <a href="/?ref=share" id="plan-cta" class="plan-cta-text-link">Plan your own week on Curate &rarr;</a>
        <span class="sep">&middot;</span>
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
function renderGoneHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>This week is no longer shared — Curate</title>
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
    <h1>This week is no longer shared</h1>
    <p>The owner of this weekly plan has deactivated or removed this share link.</p>
    <a href="/?ref=share">Plan your own week on Curate &rarr;</a>
  </div>
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
  const weekLabel = share?.weekLabel || 'Weekly Flow';
  const creator = share?.displayName ? `Curated by ${escapeHtml(share.displayName)}` : 'Weekly Flow';
  const total = share ? formatDuration(share.totalPlannedMinutes) : 'Time-budgeted';
  const itemCount = share ? `${share.items.length} items` : 'Mindful media';

  const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="630" fill="#141413"/>
    <rect x="36" y="36" width="1128" height="558" rx="20" fill="none" stroke="#2E2C29" stroke-width="2"/>
    
    <!-- Wordmark -->
    <text x="90" y="115" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="700" fill="#FBF9F5" letter-spacing="-0.5">Curate</text>
    <text x="90" y="150" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#A8A29E" letter-spacing="2">CURATE YOUR CURIOSITY</text>
    
    <!-- Week Title -->
    <text x="90" y="270" font-family="serif, Georgia" font-size="62" font-style="italic" fill="#FBF9F5">${escapeHtml(weekLabel)}</text>
    <text x="90" y="335" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="400" fill="#D6D3D1">${escapeHtml(creator)}</text>
    
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
    execSync(`convert -size 1200x630 xc:"#141413" -stroke "#2E2C29" -strokewidth 2 -fill none -draw "roundrectangle 30,30 1170,600 24,24" -stroke none -fill "#FBF9F5" -pointsize 34 -font "Liberation-Sans-Bold" -gravity NorthWest -annotate +90+80 "Curate" -fill "#A8A29E" -pointsize 14 -font "Liberation-Sans" -gravity NorthWest -annotate +90+128 "CURATE YOUR CURIOSITY" -fill "#FBF9F5" -pointsize 54 -font "Liberation-Serif-Italic" -gravity NorthWest -annotate +90+240 "${escapeHtml(weekLabel)}" -fill "#D6D3D1" -pointsize 22 -font "Liberation-Sans" -gravity NorthWest -annotate +90+320 "${escapeHtml(creator)}" -fill "#292724" -draw "roundrectangle 90,420 280,466 16,16" -fill "#E7E5E4" -pointsize 15 -font "Liberation-Sans-Bold" -gravity NorthWest -annotate +115+435 "${escapeHtml(total)}" -fill "#78716C" -pointsize 18 -font "Liberation-Sans" -gravity SouthEast -annotate +90+80 "curate.app" "${tmpPng}"`);

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
