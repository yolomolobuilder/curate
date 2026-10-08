import React, { useRef, useState } from 'react';
import {
  X,
  Download,
  Upload,
  Trash2,
  Sparkles,
  Database,
  Check,
  ShieldCheck,
  ChevronRight,
  AlertCircle,
  FileCheck,
} from 'lucide-react';
import {
  exportBackupJson,
  importBackupJson,
  validateBackupData,
  BackupValidationSummary,
} from '../lib/storage';
import { getTodayStr } from '../lib/dateUtils';
import { runSelfCheckTests, SelfCheckSuiteResult } from '../lib/selfCheck';

interface SettingsBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadStarterPack: () => void;
  onClearAll: () => void;
  onDataReloaded: () => void;
  totalItems: number;
}

export const SettingsBackupModal: React.FC<SettingsBackupModalProps> = ({
  isOpen,
  onClose,
  onLoadStarterPack,
  onClearAll,
  onDataReloaded,
  totalItems,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selfCheckResult, setSelfCheckResult] = useState<SelfCheckSuiteResult | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    summary: BackupValidationSummary;
    rawContent: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleRunSelfCheck = () => {
    const res = runSelfCheckTests();
    setSelfCheckResult(res);
  };

  const handleExport = () => {
    const json = exportBackupJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `curatecal-backup-${getTodayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) {
        setErrorMsg('The selected file is empty.');
        setPendingImport(null);
        return;
      }
      const validation = validateBackupData(content);
      if (!validation.valid) {
        setErrorMsg(validation.error || 'Invalid backup file format.');
        setPendingImport(null);
      } else {
        setErrorMsg(null);
        setPendingImport({
          summary: validation,
          rawContent: content,
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmImport = () => {
    if (!pendingImport) return;
    const ok = importBackupJson(pendingImport.rawContent);
    if (ok) {
      setImportSuccess(true);
      setErrorMsg(null);
      setPendingImport(null);
      onDataReloaded();
      setTimeout(() => {
        setImportSuccess(false);
        onClose();
      }, 1400);
    } else {
      setErrorMsg('Failed to apply imported backup.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-md bg-[#FAF8F5] dark:bg-[#181716] rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-stone-800 shrink-0">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-stone-600 dark:text-stone-300" />
            <h3 className="font-serif text-lg font-semibold text-stone-900 dark:text-stone-100">
              Data & Storage
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Visible Note: Guest data lives in this browser only */}
          <div className="p-3.5 rounded-xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/25 text-amber-950 dark:text-amber-200">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <span className="font-semibold block font-sans">
                  Guest data lives in this browser only
                </span>
                <p className="mt-0.5 text-stone-600 dark:text-stone-300 leading-relaxed font-sans">
                  Your curated library, calendar schedule, and themes are stored locally on this device.
                  No data is sent to a remote cloud server. Use <strong>Export Backup</strong> to preserve or transfer your data before clearing browser history.
                </p>
              </div>
            </div>
          </div>

          {importSuccess && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2 font-medium">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>Backup restored successfully! Updating library…</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 text-xs">
              {errorMsg}
            </div>
          )}

          {/* Pending Import Validation & Confirmation Card */}
          {pendingImport && (
            <div className="p-4 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-850 shadow-md space-y-3">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h4 className="font-sans text-xs font-semibold text-stone-900 dark:text-stone-100">
                  Backup Verified (Schema v{pendingImport.summary.schemaVersion})
                </h4>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-stone-50 dark:bg-stone-900 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800">
                <div>
                  <span className="text-stone-500 block text-[10px] uppercase">Total Items</span>
                  <span className="font-semibold text-stone-800 dark:text-stone-200">
                    {pendingImport.summary.itemCount} items
                  </span>
                </div>
                <div>
                  <span className="text-stone-500 block text-[10px] uppercase">Status</span>
                  <span className="text-stone-700 dark:text-stone-300 text-[11px]">
                    {pendingImport.summary.inboxCount} inbox · {pendingImport.summary.plannedCount} planned · {pendingImport.summary.completedCount} done
                  </span>
                </div>
                {pendingImport.summary.themesCount > 0 && (
                  <div>
                    <span className="text-stone-500 block text-[10px] uppercase">Day Themes</span>
                    <span className="text-stone-700 dark:text-stone-300 text-[11px]">
                      {pendingImport.summary.themesCount} themes
                    </span>
                  </div>
                )}
                {pendingImport.summary.exportedAt && (
                  <div>
                    <span className="text-stone-500 block text-[10px] uppercase">Export Date</span>
                    <span className="text-stone-700 dark:text-stone-300 text-[11px]">
                      {pendingImport.summary.exportedAt.slice(0, 10)}
                    </span>
                  </div>
                )}
              </div>

              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-900 dark:text-amber-200">
                <span className="font-semibold block font-sans">⚠️ Replace Existing Data?</span>
                <p className="mt-0.5 leading-relaxed font-sans">
                  This will replace your current {totalItems} items with the {pendingImport.summary.itemCount} items from this backup.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPendingImport(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-sans text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 border border-stone-200 dark:border-stone-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-sans font-medium bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
                >
                  Confirm & Replace All
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            {/* Starter pack */}
            <button
              onClick={() => {
                onLoadStarterPack();
                onClose();
              }}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 hover:bg-amber-100/70 dark:hover:bg-amber-900/40 transition-colors text-left"
            >
              <div>
                <span className="font-serif text-sm font-semibold text-amber-950 dark:text-amber-100 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Load Curated Starter Pack</span>
                </span>
                <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5">
                  Populate inspiring videos, podcasts, articles, and books
                </p>
              </div>
            </button>

            {/* Self-Check Tests Verification */}
            <div className="p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/60 dark:bg-stone-900/60 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-sans text-xs font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Self-Check Verification Tests</span>
                  </span>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    Automated invariant tests for time accounting, local dates, and activation
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRunSelfCheck}
                  className="px-2.5 py-1 rounded-lg text-xs font-sans font-medium bg-black text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity cursor-pointer shrink-0"
                >
                  {selfCheckResult ? 'Re-run Tests' : 'Run Tests'}
                </button>
              </div>

              {selfCheckResult && (
                <div className="mt-2 space-y-1.5 pt-2 border-t border-stone-200/60 dark:border-stone-800/60">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className={selfCheckResult.success ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-red-600 font-semibold'}>
                      {selfCheckResult.success ? '✅ All Invariants Verified' : `❌ ${selfCheckResult.failed} Failed`}
                    </span>
                    <span className="text-stone-400">
                      {selfCheckResult.passed}/{selfCheckResult.total} passed
                    </span>
                  </div>
                  {selfCheckResult.results.map((r) => (
                    <div
                      key={r.id}
                      className="p-2 rounded-lg bg-white dark:bg-stone-850 border border-stone-200/50 dark:border-stone-800 text-[11px]"
                    >
                      <div className="flex items-center gap-1.5 font-medium text-stone-800 dark:text-stone-200">
                        <span>{r.passed ? '✅' : '❌'}</span>
                        <span className="truncate">{r.name}</span>
                      </div>
                      <p className="text-[10px] text-stone-500 mt-0.5 pl-4 font-mono leading-relaxed">
                        {r.message}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Export */}
            <button
              onClick={handleExport}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors text-left"
            >
              <div>
                <span className="font-sans text-xs font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Backup (JSON)</span>
                </span>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  Download all {totalItems} saved items and weekly themes
                </p>
              </div>
            </button>

            {/* Import */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors text-left"
            >
              <div>
                <span className="font-sans text-xs font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import Backup (JSON)</span>
                </span>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  Restore previously exported calendar data
                </p>
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="hidden"
            />

            {/* Clear All Data */}
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to clear all data? This cannot be undone.')) {
                  onClearAll();
                  onClose();
                }
              }}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-red-200/60 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors text-left"
            >
              <div>
                <span className="font-sans text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear All Data</span>
                </span>
                <p className="text-[11px] text-red-500/80 mt-0.5">
                  Reset to clean blank slate
                </p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
