import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Sparkles,
  Plus,
  Compass,
  LayoutGrid,
  ZoomIn,
  ZoomOut,
  Play,
  FileText,
  Headphones,
  BookOpen,
  Bookmark,
  ArrowRight,
} from 'lucide-react';
import { ContentItem, ContentType, CONTENT_TYPE_CONFIG } from '../types';
import { extractMetadata } from '../lib/metadataExtractor';
import { ContentCard } from './ContentCard';
import { CurateLogo } from './CurateLogo';
import {
  getActivationState,
  recordActivationPlanMyWeek,
  recordActivationManualChosen,
  isFirstUseActivationActive,
  markActivationPermanentlyCompleted,
  ActivationState,
} from '../lib/activation';
import { getTodayStr } from '../lib/dateUtils';

interface HomePageProps {
  items: ContentItem[];
  onAddItem: (item: Omit<ContentItem, 'id' | 'createdAt'>) => void;
  onUpdateItem?: (id: string, updates: Partial<ContentItem>) => void;
  onSelectCard: (item: ContentItem) => void;
  onToggleComplete: (id: string, e: React.MouseEvent) => void;
  onTogglePriority?: (id: string, e: React.MouseEvent) => void;
  onNavigateToCalendar: () => void;
  onLoadStarterPack: () => void;
  onOpenAddModal: (type?: ContentType) => void;
  onPlanMyWeek?: () => void;
  onUpdateDuration?: (id: string, durationMinutes: number) => void;
}

interface CategoryDefinition {
  id: string;
  label: string;
  singularLabel: string;
  contentType: ContentType;
  icon: React.ComponentType<{ className?: string }>;
  kicker: string;
  filterFn: (item: ContentItem) => boolean;
}

const CATEGORIES: CategoryDefinition[] = [
  {
    id: 'videos',
    label: 'Videos',
    singularLabel: 'video',
    contentType: 'youtube',
    icon: Play,
    kicker: 'Watch & Learn',
    filterFn: (item) =>
      item.contentType === 'youtube' ||
      item.contentType === 'documentary' ||
      item.contentType === 'course',
  },
  {
    id: 'articles',
    label: 'Articles',
    singularLabel: 'article',
    contentType: 'article',
    icon: FileText,
    kicker: 'Essays & Longform',
    filterFn: (item) => item.contentType === 'article',
  },
  {
    id: 'podcasts',
    label: 'Podcasts',
    singularLabel: 'podcast',
    contentType: 'podcast',
    icon: Headphones,
    kicker: 'Audio & Conversations',
    filterFn: (item) => item.contentType === 'podcast',
  },
  {
    id: 'books',
    label: 'Books',
    singularLabel: 'book',
    contentType: 'book',
    icon: BookOpen,
    kicker: 'Volumes & Reading List',
    filterFn: (item) => item.contentType === 'book',
  },
];

interface Point {
  x: number;
  y: number;
}

// Clearance dimensions: Width 300px + 60px gap, Height 250px + 50px gap
const MIN_DIST_X = 360;
const MIN_DIST_Y = 300;

function isColliding(p1: Point, p2: Point): boolean {
  return Math.abs(p1.x - p2.x) < MIN_DIST_X && Math.abs(p1.y - p2.y) < MIN_DIST_Y;
}

// Center hero headline exclusion box
function isOverlappingCenter(p: Point): boolean {
  return Math.abs(p.x) < 380 && Math.abs(p.y) < 230;
}

// Base collision-free slot arrays for each category
function getCategorySlots(category: string): Point[] {
  switch (category) {
    case 'videos':
      return [
        { x: 0, y: -420 },     // Top center
        { x: 560, y: -220 },   // Top right
        { x: 940, y: -220 },   // Far top right
        { x: 560, y: -540 },   // High top right
        { x: 940, y: -540 },   // High far top right
        { x: 0, y: -740 },     // Deep top center
        { x: -380, y: -740 },  // Deep top left
        { x: 380, y: -740 },   // Deep top right
      ];
    case 'articles':
      return [
        { x: -560, y: -220 },  // Top left
        { x: -940, y: -220 },  // Far top left
        { x: -560, y: -540 },  // High top left
        { x: -940, y: -540 },  // High far top left
        { x: -680, y: 100 },   // Mid west
        { x: -1040, y: 100 },  // Far mid west
        { x: -640, y: -760 },  // Deep high left
      ];
    case 'books':
      return [
        { x: -560, y: 260 },   // Bottom left
        { x: -940, y: 260 },   // Far bottom left
        { x: -560, y: 580 },   // Deep bottom left
        { x: -940, y: 580 },   // Deep far bottom left
        { x: -560, y: 900 },   // Extra deep bottom left
        { x: -940, y: 900 },   // Extra deep far bottom left
      ];
    case 'podcasts':
      return [
        { x: 0, y: 440 },      // Bottom center
        { x: 560, y: 260 },    // Bottom right
        { x: 940, y: 260 },    // Far bottom right
        { x: 560, y: 580 },    // Deep bottom right
        { x: 0, y: 760 },      // Deep bottom center
        { x: 560, y: 900 },    // Extra deep bottom right
      ];
    default:
      return [
        { x: 680, y: 20 },
        { x: 1040, y: 20 },
        { x: 680, y: 340 },
        { x: 1040, y: 340 },
      ];
  }
}

export const HomePage: React.FC<HomePageProps> = ({
  items,
  onAddItem,
  onSelectCard,
  onToggleComplete,
  onTogglePriority,
  onOpenAddModal,
  onNavigateToCalendar,
  onPlanMyWeek,
  onUpdateDuration,
}) => {
  // Activation milestone state
  const [activation, setActivation] = useState<ActivationState>(getActivationState());
  const [isActivationActive, setIsActivationActive] = useState<boolean>(() => isFirstUseActivationActive());

  useEffect(() => {
    const handleUpdate = () => {
      setActivation(getActivationState());
      setIsActivationActive(isFirstUseActivationActive());
    };
    window.addEventListener('curate:activation_updated', handleUpdate);
    return () => window.removeEventListener('curate:activation_updated', handleUpdate);
  }, []);

  // Mode: 'canvas' (Default: Cosmos visual universe as shown in image) vs 'grid' (Categorized sections)
  const [viewMode, setViewMode] = useState<'canvas' | 'grid'>('canvas');

  // Filter out completed items: completed items should NOT be on the home page
  const activeItems = useMemo(() => {
    return items.filter((item) => item.status !== 'completed');
  }, [items]);

  // Genuine user-saved items (excluding sample items and completed items) for 3-5-1 activation
  const userSavedItems = useMemo(() => {
    return items.filter((item) => !item.isSample && item.status !== 'completed');
  }, [items]);

  // Canvas Pan & Zoom
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  // Quick category filter tab
  const [activeFilter, setActiveFilter] = useState<string>('all');

  // Fast paste input state (bottom HUD)
  const [pasteUrl, setPasteUrl] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [previewItem, setPreviewItem] = useState<{
    title: string;
    thumbnailUrl: string;
    contentType: ContentType;
    platform: string;
    author: string;
    durationMinutes?: number;
    durationIsEstimate?: boolean;
    durationFetchedAt?: string;
    topic?: string;
  } | null>(null);

  // Categorized counts (only active uncompleted items)
  const counts = useMemo(() => {
    return {
      all: activeItems.length,
      videos: activeItems.filter(
        (i) =>
          i.contentType === 'youtube' ||
          i.contentType === 'documentary' ||
          i.contentType === 'course'
      ).length,
      articles: activeItems.filter((i) => i.contentType === 'article').length,
      podcasts: activeItems.filter((i) => i.contentType === 'podcast').length,
      books: activeItems.filter((i) => i.contentType === 'book').length,
    };
  }, [activeItems]);

  // Compute collision-free spatial positions for all active items
  const itemPositions = useMemo(() => {
    const map = new Map<string, Point>();
    const placedPoints: Point[] = [];

    const findFreePosition = (preferred: Point, catKey: string): Point => {
      let candidate = { ...preferred };
      let attempts = 0;

      // Iteratively move candidate if it collides with center or already placed card
      while (
        (isOverlappingCenter(candidate) ||
          placedPoints.some((p) => isColliding(candidate, p))) &&
        attempts < 60
      ) {
        attempts++;
        if (catKey === 'videos') {
          candidate = { x: candidate.x + 380, y: candidate.y };
          if (candidate.x > 1400) {
            candidate = { x: 560, y: candidate.y - 320 };
          }
        } else if (catKey === 'articles') {
          candidate = { x: candidate.x - 380, y: candidate.y };
          if (candidate.x < -1400) {
            candidate = { x: -560, y: candidate.y - 320 };
          }
        } else if (catKey === 'books') {
          candidate = { x: candidate.x - 380, y: candidate.y };
          if (candidate.x < -1400) {
            candidate = { x: -560, y: candidate.y + 320 };
          }
        } else if (catKey === 'podcasts') {
          candidate = { x: candidate.x + 380, y: candidate.y };
          if (candidate.x > 1400) {
            candidate = { x: 0, y: candidate.y + 320 };
          }
        } else {
          candidate = { x: candidate.x + 380, y: candidate.y + 160 };
        }
      }

      placedPoints.push(candidate);
      return candidate;
    };

    const catCounters: Record<string, number> = {
      videos: 0,
      articles: 0,
      podcasts: 0,
      books: 0,
      other: 0,
    };

    activeItems.forEach((item) => {
      let catKey = 'other';
      if (
        item.contentType === 'youtube' ||
        item.contentType === 'documentary' ||
        item.contentType === 'course'
      ) {
        catKey = 'videos';
      } else if (item.contentType === 'article') {
        catKey = 'articles';
      } else if (item.contentType === 'podcast') {
        catKey = 'podcasts';
      } else if (item.contentType === 'book') {
        catKey = 'books';
      }

      const idx = catCounters[catKey]++;
      const slots = getCategorySlots(catKey);
      const preferred =
        idx < slots.length
          ? slots[idx]
          : {
              x: slots[0].x + (idx % 3) * 380,
              y: slots[0].y + Math.floor(idx / 3) * 320,
            };

      const finalPos = findFreePosition(preferred, catKey);
      map.set(item.id, finalPos);
    });

    return map;
  }, [activeItems]);

  // Content bounding box to prevent panning into empty space
  const contentBounds = useMemo(() => {
    if (activeItems.length === 0) {
      return { minX: -400, maxX: 400, minY: -300, maxY: 300, width: 800, height: 600 };
    }
    let minX = -300;
    let maxX = 300;
    let minY = -250;
    let maxY = 250;

    activeItems.forEach((item) => {
      const pos = itemPositions.get(item.id);
      if (pos) {
        if (pos.x - 180 < minX) minX = pos.x - 180;
        if (pos.x + 180 > maxX) maxX = pos.x + 180;
        if (pos.y - 140 < minY) minY = pos.y - 140;
        if (pos.y + 140 > maxY) maxY = pos.y + 140;
      }
    });

    const padding = 160;
    return {
      minX: minX - padding,
      maxX: maxX + padding,
      minY: minY - padding,
      maxY: maxY + padding,
      width: Math.max(900, maxX - minX + padding * 2),
      height: Math.max(700, maxY - minY + padding * 2),
    };
  }, [activeItems, itemPositions]);

  // Clamp pan so user cannot pan up or out into empty void where nothing exists
  const clampPan = useCallback(
    (newPan: { x: number; y: number }, targetZoom: number) => {
      if (activeItems.length === 0) {
        return {
          x: Math.max(-100, Math.min(100, newPan.x)),
          y: Math.max(-100, Math.min(100, newPan.y)),
        };
      }

      // Restrict pan so content remains in viewport
      const maxPanX = Math.max(200, -contentBounds.minX * targetZoom);
      const minPanX = Math.min(-200, -contentBounds.maxX * targetZoom);
      const maxPanY = Math.max(160, -contentBounds.minY * targetZoom);
      const minPanY = Math.min(-160, -contentBounds.maxY * targetZoom);

      return {
        x: Math.max(minPanX, Math.min(maxPanX, newPan.x)),
        y: Math.max(minPanY, Math.min(maxPanY, newPan.y)),
      };
    },
    [activeItems.length, contentBounds]
  );

  // Canvas Mouse Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('a') ||
      target.closest('.cosmos-card-interactive')
    ) {
      return;
    }

    setIsPanning(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { x: pan.x, y: pan.y };
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isPanning) {
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        const rawPan = {
          x: panStartRef.current.x + dx,
          y: panStartRef.current.y + dy,
        };
        setPan(clampPan(rawPan, zoom));
      }
    },
    [isPanning, zoom, clampPan]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  useEffect(() => {
    if (isPanning) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isPanning, handleMouseMove, handleMouseUp]);

  // Two-finger trackpad / wheel handling with bounded clamping
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Pinch to zoom
      e.preventDefault();
      const zoomFactor = -e.deltaY * 0.005;
      const nextZoom = Math.max(0.4, Math.min(1.6, zoom + zoomFactor));
      setZoom(nextZoom);
      setPan((p) => clampPan(p, nextZoom));
    } else {
      // Pan canvas (clamped)
      const nextPan = {
        x: pan.x - e.deltaX * 0.9,
        y: pan.y - e.deltaY * 0.9,
      };
      setPan(clampPan(nextPan, zoom));
    }
  };

  // Recenter to origin (0, 0)
  const handleRecenter = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  // Fit all cards into screen
  const handleFitAll = () => {
    if (!canvasRef.current || activeItems.length === 0) {
      handleRecenter();
      return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = (rect.width * 0.82) / contentBounds.width;
    const scaleY = (rect.height * 0.82) / contentBounds.height;
    const fitZoom = Math.max(0.4, Math.min(1.15, Math.min(scaleX, scaleY)));

    const centerX = (contentBounds.minX + contentBounds.maxX) / 2;
    const centerY = (contentBounds.minY + contentBounds.maxY) / 2;

    setZoom(fitZoom);
    setPan(
      clampPan(
        {
          x: -centerX * fitZoom,
          y: -centerY * fitZoom,
        },
        fitZoom
      )
    );
  };

  // URL extraction & save
  const handleUrlChange = async (val: string) => {
    setPasteUrl(val);
    if (val.trim().length > 8 && /^https?:\/\//i.test(val.trim())) {
      setIsExtracting(true);
      try {
        const meta = await extractMetadata(val.trim());
        setPreviewItem({
          title: meta.title,
          thumbnailUrl: meta.thumbnailUrl,
          contentType: meta.contentType,
          platform: meta.platform,
          author: meta.author,
          durationMinutes: meta.durationMinutes,
          durationIsEstimate: meta.durationIsEstimate,
          durationFetchedAt: meta.durationFetchedAt,
          topic: meta.topic,
        });
      } catch (err) {
        console.warn('Extraction failed:', err);
      } finally {
        setIsExtracting(false);
      }
    } else {
      setPreviewItem(null);
    }
  };

  const handleSaveItem = (status: 'inbox' | 'planned') => {
    if (!previewItem && !pasteUrl.trim()) return;

    const title = previewItem?.title || pasteUrl.trim();
    const thumbnailUrl = previewItem?.thumbnailUrl || '';
    const contentType = previewItem?.contentType || 'other';
    const source = previewItem?.author || previewItem?.platform || 'Curate';
    const isEstimate = previewItem?.durationIsEstimate !== false;

    onAddItem({
      url: pasteUrl.trim() || undefined,
      title,
      thumbnailUrl,
      contentType,
      source,
      platform: previewItem?.platform,
      author: previewItem?.author,
      durationMinutes: previewItem?.durationMinutes,
      durationIsEstimate: isEstimate,
      durationFetchedAt: previewItem?.durationFetchedAt,
      userEditedFields: isEstimate ? [] : ['durationMinutes'],
      editedFields: isEstimate ? [] : ['durationMinutes'],
      topic: previewItem?.topic,
      status,
      scheduledDate:
        status === 'planned' ? getTodayStr() : undefined,
    });

    setPasteUrl('');
    setPreviewItem(null);
  };

  // Filtered active items
  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') return activeItems;
    const cat = CATEGORIES.find((c) => c.id === activeFilter);
    if (cat) return activeItems.filter(cat.filterFn);
    return activeItems;
  }, [activeItems, activeFilter]);

  // Visible category definitions for Grid mode (all sections visible in Grid mode)
  const visibleCategories = useMemo(() => {
    return CATEGORIES;
  }, []);

  const otherItems = useMemo(() => {
    return activeItems.filter(
      (item) =>
        !['youtube', 'documentary', 'course', 'article', 'podcast', 'book'].includes(
          item.contentType
        )
    );
  }, [activeItems]);

  const handlePlanWeekChoice = () => {
    markActivationPermanentlyCompleted();
    setIsActivationActive(false);
    if (onPlanMyWeek) {
      onPlanMyWeek();
    } else {
      recordActivationPlanMyWeek(Math.min(3, userSavedItems.length));
      onNavigateToCalendar();
    }
  };

  const handleManualChoice = () => {
    recordActivationManualChosen();
    markActivationPermanentlyCompleted();
    setIsActivationActive(false);
  };

  // Full-screen centered activation lifecycle (only shown the very first time on account creation)
  if (isActivationActive) {
    return (
      <div className="relative w-full h-[calc(100vh-61px)] overflow-y-auto bg-[#0C0C0C] text-stone-100 flex items-center justify-center p-4 select-none">
        {/* Subtle radial dot grid */}
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: 'radial-gradient(circle, #888888 1px, transparent 1px)',
            backgroundSize: '36px 36px',
          }}
        />

        <div className="relative z-10 w-full max-w-xl text-center py-12 px-4">
          <div className="inline-flex items-center justify-center w-12 h-12 mb-4 mx-auto">
            <CurateLogo className="w-full h-full text-stone-200" />
          </div>

          <span className="block text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.25em] text-stone-400 mb-3">
            your endless visual universe
          </span>

          <h1 className="font-serif text-3xl sm:text-4xl lg:text-[44px] font-normal text-stone-100 tracking-tight leading-snug">
            Everything worth exploring.<br className="hidden sm:inline" /> On your schedule.
          </h1>

          <p className="mt-3.5 font-serif italic text-xs sm:text-sm text-stone-400 max-w-md mx-auto leading-relaxed">
            Save YouTube videos, articles, podcasts and books, then plan when you'll actually consume them.
          </p>

          {/* Progress state & actions */}
          <div className="mt-8">
            {/* Step indicator */}
            <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-stone-900 border border-stone-800 shadow-sm mb-4">
              <span className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full transition-colors ${userSavedItems.length >= 1 ? 'bg-amber-400' : 'bg-stone-700'}`} />
                <span className={`w-2 h-2 rounded-full transition-colors ${userSavedItems.length >= 2 ? 'bg-amber-400' : 'bg-stone-700'}`} />
                <span className={`w-2 h-2 rounded-full transition-colors ${userSavedItems.length >= 3 ? 'bg-emerald-400' : 'bg-stone-700'}`} />
              </span>
              <span className="font-mono text-xs text-stone-300 font-medium tabular-nums">
                {Math.min(3, userSavedItems.length)} of 3 saved
              </span>
            </div>

            {userSavedItems.length < 3 ? (
              <>
                <p className="font-serif italic text-xs sm:text-sm text-stone-400 mb-5">
                  {userSavedItems.length === 0
                    ? 'Start with 3 things you want to consume this week.'
                    : `Save ${3 - userSavedItems.length} more ${3 - userSavedItems.length === 1 ? 'thing' : 'things'} to plan your week.`}
                </p>

                {/* Paste input bar */}
                <div className="w-full max-w-md mx-auto mb-4 bg-[#141414] rounded-full border border-stone-800 shadow-xl p-1.5 flex items-center gap-2">
                  <input
                    data-clarity-mask="True"
                    type="text"
                    placeholder="Paste a YouTube, article, podcast, or book link…"
                    value={pasteUrl}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    className="flex-1 pl-4 pr-2 py-2 bg-transparent text-xs sm:text-sm text-stone-100 placeholder:text-stone-500 focus:outline-hidden font-mono"
                  />
                  {isExtracting ? (
                    <div className="pr-3 text-stone-400 animate-pulse text-xs flex items-center gap-1 font-sans">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Fetching...</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSaveItem('inbox')}
                      disabled={!pasteUrl.trim() && !previewItem}
                      className="px-5 py-2 rounded-full text-xs font-medium text-black bg-white hover:opacity-90 transition-opacity disabled:opacity-30 cursor-pointer shadow-xs whitespace-nowrap"
                    >
                      Save
                    </button>
                  )}
                </div>

                {/* Quick Add buttons */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenAddModal('youtube')}
                    className="px-3.5 py-1.5 rounded-full text-xs font-sans text-stone-300 bg-stone-900 hover:bg-stone-800 border border-stone-800 transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5 text-stone-400" />
                    <span>+ Add a video</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenAddModal('article')}
                    className="px-3.5 py-1.5 rounded-full text-xs font-sans text-stone-300 bg-stone-900 hover:bg-stone-800 border border-stone-800 transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5 text-stone-400" />
                    <span>+ Add an article</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenAddModal('book')}
                    className="px-3.5 py-1.5 rounded-full text-xs font-sans text-stone-300 bg-stone-900 hover:bg-stone-800 border border-stone-800 transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5 text-stone-400" />
                    <span>+ Add a book</span>
                  </button>
                </div>
              </>
            ) : (
              /* 3 items reached: Offer "Your week is ready to plan." */
              <div className="animate-in fade-in duration-300 max-w-md mx-auto p-6 rounded-2xl bg-[#141414] border border-stone-800 shadow-2xl">
                <h3 className="font-serif text-xl sm:text-2xl font-normal text-stone-100 tracking-tight">
                  Your week is ready to plan.
                </h3>
                <p className="mt-2 text-xs sm:text-sm font-sans text-stone-400">
                  You've saved 3 items. Schedule them now to make time for what matters.
                </p>
                <div className="mt-6 flex items-center justify-center gap-4">
                  <button
                    type="button"
                    onClick={handleManualChoice}
                    className="text-xs font-sans text-stone-400 hover:text-stone-200 transition-colors cursor-pointer underline underline-offset-4"
                  >
                    I'll do it manually
                  </button>
                  <button
                    type="button"
                    onClick={handlePlanWeekChoice}
                    className="px-5 py-2.5 rounded-full text-xs font-medium text-black bg-white hover:opacity-90 transition-opacity cursor-pointer shadow-md flex items-center gap-1.5"
                  >
                    <span>Plan my week</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Quiet summary of saved items if any are saved */}
            {userSavedItems.length > 0 && (
              <div className="mt-8 pt-6 border-t border-stone-900 max-w-sm mx-auto text-left">
                <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 block mb-2 text-center">
                  Saved so far ({userSavedItems.length}/3)
                </span>
                <div className="space-y-1.5">
                  {userSavedItems.slice(0, 3).map((item) => (
                    <div
                      key={item.id}
                      className="px-3 py-1.5 rounded-lg bg-stone-900/60 border border-stone-850 flex items-center justify-between text-xs text-stone-300"
                    >
                      <span data-clarity-mask="True" className="truncate max-w-[240px] font-serif">{item.title}</span>
                      <span className="text-[10px] text-stone-500 font-mono capitalize shrink-0 ml-2">
                        {item.contentType}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[calc(100vh-61px)] overflow-hidden select-none bg-[#FAF9F6] dark:bg-[#0C0C0C]">
      {/* 
        --------------------------------------------------------
        TOP OVERLAY BAR: STRUCTURED UNDER THE LOGO & CONTROLS
        - Filters aligned directly under the logo on the left (Canvas view only)
        - In Grid view, filters are hidden per requirement
        - View switch & zoom controls aligned on the right
        --------------------------------------------------------
      */}
      <div className="absolute top-3 sm:top-4 left-0 right-0 z-20 pointer-events-none">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-4">
          {/* Left: Filters under Logo (only visible in Canvas mode) */}
          <div className="pointer-events-auto">
            {viewMode === 'canvas' ? (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
                {[
                  { id: 'all', label: 'All', count: counts.all },
                  { id: 'videos', label: 'Videos', count: counts.videos },
                  { id: 'articles', label: 'Articles', count: counts.articles },
                  { id: 'podcasts', label: 'Podcasts', count: counts.podcasts },
                  { id: 'books', label: 'Books', count: counts.books },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setActiveFilter(f.id)}
                    className={`px-3 py-1 rounded-full text-xs font-sans transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs font-medium border ${
                      activeFilter === f.id
                        ? 'bg-black text-white dark:bg-white dark:text-black border-transparent shadow-xs'
                        : 'bg-white/90 dark:bg-stone-900/90 text-stone-700 dark:text-stone-300 hover:text-stone-950 dark:hover:text-stone-100 hover:bg-white dark:hover:bg-stone-800 border-stone-200/90 dark:border-stone-800 backdrop-blur-md'
                    }`}
                  >
                    <span>{f.label}</span>
                    <span className="text-[10px] opacity-70 tabular-nums">({f.count})</span>
                  </button>
                ))}
              </div>
            ) : (
              <div />
            )}
          </div>

          {/* Right: View Switcher & Canvas Controls */}
          <div className="flex items-center gap-2 pointer-events-auto shrink-0">
            {/* Toggle Canvas vs Grid */}
            <div className="flex items-center p-0.5 rounded-full bg-white/90 dark:bg-stone-900/90 backdrop-blur-md border border-stone-200/60 dark:border-stone-800 shadow-2xs">
              <button
                onClick={() => setViewMode('canvas')}
                title="Cosmos Visual Canvas"
                className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                  viewMode === 'canvas'
                    ? 'bg-black text-white dark:bg-white dark:text-black'
                    : 'text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                title="Categorized Grid View"
                className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-black text-white dark:bg-white dark:text-black'
                    : 'text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Zoom & Fit Controls (Active in Canvas mode) */}
            {viewMode === 'canvas' && (
              <div className="hidden sm:flex items-center gap-1 px-1.5 py-1 rounded-full bg-white/90 dark:bg-stone-900/90 backdrop-blur-md border border-stone-200/60 dark:border-stone-800 shadow-2xs text-xs">
                <button
                  onClick={() => {
                    const nz = Math.max(0.4, zoom - 0.15);
                    setZoom(nz);
                    setPan((p) => clampPan(p, nz));
                  }}
                  title="Zoom out (-)"
                  className="p-1 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono text-[10px] text-stone-400 w-8 text-center tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => {
                    const nz = Math.min(1.6, zoom + 0.15);
                    setZoom(nz);
                    setPan((p) => clampPan(p, nz));
                  }}
                  title="Zoom in (+)"
                  className="p-1 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleRecenter}
                  title="Center canvas"
                  className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-sans text-stone-500 hover:text-black dark:hover:text-white transition-colors cursor-pointer"
                >
                  Center
                </button>
                <button
                  onClick={handleFitAll}
                  title="Fit all on screen"
                  className="px-2 py-0.5 rounded-full text-[10px] font-sans text-stone-500 hover:text-black dark:hover:text-white transition-colors cursor-pointer"
                >
                  Fit
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 
        ========================================================
        MODE A: COSMOS VISUAL CANVAS (Default - Matching user image)
        ========================================================
      */}
      {viewMode === 'canvas' ? (
        <div
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
          className={`absolute inset-0 w-full h-full overflow-hidden ${
            isPanning ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{
            backgroundImage: `radial-gradient(circle, rgba(120, 113, 108, 0.22) 1.2px, transparent 1.2px)`,
            backgroundSize: '36px 36px',
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        >
          {/* Spatial World Container */}
          <div
            className="absolute top-1/2 left-1/2 transform-gpu will-change-transform"
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              transition: isPanning ? 'none' : 'transform 0.12s ease-out',
            }}
          >
            {/* 
              --------------------------------------------------------
              HERO ETHOS (Centered headline & brand statement in universe)
              --------------------------------------------------------
            */}
            <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none select-none z-10 w-[380px] sm:w-[540px] md:w-[620px] max-w-[92vw] px-4">
              <span className="block text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.22em] text-stone-400 dark:text-stone-500 mb-2">
                your endless visual universe
              </span>
              <h1 className="font-serif text-3xl sm:text-4xl lg:text-[42px] font-normal text-stone-900/90 dark:text-stone-100/90 tracking-tight leading-snug">
                Everything worth exploring. On your schedule.
              </h1>
              <p className="mt-3 font-serif italic text-xs sm:text-sm text-stone-500 dark:text-stone-400 max-w-md mx-auto leading-relaxed">
                Save YouTube videos, articles, podcasts and books, then plan when you'll actually consume them.
              </p>

              {/* Empty state when 0 items saved */}
              {activeItems.length === 0 && (
                <div className="mt-5 pointer-events-auto">
                  <p className="font-serif italic text-xs sm:text-sm text-stone-600 dark:text-stone-300 mb-3">
                    Start with 3 things you want to consume this week.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenAddModal('youtube')}
                      className="px-3.5 py-1.5 rounded-full text-xs font-sans text-stone-800 dark:text-stone-200 bg-white/90 dark:bg-stone-850/90 hover:bg-stone-100 dark:hover:bg-stone-800 border border-stone-200/80 dark:border-stone-700 transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5 font-medium"
                    >
                      <Plus className="w-3.5 h-3.5 text-stone-500" />
                      <span>Add a video</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenAddModal('article')}
                      className="px-3.5 py-1.5 rounded-full text-xs font-sans text-stone-800 dark:text-stone-200 bg-white/90 dark:bg-stone-850/90 hover:bg-stone-100 dark:hover:bg-stone-800 border border-stone-200/80 dark:border-stone-700 transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5 font-medium"
                    >
                      <Plus className="w-3.5 h-3.5 text-stone-500" />
                      <span>Add an article</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenAddModal('book')}
                      className="px-3.5 py-1.5 rounded-full text-xs font-sans text-stone-800 dark:text-stone-200 bg-white/90 dark:bg-stone-850/90 hover:bg-stone-100 dark:hover:bg-stone-800 border border-stone-200/80 dark:border-stone-700 transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5 font-medium"
                    >
                      <Plus className="w-3.5 h-3.5 text-stone-500" />
                      <span>Add a book</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 
              --------------------------------------------------------
              FLOATING VISUAL CARDS (Categorized in space, non-draggable, no overlap)
              --------------------------------------------------------
            */}
            {filteredItems.map((item) => {
              const pos = itemPositions.get(item.id) || { x: 0, y: 0 };

              return (
                <div
                  key={item.id}
                  className="cosmos-card-interactive absolute -translate-x-1/2 -translate-y-1/2 w-64 sm:w-72 transition-transform duration-200 hover:scale-103 hover:z-30 cursor-pointer pointer-events-auto"
                  style={{
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isPanning) {
                      onSelectCard(item);
                    }
                  }}
                >
                  <ContentCard
                    item={item}
                    onSelect={onSelectCard}
                    onToggleComplete={onToggleComplete}
                    onTogglePriority={onTogglePriority}
                    onUpdateDuration={onUpdateDuration}
                    variant="visual"
                    disableDrag={true}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* 
          ========================================================
          MODE B: CATEGORIZED GRID VIEW ("categories inserted in grid")
          ========================================================
        */
        <div className="w-full h-full overflow-y-auto px-4 sm:px-8 py-8 sm:py-12 max-w-7xl mx-auto pb-36">
          {/* Header in Grid Mode */}
          <div className="pb-8 mb-8 border-b border-stone-200/50 dark:border-stone-850">
            <span className="text-xs font-mono tracking-widest text-stone-500 dark:text-stone-400 uppercase">
              Categorized Library
            </span>
            <h2 className="font-serif text-2xl sm:text-3xl font-normal text-stone-900 dark:text-stone-100 mt-1">
              Everything worth exploring. On your schedule.
            </h2>
            <p className="font-serif italic text-xs sm:text-sm text-stone-500 dark:text-stone-400 mt-1">
              Organized by medium for intentional consumption.
            </p>
          </div>

          {activeItems.length === 0 ? (
            <div className="py-16 text-center max-w-md mx-auto">
              <p className="font-serif italic text-stone-600 dark:text-stone-300 text-sm mb-4">
                Start with 3 things you want to consume this week.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenAddModal('youtube')}
                  className="px-3.5 py-1.5 rounded-full text-xs font-sans text-stone-800 dark:text-stone-200 bg-white dark:bg-stone-850 hover:bg-stone-100 dark:hover:bg-stone-800 border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5 text-stone-500" />
                  <span>Add a video</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAddModal('article')}
                  className="px-3.5 py-1.5 rounded-full text-xs font-sans text-stone-800 dark:text-stone-200 bg-white dark:bg-stone-850 hover:bg-stone-100 dark:hover:bg-stone-800 border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5 text-stone-500" />
                  <span>Add an article</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAddModal('book')}
                  className="px-3.5 py-1.5 rounded-full text-xs font-sans text-stone-800 dark:text-stone-200 bg-white dark:bg-stone-850 hover:bg-stone-100 dark:hover:bg-stone-800 border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5 text-stone-500" />
                  <span>Add a book</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-12">
              {visibleCategories.map((cat) => {
                const catItems = activeItems.filter(cat.filterFn);
                const Icon = cat.icon;

                if (catItems.length === 0 && activeFilter === 'all') {
                  return null;
                }

                return (
                  <section key={cat.id} className="relative">
                    <div className="flex items-center justify-between pb-3.5 mb-5 border-b border-stone-200/60 dark:border-stone-850">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-stone-100 dark:bg-stone-850 flex items-center justify-center text-stone-600 dark:text-stone-300">
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-serif text-lg font-medium text-stone-900 dark:text-stone-100 tracking-tight">
                              {cat.label}
                            </h3>
                            <span className="text-xs font-mono text-stone-400 dark:text-stone-500 tabular-nums">
                              {catItems.length}
                            </span>
                          </div>
                          <p className="text-[11px] font-sans text-stone-400 dark:text-stone-500">
                            {cat.kicker}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onOpenAddModal(cat.contentType)}
                        className="px-3 py-1 rounded-full text-xs font-sans text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-850 border border-stone-200/60 dark:border-stone-800 transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <Plus className="w-3 h-3 text-stone-400" />
                        <span>Add {cat.singularLabel}</span>
                      </button>
                    </div>

                    {catItems.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {catItems.map((item) => (
                          <ContentCard
                            key={item.id}
                            item={item}
                            onSelect={onSelectCard}
                            onToggleComplete={onToggleComplete}
                            onTogglePriority={onTogglePriority}
                            onUpdateDuration={onUpdateDuration}
                            variant="visual"
                            disableDrag={true}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="py-8 text-center border border-dashed border-stone-200 dark:border-stone-800 rounded-xl bg-stone-50/50 dark:bg-stone-900/30">
                        <p className="text-xs text-stone-500 font-serif italic mb-2">
                          No {cat.label.toLowerCase()} saved yet.
                        </p>
                        <button
                          type="button"
                          onClick={() => onOpenAddModal(cat.contentType)}
                          className="text-xs font-sans text-stone-700 dark:text-stone-300 underline underline-offset-4 hover:text-black dark:hover:text-white cursor-pointer"
                        >
                          + Add a {cat.singularLabel}
                        </button>
                      </div>
                    )}
                  </section>
                );
              })}

              {/* Other items if present */}
              {(activeFilter === 'all' || activeFilter === 'other') && otherItems.length > 0 && (
                <section className="relative">
                  <div className="flex items-center justify-between pb-3.5 mb-5 border-b border-stone-200/60 dark:border-stone-850">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-stone-100 dark:bg-stone-850 flex items-center justify-center text-stone-600 dark:text-stone-300">
                        <Bookmark className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-serif text-lg font-medium text-stone-900 dark:text-stone-100 tracking-tight">
                            Other Items
                          </h3>
                          <span className="text-xs font-mono text-stone-400 dark:text-stone-500 tabular-nums">
                            {otherItems.length}
                          </span>
                        </div>
                        <p className="text-[11px] font-sans text-stone-400 dark:text-stone-500">
                          Links, ideas, and notes
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenAddModal('other')}
                      className="px-3 py-1 rounded-full text-xs font-sans text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-850 border border-stone-200/60 dark:border-stone-800 transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <Plus className="w-3 h-3 text-stone-400" />
                      <span>Add item</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {otherItems.map((item) => (
                      <ContentCard
                        key={item.id}
                        item={item}
                        onSelect={onSelectCard}
                        onToggleComplete={onToggleComplete}
                        onTogglePriority={onTogglePriority}
                        onUpdateDuration={onUpdateDuration}
                        variant="visual"
                        disableDrag={true}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      )}

      {/* 
        --------------------------------------------------------
        FLOATING BOTTOM HUD: FAST PASTE BAR
        --------------------------------------------------------
      */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-xl px-4 pointer-events-auto">
        <div className="relative bg-white/95 dark:bg-[#141414]/95 backdrop-blur-xl rounded-full border border-stone-200/80 dark:border-stone-800 shadow-xl p-1.5 flex items-center gap-2">
          <input
            data-clarity-mask="True"
            type="text"
            placeholder="Paste a YouTube, article, podcast, or book link…"
            value={pasteUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            className="flex-1 pl-4 pr-2 py-2 bg-transparent text-xs sm:text-sm text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-hidden font-mono"
          />

          {isExtracting ? (
            <div className="pr-3 text-stone-400 animate-pulse text-xs flex items-center gap-1 font-sans">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Fetching...</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleSaveItem('inbox')}
              disabled={!pasteUrl.trim() && !previewItem}
              className="px-5 py-2 rounded-full text-xs font-medium text-white bg-black dark:bg-white dark:text-black hover:opacity-85 transition-opacity disabled:opacity-30 cursor-pointer shadow-2xs whitespace-nowrap"
            >
              Save
            </button>
          )}
        </div>

        {/* Live Preview Dropdown when link is pasted */}
        {previewItem && (
          <div className="mt-2.5 p-3 rounded-2xl bg-white/95 dark:bg-[#181818]/95 backdrop-blur-xl border border-stone-200 dark:border-stone-800 shadow-2xl flex items-center justify-between gap-3 text-left animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-16 aspect-16/10 rounded-lg overflow-hidden bg-stone-900 shrink-0">
                <img
                  src={previewItem.thumbnailUrl}
                  alt={previewItem.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <span className="text-[9px] font-sans text-stone-400 uppercase tracking-widest">
                  {CONTENT_TYPE_CONFIG[previewItem.contentType]?.label}
                </span>
                <h4 data-clarity-mask="True" className="font-serif text-xs font-medium text-stone-900 dark:text-stone-100 truncate mt-0.5">
                  {previewItem.title}
                </h4>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => handleSaveItem('inbox')}
                className="px-3 py-1 rounded-full text-xs font-sans text-stone-600 dark:text-stone-300 hover:text-black dark:hover:text-white bg-stone-100 dark:bg-stone-800 cursor-pointer"
              >
                Library
              </button>
              <button
                onClick={() => handleSaveItem('planned')}
                className="px-3 py-1 rounded-full text-xs font-medium text-white bg-black dark:bg-white dark:text-black cursor-pointer"
              >
                Today
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
