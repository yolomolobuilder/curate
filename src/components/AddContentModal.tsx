import React, { useState, useEffect } from 'react';
import { X, Sparkles, Link as LinkIcon, Calendar, Inbox, ChevronDown, Play, FileText, BookOpen, Headphones } from 'lucide-react';
import { ContentType, ContentItem, CONTENT_TYPE_CONFIG } from '../types';
import { extractMetadata, EDITORIAL_COVER_PALETTES, generateEditorialCoverSvg } from '../lib/metadataExtractor';
import { getTodayStr } from '../lib/dateUtils';

interface AddContentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (item: Omit<ContentItem, 'id' | 'createdAt'>) => void;
  availableTopics: string[];
  onAddCustomTopic: (topic: string) => void;
  initialDate?: string;
  initialType?: ContentType;
  existingItems: ContentItem[];
}

export const AddContentModal: React.FC<AddContentModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  availableTopics,
  onAddCustomTopic,
  initialDate,
  initialType,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Core fields
  const [title, setTitle] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [contentType, setContentType] = useState<ContentType>(initialType || 'youtube');
  const [platform, setPlatform] = useState('');
  const [author, setAuthor] = useState('');
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [topic, setTopic] = useState('Marketing');
  const [scheduledDate, setScheduledDate] = useState<string>(initialDate || '');
  const [isInbox, setIsInbox] = useState(!initialDate);
  const [coverPaletteIdx, setCoverPaletteIdx] = useState(0);

  useEffect(() => {
    if (initialType) {
      setContentType(initialType);
    }
  }, [initialType, isOpen]);

  useEffect(() => {
    if (initialDate) {
      setScheduledDate(initialDate);
      setIsInbox(false);
    } else {
      setIsInbox(true);
    }
  }, [initialDate]);

  if (!isOpen) return null;

  const handleUrlChange = async (val: string) => {
    setUrlInput(val);

    if (val.trim().length > 8 && /^https?:\/\//i.test(val.trim())) {
      setIsExtracting(true);
      try {
        const meta = await extractMetadata(val.trim());
        setTitle(meta.title);
        setThumbnailUrl(meta.thumbnailUrl);
        setContentType(meta.contentType);
        setPlatform(meta.platform);
        setAuthor(meta.author);
        if (meta.durationMinutes) setDurationMinutes(meta.durationMinutes);
        if (meta.topic) setTopic(meta.topic);
      } catch (err) {
        console.warn('Auto metadata extraction failed:', err);
      } finally {
        setIsExtracting(false);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !urlInput.trim()) return;

    const finalTitle = title.trim() || urlInput.trim();
    const finalSource = author.trim() || platform.trim() || 'Curate';
    const finalThumbnail =
      thumbnailUrl.trim() ||
      generateEditorialCoverSvg(finalTitle, finalSource, topic, coverPaletteIdx);

    onAdd({
      url: urlInput.trim() || undefined,
      title: finalTitle,
      thumbnailUrl: finalThumbnail,
      contentType,
      source: finalSource,
      platform: platform.trim() || undefined,
      author: author.trim() || undefined,
      durationMinutes: durationMinutes > 0 ? durationMinutes : undefined,
      topic: topic || undefined,
      status: isInbox ? 'inbox' : 'planned',
      scheduledDate: isInbox ? undefined : (scheduledDate || undefined),
    });

    // Reset & close
    setUrlInput('');
    setTitle('');
    setThumbnailUrl('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-[#FAF9F6] dark:bg-[#121212] rounded-3xl shadow-2xl border border-stone-200/60 dark:border-stone-800 p-6 sm:p-8 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3">
          <span className="font-serif text-lg font-normal text-stone-900 dark:text-stone-100">
            Add to Curate
          </span>
          <button
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Type Selector */}
        <div className="flex items-center gap-1.5 pb-2">
          {([
            { type: 'youtube', label: 'Video', icon: Play },
            { type: 'article', label: 'Article', icon: FileText },
            { type: 'book', label: 'Book', icon: BookOpen },
            { type: 'podcast', label: 'Podcast', icon: Headphones },
          ] as const).map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              type="button"
              onClick={() => setContentType(type as ContentType)}
              className={`px-3 py-1.5 rounded-full text-xs font-sans flex items-center gap-1.5 transition-all cursor-pointer font-medium border ${
                contentType === type
                  ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950 border-stone-900 dark:border-stone-100 shadow-xs'
                  : 'bg-stone-200/70 dark:bg-stone-800 text-stone-700 dark:text-stone-200 border-stone-300 dark:border-stone-700 hover:bg-stone-300/80 dark:hover:bg-stone-700 hover:text-stone-950 dark:hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Main URL Bar */}
          <div className="relative">
            <input
              type="text"
              autoFocus
              placeholder="Paste a YouTube, article, podcast, or book link…"
              value={urlInput}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 text-sm focus:outline-hidden focus:border-stone-400 transition-colors font-mono"
            />
            {isExtracting && (
              <div className="absolute right-3.5 top-3.5 text-stone-400 animate-spin">
                <Sparkles className="w-4 h-4" />
              </div>
            )}
          </div>

          {/* Visual Preview Card (Appears as soon as resolved or title typed) */}
          {(thumbnailUrl || title) && (
            <div className="flex gap-4 p-3 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200/60 dark:border-stone-800">
              <div className="w-28 aspect-16/10 rounded-xl overflow-hidden bg-stone-100 dark:bg-stone-950 shrink-0">
                {thumbnailUrl ? (
                  <img
                    src={thumbnailUrl}
                    alt={title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-stone-400">
                    Cover
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div>
                  <span className="text-[10px] font-sans text-stone-400 uppercase tracking-widest">
                    {CONTENT_TYPE_CONFIG[contentType]?.label || 'Media'}
                  </span>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Content Title"
                    className="w-full font-serif text-sm text-stone-900 dark:text-stone-100 font-medium truncate mt-0.5 bg-transparent focus:outline-hidden"
                  />
                </div>

                <p className="text-[11px] text-stone-400 font-sans truncate">
                  {author || platform || 'CurateCal'}
                  {durationMinutes ? ` · ${durationMinutes}m` : ''}
                </p>
              </div>
            </div>
          )}

          {/* Scheduling Selection: Inbox vs Date */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsInbox(true)}
                className={`px-3 py-1.5 rounded-full text-xs font-sans transition-all cursor-pointer ${
                  isInbox
                    ? 'bg-black text-white dark:bg-white dark:text-black font-medium'
                    : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
                }`}
              >
                Add to Inbox
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsInbox(false);
                  if (!scheduledDate) setScheduledDate(getTodayStr());
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-sans transition-all cursor-pointer ${
                  !isInbox
                    ? 'bg-black text-white dark:bg-white dark:text-black font-medium'
                    : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
                }`}
              >
                Schedule on Date
              </button>
            </div>

            {!isInbox && (
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="px-2.5 py-1 rounded-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-xs font-mono"
              />
            )}
          </div>

          {/* Optional Details Accordion */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[11px] font-sans text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 flex items-center gap-1 cursor-pointer"
            >
              <span>More options</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 pt-3 border-t border-stone-200/50 dark:border-stone-800">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-stone-400 mb-1">Topic</label>
                    <select
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-xs"
                    >
                      {availableTopics.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-stone-400 mb-1">Type</label>
                    <select
                      value={contentType}
                      onChange={(e) => setContentType(e.target.value as ContentType)}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-xs"
                    >
                      {Object.entries(CONTENT_TYPE_CONFIG).map(([typeKey, cfg]) => (
                        <option key={typeKey} value={typeKey}>
                          {cfg.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-stone-400 mb-1">Duration (minutes)</label>
                  <input
                    type="number"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="w-24 px-2.5 py-1.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-xs font-mono"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Primary Action Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={!urlInput.trim() && !title.trim()}
              className="w-full py-2.5 rounded-full text-xs font-medium text-white bg-black hover:bg-stone-800 dark:bg-white dark:text-black dark:hover:bg-stone-100 transition-all disabled:opacity-30 cursor-pointer shadow-2xs"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
