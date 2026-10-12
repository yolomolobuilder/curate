import React, { useState } from 'react';
import {
  X,
  User,
  Download,
  FileSpreadsheet,
  FileJson,
  LogOut,
  Trash2,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { ContentItem } from '../types';
import { exportBackupJson } from '../lib/storage';
import { exportItemsToCsv, cloudStore } from '../lib/cloudStore';
import { getTodayStr } from '../lib/dateUtils';

interface AccountMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: SupabaseUser;
  items: ContentItem[];
  onSignedOut: () => void;
  onAccountDeleted: () => void;
}

export const AccountMenuModal: React.FC<AccountMenuModalProps> = ({
  isOpen,
  onClose,
  user,
  items,
  onSignedOut,
  onAccountDeleted,
}) => {
  const [showDeleteFlow, setShowDeleteFlow] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExportJson = () => {
    const json = exportBackupJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `curate-cloud-backup-${getTodayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const csv = exportItemsToCsv(items);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `curate-library-${getTodayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSignOut = async () => {
    await cloudStore.signOut();
    onSignedOut();
    onClose();
  };

  const handleConfirmDelete = async () => {
    if (confirmInput.trim() !== 'DELETE') return;
    setIsDeleting(true);
    setDeleteError(null);

    const { success, error } = await cloudStore.deleteUserAccount();
    setIsDeleting(false);

    if (success) {
      onAccountDeleted();
      onClose();
    } else {
      setDeleteError(error || 'Failed to delete account');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Account Settings"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md bg-white dark:bg-[#141414] border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-stone-850 bg-stone-50/70 dark:bg-stone-900/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-stone-900 text-white dark:bg-white dark:text-stone-900 flex items-center justify-center text-xs font-bold font-serif">
              {user.email ? user.email.charAt(0).toUpperCase() : 'U'}
            </div>
            <div className="truncate">
              <h3 className="text-xs font-medium text-stone-900 dark:text-stone-100 truncate max-w-[200px]">
                {user.email}
              </h3>
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                Cloud sync active · {items.length} item{items.length === 1 ? '' : 's'}
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

        {/* Content Body */}
        <div className="p-6 space-y-4">
          {!showDeleteFlow ? (
            <>
              {/* Export Section */}
              <div className="space-y-2">
                <span className="text-[10px] uppercase font-semibold text-stone-400 tracking-wider">
                  Export Data
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleExportJson}
                    className="p-3 rounded-xl border border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-850 flex flex-col items-center gap-1.5 text-stone-700 dark:text-stone-300 transition-colors cursor-pointer"
                  >
                    <FileJson className="w-4 h-4 text-stone-500" />
                    <span className="text-xs font-medium">Export JSON</span>
                    <span className="text-[10px] text-stone-400">Full backup with tags</span>
                  </button>
                  <button
                    onClick={handleExportCsv}
                    className="p-3 rounded-xl border border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-850 flex flex-col items-center gap-1.5 text-stone-700 dark:text-stone-300 transition-colors cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-xs font-medium">Export CSV</span>
                    <span className="text-[10px] text-stone-400">Spreadsheet table</span>
                  </button>
                </div>
              </div>

              {/* Account Actions */}
              <div className="space-y-2 pt-2 border-t border-stone-100 dark:border-stone-850">
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full py-2.5 px-3 rounded-xl border border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-850 flex items-center justify-between text-xs text-stone-700 dark:text-stone-300 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <LogOut className="w-3.5 h-3.5 text-stone-400" />
                    <span>Sign Out</span>
                  </span>
                  <span className="text-[10px] text-stone-400">Switch to Guest Mode</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowDeleteFlow(true)}
                  className="w-full py-2.5 px-3 rounded-xl border border-red-200/50 dark:border-red-950/50 bg-red-50/30 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-between text-xs text-red-600 dark:text-red-400 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Account</span>
                  </span>
                  <span className="text-[10px] text-red-400/80">Permanent purge</span>
                </button>
              </div>
            </>
          ) : (
            /* Delete Confirmation Flow */
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-800 dark:text-red-300 space-y-1.5 text-xs">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                  <span>Delete account & all cloud data</span>
                </div>
                <p className="text-[11px] leading-relaxed text-red-700/90 dark:text-red-300/90">
                  This action is permanent and irreversible. It will immediately cascade delete all your saved items, settings, screenshots, and account credentials from the cloud database.
                </p>
              </div>

              {/* Step 1: Export prompt */}
              <div className="p-3 rounded-xl bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 space-y-2">
                <span className="text-xs font-medium text-stone-800 dark:text-stone-200">
                  Backup your data first?
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleExportJson}
                    className="flex-1 py-1.5 px-2.5 rounded-lg border border-stone-300 dark:border-stone-700 text-[11px] text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-3 h-3" /> JSON
                  </button>
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="flex-1 py-1.5 px-2.5 rounded-lg border border-stone-300 dark:border-stone-700 text-[11px] text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-3 h-3" /> CSV
                  </button>
                </div>
              </div>

              {/* Step 2: Typed confirmation */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-stone-600 dark:text-stone-400 block">
                  To confirm, type <strong className="font-mono text-red-600 dark:text-red-400">DELETE</strong> below:
                </label>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder="DELETE"
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs font-mono text-stone-900 dark:text-stone-100 focus:outline-hidden focus:ring-1 focus:ring-red-500"
                />
              </div>

              {deleteError && (
                <p className="text-xs text-red-600 dark:text-red-400">{deleteError}</p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteFlow(false)}
                  className="flex-1 py-2 px-3 rounded-xl border border-stone-200 dark:border-stone-800 text-xs text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={confirmInput.trim() !== 'DELETE' || isDeleting}
                  onClick={handleConfirmDelete}
                  className="flex-1 py-2 px-3 rounded-xl bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  {isDeleting ? 'Deleting...' : 'Permanently Delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
