import React, { useState } from 'react';
import {
  Sparkles,
  Plus,
  Globe,
  Lock,
  Copy,
  Check,
  ExternalLink,
  Trash2,
  Clock,
  Layers,
  Eye,
  EyeOff,
  AlertCircle,
  Edit3,
  BookmarkPlus,
} from 'lucide-react';
import {
  SharedCollectionRecord,
  deleteCollectionOnServer,
  updateCollectionOnServer,
} from '../lib/collections';
import { MAX_FREE_COLLECTIONS } from '../types';

interface CollectionsViewProps {
  collections: SharedCollectionRecord[];
  onOpenCreateModal: () => void;
  onRefreshCollections: () => void;
  onEditCollection?: (collection: SharedCollectionRecord) => void;
  onOpenAddContent?: () => void;
  onNavigateToInbox?: () => void;
  onNavigateToHome?: () => void;
}

export const CollectionsView: React.FC<CollectionsViewProps> = ({
  collections,
  onOpenCreateModal,
  onRefreshCollections,
  onEditCollection,
  onOpenAddContent,
  onNavigateToInbox,
  onNavigateToHome,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const activeCollections = collections.filter((c) => c.isActive);
  const activeCount = activeCollections.length;
  const isAtLimit = activeCount >= MAX_FREE_COLLECTIONS;

  const handleCopyLink = async (col: SharedCollectionRecord) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}/c/${col.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(col.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback
    }
  };

  const handleToggleSeo = async (col: SharedCollectionRecord) => {
    setUpdatingId(col.id);
    try {
      await updateCollectionOnServer(col.id, {
        allowSearchEngines: !col.allowSearchEngines,
      });
      onRefreshCollections();
    } catch (err) {
      console.error('Failed to update SEO setting:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleToggleActive = async (col: SharedCollectionRecord) => {
    setUpdatingId(col.id);
    try {
      await updateCollectionOnServer(col.id, {
        isActive: !col.isActive,
      });
      onRefreshCollections();
    } catch (err) {
      console.error('Failed to update active state:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setUpdatingId(id);
    try {
      await deleteCollectionOnServer(id);
      setDeleteConfirmId(null);
      onRefreshCollections();
    } catch (err) {
      console.error('Failed to delete collection:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const formatTotalTime = (mins: number) => {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8 animate-in fade-in duration-200">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-8 border-b border-stone-200/60 dark:border-stone-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Curation Boards
            </span>
            <span className="text-stone-300 dark:text-stone-700">&middot;</span>
            <span className="text-xs text-stone-500">
              {activeCount} of {MAX_FREE_COLLECTIONS} free collections used
            </span>
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl font-normal text-stone-900 dark:text-stone-100 tracking-tight">
            Share Collections
          </h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-1 max-w-xl">
            Publish public Pinterest-style boards from your saved media. Anyone can browse, learn, and import directly to their Curate Inbox.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {onOpenAddContent && (
            <button
              type="button"
              onClick={onOpenAddContent}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-full border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-850 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add Content</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenCreateModal}
            disabled={isAtLimit}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-stone-900 text-white dark:bg-white dark:text-stone-900 text-xs font-semibold hover:opacity-90 active:scale-95 transition-all shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <BookmarkPlus className="w-4 h-4" />
            <span>Create Collection</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      {collections.length === 0 ? (
        /* Empty State */
        <div className="py-20 flex flex-col items-center justify-center text-center max-w-md mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-stone-100 dark:bg-stone-800 flex items-center justify-center text-stone-400 dark:text-stone-500 mb-4">
            <Layers className="w-7 h-7" />
          </div>
          <h2 className="font-serif text-2xl font-normal text-stone-900 dark:text-stone-100 mb-2">
            No public collections yet
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed mb-6">
            Create an aesthetic public board like Pinterest. Easily select articles, YouTube videos, and podcasts from your library or paste new links.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onOpenCreateModal}
              className="px-4 py-2.5 rounded-full bg-stone-900 text-white dark:bg-white dark:text-stone-900 text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
            >
              Create First Collection
            </button>
            {onOpenAddContent && (
              <button
                type="button"
                onClick={onOpenAddContent}
                className="px-4 py-2.5 rounded-full border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300 text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
              >
                + Add Content to Library
              </button>
            )}
            {onNavigateToInbox && (
              <button
                type="button"
                onClick={onNavigateToInbox}
                className="px-4 py-2.5 rounded-full border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300 text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
              >
                Open Inbox
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Grid of Collections */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-8">
          {collections.map((col) => {
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const publicUrl = `${origin}/c/${col.id}`;
            const isCopied = copiedId === col.id;
            const isDeleting = deleteConfirmId === col.id;
            const isUpdating = updatingId === col.id;

            return (
              <div
                key={col.id}
                className={`flex flex-col bg-white dark:bg-stone-900/60 border rounded-2xl p-5 shadow-xs transition-all ${
                  col.isActive
                    ? 'border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700'
                    : 'border-stone-200/50 dark:border-stone-850 opacity-60'
                }`}
              >
                {/* Top Badge & Active Indicator */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        col.isActive ? 'bg-emerald-500' : 'bg-stone-400'
                      }`}
                    />
                    <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wider">
                      {col.isActive ? 'Active' : 'Unpublished (410)'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleSeo(col)}
                      disabled={isUpdating}
                      title={
                        col.allowSearchEngines
                          ? 'Search engines enabled (index, follow)'
                          : 'Search engines disabled (noindex)'
                      }
                      className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                        col.allowSearchEngines
                          ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                          : 'border-stone-200 dark:border-stone-800 text-stone-400'
                      }`}
                    >
                      {col.allowSearchEngines ? (
                        <Globe className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Lock className="w-3 h-3" />
                      )}
                      <span>{col.allowSearchEngines ? 'SEO Index' : 'Noindex'}</span>
                    </button>
                  </div>
                </div>

                {/* Title & Description */}
                <h2 className="font-serif text-xl font-medium text-stone-900 dark:text-stone-100 mb-1.5 line-clamp-2">
                  {col.title}
                </h2>
                {col.description ? (
                  <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 mb-4 leading-relaxed">
                    {col.description}
                  </p>
                ) : (
                  <p className="text-xs text-stone-400 italic mb-4">No description provided</p>
                )}

                {/* Metrics */}
                <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400 py-2.5 border-y border-stone-100 dark:border-stone-800/80 mb-4">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-stone-400" />
                      <strong>{col.items.length}</strong> items
                    </span>
                    <span>&middot;</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-stone-400" />
                      <strong>{formatTotalTime(col.totalDurationMinutes)}</strong>
                    </span>
                  </div>

                  {/* Add / Edit Items button */}
                  {onEditCollection && (
                    <button
                      type="button"
                      onClick={() => onEditCollection(col)}
                      className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>+ Add Items</span>
                    </button>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleCopyLink(col)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 text-xs font-medium transition-colors cursor-pointer"
                      title="Copy Public Link"
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="text-emerald-600 font-semibold">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-stone-500" />
                          <span>Copy Link</span>
                        </>
                      )}
                    </button>

                    <a
                      href={`/c/${col.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
                      title="Open Public Board"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Active/Inactive Toggle */}
                    <button
                      type="button"
                      onClick={() => handleToggleActive(col)}
                      disabled={isUpdating}
                      title={col.isActive ? 'Deactivate board' : 'Reactivate board'}
                      className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                    >
                      {col.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>

                    {/* Delete button */}
                    {isDeleting ? (
                      <div className="flex items-center gap-1 bg-red-50 dark:bg-red-950/40 p-1 rounded-lg">
                        <button
                          type="button"
                          onClick={() => handleDelete(col.id)}
                          className="px-2 py-0.5 rounded text-[11px] font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="px-1.5 py-0.5 rounded text-[11px] text-stone-500 hover:text-stone-700 transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(col.id)}
                        disabled={isUpdating}
                        title="Delete collection (returns 410 Gone)"
                        className="p-1.5 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
