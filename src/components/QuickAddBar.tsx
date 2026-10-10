import React, { useState } from 'react';
import { Sparkles, Plus, Clock, Inbox, Calendar, X, Link as LinkIcon, Check } from 'lucide-react';
import { extractMetadata } from '../lib/metadataExtractor';
import { ContentItem, CONTENT_TYPE_CONFIG } from '../types';
import { getTodayStr } from '../lib/dateUtils';
import { formatDuration } from '../lib/timeAccounting';

interface QuickAddBarProps {
  onAddItem: (item: Omit<ContentItem, 'id' | 'createdAt'>, method?: 'paste' | 'quick_add' | 'sample') => void;
  onOpenFullModal: () => void;
}

export const QuickAddBar: React.FC<QuickAddBarProps> = ({
  onAddItem,
  onOpenFullModal,
}) => {
  const [url, setUrl] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [previewItem, setPreviewItem] = useState<{
    title: string;
    thumbnailUrl: string;
    contentType: ContentItem['contentType'];
    platform: string;
    author: string;
    durationMinutes?: number;
    durationIsEstimate?: boolean;
    durationFetchedAt?: string;
    topic?: string;
  } | null>(null);

  const handleInputChange = async (val: string) => {
    setUrl(val);

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
        console.warn('Metadata fetch failed:', err);
      } finally {
        setIsExtracting(false);
      }
    } else {
      setPreviewItem(null);
    }
  };

  const handleClear = () => {
    setUrl('');
    setPreviewItem(null);
  };

  const handleSaveToInbox = () => {
    if (!previewItem) return;
    const isEstimate = previewItem.durationIsEstimate !== false;
    onAddItem({
      url: url.trim(),
      title: previewItem.title,
      thumbnailUrl: previewItem.thumbnailUrl,
      contentType: previewItem.contentType,
      platform: previewItem.platform,
      author: previewItem.author,
      durationMinutes: previewItem.durationMinutes,
      durationIsEstimate: isEstimate,
      durationFetchedAt: previewItem.durationFetchedAt,
      userEditedFields: isEstimate ? [] : ['durationMinutes'],
      editedFields: isEstimate ? [] : ['durationMinutes'],
      topic: previewItem.topic,
      status: 'inbox',
    }, 'quick_add');
    handleClear();
  };

  const handleSaveForToday = () => {
    if (!previewItem) return;
    const todayStr = getTodayStr();
    const isEstimate = previewItem.durationIsEstimate !== false;
    onAddItem({
      url: url.trim(),
      title: previewItem.title,
      thumbnailUrl: previewItem.thumbnailUrl,
      contentType: previewItem.contentType,
      platform: previewItem.platform,
      author: previewItem.author,
      durationMinutes: previewItem.durationMinutes,
      durationIsEstimate: isEstimate,
      durationFetchedAt: previewItem.durationFetchedAt,
      userEditedFields: isEstimate ? [] : ['durationMinutes'],
      editedFields: isEstimate ? [] : ['durationMinutes'],
      topic: previewItem.topic,
      status: 'planned',
      scheduledDate: todayStr,
    }, 'quick_add');
    handleClear();
  };

  // Enable dragging the live preview card straight onto any calendar day!
  const handleDragStart = (e: React.DragEvent) => {
    if (!previewItem) return;
    const tempId = `temp-quick-${Date.now()}`;
    // Register temporary item or data transfer
    const itemData = {
      id: tempId,
      url: url.trim(),
      title: previewItem.title,
      thumbnailUrl: previewItem.thumbnailUrl,
      contentType: previewItem.contentType,
      platform: previewItem.platform,
      author: previewItem.author,
      durationMinutes: previewItem.durationMinutes,
      topic: previewItem.topic,
      isNewUnsaved: true,
    };
    e.dataTransfer.setData('text/plain', JSON.stringify(itemData));
    e.dataTransfer.setData('application/json', JSON.stringify(itemData));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-2">
      <div className="relative bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-xs p-2 sm:p-2.5 transition-all">
        <div className="flex items-center gap-2">
          <div className="pl-2 text-stone-400">
            <LinkIcon className="w-4 h-4" />
          </div>

          <input
            type="text"
            placeholder="Paste any link to plan (YouTube, article, podcast, book)..."
            value={url}
            onChange={(e) => handleInputChange(e.target.value)}
            className="flex-1 bg-transparent text-xs sm:text-sm text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-hidden py-1 font-mono"
          />

          {isExtracting && (
            <div className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 pr-2 font-sans animate-pulse">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Fetching preview...</span>
            </div>
          )}

          {url && !isExtracting && (
            <button
              onClick={handleClear}
              className="p-1 text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={onOpenFullModal}
            className="px-3 py-1.5 rounded-xl text-xs font-medium text-stone-700 dark:text-stone-200 bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors whitespace-nowrap cursor-pointer"
          >
            + Custom Entry
          </button>
        </div>

        {/* Live Instant Preview Card Popup */}
        {previewItem && (
          <div className="mt-2.5 pt-2.5 border-t border-stone-200/80 dark:border-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1">
            {/* Draggable preview item */}
            <div
              draggable
              onDragStart={handleDragStart}
              className="flex items-center gap-3 cursor-grab active:cursor-grabbing bg-stone-50 dark:bg-stone-950 p-2 rounded-xl border border-stone-200 dark:border-stone-800 group hover:border-amber-500 max-w-xl"
              title="Drag this card directly onto any calendar day!"
            >
              <div className="relative w-24 aspect-16/10 rounded-lg overflow-hidden bg-stone-900 shrink-0">
                <img
                  src={previewItem.thumbnailUrl}
                  alt={previewItem.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                {previewItem.durationMinutes && (
                  <div className="absolute bottom-1 right-1 px-1 py-0.2 rounded bg-black/80 text-[9px] font-mono text-white">
                    {formatDuration(previewItem.durationMinutes)}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">
                  {CONTENT_TYPE_CONFIG[previewItem.contentType]?.label} · {previewItem.platform}
                </span>
                <h4 className="font-serif text-xs font-semibold text-stone-900 dark:text-stone-100 truncate mt-0.5">
                  {previewItem.title}
                </h4>
                <p className="text-[11px] text-amber-700 dark:text-amber-400 font-sans mt-0.5 flex items-center gap-1">
                  <span>💡 Drag onto a calendar day, or click an action →</span>
                </p>
              </div>
            </div>

            {/* Quick destination buttons */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleSaveToInbox}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-stone-800 dark:text-stone-200 bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer"
              >
                <Inbox className="w-3.5 h-3.5" />
                <span>Save to Inbox</span>
              </button>

              <button
                onClick={handleSaveForToday}
                className="flex items-center gap-1 px-3.5 py-1.5 rounded-xl text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 dark:bg-amber-600 dark:hover:bg-amber-500 transition-colors shadow-xs cursor-pointer"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Schedule Today</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
