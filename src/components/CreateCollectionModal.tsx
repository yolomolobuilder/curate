import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Globe,
  Lock,
  Copy,
  Check,
  ExternalLink,
  Trash2,
  AlertCircle,
  Sparkles,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Link as LinkIcon,
  BookOpen,
  Play,
  FileText,
  Headphones,
  Edit3,
} from 'lucide-react';
import {
  ContentItem,
  ContentType,
  MAX_COLLECTION_TITLE_LENGTH,
  MAX_COLLECTION_DESC_LENGTH,
  MAX_COLLECTION_ITEMS,
  MAX_FREE_COLLECTIONS,
  CONTENT_TYPE_CONFIG,
  getItemSource,
} from '../types';
import {
  createCollectionSnapshot,
  syncCollectionToServer,
  updateCollectionOnServer,
  sanitizeCollectionTitle,
  sanitizeCollectionDescription,
  SharedCollectionRecord,
} from '../lib/collections';
import { extractMetadata, extractYouTubeId } from '../lib/metadataExtractor';

interface CreateCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedItems: ContentItem[];
  allItems: ContentItem[];
  userCollectionsCount: number;
  userId?: string;
  displayName?: string;
  editingCollection?: SharedCollectionRecord | null;
  onCollectionCreated?: (collection: SharedCollectionRecord) => void;
  onCollectionUpdated?: (collection: SharedCollectionRecord) => void;
  onAddNewLibraryItem?: (item: Omit<ContentItem, 'id' | 'createdAt'>) => ContentItem;
}

export const CreateCollectionModal: React.FC<CreateCollectionModalProps> = ({
  isOpen,
  onClose,
  selectedItems,
  allItems = [],
  userCollectionsCount,
  userId,
  displayName,
  editingCollection,
  onCollectionCreated,
  onCollectionUpdated,
  onAddNewLibraryItem,
}) => {
  const isEditing = Boolean(editingCollection);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [allowSearchEngines, setAllowSearchEngines] = useState(false);
  const [collectionItems, setCollectionItems] = useState<ContentItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [createdCollection, setCreatedCollection] = useState<SharedCollectionRecord | null>(null);
  const [hasCopied, setHasCopied] = useState(false);

  // Library Item Picker state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTypeFilter, setActiveTypeFilter] = useState<'all' | 'inbox' | ContentType>('all');
  const [isAddingNewLink, setIsAddingNewLink] = useState(true);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [modalTab, setModalTab] = useState<'add_link' | 'library' | 'details'>('details');

  // Synchronize state on open
  useEffect(() => {
    if (!isOpen) return;

    setError(null);
    setCreatedUrl(null);
    setCreatedCollection(null);
    setHasCopied(false);
    setSearchQuery('');
    setActiveTypeFilter('all');
    setIsAddingNewLink(true);
    setNewLinkUrl('');
    setNewLinkTitle('');
    setModalTab(editingCollection ? 'add_link' : 'details');

    if (editingCollection) {
      setTitle(editingCollection.title || '');
      setDescription(editingCollection.description || '');
      setAllowSearchEngines(Boolean(editingCollection.allowSearchEngines));

      // Match collection items with allItems to preserve full ContentItem objects
      const matchedItems: ContentItem[] = [];
      const itemMap = new Map<string, ContentItem>();
      for (const item of allItems) {
        itemMap.set(item.id, item);
      }

      for (const cItem of editingCollection.items) {
        if (itemMap.has(cItem.id)) {
          matchedItems.push(itemMap.get(cItem.id)!);
        } else {
          // Construct fallback ContentItem
          matchedItems.push({
            id: cItem.id,
            title: cItem.title,
            source: cItem.source,
            contentType: (cItem.type as ContentType) || 'other',
            durationMinutes: cItem.duration,
            durationIsEstimate: cItem.durationIsEstimate,
            thumbnailUrl: cItem.coverReference || '',
            url: cItem.url,
            status: 'inbox',
            createdAt: editingCollection.createdAt,
          });
        }
      }
      setCollectionItems(matchedItems);
    } else {
      setTitle('');
      setDescription('');
      setAllowSearchEngines(false);
      setCollectionItems(selectedItems || []);
    }
  }, [isOpen, editingCollection, selectedItems, allItems]);

  const isAtLimit = !isEditing && userCollectionsCount >= MAX_FREE_COLLECTIONS;

  // Toggle item in/out of the collection
  const handleToggleItemInCollection = (item: ContentItem) => {
    setCollectionItems((prev) => {
      const exists = prev.some((it) => it.id === item.id);
      if (exists) {
        return prev.filter((it) => it.id !== item.id);
      } else {
        if (prev.length >= MAX_COLLECTION_ITEMS) {
          setError(`Collections are capped at a maximum of ${MAX_COLLECTION_ITEMS} items.`);
          return prev;
        }
        setError(null);
        return [...prev, item];
      }
    });
  };

  const handleRemoveItem = (id: string) => {
    setCollectionItems((prev) => prev.filter((it) => it.id !== id));
  };

  // Add all currently filtered items
  const handleAddAllFiltered = (itemsToAdd: ContentItem[]) => {
    setCollectionItems((prev) => {
      const currentIds = new Set(prev.map((i) => i.id));
      const next = [...prev];
      for (const it of itemsToAdd) {
        if (!currentIds.has(it.id)) {
          if (next.length >= MAX_COLLECTION_ITEMS) break;
          next.push(it);
          currentIds.add(it.id);
        }
      }
      return next;
    });
  };

  // Quick Curate: Add a new URL directly into the collection and library
  const handleQuickAddUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLinkUrl.trim()) return;

    setIsFetchingUrl(true);
    setError(null);

    try {
      const meta = await extractMetadata(newLinkUrl.trim());
      const resolvedTitle = newLinkTitle.trim() || meta.title || newLinkUrl.trim();

      const newItemData: Omit<ContentItem, 'id' | 'createdAt'> = {
        title: resolvedTitle,
        url: newLinkUrl.trim(),
        contentType: meta.contentType,
        source: meta.source,
        author: meta.author,
        durationMinutes: meta.durationMinutes || 15,
        durationIsEstimate: true,
        thumbnailUrl: meta.thumbnailUrl,
        status: 'inbox',
      };

      let addedItem: ContentItem;
      if (onAddNewLibraryItem) {
        addedItem = onAddNewLibraryItem(newItemData);
      } else {
        addedItem = {
          ...newItemData,
          id: 'item-' + Date.now().toString(16),
          createdAt: new Date().toISOString(),
        };
      }

      // Add to current collection
      setCollectionItems((prev) => [...prev, addedItem]);
      setNewLinkUrl('');
      setNewLinkTitle('');
      setIsAddingNewLink(false);
    } catch (err: any) {
      setError('Could not extract details from URL. Please try again.');
    } finally {
      setIsFetchingUrl(false);
    }
  };

  // Filtered available items from library/inbox
  const filteredAvailableItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allItems.filter((it) => {
      // Type/Status filter
      if (activeTypeFilter === 'inbox') {
        if (it.status !== 'inbox') return false;
      } else if (activeTypeFilter !== 'all') {
        if (it.contentType !== activeTypeFilter) return false;
      }

      // Search text filter
      if (q) {
        const titleMatch = it.title.toLowerCase().includes(q);
        const sourceMatch = (it.source || it.author || '').toLowerCase().includes(q);
        const topicMatch = (it.topic || '').toLowerCase().includes(q);
        if (!titleMatch && !sourceMatch && !topicMatch) return false;
      }

      return true;
    });
  }, [allItems, searchQuery, activeTypeFilter]);

  const selectedItemIdsSet = useMemo(() => {
    return new Set(collectionItems.map((i) => i.id));
  }, [collectionItems]);

  const totalDuration = useMemo(() => {
    return collectionItems.reduce((acc, it) => acc + (it.durationMinutes || 0), 0);
  }, [collectionItems]);

  const formattedTotal = useMemo(() => {
    if (totalDuration < 60) return `${totalDuration}m`;
    const h = Math.floor(totalDuration / 60);
    const m = totalDuration % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }, [totalDuration]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Please provide a title for your collection.');
      return;
    }

    if (collectionItems.length === 0) {
      setError('Please select at least one item for this collection.');
      return;
    }

    if (collectionItems.length > MAX_COLLECTION_ITEMS) {
      setError(`Collections are limited to ${MAX_COLLECTION_ITEMS} items.`);
      return;
    }

    if (isAtLimit) {
      setError(
        `Free accounts are limited to ${MAX_FREE_COLLECTIONS} collections. Please delete an existing collection first.`
      );
      return;
    }

    setIsSubmitting(true);

    try {
      if (isEditing && editingCollection) {
        // Update existing collection
        const snapshot = createCollectionSnapshot({
          id: editingCollection.id,
          userId: editingCollection.userId || userId || 'guest-user',
          title: title.trim(),
          description: description.trim() || undefined,
          displayName: editingCollection.displayName || displayName || undefined,
          items: collectionItems,
          allowSearchEngines,
        });

        const result = await updateCollectionOnServer(editingCollection.id, {
          title: snapshot.title,
          description: snapshot.description,
          items: snapshot.items as any,
          totalDurationMinutes: snapshot.totalDurationMinutes,
          allowSearchEngines: snapshot.allowSearchEngines,
          isActive: true,
        });

        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const url = `${origin}/c/${editingCollection.id}`;

        setCreatedUrl(url);
        setCreatedCollection(result.collection);
        onCollectionUpdated?.(result.collection);
      } else {
        // Create new collection
        const snapshot = createCollectionSnapshot({
          userId: userId || 'guest-user',
          title: title.trim(),
          description: description.trim() || undefined,
          displayName: displayName || undefined,
          items: collectionItems,
          allowSearchEngines,
        });

        const result = await syncCollectionToServer(snapshot);

        setCreatedUrl(result.url);
        setCreatedCollection(result.collection);
        onCollectionCreated?.(result.collection);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save collection. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl bg-white dark:bg-[#141414] border border-stone-200 dark:border-stone-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4.5 border-b border-stone-100 dark:border-stone-800/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center text-stone-900 dark:text-stone-100">
              <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                {createdUrl
                  ? isEditing
                    ? 'Collection Updated'
                    : 'Collection Published'
                  : isEditing
                  ? `Add Items to "${title || 'Collection'}"`
                  : 'Create Public Collection'}
              </h2>
              <p className="text-xs text-stone-500">
                {createdUrl
                  ? 'Your board is live and ready to share.'
                  : isEditing
                  ? 'Add items by pasting any link or picking from your library.'
                  : 'Curate a Pinterest-style board from your saved media.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-full hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {error && (
            <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {createdUrl ? (
            /* Success View */
            <div className="space-y-5 py-4 animate-in fade-in duration-200">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
                  <Check className="w-6 h-6" />
                </div>
                <h3 className="font-serif text-xl font-medium text-stone-900 dark:text-stone-100">
                  {isEditing ? 'Changes Saved!' : 'Collection Published!'}
                </h3>
                <p className="text-xs text-stone-500 max-w-md mx-auto">
                  Anyone with the link can view your curated Pinterest-style board and import items to their own Curate Inbox.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-stone-50 dark:bg-stone-900/50 border border-stone-200 dark:border-stone-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-stone-700 dark:text-stone-300">Public Link:</span>
                  <span className="text-[11px] text-stone-400">Snapshot &middot; Read-only</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={createdUrl}
                    className="flex-1 px-3 py-2 bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-xl text-xs font-mono text-stone-700 dark:text-stone-300 select-all"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="flex items-center gap-1.5 px-4 py-2 bg-stone-900 text-white dark:bg-white dark:text-stone-900 rounded-xl text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shrink-0"
                  >
                    {hasCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-600" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 text-xs text-stone-600 dark:text-stone-400">
                <div className="flex items-center gap-2">
                  {allowSearchEngines ? (
                    <Globe className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Lock className="w-4 h-4 text-stone-400" />
                  )}
                  <span>
                    {allowSearchEngines
                      ? 'Indexable by search engines (SEO enabled)'
                      : 'Unlisted (noindex, accessible via direct link only)'}
                  </span>
                </div>
                <a
                  href={createdUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 font-medium text-stone-900 dark:text-stone-100 hover:underline cursor-pointer"
                >
                  <span>Open Board</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ) : (
            /* Creation / Edit Form */
            <form id="collection-form" onSubmit={handleSubmit} className="space-y-4">
              {/* Account Limits Notice */}
              {!isEditing && (
                <div className="flex items-center justify-between text-[11px] text-stone-500 px-1">
                  <span>
                    Free plan allowance: {userCollectionsCount} / {MAX_FREE_COLLECTIONS} collections used
                  </span>
                  {isAtLimit && (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      Limit reached
                    </span>
                  )}
                </div>
              )}

              {/* Title Input - Always accessible at top */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-medium text-stone-800 dark:text-stone-200">
                    Collection Title <span className="text-red-500">*</span>
                  </label>
                  <span
                    className={`text-[11px] ${
                      title.length > MAX_COLLECTION_TITLE_LENGTH
                        ? 'text-red-500 font-bold'
                        : 'text-stone-400'
                    }`}
                  >
                    {title.length}/{MAX_COLLECTION_TITLE_LENGTH}
                  </span>
                </div>
                <input
                  type="text"
                  required
                  placeholder="e.g. Cognitive Science Masterclass, Architecture Essentials"
                  value={title}
                  maxLength={MAX_COLLECTION_TITLE_LENGTH}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/50 text-stone-900 dark:text-stone-100 text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400 transition-all font-serif"
                />
              </div>

              {/* Mode Tabs: Add by Link / Pick from Library / Board Details */}
              <div className="flex items-center gap-1.5 border-b border-stone-200/80 dark:border-stone-800 pb-2 pt-1">
                <button
                  type="button"
                  onClick={() => setModalTab('add_link')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                    modalTab === 'add_link'
                      ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 font-semibold shadow-xs'
                      : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 stroke-[2.5]" />
                  <span>+ Quick Add by Link</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalTab('library')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                    modalTab === 'library'
                      ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 font-semibold shadow-xs'
                      : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>Pick from Library ({allItems.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalTab('details')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                    modalTab === 'details'
                      ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 font-semibold shadow-xs'
                      : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Board Settings</span>
                </button>
              </div>

              {/* Tab 1: Quick Add by Link */}
              {modalTab === 'add_link' && (
                <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/40 space-y-2.5 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-amber-900 dark:text-amber-200 uppercase tracking-wider block">
                      Add New Media by Link
                    </span>
                    <span className="text-[10px] text-amber-700/80 dark:text-amber-400/80">
                      YouTube, Articles, Substack, Podcasts
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="url"
                      placeholder="https://youtube.com/watch?v=... or article URL"
                      value={newLinkUrl}
                      onChange={(e) => setNewLinkUrl(e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs text-stone-900 dark:text-stone-100 focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    />
                    <input
                      type="text"
                      placeholder="Title (optional)"
                      value={newLinkTitle}
                      onChange={(e) => setNewLinkTitle(e.target.value)}
                      className="sm:w-48 px-3 py-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs text-stone-900 dark:text-stone-100 focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={handleQuickAddUrl}
                      disabled={isFetchingUrl || !newLinkUrl.trim()}
                      className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-stone-950 rounded-xl text-xs font-semibold disabled:opacity-50 cursor-pointer shrink-0 transition-colors shadow-xs"
                    >
                      {isFetchingUrl ? 'Adding...' : '+ Add Link'}
                    </button>
                  </div>
                  <p className="text-[10px] text-stone-500 dark:text-stone-400 leading-normal">
                    This link will be fetched, added to your Curate library, and included in this collection automatically.
                  </p>
                </div>
              )}

              {/* Tab 2: Pick from Library */}
              {modalTab === 'library' && (
                <div className="space-y-2.5 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                      <Filter className="w-3.5 h-3.5 text-stone-500" />
                      <span>Select Items from Your Library</span>
                    </span>

                    {filteredAvailableItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleAddAllFiltered(filteredAvailableItems)}
                        className="text-[11px] text-amber-700 dark:text-amber-300 hover:underline font-medium cursor-pointer"
                      >
                        + Add all filtered ({filteredAvailableItems.length})
                      </button>
                    )}
                  </div>

                  {/* Search & Filter pills */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                      <input
                        type="text"
                        placeholder="Search by title, source, or creator..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/50 text-xs text-stone-900 dark:text-stone-100 focus:outline-hidden focus:ring-1 focus:ring-stone-400"
                      />
                    </div>

                    <div className="flex items-center gap-1 overflow-x-auto text-[11px] font-sans">
                      {(
                        [
                          { id: 'all', label: 'All' },
                          { id: 'inbox', label: 'Inbox' },
                          { id: 'youtube', label: 'Videos' },
                          { id: 'article', label: 'Articles' },
                          { id: 'podcast', label: 'Podcasts' },
                          { id: 'book', label: 'Books' },
                        ] as const
                      ).map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setActiveTypeFilter(f.id)}
                          className={`px-2 py-1 rounded-lg transition-colors cursor-pointer shrink-0 ${
                            activeTypeFilter === f.id
                              ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900 font-medium'
                              : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Interactive Item Checklist */}
                  <div className="max-h-48 overflow-y-auto space-y-1 pr-1 border border-stone-200 dark:border-stone-800 rounded-2xl p-2 bg-stone-50/30 dark:bg-stone-950/20">
                    {filteredAvailableItems.length === 0 ? (
                      <div className="py-6 text-center text-xs text-stone-400">
                        {allItems.length === 0
                          ? 'Your library is empty. Click "+ Quick Add by Link" above to add items!'
                          : 'No items match your search filter.'}
                      </div>
                    ) : (
                      filteredAvailableItems.map((item) => {
                        const isSelected = selectedItemIdsSet.has(item.id);
                        return (
                          <div
                            key={item.id}
                            onClick={() => handleToggleItemInCollection(item)}
                            className={`flex items-center justify-between p-2 rounded-xl border text-xs transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-100'
                                : 'bg-white dark:bg-stone-900/60 border-stone-200/60 dark:border-stone-800/80 hover:border-stone-300 text-stone-800 dark:text-stone-200'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <div
                                className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                                  isSelected
                                    ? 'bg-amber-600 border-amber-600 text-white'
                                    : 'border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800'
                                }`}
                              >
                                {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                              </div>

                              {item.thumbnailUrl ? (
                                <img
                                  src={item.thumbnailUrl}
                                  alt=""
                                  className="w-9 h-6 object-cover rounded-md shrink-0 bg-stone-100 dark:bg-stone-800"
                                />
                              ) : (
                                <div className="w-9 h-6 rounded-md bg-stone-100 dark:bg-stone-800 shrink-0 flex items-center justify-center text-[10px] text-stone-500">
                                  ✦
                                </div>
                              )}

                              <div className="min-w-0 flex-1">
                                <h4 className="font-serif text-xs truncate leading-snug">
                                  {item.title}
                                </h4>
                                <div className="flex items-center gap-1.5 text-[10px] text-stone-500 dark:text-stone-400">
                                  <span>{getItemSource(item)}</span>
                                  <span>&middot;</span>
                                  <span className="capitalize">{item.contentType}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className="text-[11px] text-stone-500 font-mono">
                                {item.durationMinutes ? `${item.durationMinutes}m` : '0m'}
                              </span>
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                  isSelected
                                    ? 'bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100'
                                    : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400'
                                }`}
                              >
                                {isSelected ? 'In Board' : '+ Add'}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: Board Settings */}
              {modalTab === 'details' && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  {/* Description Input */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <label className="font-medium text-stone-800 dark:text-stone-200">
                        Description <span className="text-stone-400 font-normal">(optional, plain text)</span>
                      </label>
                      <span
                        className={`text-[11px] ${
                          description.length > MAX_COLLECTION_DESC_LENGTH
                            ? 'text-red-500 font-bold'
                            : 'text-stone-400'
                        }`}
                      >
                        {description.length}/{MAX_COLLECTION_DESC_LENGTH}
                      </span>
                    </div>
                    <textarea
                      rows={2}
                      placeholder="A curated series of deep dives on complex mental models, curated from long-form writing and lectures."
                      value={description}
                      maxLength={MAX_COLLECTION_DESC_LENGTH}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/50 text-stone-900 dark:text-stone-100 text-xs focus:outline-hidden focus:ring-2 focus:ring-stone-400 dark:focus:ring-stone-600 transition-all resize-none"
                    />
                  </div>

                  {/* Allow Search Engines Toggle */}
                  <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-stone-900/40 border border-stone-200/80 dark:border-stone-800 flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <label
                        htmlFor="seo-toggle"
                        className="text-xs font-semibold text-stone-900 dark:text-stone-100 cursor-pointer"
                      >
                        Allow search engines
                      </label>
                      <p className="text-[11px] text-stone-500 dark:text-stone-400 leading-normal">
                        Off by default (noindex). Turn on to publish this collection for Google and search engine indexing.
                      </p>
                    </div>
                    <input
                      id="seo-toggle"
                      type="checkbox"
                      checked={allowSearchEngines}
                      onChange={(e) => setAllowSearchEngines(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded-sm border-stone-300 text-stone-900 focus:ring-stone-400 dark:border-stone-700 dark:bg-stone-800 cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {/* Items in Collection Header & List (Always visible below the tabs) */}
              <div className="pt-2 border-t border-stone-200/60 dark:border-stone-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                      Collection Items ({collectionItems.length} / {MAX_COLLECTION_ITEMS})
                    </span>
                    <span className="text-stone-400 text-xs ml-2">&middot; {formattedTotal}</span>
                  </div>
                  {collectionItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCollectionItems([])}
                      className="text-[10px] text-stone-400 hover:text-red-500 cursor-pointer"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {/* Selected items chips/list */}
                {collectionItems.length > 0 ? (
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 divide-y divide-stone-100 dark:divide-stone-850 bg-stone-50/50 dark:bg-stone-900/30 p-2.5 rounded-2xl border border-stone-200/60 dark:border-stone-800">
                    {collectionItems.map((it) => (
                      <div
                        key={it.id}
                        className="pt-1.5 first:pt-0 flex items-center justify-between gap-2.5 text-xs text-stone-800 dark:text-stone-200"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {it.thumbnailUrl ? (
                            <img
                              src={it.thumbnailUrl}
                              alt=""
                              className="w-7 h-5 object-cover rounded-md shrink-0 bg-stone-100 dark:bg-stone-800"
                            />
                          ) : (
                            <div className="w-7 h-5 rounded-md bg-stone-200 dark:bg-stone-800 shrink-0 flex items-center justify-center text-[9px]">
                              ✦
                            </div>
                          )}
                          <span className="truncate">{it.title}</span>
                          <span className="text-[10px] text-stone-400 capitalize shrink-0">
                            ({it.contentType || 'media'})
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-stone-400">
                          <span className="text-[11px]">
                            {it.durationMinutes ? `${it.durationMinutes}m` : '0m'}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(it.id)}
                            className="p-1 text-stone-400 hover:text-red-500 rounded-sm transition-colors cursor-pointer"
                            title="Remove from collection"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 text-center bg-stone-50 dark:bg-stone-900/30 rounded-xl border border-dashed border-stone-200 dark:border-stone-800 text-xs text-stone-400">
                    No items added yet. Use "+ Quick Add by Link" or "Pick from Library" above to add items!
                  </div>
                )}
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-stone-100 dark:border-stone-800/80 bg-stone-50/50 dark:bg-stone-900/50 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
          >
            {createdUrl ? 'Done' : 'Cancel'}
          </button>

          {!createdUrl && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-stone-500 hidden sm:inline">
                {collectionItems.length} {collectionItems.length === 1 ? 'item' : 'items'} selected
              </span>
              <button
                type="submit"
                form="collection-form"
                disabled={isSubmitting || collectionItems.length === 0 || isAtLimit || !title.trim()}
                className="px-5 py-2 bg-stone-900 text-white dark:bg-white dark:text-stone-900 rounded-xl text-xs font-semibold hover:opacity-90 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {isSubmitting
                  ? isEditing
                    ? 'Saving...'
                    : 'Publishing...'
                  : isEditing
                  ? 'Save Collection Changes'
                  : 'Publish Collection'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
