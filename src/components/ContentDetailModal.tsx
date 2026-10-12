import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  ExternalLink,
  Clock,
  Calendar,
  Check,
  Trash2,
  Inbox,
  Bookmark,
  Play,
  Image as ImageIcon,
  Upload,
  Plus,
  Maximize2,
  Sparkles,
  Timer,
  Star,
  Edit3,
  RefreshCw,
} from 'lucide-react';
import { ContentItem, ContentStatus, ContentType, CONTENT_TYPE_CONFIG } from '../types';
import { extractYouTubeId, refetchItemMetadata } from '../lib/metadataExtractor';
import { formatDuration } from '../lib/timeAccounting';
import { trackEvent } from '../lib/analytics';
import { DurationChips, DurationBadgeWithPicker } from './DurationEditor';
import { getDataStore } from '../lib/dataStore';

interface ContentDetailModalProps {
  item: ContentItem | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<ContentItem>) => void;
  onDelete: (id: string) => void;
  onUpdateDuration?: (id: string, durationMinutes: number) => void;
}

export const ContentDetailModal: React.FC<ContentDetailModalProps> = ({
  item,
  isOpen,
  onClose,
  onUpdate,
  onDelete,
  onUpdateDuration,
}) => {
  const [notes, setNotes] = useState('');
  const [keyTakeaway, setKeyTakeaway] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [status, setStatus] = useState<ContentStatus>('planned');
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [activeMediaView, setActiveMediaView] = useState<'video' | 'cover'>('video');
  const [zoomScreenshot, setZoomScreenshot] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit details panel states
  const [editTitle, setEditTitle] = useState('');
  const [editType, setEditType] = useState<ContentType>('article');
  const [editSource, setEditSource] = useState('');
  const [refetchMessage, setRefetchMessage] = useState<string | null>(null);
  const [isRefetching, setIsRefetching] = useState(false);

  const ytId = item?.url ? extractYouTubeId(item.url) : null;
  const isYouTube = !!ytId;

  // Spotify podcast embed detection
  const spotifyEmbedUrl = item?.url?.includes('open.spotify.com')
    ? item.url.replace('open.spotify.com/', 'open.spotify.com/embed/')
    : null;

  useEffect(() => {
    if (item) {
      setNotes(item.notes || '');
      setKeyTakeaway(item.keyTakeaway || '');
      setScheduledDate(item.scheduledDate || '');
      setStatus(item.status);
      setScreenshots(item.screenshots || []);
      setImageError(false);
      setEditTitle(item.title || '');
      setEditType(item.contentType || 'article');
      setEditSource(item.source || item.author || item.platform || '');
      setRefetchMessage(null);
      // Default to video embed if YouTube, else cover
      setActiveMediaView(ytId || spotifyEmbedUrl ? 'video' : 'cover');
    }
  }, [item, ytId, spotifyEmbedUrl]);

  // Support pasting screenshots directly from clipboard (Cmd+V / Ctrl+V)
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      const clipboardItems = e.clipboardData?.items;
      if (!clipboardItems) return;

      for (let i = 0; i < clipboardItems.length; i++) {
        const clipItem = clipboardItems[i];
        if (clipItem.type.indexOf('image') !== -1) {
          const file = clipItem.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = async (event) => {
              const base64 = event.target?.result as string;
              if (base64 && item) {
                const shotKey = `shot_${item.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
                const ref = await getDataStore().saveMedia(shotKey, base64);
                setScreenshots((prev) => {
                  const updated = [...prev, ref];
                  onUpdate(item.id, { screenshots: updated });
                  return updated;
                });
              }
            };
            reader.readAsDataURL(file);
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, item, onUpdate]);

  if (!isOpen || !item) return null;

  const handleDurationEdit = (minutes: number) => {
    if (!item) return;
    const wasEstimate = item.durationIsEstimate !== false;
    const currentEdited = new Set([
      ...(item.userEditedFields || []),
      ...(item.editedFields || []),
      'durationMinutes',
    ]);
    const fields = Array.from(currentEdited);

    onUpdate(item.id, {
      durationMinutes: minutes,
      durationIsEstimate: false,
      userEditedFields: fields,
      editedFields: fields,
    });

    onUpdateDuration?.(item.id, minutes);

    trackEvent('duration_edited', {
      type: item.contentType,
      wasEstimate,
    });
  };

  const handleTitleChange = (newTitle: string) => {
    setEditTitle(newTitle);
    if (!item) return;
    const currentEdited = new Set([
      ...(item.userEditedFields || []),
      ...(item.editedFields || []),
      'title',
    ]);
    const fields = Array.from(currentEdited);
    onUpdate(item.id, {
      title: newTitle,
      userEditedFields: fields,
      editedFields: fields,
    });
  };

  const handleTypeChange = (newType: ContentType) => {
    setEditType(newType);
    if (!item) return;
    const currentEdited = new Set([
      ...(item.userEditedFields || []),
      ...(item.editedFields || []),
      'contentType',
    ]);
    const fields = Array.from(currentEdited);
    onUpdate(item.id, {
      contentType: newType,
      userEditedFields: fields,
      editedFields: fields,
    });
  };

  const handleSourceChange = (newSource: string) => {
    setEditSource(newSource);
    if (!item) return;
    const currentEdited = new Set([
      ...(item.userEditedFields || []),
      ...(item.editedFields || []),
      'source',
    ]);
    const fields = Array.from(currentEdited);
    onUpdate(item.id, {
      source: newSource,
      platform: newSource,
      author: newSource,
      userEditedFields: fields,
      editedFields: fields,
    });
  };

  const handleRefetch = async () => {
    if (!item || !item.url) return;
    setIsRefetching(true);
    setRefetchMessage(null);
    try {
      const updated = await refetchItemMetadata(item);
      onUpdate(item.id, updated);
      setEditTitle(updated.title);
      setEditType(updated.contentType);
      setEditSource(updated.source || updated.author || updated.platform || '');
      setRefetchMessage('Metadata refetched from URL. Your custom edits were preserved.');
      setTimeout(() => setRefetchMessage(null), 4000);
    } catch {
      setRefetchMessage('Could not refetch metadata from URL.');
      setTimeout(() => setRefetchMessage(null), 4000);
    } finally {
      setIsRefetching(false);
    }
  };

  const typeConfig = CONTENT_TYPE_CONFIG[item.contentType] || CONTENT_TYPE_CONFIG.other;

  const handleSaveFields = () => {
    onUpdate(item.id, {
      notes: notes.trim() || undefined,
      keyTakeaway: keyTakeaway.trim() || undefined,
      scheduledDate: status === 'inbox' ? undefined : (scheduledDate || undefined),
      status,
      screenshots,
    });
  };

  const handleStatusChange = (newStatus: ContentStatus) => {
    setStatus(newStatus);
    onUpdate(item.id, {
      status: newStatus,
      completedAt: newStatus === 'completed' ? new Date().toISOString() : undefined,
      scheduledDate: newStatus === 'inbox' ? undefined : item.scheduledDate,
    });
  };

  const handleMoveToInbox = () => {
    setStatus('inbox');
    onUpdate(item.id, {
      status: 'inbox',
      scheduledDate: undefined,
    });
    onClose();
  };

  const handleDelete = () => {
    if (window.confirm('Remove this item from your planner?')) {
      onDelete(item.id);
      onClose();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      if (base64 && item) {
        const shotKey = `shot_${item.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const ref = await getDataStore().saveMedia(shotKey, base64);
        setScreenshots((prev) => {
          const updated = [...prev, ref];
          onUpdate(item.id, { screenshots: updated });
          return updated;
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteScreenshot = (index: number) => {
    const targetShot = screenshots[index];
    if (targetShot) {
      getDataStore().deleteMedia(targetShot);
    }
    setScreenshots((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      onUpdate(item.id, { screenshots: updated });
      return updated;
    });
  };

  const handleInsertTimestamp = () => {
    const stamp = `\n[00:00] `;
    setNotes((prev) => prev + stamp);
  };

  const isCompleted = status === 'completed';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/70 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-[#FAF8F5] dark:bg-[#181716] rounded-3xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden my-4 flex flex-col max-h-[94vh]">
        {/* Top Header Bar */}
        <div className="px-5 py-3.5 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between bg-stone-100/60 dark:bg-stone-900/60">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-stone-600 dark:text-stone-400">
              {typeConfig.icon} {typeConfig.label}
            </span>
            {item.platform && (
              <>
                <span className="text-stone-300 dark:text-stone-700">·</span>
                <span className="text-xs font-medium text-stone-700 dark:text-stone-300 font-sans">
                  {item.platform}
                </span>
              </>
            )}
            {item.topic && (
              <>
                <span className="text-stone-300 dark:text-stone-700">·</span>
                <span className="text-xs font-medium text-amber-900 dark:text-amber-300 font-sans">
                  {item.topic}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Priority Toggle */}
            <button
              type="button"
              onClick={() => {
                onUpdate(item.id, { isPriority: !item.isPriority });
              }}
              title={item.isPriority ? 'Remove high priority' : 'Mark as high priority'}
              className={`p-1.5 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-sans font-medium cursor-pointer ${
                item.isPriority
                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${item.isPriority ? 'fill-current text-amber-500' : ''}`} />
              <span className="hidden sm:inline">{item.isPriority ? 'Priority' : 'Star'}</span>
            </button>

            {item.url && (
              <a
                data-clarity-mask="True"
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in new tab"
                className="p-1.5 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 rounded-lg transition-colors flex items-center gap-1 text-xs"
              >
                <span className="hidden sm:inline">Open Original</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <button
              onClick={handleDelete}
              title="Delete item"
              className="p-1.5 text-stone-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            <button
              onClick={() => {
                handleSaveFields();
                onClose();
              }}
              className="p-1.5 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
          {/* MEDIA VIEWER: EMBEDDED VIDEO OR THUMBNAIL POSTER */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isYouTube && (
                  <div className="inline-flex rounded-xl bg-stone-200/80 dark:bg-stone-800 p-0.5 border border-stone-300 dark:border-stone-700">
                    <button
                      type="button"
                      onClick={() => setActiveMediaView('video')}
                      className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                        activeMediaView === 'video'
                          ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-2xs'
                          : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
                      }`}
                    >
                      <Play className="w-3 h-3 fill-current text-red-600" />
                      <span>Watch Embedded Video</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveMediaView('cover')}
                      className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                        activeMediaView === 'cover'
                          ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-2xs'
                          : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
                      }`}
                    >
                      <ImageIcon className="w-3 h-3" />
                      <span>Thumbnail Poster</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-xs font-mono text-stone-500">
                <Clock className="w-3.5 h-3.5 text-stone-400" />
                <span>Duration:</span>
                <DurationBadgeWithPicker
                  item={item}
                  onUpdateDuration={(_, mins) => handleDurationEdit(mins)}
                  className="font-semibold text-stone-700 dark:text-stone-300"
                />
              </div>
            </div>

            {/* Embedded Video Player or Thumbnail Frame */}
            <div className="relative w-full aspect-16/9 rounded-2xl overflow-hidden bg-black shadow-md border border-stone-200 dark:border-stone-800">
              {isYouTube && activeMediaView === 'video' ? (
                /* YouTube Embedded Player */
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${ytId}?rel=0&autoplay=0&enablejsapi=1`}
                  title={item.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="w-full h-full border-0"
                />
              ) : spotifyEmbedUrl && activeMediaView === 'video' ? (
                /* Spotify Podcast Embedded Player */
                <iframe
                  src={spotifyEmbedUrl}
                  title={item.title}
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full border-0"
                />
              ) : (
                /* Visual Poster Showcase */
                <div className="relative w-full h-full">
                  {!imageError && item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      onError={() => setImageError(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-stone-900 text-white">
                      <span className="font-serif text-xl italic">{item.title}</span>
                      <span className="text-xs text-stone-400 mt-2 font-mono">{item.platform}</span>
                    </div>
                  )}

                  {isYouTube && (
                    <button
                      onClick={() => setActiveMediaView('video')}
                      className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-red-600/90 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-transform hover:scale-110 cursor-pointer"
                      title="Play video here"
                    >
                      <Play className="w-8 h-8 fill-current ml-1" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Title & Attribution Header */}
          <div>
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold leading-tight text-stone-900 dark:text-stone-50 text-balance">
              {item.title}
            </h2>

            <div className="mt-2 flex flex-wrap items-center gap-y-1 gap-x-2 text-xs text-stone-600 dark:text-stone-300 font-sans">
              {(item.source || item.author || item.platform) && (
                <span className="font-semibold text-stone-900 dark:text-stone-100">
                  {item.source || item.author || item.platform}
                </span>
              )}
              {item.scheduledDate && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-1 text-amber-900 dark:text-amber-300 font-mono">
                    <Calendar className="w-3 h-3" />
                    <span>Scheduled: {item.scheduledDate}</span>
                  </span>
                </>
              )}
            </div>
          </div>

          {/* EDIT DETAILS PANEL (Requirement 3: title, type, source, duration; edited fields never overwritten by metadata refetches) */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100 dark:border-stone-850">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-stone-500" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-800 dark:text-stone-200">
                  Edit Details
                </h3>
                {item.durationIsEstimate !== false ? (
                  <span className="text-[10px] font-mono text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800">
                    est. duration
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                    user edited
                  </span>
                )}
              </div>

              {item.url && (
                <button
                  type="button"
                  onClick={handleRefetch}
                  disabled={isRefetching}
                  className="flex items-center gap-1.5 text-[11px] font-sans text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 px-2.5 py-1 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-850 transition-colors cursor-pointer disabled:opacity-50"
                  title="Refetch metadata from URL (keeps your custom edits)"
                >
                  <RefreshCw className={`w-3 h-3 ${isRefetching ? 'animate-spin' : ''}`} />
                  <span>Refetch metadata</span>
                </button>
              )}
            </div>

            {refetchMessage && (
              <div className="text-xs font-sans px-3 py-1.5 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300">
                {refetchMessage}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Title input */}
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-mono text-stone-500 uppercase tracking-wider mb-1">
                  Title
                </label>
                <input
                  data-clarity-mask="True"
                  type="text"
                  value={editTitle}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="Content title..."
                  className="w-full px-3 py-2 text-sm rounded-xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 focus:outline-hidden focus:ring-1 focus:ring-stone-400 font-serif"
                />
              </div>

              {/* Type selector */}
              <div>
                <label className="block text-[11px] font-mono text-stone-500 uppercase tracking-wider mb-1">
                  Type
                </label>
                <select
                  value={editType}
                  onChange={(e) => handleTypeChange(e.target.value as ContentType)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 focus:outline-hidden focus:ring-1 focus:ring-stone-400 font-sans cursor-pointer capitalize"
                >
                  {(['youtube', 'podcast', 'article', 'book', 'course', 'documentary', 'other'] as ContentType[]).map((t) => (
                    <option key={t} value={t}>
                      {CONTENT_TYPE_CONFIG[t]?.label || t}
                    </option>
                  ))}
                </select>
              </div>

              {/* Source input */}
              <div>
                <label className="block text-[11px] font-mono text-stone-500 uppercase tracking-wider mb-1">
                  Source / Creator
                </label>
                <input
                  data-clarity-mask="True"
                  type="text"
                  value={editSource}
                  onChange={(e) => handleSourceChange(e.target.value)}
                  placeholder="e.g. YouTube, Harvard Business Review..."
                  className="w-full px-3 py-2 text-xs rounded-xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 focus:outline-hidden focus:ring-1 focus:ring-stone-400 font-sans"
                />
              </div>

              {/* Duration with 1-tap chips & custom field */}
              <div className="sm:col-span-2 pt-1 border-t border-stone-100 dark:border-stone-850">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-mono text-stone-500 uppercase tracking-wider">
                    Duration ({formatDuration(item.durationMinutes) || 'Not set'}{item.durationIsEstimate !== false ? ' est.' : ''})
                  </label>
                  <span className="text-[10px] font-sans text-stone-400">
                    One-tap editing sets duration & recalculates totals
                  </span>
                </div>
                <DurationChips
                  currentMinutes={item.durationMinutes}
                  onSelectDuration={handleDurationEdit}
                />
              </div>
            </div>
          </div>

          {/* KEY TAKEAWAYS (High-Visibility Section) */}
          <div className="p-4 sm:p-5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-800/60 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-amber-950 dark:text-amber-200 flex items-center gap-1.5 uppercase tracking-wide font-sans">
                <Bookmark className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                <span>Key Takeaways & Core Insights</span>
              </label>
              <span className="text-[11px] text-amber-800/80 dark:text-amber-300/80 font-serif italic">
                What stuck with you?
              </span>
            </div>

            <textarea
              data-clarity-mask="True"
              rows={2}
              value={keyTakeaway}
              onChange={(e) => setKeyTakeaway(e.target.value)}
              onBlur={handleSaveFields}
              placeholder="e.g. 1. The creative asset does 80% of algorithmic targeting. 2. Price anchoring shifts perceived reference points..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-stone-900 border border-amber-300/70 dark:border-amber-800/70 text-stone-900 dark:text-stone-100 text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-500/50 leading-relaxed font-serif"
            />
          </div>

          {/* PERSONAL NOTES & TIMESTAMPS */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5 uppercase tracking-wide font-sans">
                <span>Personal Notes & Outlines</span>
              </label>

              {isYouTube && (
                <button
                  type="button"
                  onClick={handleInsertTimestamp}
                  className="flex items-center gap-1 text-[11px] font-mono text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200 px-2 py-0.5 rounded-md bg-stone-200/60 dark:bg-stone-800 transition-colors cursor-pointer"
                >
                  <Timer className="w-3 h-3" />
                  <span>+ Add Timestamp</span>
                </button>
              )}
            </div>

            <textarea
              data-clarity-mask="True"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleSaveFields}
              placeholder="Detailed notes, timestamps, quotes, or thoughts while watching or reading..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-700 text-stone-900 dark:text-stone-100 text-sm focus:outline-hidden focus:ring-2 focus:ring-stone-400 font-sans leading-relaxed"
            />
          </div>

          {/* SCREENSHOTS GALLERY & PASTE ZONE */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5 uppercase tracking-wide font-sans">
                  <ImageIcon className="w-4 h-4 text-stone-600 dark:text-stone-400" />
                  <span>Screenshots & Visual Captures ({screenshots.length})</span>
                </label>
                <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 font-sans">
                  💡 You can paste a screenshot directly anytime using <kbd className="px-1 py-0.2 rounded bg-stone-200 dark:bg-stone-800 font-mono text-[10px]">Ctrl+V</kbd> / <kbd className="px-1 py-0.2 rounded bg-stone-200 dark:bg-stone-800 font-mono text-[10px]">⌘V</kbd>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-stone-800 dark:text-stone-200 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Image</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>
            </div>

            {/* Screenshots Grid */}
            {screenshots.length === 0 ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="p-6 border-2 border-dashed border-stone-300 dark:border-stone-700 rounded-2xl text-center bg-stone-50/50 dark:bg-stone-900/30 hover:bg-stone-100/50 cursor-pointer transition-colors"
              >
                <ImageIcon className="w-8 h-8 mx-auto text-stone-400 mb-2 stroke-[1.5]" />
                <p className="text-xs font-medium text-stone-700 dark:text-stone-300">
                  No screenshots captured yet.
                </p>
                <p className="text-[11px] text-stone-400 mt-0.5">
                  Take a screenshot on your device, then press <kbd className="font-mono">⌘V / Ctrl+V</kbd> to paste it here, or click to upload.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {screenshots.map((shot, idx) => (
                  <div
                    key={idx}
                    className="group relative aspect-16/10 rounded-xl overflow-hidden bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xs cursor-pointer"
                  >
                    <img
                      src={getDataStore().getMediaSync(shot) || shot}
                      alt={`Screenshot ${idx + 1}`}
                      onClick={() => setZoomScreenshot(getDataStore().getMediaSync(shot) || shot)}
                      className="w-full h-full object-cover transition-transform group-hover:scale-104"
                    />

                    {/* Overlay controls */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setZoomScreenshot(getDataStore().getMediaSync(shot) || shot)}
                        className="p-1.5 rounded-full bg-white/90 text-stone-900 hover:scale-110 transition-transform"
                        title="View Fullscreen"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteScreenshot(idx);
                        }}
                        className="p-1.5 rounded-full bg-red-600 text-white hover:scale-110 transition-transform"
                        title="Delete Screenshot"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* STATUS & SCHEDULE ROW */}
          <div className="p-4 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {/* Status Switcher */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-stone-500">Status:</span>
              <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-stone-950 rounded-xl">
                {(['inbox', 'planned', 'in_progress', 'completed'] as ContentStatus[]).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => handleStatusChange(st)}
                    className={`px-3 py-1 text-xs font-medium capitalize rounded-lg transition-all ${
                      status === st
                        ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-2xs font-semibold'
                        : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-300'
                    }`}
                  >
                    {st === 'in_progress' ? 'In Progress' : st}
                  </button>
                ))}
              </div>
            </div>

            {/* Target Date */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-stone-500">Scheduled:</span>
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => {
                  setScheduledDate(e.target.value);
                  if (status === 'inbox') setStatus('planned');
                  onUpdate(item.id, {
                    scheduledDate: e.target.value,
                    status: status === 'inbox' ? 'planned' : status,
                  });
                }}
                className="px-3 py-1 rounded-lg bg-stone-50 dark:bg-stone-950 border border-stone-300 dark:border-stone-700 text-xs font-mono"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between bg-stone-100/60 dark:bg-stone-900/60">
          <button
            onClick={() => handleStatusChange(isCompleted ? 'planned' : 'completed')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
              isCompleted
                ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 border border-emerald-300'
                : 'bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 text-stone-800 dark:text-stone-200 hover:bg-stone-100'
            }`}
          >
            <Check className="w-4 h-4" />
            <span>{isCompleted ? 'Completed' : 'Mark as Completed'}</span>
          </button>

          <button
            onClick={() => {
              handleSaveFields();
              onClose();
            }}
            className="px-5 py-2 rounded-xl text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 dark:bg-amber-600 dark:hover:bg-amber-500 transition-colors shadow-xs cursor-pointer"
          >
            Save & Close
          </button>
        </div>
      </div>

      {/* Fullscreen Screenshot Zoom Lightbox */}
      {zoomScreenshot && (
        <div
          className="fixed inset-0 z-60 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setZoomScreenshot(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh]">
            <img
              src={getDataStore().getMediaSync(zoomScreenshot) || zoomScreenshot}
              alt="Zoomed Screenshot"
              className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl"
            />
            <button
              onClick={() => setZoomScreenshot(null)}
              className="absolute top-3 right-3 p-2 rounded-full bg-black/70 text-white hover:bg-black transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
