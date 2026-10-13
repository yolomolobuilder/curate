import { ContentType, ContentItem } from '../types';
import { trackEvent } from './analytics';
import { fetchYouTubeDurationsBatch } from './youtubeDuration';

export interface ExtractedMetadata {
  title: string;
  thumbnailUrl: string;
  contentType: ContentType;
  source: string;
  platform: string;
  author: string;
  durationMinutes?: number;
  durationIsEstimate?: boolean;
  durationFetchedAt?: string;
  description?: string;
  topic?: string;
}

// Preset artistic editorial covers for items without public thumbnails
export const EDITORIAL_COVER_PALETTES = [
  { name: 'Warm Terracotta', bg: '#9A3412', fg: '#FEF3C7', sub: '#FED7AA' },
  { name: 'Forest Ink', bg: '#14532D', fg: '#DCFCE7', sub: '#BBF7D0' },
  { name: 'Deep Lapis', bg: '#1E3A8A', fg: '#DBEAFE', sub: '#BFDBFE' },
  { name: 'Charcoal Alabaster', bg: '#292524', fg: '#F5F5F4', sub: '#D6D3D1' },
  { name: 'Muted Bronze', bg: '#78350F', fg: '#FEF3C7', sub: '#FDE68A' },
  { name: 'Plum Velvet', bg: '#581C87', fg: '#F3E8FF', sub: '#E9D5FF' },
];

export function generateEditorialCoverSvg(
  title: string,
  author: string,
  category: string,
  paletteIndex = 0
): string {
  const palette = EDITORIAL_COVER_PALETTES[paletteIndex % EDITORIAL_COVER_PALETTES.length];
  const safeTitle = (title || 'Curated Reading').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeAuthor = (author || 'Selected Work').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeCat = (category || 'EDITORIAL').toUpperCase().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
    <rect width="800" height="500" fill="${palette.bg}"/>
    <rect x="24" y="24" width="752" height="452" fill="none" stroke="${palette.fg}" stroke-opacity="0.18" stroke-width="1.5"/>
    <rect x="36" y="36" width="728" height="428" fill="none" stroke="${palette.fg}" stroke-opacity="0.1" stroke-width="0.75"/>
    <text x="64" y="90" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="${palette.sub}" letter-spacing="3">${safeCat}</text>
    <line x1="64" y1="110" x2="160" y2="110" stroke="${palette.fg}" stroke-opacity="0.3" stroke-width="1"/>
    <text x="64" y="220" font-family="Newsreader, Georgia, serif" font-size="34" font-weight="500" fill="${palette.fg}" font-style="italic">
      <tspan x="64" dy="0">${safeTitle.slice(0, 36)}</tspan>
      ${safeTitle.length > 36 ? `<tspan x="64" dy="44">${safeTitle.slice(36, 74)}</tspan>` : ''}
    </text>
    <text x="64" y="420" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="500" fill="${palette.sub}">
      By ${safeAuthor}
    </text>
    <circle cx="700" cy="410" r="18" fill="none" stroke="${palette.fg}" stroke-opacity="0.25" stroke-width="1.5"/>
    <circle cx="700" cy="410" r="8" fill="${palette.fg}" fill-opacity="0.3"/>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Extract YouTube Video ID from any standard URL
export function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname === '/watch') {
        return parsed.searchParams.get('v');
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        return parsed.pathname.split('/shorts/')[1]?.split(/[?&#]/)[0] || null;
      }
      if (parsed.pathname.startsWith('/live/')) {
        return parsed.pathname.split('/live/')[1]?.split(/[?&#]/)[0] || null;
      }
      if (parsed.pathname.startsWith('/embed/')) {
        return parsed.pathname.split('/embed/')[1]?.split(/[?&#]/)[0] || null;
      }
    } else if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1).split(/[?&#]/)[0] || null;
    }
  } catch {
    // regex fallback
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/|live\/))([\w-]{11})/);
    return match ? match[1] : null;
  }
  return null;
}

// Clean platform name from host
function getPlatformFromHostname(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'YouTube';
  if (host.includes('spotify.com')) return 'Spotify';
  if (host.includes('apple.com')) return 'Apple Podcasts';
  if (host.includes('substack.com')) return 'Substack';
  if (host.includes('medium.com')) return 'Medium';
  if (host.includes('nytimes.com')) return 'The New York Times';
  if (host.includes('theatlantic.com')) return 'The Atlantic';
  if (host.includes('wsj.com')) return 'Wall Street Journal';
  if (host.includes('ft.com')) return 'Financial Times';
  if (host.includes('hbr.org')) return 'Harvard Business Review';
  if (host.includes('wired.com')) return 'Wired';
  if (host.includes('economist.com')) return 'The Economist';
  if (host.includes('goodreads.com')) return 'Goodreads';
  if (host.includes('coursera.org')) return 'Coursera';
  if (host.includes('mit.edu')) return 'MIT OpenCourseWare';
  if (host.includes('edx.org')) return 'edX';
  if (host.includes('netflix.com')) return 'Netflix';
  if (host.includes('pbs.org')) return 'PBS';
  if (host.includes('nebula.tv')) return 'Nebula';

  // Capitalize main domain
  const parts = host.split('.');
  if (parts.length >= 2) {
    const main = parts[0];
    return main.charAt(0).toUpperCase() + main.slice(1);
  }
  return host;
}

// Intelligent topic detection from URL or title keywords
export function detectTopic(titleOrUrl: string | undefined | null): string {
  if (!titleOrUrl || typeof titleOrUrl !== 'string') return 'Deep Dive';

  const text = titleOrUrl.toLowerCase();

  const containsWord = (words: string[]) =>
    words.some(word => new RegExp(`\\b${word}\\b`, 'i').test(text));

  if (containsWord(['marketing', 'growth', 'seo', 'ads', 'copywriting'])) return 'Marketing';
  if (containsWord(['ux', 'ui', 'design', 'figma', 'typography'])) return 'UX/UI';
  if (containsWord(['german', 'deutsch'])) return 'German';
  if (containsWord(['english', 'grammar', 'vocabulary'])) return 'English';
  if (containsWord(['health', 'sleep', 'nutrition', 'fasting', 'longevity'])) return 'Health';
  if (containsWord(['fitness', 'workout', 'gym', 'strength', 'run'])) return 'Fitness';
  if (containsWord(['psychology', 'cognitive', 'bias', 'behavior', 'mindset'])) return 'Psychology';
  if (containsWord(['business', 'startup', 'strategy', 'venture', 'founder'])) return 'Business';
  if (containsWord(['economics', 'economy', 'finance', 'investing', 'market'])) return 'Economics';
  if (containsWord(['history', 'century', 'war', 'ancient', 'roman'])) return 'History';
  if (containsWord(['science', 'physics', 'biology', 'neuroscience', 'quantum'])) return 'Science';
  if (containsWord(['philosophy', 'stoic', 'ethics', 'nietzsche', 'epictetus'])) return 'Philosophy';
  if (containsWord(['culture', 'art', 'cinema', 'music', 'literature'])) return 'Culture';
  if (containsWord(['tech', 'ai', 'code', 'software', 'engineering'])) return 'Technology';

  return 'Deep Dive';
}

/**
 * Primary metadata extraction entry point.
 * Given a URL or book name, attempts automatic extraction.
 */
export async function extractMetadata(urlInput: string): Promise<ExtractedMetadata> {
  const trimmed = urlInput.trim();
  const isUrl = /^https?:\/\//i.test(trimmed);

  if (!isUrl) {
    // Treat as manual book or lecture title
    trackEvent('metadata_fallback_used', { type: 'book' });
    const topic = detectTopic(trimmed);
    const cover = generateEditorialCoverSvg(trimmed, 'Author', topic, 0);
    return {
      title: trimmed,
      thumbnailUrl: cover,
      contentType: 'book',
      source: 'Book / Publication',
      platform: 'Book / Publication',
      author: 'Author',
      durationMinutes: 180,
      topic,
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    trackEvent('metadata_fallback_used', { type: 'other' });
    const topic = detectTopic(trimmed);
    return {
      title: trimmed,
      thumbnailUrl: generateEditorialCoverSvg(trimmed, 'Web Resource', topic, 1),
      contentType: 'other',
      source: 'Web',
      platform: 'Web',
      author: 'Web Resource',
      topic,
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const platform = getPlatformFromHostname(hostname);

  // 1. YouTube specific handler
  const ytId = extractYouTubeId(trimmed);
  if (ytId) {
    const isPodcast = trimmed.toLowerCase().includes('podcast') || parsedUrl.pathname.includes('/podcasts');
    const contentType: ContentType = isPodcast ? 'podcast' : 'youtube';
    const thumbnailUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;

    let title = 'YouTube Video';
    let author = 'YouTube Channel';

    try {
      // Use YouTube official no-auth oEmbed endpoint
      const oEmbedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`;
      const res = await fetch(oEmbedUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.title) title = data.title;
        if (data.author_name) author = data.author_name;
      } else {
        trackEvent('metadata_fallback_used', { type: contentType });
      }
    } catch {
      // Offline or CORS fallback
      trackEvent('metadata_fallback_used', { type: contentType });
      title = `YouTube: ${ytId}`;
    }

    const topic = detectTopic(`${title} ${trimmed}`);

    let durationMinutes = isPodcast ? 55 : 28;
    let durationIsEstimate = true;
    let durationFetchedAt: string | undefined = undefined;

    try {
      const ytDurations = await fetchYouTubeDurationsBatch([ytId]);
      const ytResult = ytDurations.get(ytId);
      if (ytResult && typeof ytResult.durationMinutes === 'number' && ytResult.durationMinutes > 0) {
        durationMinutes = ytResult.durationMinutes;
        durationIsEstimate = false;
        durationFetchedAt = ytResult.fetchedAt || new Date().toISOString();
      }
    } catch {
      // Offline / error: stays estimate
    }

    return {
      title,
      thumbnailUrl,
      contentType,
      source: author || 'YouTube',
      platform: 'YouTube',
      author,
      durationMinutes,
      durationIsEstimate,
      durationFetchedAt,
      topic,
    };
  }

  // 2. Podcast platforms
  if (hostname.includes('spotify.com') || hostname.includes('apple.com') || hostname.includes('overcast.fm')) {
    const titleFromPath = parsedUrl.pathname.split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ') || 'Podcast Episode';
    const cleanTitle = decodeURIComponent(titleFromPath)
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    const topic = detectTopic(cleanTitle);
    return {
      title: cleanTitle,
      thumbnailUrl: generateEditorialCoverSvg(cleanTitle, platform, topic, 2),
      contentType: 'podcast',
      source: platform,
      platform,
      author: platform,
      durationMinutes: 45,
      topic,
    };
  }

  // 3. Documentaries or Courses
  if (hostname.includes('coursera.org') || hostname.includes('edx.org') || hostname.includes('mit.edu')) {
    const titleFromPath = parsedUrl.pathname.split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ') || 'Online Course';
    const cleanTitle = decodeURIComponent(titleFromPath)
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    const topic = detectTopic(cleanTitle);
    return {
      title: cleanTitle,
      thumbnailUrl: generateEditorialCoverSvg(cleanTitle, platform, topic, 3),
      contentType: 'course',
      source: platform,
      platform,
      author: platform,
      durationMinutes: 90,
      topic,
    };
  }

  if (hostname.includes('netflix.com') || hostname.includes('pbs.org') || hostname.includes('nebula.tv')) {
    const titleFromPath = parsedUrl.pathname.split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ') || 'Documentary Feature';
    const cleanTitle = decodeURIComponent(titleFromPath)
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    const topic = detectTopic(cleanTitle);
    return {
      title: cleanTitle,
      thumbnailUrl: generateEditorialCoverSvg(cleanTitle, platform, topic, 4),
      contentType: 'documentary',
      source: platform,
      platform,
      author: platform,
      durationMinutes: 75,
      topic,
    };
  }

  // 4. Default: Article / Essay / Monograph
  const titleSlug = parsedUrl.pathname.split('/').filter(Boolean).pop()?.replace(/\.(html?|php)$/, '').replace(/[-_]/g, ' ') || '';
  const readableTitle = titleSlug.length > 3
    ? decodeURIComponent(titleSlug).split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : `${platform} Article`;

  const topic = detectTopic(`${readableTitle} ${parsedUrl.pathname}`);
  const coverUrl = generateEditorialCoverSvg(readableTitle, platform, topic, 0);

  return {
    title: readableTitle,
    thumbnailUrl: coverUrl,
    contentType: 'article',
    source: platform,
    platform,
    author: platform,
    durationMinutes: 12,
    topic,
  };
}

/**
 * Merges freshly fetched metadata into an existing item, ensuring user-edited fields
 * (title, contentType, source, durationMinutes) are NEVER overwritten.
 */
export function mergeRefetchedMetadata(
  item: ContentItem,
  meta: ExtractedMetadata
): ContentItem {
  const edited = new Set<string>([
    ...(item.userEditedFields || []),
    ...(item.editedFields || []),
  ]);

  // If durationIsEstimate is false, consider duration as user-edited
  const isDurationEdited = item.durationIsEstimate === false || edited.has('durationMinutes');
  const isTitleEdited = edited.has('title');
  const isTypeEdited = edited.has('contentType');
  const isSourceEdited = edited.has('source');

  const finalUserEditedFields = Array.from(edited);

  return {
    ...item,
    title: isTitleEdited ? item.title : meta.title || item.title,
    contentType: isTypeEdited ? item.contentType : meta.contentType || item.contentType,
    source: isSourceEdited ? item.source : meta.source || item.source,
    platform: isSourceEdited ? item.platform : meta.platform || item.platform,
    author: isSourceEdited ? item.author : meta.author || item.author,
    durationMinutes: isDurationEdited
      ? item.durationMinutes
      : meta.durationMinutes ?? item.durationMinutes,
    durationIsEstimate: isDurationEdited ? false : (meta.durationIsEstimate !== undefined ? meta.durationIsEstimate : true),
    durationFetchedAt: isDurationEdited ? item.durationFetchedAt : (meta.durationFetchedAt || item.durationFetchedAt),
    userEditedFields: finalUserEditedFields,
    editedFields: finalUserEditedFields,
    thumbnailUrl: item.thumbnailUrl || meta.thumbnailUrl,
    topic: item.topic || meta.topic,
  };
}

/**
 * Refetches metadata for an item from its URL, preserving all user-edited fields.
 */
export async function refetchItemMetadata(item: ContentItem): Promise<ContentItem> {
  if (!item.url) return item;
  const meta = await extractMetadata(item.url);
  return mergeRefetchedMetadata(item, meta);
}

