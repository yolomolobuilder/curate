/**
 * Third-Party Services Directory
 *
 * Full transparency manifest of every third-party script, font, API, and media
 * request used by Curate, including its operational purpose and cookie behavior.
 */

export interface ThirdPartyService {
  id: string;
  name: string;
  type: 'script' | 'font' | 'media' | 'api';
  domain: string;
  purpose: string;
  setsCookies: boolean;
  respectsAnalyticsOptOut: boolean;
}

export const THIRD_PARTIES: readonly ThirdPartyService[] = [
  {
    id: 'umami',
    name: 'Umami Analytics',
    type: 'script',
    domain: 'cloud.umami.is',
    purpose: 'Anonymous product telemetry (feature usage counts, session metrics). Never collects URLs, titles, notes, or user text.',
    setsCookies: false,
    respectsAnalyticsOptOut: true,
  },
  {
    id: 'clarity',
    name: 'Microsoft Clarity',
    type: 'script',
    domain: 'www.clarity.ms',
    purpose: 'Session heatmaps and scroll depth. Masked with data-clarity-mask on all personal titles, notes, and URLs. Disabled by default in beta.',
    setsCookies: true,
    respectsAnalyticsOptOut: true,
  },
  {
    id: 'google-fonts',
    name: 'Google Fonts',
    type: 'font',
    domain: 'fonts.googleapis.com / fonts.gstatic.com',
    purpose: 'Editorial typography (Newsreader serif and Plus Jakarta Sans typefaces).',
    setsCookies: false,
    respectsAnalyticsOptOut: false,
  },
  {
    id: 'youtube-thumbnails',
    name: 'YouTube Thumbnails',
    type: 'media',
    domain: 'img.youtube.com / i.ytimg.com',
    purpose: 'Cover poster artwork previews for saved YouTube video cards.',
    setsCookies: false,
    respectsAnalyticsOptOut: false,
  },
  {
    id: 'youtube-api',
    name: 'YouTube Data API & oEmbed',
    type: 'api',
    domain: 'googleapis.com / youtube.com',
    purpose: 'Fetching title, author, and exact video durations when links are added or refreshed.',
    setsCookies: false,
    respectsAnalyticsOptOut: false,
  },
  {
    id: 'supabase',
    name: 'Supabase',
    type: 'api',
    domain: 'supabase.co',
    purpose: 'Cloud authentication, database sync (PostgreSQL), and image storage for authenticated accounts.',
    setsCookies: true,
    respectsAnalyticsOptOut: false,
  },
];
