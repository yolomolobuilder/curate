import React, { useState } from 'react';
import { Layers, X, PlusCircle, BookmarkPlus, ChevronDown, Check } from 'lucide-react';
import { SharedCollectionRecord } from '../lib/collections';

interface MultiSelectToolbarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onCreateCollection: () => void;
  collections?: SharedCollectionRecord[];
  onAddSelectedToCollection?: (collectionId: string) => void;
  maxLimit?: number;
}

export const MultiSelectToolbar: React.FC<MultiSelectToolbarProps> = ({
  selectedCount,
  onClearSelection,
  onCreateCollection,
  collections = [],
  onAddSelectedToCollection,
  maxLimit = 50,
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [addedCollectionTitle, setAddedCollectionTitle] = useState<string | null>(null);

  if (selectedCount === 0) return null;

  const isOverLimit = selectedCount > maxLimit;
  const activeCollections = collections.filter((c) => c.isActive);

  return (
    <div className="fixed bottom-6 inset-x-0 z-50 flex justify-center px-4 pointer-events-none animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="pointer-events-auto relative flex items-center gap-2 sm:gap-3 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-4 py-2.5 rounded-full shadow-2xl border border-stone-800 dark:border-stone-200 backdrop-blur-md">
        <div className="flex items-center gap-2 pr-2 border-r border-stone-700 dark:border-stone-300 text-xs font-medium">
          <Layers className="w-4 h-4 text-amber-400 dark:text-amber-600" />
          <span>
            {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected
          </span>
          {isOverLimit && (
            <span className="text-[10px] text-red-400 font-semibold">
              (Max {maxLimit})
            </span>
          )}
        </div>

        {/* Add to Existing Collection Menu */}
        {activeCollections.length > 0 && onAddSelectedToCollection && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowDropdown(!showDropdown)}
              disabled={isOverLimit}
              className="flex items-center gap-1.5 px-3 py-1 bg-amber-500 hover:bg-amber-600 text-stone-950 font-semibold rounded-full text-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>
                {addedCollectionTitle ? `Added to ${addedCollectionTitle}!` : 'Add to Collection'}
              </span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {showDropdown && (
              <div className="absolute bottom-full left-0 mb-3 w-64 bg-stone-900 dark:bg-white text-white dark:text-stone-900 border border-stone-800 dark:border-stone-200 rounded-2xl shadow-2xl p-2 z-50 text-xs animate-in fade-in slide-in-from-bottom-2 duration-150">
                <div className="px-2.5 py-1.5 font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider text-[10px] border-b border-stone-800 dark:border-stone-100 mb-1">
                  Choose Collection to Add ({selectedCount} items)
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {activeCollections.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        onAddSelectedToCollection(c.id);
                        setAddedCollectionTitle(c.title);
                        setShowDropdown(false);
                        setTimeout(() => setAddedCollectionTitle(null), 2500);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-stone-800 dark:hover:bg-stone-100 flex items-center justify-between transition-colors cursor-pointer"
                    >
                      <span className="truncate font-medium">{c.title}</span>
                      <span className="text-[10px] text-stone-400 dark:text-stone-500 shrink-0 ml-2">
                        {c.items.length}/50 items
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-1 pt-1 border-t border-stone-800 dark:border-stone-100">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDropdown(false);
                      onCreateCollection();
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-stone-800 dark:hover:bg-stone-100 text-amber-400 dark:text-amber-600 font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Create new collection with these</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onCreateCollection}
          disabled={isOverLimit}
          className="flex items-center gap-1.5 px-3 py-1 bg-white text-stone-900 dark:bg-stone-900 dark:text-white rounded-full text-xs font-semibold hover:opacity-90 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>New Collection</span>
        </button>

        <button
          type="button"
          onClick={onClearSelection}
          className="p-1 text-stone-400 hover:text-white dark:hover:text-stone-900 transition-colors cursor-pointer"
          title="Clear selection"
          aria-label="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
