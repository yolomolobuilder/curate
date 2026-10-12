import React from 'react';
import { X, GitMerge, Check, AlertTriangle, ArrowRight } from 'lucide-react';
import { SnapshotConflict } from '../lib/dataStore';

interface SyncConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflicts: SnapshotConflict[];
}

export const SyncConflictModal: React.FC<SyncConflictModalProps> = ({
  isOpen,
  onClose,
  conflicts,
}) => {
  if (!isOpen || conflicts.length === 0) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cloud Sync Resolution Notice"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-lg bg-white dark:bg-[#141414] border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-stone-850 bg-stone-50/70 dark:bg-stone-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center">
              <GitMerge className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-serif italic text-base font-bold text-stone-900 dark:text-stone-100">
                Multi-Device Sync Resolution
              </h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {conflicts.length} item{conflicts.length === 1 ? '' : 's'} had differing edits across devices
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Conflict list */}
        <div className="p-6 overflow-y-auto space-y-3 text-xs">
          <p className="text-stone-600 dark:text-stone-300">
            Curate merged items from this device and the cloud without silently dropping any entries. When an item was edited on multiple devices, the version with the newer <code className="font-mono text-[11px] bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded">updatedAt</code> timestamp was preserved:
          </p>

          <div className="space-y-2.5 divide-y divide-stone-100 dark:divide-stone-800 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
            {conflicts.map((conflict, idx) => {
              const winningItem = conflict.winner === 'local' ? conflict.localItem : conflict.remoteItem;
              const supersededItem = conflict.winner === 'local' ? conflict.remoteItem : conflict.localItem;

              return (
                <div key={idx} className="p-3 bg-white dark:bg-[#181818] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-stone-900 dark:text-stone-100 truncate max-w-[280px]">
                      {winningItem.title}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        conflict.winner === 'remote'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      }`}
                    >
                      {conflict.winner === 'remote' ? 'Cloud version kept' : 'Local version kept'}
                    </span>
                  </div>

                  <p className="text-[11px] text-stone-500 dark:text-stone-400">
                    {conflict.reason}
                  </p>

                  <div className="text-[10px] font-mono text-stone-400 flex items-center gap-2">
                    <span>Winner: {winningItem.updatedAt?.slice(0, 19).replace('T', ' ')}</span>
                    <span>·</span>
                    <span>Superseded: {supersededItem.updatedAt?.slice(0, 19).replace('T', ' ')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 dark:border-stone-850 bg-stone-50/50 dark:bg-stone-900/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-stone-900 text-white dark:bg-white dark:text-stone-900 text-xs font-medium hover:opacity-90 transition-opacity"
          >
            Acknowledge &amp; Continue
          </button>
        </div>
      </div>
    </div>
  );
};
