import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Trash2,
  Power,
  ChevronLeft,
  ChevronRight,
  Link2,
  AlertCircle,
  Eye,
} from 'lucide-react';
import { ContentItem, CONTENT_TYPE_CONFIG } from '../types';
import {
  SharedWeekRecord,
  createSharedWeekSnapshot,
  publishSharedWeek,
  toggleShareActive,
  deleteSharedWeek,
  getLocalSharedWeeks,
} from '../lib/shareWeek';
import { getWeekDates } from '../lib/dateUtils';
import { trackEvent } from '../lib/analytics';

interface ShareWeekModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentDate: Date;
  items: ContentItem[];
  userId?: string;
  onDateChange?: (date: Date) => void;
}

function formatItemDuration(mins?: number): string {
  if (!mins || mins <= 0) return '0 min';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

function formatPlannedTotal(mins: number): string {
  if (mins <= 0) return '0m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDayParts(dateStr: string): { dayName: string; dateLabel: string } {
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      return {
        dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      };
    }
  } catch {}
  return { dayName: 'Day', dateLabel: dateStr };
}

function getPosterColor(type: string, id: string): string {
  switch (type) {
    case 'youtube':
      return 'bg-[#9E3922]'; // Warm terracotta / rust
    case 'article':
      return 'bg-[#185334]'; // Forest green
    case 'book':
      return 'bg-[#8F4318]'; // Copper leather
    case 'podcast':
      return 'bg-[#1C3E7B]'; // Deep cobalt
    default: {
      const palette = ['bg-[#9E3922]', 'bg-[#185334]', 'bg-[#1C3E7B]', 'bg-[#8F4318]', 'bg-[#0B543D]'];
      const charCode = id.charCodeAt(id.length - 1) || 0;
      return palette[charCode % palette.length];
    }
  }
}

export const ShareWeekModal: React.FC<ShareWeekModalProps> = ({
  isOpen,
  onClose,
  currentDate,
  items,
  userId,
  onDateChange,
}) => {
  const [selectedDate, setSelectedDate] = useState<Date>(currentDate);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [displayName, setDisplayName] = useState<string>('Oktay');
  const [activeShare, setActiveShare] = useState<SharedWeekRecord | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [showPreviewModal, setShowPreviewModal] = useState<boolean>(false);

  // Sync with currentDate when opening
  useEffect(() => {
    if (isOpen) {
      setSelectedDate(currentDate);
      setErrorMessage(null);
      setConfirmDelete(false);
      setShowPreviewModal(false);
    }
  }, [isOpen, currentDate]);

  // Compute week range for selected date
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const weekStartDate = weekDates[0]?.dateStr || '';
  const weekEndDate = weekDates[6]?.dateStr || '';

  const weekLabel = useMemo(() => {
    if (!weekDates[0] || !weekDates[6]) return 'This Week';
    const first = weekDates[0].date;
    const last = weekDates[6].date;
    return `${first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }, [weekDates]);

  // Look for existing share matching this weekStartDate
  useEffect(() => {
    if (!isOpen) return;
    const localShares = getLocalSharedWeeks();
    const existing = localShares.find(
      (s) => s.weekStartDate === weekStartDate && (s.userId === userId || !userId)
    );
    if (existing) {
      setActiveShare(existing);
      setDisplayName(existing.displayName || 'Oktay');
    } else {
      setActiveShare(null);
      setDisplayName((prev) => prev.trim() || 'Oktay');
    }
  }, [isOpen, weekStartDate, userId]);

  // Items scheduled for this week
  const weekItems = useMemo(() => {
    return items
      .filter((it) => {
        if (!it.scheduledDate) return false;
        return it.scheduledDate >= weekStartDate && it.scheduledDate <= weekEndDate;
      })
      .sort((a, b) => (a.scheduledDate || '').localeCompare(b.scheduledDate || ''));
  }, [items, weekStartDate, weekEndDate]);

  // Included items calculation
  const includedItems = useMemo(() => {
    return weekItems.filter((it) => !hiddenIds.has(it.id));
  }, [weekItems, hiddenIds]);

  const totalPlannedMinutes = useMemo(() => {
    return includedItems.reduce((acc, it) => acc + (it.durationMinutes || 0), 0);
  }, [includedItems]);

  // Group items by scheduled day
  const itemsByDay = useMemo(() => {
    const map: Record<string, ContentItem[]> = {};
    for (const item of weekItems) {
      const dStr = item.scheduledDate || 'unscheduled';
      if (!map[dStr]) map[dStr] = [];
      map[dStr].push(item);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [weekItems]);

  const allHidden = useMemo(() => {
    return weekItems.length > 0 && hiddenIds.size === weekItems.length;
  }, [weekItems, hiddenIds]);

  const handleToggleHide = (itemId: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleToggleAll = () => {
    if (allHidden) {
      // Show all
      setHiddenIds(new Set());
    } else {
      // Hide all
      setHiddenIds(new Set(weekItems.map((it) => it.id)));
    }
  };

  const handleNavigateWeek = (offsetWeeks: number) => {
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() + offsetWeeks * 7);
    setSelectedDate(nextDate);
    if (onDateChange) {
      onDateChange(nextDate);
    }
  };

  // Create or Update Link
  const handlePublish = async (isUpdate = false) => {
    setIsPublishing(true);
    setErrorMessage(null);

    const snapshot = createSharedWeekSnapshot({
      items,
      hiddenItemIds: hiddenIds,
      weekStartDate,
      weekEndDate,
      weekLabel,
      displayName: displayName.trim() || 'Oktay',
      userId: userId || 'guest-user',
      existingId: isUpdate && activeShare ? activeShare.id : undefined,
    });

    const res = await publishSharedWeek(snapshot, isUpdate);
    setIsPublishing(false);

    if (res.success && res.share) {
      setActiveShare(res.share);
      if (!isUpdate && res.url) {
        // Auto-copy on initial creation
        try {
          await navigator.clipboard.writeText(res.url);
          setIsCopied(true);
          setTimeout(() => setIsCopied(false), 3000);
        } catch {
          // ignore
        }
      }
    } else {
      setErrorMessage(res.error || 'Failed to create share link.');
    }
  };

  const handleCopyLink = async () => {
    if (!activeShare) return;
    const url = `${window.location.origin}/w/${activeShare.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    } catch {
      // fallback
    }
  };

  const handleToggleActive = async () => {
    if (!activeShare) return;
    const newActive = !activeShare.isActive;
    const ok = await toggleShareActive(activeShare.id, newActive);
    if (ok) {
      setActiveShare({
        ...activeShare,
        isActive: newActive,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleDelete = async () => {
    if (!activeShare) return;
    const ok = await deleteSharedWeek(activeShare.id);
    if (ok) {
      setActiveShare(null);
      setConfirmDelete(false);
    }
  };

  if (!isOpen) return null;

  const publicUrl = activeShare ? `${window.location.origin}/w/${activeShare.id}` : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#141414] text-white rounded-3xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-stone-800/80 overflow-hidden font-sans p-6 sm:p-8">
        {/* Top Header Row with Close Icon */}
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <h2 className="font-serif text-3xl font-normal text-stone-100 leading-tight">
              Share My Week
            </h2>
            <p className="text-xs text-stone-400 mt-2 max-w-lg leading-relaxed">
              Create a clean, focused snapshot of your planned content. Choose what to include
              and get a link to share with anyone.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-white transition-colors cursor-pointer shrink-0 mt-1"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Week Navigator Pill (Right aligned above metrics) */}
        <div className="flex justify-end mb-4">
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full border border-stone-800 bg-[#1D1C1B] text-xs text-stone-300 font-sans shadow-2xs">
            <button
              type="button"
              onClick={() => handleNavigateWeek(-1)}
              className="text-stone-400 hover:text-white transition-colors cursor-pointer"
              title="Previous Week"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            {activeShare ? (
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-stone-200 hover:text-white underline underline-offset-2 inline-flex items-center gap-1 cursor-pointer"
                title="Open public shared snapshot in new tab"
              >
                <span>{weekLabel}</span>
                <span className="text-[10px] text-stone-400 no-underline">↗</span>
              </a>
            ) : (
              <span className="font-medium">{weekLabel}</span>
            )}
            <button
              type="button"
              onClick={() => handleNavigateWeek(1)}
              className="text-stone-400 hover:text-white transition-colors cursor-pointer"
              title="Next Week"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Metrics Row: Planned Time, Items & Hide All Switch */}
        <div className="flex items-center justify-between pb-6 border-b border-stone-800/80">
          <div className="flex items-center">
            <div>
              <div className="font-serif text-3xl font-normal text-white leading-none">
                {formatPlannedTotal(totalPlannedMinutes)}
              </div>
              <div className="text-xs text-stone-400 mt-1.5 font-sans">
                planned time
              </div>
            </div>

            <div className="h-10 w-px bg-stone-800 mx-7" />

            <div>
              <div className="font-serif text-3xl font-normal text-white leading-none">
                {weekItems.length}
              </div>
              <div className="text-xs text-stone-400 mt-1.5 font-sans">
                items &middot; {includedItems.length} visible
              </div>
            </div>
          </div>

          {/* Hide All Toggle Switch */}
          <button
            type="button"
            role="switch"
            aria-checked={allHidden}
            onClick={handleToggleAll}
            className="flex items-center gap-2.5 cursor-pointer group"
            title={allHidden ? 'Show all items' : 'Hide all items'}
          >
            <div
              className={`w-10 h-5 rounded-full p-0.5 transition-colors flex items-center ${
                allHidden ? 'bg-stone-500 justify-end' : 'bg-stone-800 justify-start'
              }`}
            >
              <div className="w-4 h-4 rounded-full bg-white shadow-xs" />
            </div>
            <span className="text-xs text-stone-300 group-hover:text-white transition-colors font-sans">
              Hide all
            </span>
          </button>
        </div>

        {/* Day-by-Day Content Stream (Scrollable) */}
        <div className="flex-1 overflow-y-auto py-4 space-y-6 pr-1 custom-scrollbar min-h-[220px]">
          {weekItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-stone-500 border border-dashed border-stone-800 rounded-2xl">
              No items scheduled for this week. Add items on the calendar or navigate to another week.
            </div>
          ) : (
            itemsByDay.map(([dateStr, dayItems]) => {
              const { dayName, dateLabel } = formatDayParts(dateStr);
              return (
                <div
                  key={dateStr}
                  className="flex items-start gap-5 pt-4 first:pt-0 border-t border-stone-850 first:border-t-0"
                >
                  {/* Left Column: Day Label */}
                  <div className="w-16 sm:w-20 shrink-0 pt-0.5">
                    <div className="font-serif text-lg sm:text-xl font-normal text-white">
                      {dayName}
                    </div>
                    <div className="text-xs text-stone-400 mt-0.5 font-sans">
                      {dateLabel}
                    </div>
                  </div>

                  {/* Right Column: Items for this Day */}
                  <div className="flex-1 space-y-3.5">
                    {dayItems.map((item) => {
                      const isHidden = hiddenIds.has(item.id);
                      return (
                        <div
                          key={item.id}
                          className={`flex items-center justify-between gap-3 group transition-opacity ${
                            isHidden ? 'opacity-35' : 'opacity-100'
                          }`}
                        >
                          {/* Poster Thumbnail */}
                          <div
                            className={`w-24 h-14 sm:w-28 sm:h-16 rounded-lg overflow-hidden shrink-0 relative ${getPosterColor(
                              item.contentType,
                              item.id
                            )} flex flex-col justify-between p-2 shadow-xs select-none`}
                          >
                            {item.thumbnailUrl && !item.thumbnailUrl.startsWith('data:') ? (
                              <img
                                src={item.thumbnailUrl}
                                alt=""
                                className="absolute inset-0 w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  (e.currentTarget as HTMLElement).style.display = 'none';
                                }}
                              />
                            ) : null}
                            <span className="text-[8px] uppercase tracking-wider text-white/70 font-mono font-medium relative z-10 truncate">
                              {item.source || item.contentType}
                            </span>
                            <span className="font-serif text-[10px] text-white/95 line-clamp-2 leading-tight relative z-10 italic">
                              {item.title}
                            </span>
                          </div>

                          {/* Item Details */}
                          <div className="min-w-0 flex-1 pr-2">
                            {item.url ? (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-sans text-sm font-medium text-stone-100 hover:text-white underline underline-offset-2 transition-colors line-clamp-2 leading-snug inline-flex items-baseline gap-1 cursor-pointer"
                                title="Open original link in new tab"
                              >
                                <span>{item.title}</span>
                                <span className="text-[10px] text-stone-400 no-underline shrink-0">↗</span>
                              </a>
                            ) : (
                              <h4 className="font-sans text-sm font-medium text-stone-100 group-hover:text-white transition-colors line-clamp-2 leading-snug">
                                {item.title}
                              </h4>
                            )}
                            <div className="flex items-center gap-1.5 text-xs text-stone-400 mt-1">
                              <span className="capitalize">{item.source || item.contentType}</span>
                              <span aria-hidden="true">&middot;</span>
                              <span>{formatItemDuration(item.durationMinutes)}</span>
                            </div>
                          </div>

                          {/* Individual Item Toggle Switch */}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={!isHidden}
                            onClick={() => handleToggleHide(item.id)}
                            className="cursor-pointer shrink-0 p-1"
                            title={isHidden ? 'Include in public share' : 'Hide from public share'}
                          >
                            <div
                              className={`w-10 h-5 rounded-full p-0.5 transition-colors flex items-center ${
                                !isHidden ? 'bg-stone-700 justify-end' : 'bg-stone-850 justify-start'
                              }`}
                            >
                              <div
                                className={`w-4 h-4 rounded-full shadow-xs transition-colors ${
                                  !isHidden ? 'bg-white' : 'bg-stone-400'
                                }`}
                              />
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="mt-3 p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-300 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Bottom Controls Row: Display Name & Create Link */}
        <div className="pt-6 mt-2 border-t border-stone-800/80 flex flex-col sm:flex-row sm:items-end justify-between gap-4 shrink-0">
          {/* Display Name Input */}
          <div className="flex-1 max-w-sm">
            <label htmlFor="displayName" className="block text-xs text-stone-400 mb-1.5 font-sans">
              Display name (optional)
            </label>
            <div className="relative">
              <input
                id="displayName"
                type="text"
                maxLength={40}
                placeholder="e.g. Oktay (max 40 characters)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
                className="w-full bg-[#181818] border border-stone-800 rounded-xl px-3.5 py-2.5 text-xs text-stone-100 placeholder:text-stone-500 pr-12 focus:outline-none focus:border-stone-600 transition-colors"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-stone-500 font-mono">
                {displayName.length}/40
              </span>
            </div>
          </div>

          {/* Create / Update Link Button */}
          <button
            type="button"
            onClick={() => handlePublish(Boolean(activeShare))}
            disabled={isPublishing || weekItems.length === 0}
            className="bg-[#F6F4EE] hover:bg-white text-stone-900 font-medium px-6 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 shrink-0 transition-all cursor-pointer disabled:opacity-40 shadow-xs"
          >
            {isPublishing ? (
              <RefreshCw className="w-4 h-4 animate-spin text-stone-900" />
            ) : (
              <Link2 className="w-4 h-4 text-stone-900" />
            )}
            <span>{activeShare ? 'Update link' : 'Create link'}</span>
          </button>
        </div>

        {/* Active Link Details: Positioned directly UNDER display name and update link */}
        {activeShare ? (
          <div className="mt-3.5 pt-3.5 border-t border-stone-850 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2.5 shrink-0 animate-in fade-in duration-150">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-stone-400 shrink-0 font-medium">Link:</span>
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-stone-200 underline underline-offset-2 truncate hover:text-white transition-colors cursor-pointer select-all"
                title="Click to open public shared page in a new tab"
              >
                {publicUrl}
              </a>
              {!activeShare.isActive && (
                <span className="text-[11px] text-amber-400 font-sans shrink-0">(paused)</span>
              )}
            </div>
            <div className="flex items-center gap-2.5 shrink-0 font-sans text-xs">
              <button
                type="button"
                onClick={() => setShowPreviewModal(true)}
                className="text-stone-300 hover:text-white underline underline-offset-2 inline-flex items-center gap-1 cursor-pointer"
                title="Preview public shared link design inside app"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Preview</span>
              </button>
              <span className="text-stone-600">&middot;</span>
              <button
                type="button"
                onClick={handleCopyLink}
                className="text-stone-300 hover:text-white underline underline-offset-2 transition-colors cursor-pointer"
              >
                {isCopied ? 'Copied' : 'Copy link'}
              </button>
              <span className="text-stone-600">&middot;</span>
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-stone-300 hover:text-white underline underline-offset-2 inline-flex items-center gap-0.5 cursor-pointer"
              >
                <span>Open ↗</span>
              </a>
              <span className="text-stone-600">&middot;</span>
              <button
                type="button"
                onClick={handleToggleActive}
                className="text-stone-400 hover:text-stone-200 underline underline-offset-2 transition-colors cursor-pointer"
              >
                {activeShare.isActive ? 'Turn Off' : 'Turn On'}
              </button>
              <span className="text-stone-600">&middot;</span>
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-stone-500 hover:text-rose-400 underline underline-offset-2 transition-colors cursor-pointer"
                >
                  Delete
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="text-rose-400 hover:underline cursor-pointer font-medium"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-stone-400 hover:underline cursor-pointer"
                  >
                    Cancel
                  </button>
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3.5 pt-3.5 border-t border-stone-850 flex items-center justify-between text-xs text-stone-500 shrink-0 font-sans">
            <span>Link will appear here once created &mdash; ready to share publicly.</span>
          </div>
        )}
      </div>

      {/* In-App Live Shared Page Preview Modal */}
      {showPreviewModal && activeShare && (
        <div className="fixed inset-0 z-60 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-[#121212] border border-stone-800 rounded-2xl w-full max-w-4xl h-[88vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header bar */}
            <div className="px-5 py-3.5 border-b border-stone-800 flex items-center justify-between shrink-0 bg-[#171717]">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-xs font-medium text-stone-200 font-sans">
                  Public Shared Page Preview &middot; <span className="font-mono text-stone-400">/w/{activeShare.id.slice(0, 8)}...</span>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-stone-300 hover:text-white underline underline-offset-2 inline-flex items-center gap-1"
                >
                  <span>Open in new tab</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(false)}
                  className="text-stone-400 hover:text-white p-1 rounded-lg hover:bg-stone-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Embedded Live Frame */}
            <div className="flex-1 w-full bg-[#FAF9F6] overflow-hidden">
              <iframe
                src={`/w/${activeShare.id}`}
                title="Shared Week Snapshot Preview"
                className="w-full h-full border-0"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
