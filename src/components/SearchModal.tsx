import React, { useState, useEffect } from 'react';
import { Search, X, Clock, ExternalLink, Play, FileText, Headphones, BookOpen } from 'lucide-react';
import { ContentItem, CONTENT_TYPE_CONFIG } from '../types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: ContentItem[];
  onSelectItem: (item: ContentItem) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  items,
  onSelectItem,
}) => {
  const [query, setQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        // Toggle search
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const results = items.filter((item) => {
    if (selectedType !== 'all') {
      if (selectedType === 'video' && !['youtube', 'documentary', 'course'].includes(item.contentType)) {
        return false;
      }
      if (selectedType === 'article' && item.contentType !== 'article') {
        return false;
      }
      if (selectedType === 'podcast' && item.contentType !== 'podcast') {
        return false;
      }
      if (selectedType === 'book' && item.contentType !== 'book') {
        return false;
      }
    }

    if (!query.trim()) {
      return selectedType !== 'all';
    }

    const q = query.toLowerCase().trim();
    return (
      item.title.toLowerCase().includes(q) ||
      (item.topic && item.topic.toLowerCase().includes(q)) ||
      (item.author && item.author.toLowerCase().includes(q)) ||
      (item.platform && item.platform.toLowerCase().includes(q)) ||
      (item.url && item.url.toLowerCase().includes(q)) ||
      (item.notes && item.notes.toLowerCase().includes(q)) ||
      (item.keyTakeaway && item.keyTakeaway.toLowerCase().includes(q))
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 sm:pt-24 bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl bg-[#FAF8F5] dark:bg-[#181716] rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden flex flex-col max-h-[80vh]">
        {/* Search Input Bar */}
        <div className="p-4 border-b border-stone-200 dark:border-stone-800 flex items-center gap-3">
          <Search className="w-5 h-5 text-stone-400" />
          <input
            type="text"
            placeholder="Search by title, topic, author, platform, or notes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="flex-1 bg-transparent text-sm sm:text-base text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-hidden"
          />
          <button
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Source Categories Selector */}
        <div className="px-4 py-2.5 border-b border-stone-200/80 dark:border-stone-800 bg-stone-100/60 dark:bg-stone-900/60 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {[
            { id: 'all', label: 'All Sources' },
            { id: 'video', label: 'Video', icon: Play },
            { id: 'article', label: 'Article', icon: FileText },
            { id: 'podcast', label: 'Podcast', icon: Headphones },
            { id: 'book', label: 'Book', icon: BookOpen },
          ].map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedType === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedType(cat.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-sans flex items-center gap-1.5 transition-all cursor-pointer font-medium border ${
                  isSelected
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950 border-stone-900 dark:border-stone-100 shadow-xs'
                    : 'bg-stone-200/70 dark:bg-stone-800 text-stone-700 dark:text-stone-200 border-stone-300 dark:border-stone-700 hover:bg-stone-300/80 dark:hover:bg-stone-700 hover:text-stone-950 dark:hover:text-white'
                }`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto p-4">
          {!query.trim() ? (
            <div className="py-12 text-center text-xs text-stone-400 dark:text-stone-500 font-sans">
              Type to search through all planned, inbox, and completed content.
            </div>
          ) : results.length === 0 ? (
            <div className="py-12 text-center text-xs text-stone-500 font-serif italic">
              No matching content found for "{query}".
            </div>
          ) : (
            <div className="space-y-3">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-400 block px-1">
                Found {results.length} results
              </span>

              {results.map((item) => {
                const typeCfg = CONTENT_TYPE_CONFIG[item.contentType] || CONTENT_TYPE_CONFIG.other;
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      onSelectItem(item);
                      onClose();
                    }}
                    className="flex items-center gap-3 p-2.5 rounded-xl border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 hover:border-stone-400 dark:hover:border-stone-600 transition-all cursor-pointer group"
                  >
                    {/* Thumbnail */}
                    <div className="w-20 aspect-16/10 rounded-lg overflow-hidden bg-stone-200 dark:bg-stone-950 shrink-0">
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-stone-400">
                          {typeCfg.shortLabel}
                        </div>
                      )}
                    </div>

                    {/* Meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px] text-stone-500 font-sans">
                        <span>{typeCfg.icon} {typeCfg.shortLabel}</span>
                        {item.topic && (
                          <>
                            <span>·</span>
                            <span className="font-medium text-stone-700 dark:text-stone-300">
                              {item.topic}
                            </span>
                          </>
                        )}
                        {item.scheduledDate && (
                          <>
                            <span>·</span>
                            <span>{item.scheduledDate}</span>
                          </>
                        )}
                      </div>

                      <h4 data-clarity-mask="True" className="font-serif text-sm font-semibold text-stone-900 dark:text-stone-100 truncate mt-0.5 group-hover:text-amber-900 dark:group-hover:text-amber-200">
                        {item.title}
                      </h4>

                      <div className="flex items-center gap-2 text-[11px] text-stone-400 font-sans mt-0.5">
                        {item.author && <span data-clarity-mask="True">{item.author}</span>}
                        {item.durationMinutes && <span>· {item.durationMinutes}m</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
