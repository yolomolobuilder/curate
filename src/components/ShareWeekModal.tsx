import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Share2,
  Copy,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  Trash2,
  Power,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Clock,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import { ContentItem, CONTENT_TYPE_CONFIG } from '../types';
import {
  SharedWeekRecord,
  createSharedWeekSnapshot,
  publishSharedWeek,
  toggleShareActive,
  deleteSharedWeek,
  getLocalSharedWeeks,
  formatDayLabel,
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
  const [displayName, setDisplayName] = useState<string>('');
  const [activeShare, setActiveShare] = useState<SharedWeekRecord | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);

  // Sync with currentDate when opening
  useEffect(() => {
    if (isOpen) {
      setSelectedDate(currentDate);
      setErrorMessage(null);
      setConfirmDelete(false);
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
      if (existing.displayName) {
        setDisplayName(existing.displayName);
      }
    } else {
      setActiveShare(null);
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

  const formatHoursMinutes = (mins: number) => {
    if (mins <= 0) return '0m';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

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
      displayName: displayName.trim() || undefined,
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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#FAF9F6] dark:bg-[#141413] text-stone-900 dark:text-stone-100 rounded-2xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-stone-200/80 dark:border-stone-800 overflow-hidden font-sans">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-200/80 dark:border-stone-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-stone-100 dark:bg-stone-850 flex items-center justify-center border border-stone-200 dark:border-stone-800 text-stone-800 dark:text-stone-200">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif text-xl font-normal text-stone-900 dark:text-stone-100 leading-tight">
                Share My Week
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Publish a read-only snapshot of your weekly plan. Notes and private URLs are never included.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
          {/* Week Selector Bar */}
          <div className="flex items-center justify-between bg-stone-100/70 dark:bg-stone-900 p-2.5 rounded-xl border border-stone-200/60 dark:border-stone-800">
            <button
              type="button"
              onClick={() => handleNavigateWeek(-1)}
              className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors cursor-pointer"
              title="Previous Week"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-center">
              <span className="text-[10px] uppercase font-mono tracking-wider text-stone-500 dark:text-stone-400 font-semibold block">
                Selected Week
              </span>
              {activeShare ? (
                <a
                  href={`/w/${activeShare.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-serif text-base font-normal text-stone-900 dark:text-stone-100 hover:opacity-75 transition-opacity inline-flex items-center gap-1 underline decoration-stone-300 dark:decoration-stone-700 underline-offset-4 cursor-pointer"
                  title="Click to open public shared page in a new tab"
                >
                  <span>{weekLabel}</span>
                  <span className="text-xs font-sans text-stone-500 no-underline">↗</span>
                </a>
              ) : (
                <span className="font-serif text-base font-normal text-stone-900 dark:text-stone-100">
                  {weekLabel}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleNavigateWeek(1)}
              className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors cursor-pointer"
              title="Next Week"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Active Link Management Card (Pure text-based controls & Clickable URL) */}
          {activeShare && (
            <div className="p-4 rounded-xl border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-2xs space-y-3">
              <div className="flex items-center justify-between text-xs pb-1 border-b border-stone-100 dark:border-stone-850">
                <span className="text-stone-600 dark:text-stone-400">
                  Status: <strong className="font-medium text-stone-900 dark:text-stone-100">{activeShare.isActive ? 'Active (public)' : 'Turned off (HTTP 410)'}</strong>
                </span>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleToggleActive}
                    className="text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white underline underline-offset-2 transition-colors cursor-pointer"
                  >
                    {activeShare.isActive ? 'Turn Off' : 'Turn On'}
                  </button>
                  <span className="text-stone-300 dark:text-stone-700">&middot;</span>
                  {!confirmDelete ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="text-stone-500 hover:text-rose-600 dark:hover:text-rose-400 underline underline-offset-2 transition-colors cursor-pointer"
                    >
                      Delete
                    </button>
                  ) : (
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDelete}
                        className="text-rose-600 font-medium underline underline-offset-2 cursor-pointer"
                      >
                        Confirm Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="text-stone-500 hover:text-stone-700 underline underline-offset-2 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* URL & Clickable Open / Copy Row */}
              <div className="flex items-center justify-between gap-3 bg-stone-50/80 dark:bg-stone-950/80 p-2.5 rounded-lg border border-stone-200/80 dark:border-stone-800 text-xs">
                <a
                  href={`/w/${activeShare.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-stone-900 dark:text-stone-100 hover:opacity-75 underline underline-offset-2 truncate flex-1 block transition-opacity cursor-pointer"
                  title="Click to open public shared page in a new tab"
                >
                  {publicUrl}
                </a>
                <div className="flex items-center gap-2.5 shrink-0 font-sans text-xs">
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white underline underline-offset-2 transition-colors cursor-pointer"
                  >
                    {isCopied ? 'Copied' : 'Copy link'}
                  </button>
                  <span className="text-stone-300 dark:text-stone-700">&middot;</span>
                  <a
                    href={`/w/${activeShare.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white underline underline-offset-2 inline-flex items-center gap-0.5 cursor-pointer"
                  >
                    <span>Open ↗</span>
                  </a>
                </div>
              </div>

              {/* Snapshot Update Prompt */}
              <div className="flex items-center justify-between text-xs pt-1 border-t border-stone-100 dark:border-stone-850">
                <span className="text-stone-500">
                  Last updated {new Date(activeShare.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <button
                  type="button"
                  onClick={() => handlePublish(true)}
                  disabled={isPublishing}
                  className="text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white underline underline-offset-2 cursor-pointer inline-flex items-center gap-1 font-medium"
                >
                  <RefreshCw className={`w-3 h-3 ${isPublishing ? 'animate-spin' : ''}`} />
                  <span>Update snapshot</span>
                </button>
              </div>
            </div>
          )}

          {/* Optional Creator Display Name Input (Requirement 6) */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <label htmlFor="displayName" className="font-medium text-stone-700 dark:text-stone-300">
                Optional Display Name
              </label>
              <span className="text-stone-400 font-mono text-[11px]">
                {displayName.length}/40
              </span>
            </div>
            <input
              id="displayName"
              type="text"
              maxLength={40}
              placeholder="e.g. Alex (leave blank for anonymous)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
              className="w-full px-3 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 focus:outline-hidden focus:ring-1 focus:ring-stone-400 dark:focus:ring-stone-600"
            />
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              Only this display name will appear. Your email and account identity are never shared.
            </p>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Public Preview & Per-Item Privacy Toggles (Requirement 1 & 2) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-stone-200/60 dark:border-stone-800">
              <span className="font-medium text-stone-800 dark:text-stone-200 text-xs">
                Public Preview ({includedItems.length} items &middot; {formatHoursMinutes(totalPlannedMinutes)} planned)
              </span>
              <span className="text-[11px] text-stone-500">
                Click Hide to exclude items
              </span>
            </div>

            {weekItems.length === 0 ? (
              <div className="py-8 text-center text-xs text-stone-400 border border-dashed border-stone-200 dark:border-stone-800 rounded-xl">
                No items scheduled for this week. Add items on the calendar or navigate to another week.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {weekItems.map((item) => {
                  const isHidden = hiddenIds.has(item.id);
                  const typeConfig = CONTENT_TYPE_CONFIG[item.contentType] || CONTENT_TYPE_CONFIG.other;

                  return (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                        isHidden
                          ? 'opacity-40 bg-stone-100/50 dark:bg-stone-900/40 border-stone-200/50 dark:border-stone-800/50'
                          : 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800 shadow-2xs'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-3">
                        <span className="text-xs shrink-0 font-medium">{typeConfig.icon}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
                            <span className="font-medium">{formatDayLabel(item.scheduledDate)}</span>
                            <span>&middot;</span>
                            <span>{item.durationMinutes ? `${item.durationMinutes}m` : '0m'}</span>
                            {isHidden && (
                              <span className="text-amber-600 dark:text-amber-400 font-medium">
                                (Hidden)
                              </span>
                            )}
                          </div>
                          <h4 className="text-xs font-medium text-stone-900 dark:text-stone-100 truncate">
                            {item.title}
                          </h4>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleHide(item.id)}
                        className="text-xs font-sans text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 underline underline-offset-2 transition-colors cursor-pointer shrink-0"
                        title={isHidden ? 'Include in public share' : 'Hide from public share'}
                      >
                        {isHidden ? 'Show in share' : 'Hide'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Privacy Guarantee Note */}
          <div className="p-3 rounded-xl bg-stone-100/80 dark:bg-stone-900/60 border border-stone-200/70 dark:border-stone-800/70 text-xs text-stone-600 dark:text-stone-400 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="text-stone-800 dark:text-stone-200">Strict Privacy:</strong> Only
              titles, sources, types, durations, and day labels are stored in the snapshot. Personal notes,
              original URLs, and hidden items are never stored in the database or sent to viewers.
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-stone-200/80 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/50 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-stone-400">
            Free accounts: up to 3 active links &middot; 10 links/hr
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 text-xs font-medium transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => handlePublish(Boolean(activeShare))}
              disabled={isPublishing || weekItems.length === 0}
              className="px-4 py-1.5 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 font-medium text-xs hover:opacity-90 transition-opacity flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              {isPublishing ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Share2 className="w-3.5 h-3.5" />
              )}
              <span>{activeShare ? 'Update Link' : 'Create Link'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
