import React, { useRef, useState, useEffect } from 'react';
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
  HardDrive,
  AlertTriangle,
  Image as ImageIcon,
  Copy,
  Youtube,
  RefreshCw,
  Info,
  Settings as SettingsIcon,
} from 'lucide-react';
import { APP_VERSION, BUILD_DATE_STRING } from '../lib/buildInfo';
import {
  refreshAllEstimatedYouTubeItems,
  getYouTubeApiKey,
} from '../lib/youtubeDuration';
import { getStoredItems, saveStoredItems } from '../lib/storage';
import {
  getCustomBrandLogo,
  saveCustomBrandLogo,
} from '../lib/brand';
import { CurateLogo } from './CurateLogo';
import {
  exportBackupJson,
  importBackupJson,
  validateBackupData,
  BackupValidationSummary,
  getStoredDayPreferencesEnabled,
  saveStoredDayPreferencesEnabled,
  getStorageUsageStats,
  getStorageFailureInfo,
  StorageUsageStats,
  StorageFailureInfo,
} from '../lib/storage';
import { getTodayStr } from '../lib/dateUtils';
import { runSelfCheckTests, SelfCheckSuiteResult } from '../lib/selfCheck';
import {
  getStoredAnalyticsEvents,
  clearAnalyticsEvents,
  copySessionLogToClipboard,
} from '../lib/analytics';
import {
  isAnalyticsDisabled,
  setAnalyticsDisabled,
} from '../lib/analyticsConfig';

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
  const [storageStats, setStorageStats] = useState<StorageUsageStats>(() => getStorageUsageStats());
  const [storageFailure, setStorageFailure] = useState<StorageFailureInfo | null>(() =>
    getStorageFailureInfo()
  );
  const [dayPreferencesEnabled, setDayPreferencesEnabled] = useState(() =>
    getStoredDayPreferencesEnabled()
  );
  const [currentLogo, setCurrentLogo] = useState<string | null>(() => getCustomBrandLogo());
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<{
    summary: BackupValidationSummary;
    rawContent: string;
  } | null>(null);

  const [analyticsOff, setAnalyticsOff] = useState(() => isAnalyticsDisabled());
  const [copiedLog, setCopiedLog] = useState(false);
  const [logCount, setLogCount] = useState(() => getStoredAnalyticsEvents().length);
  const [isRefreshingYouTube, setIsRefreshingYouTube] = useState(false);
  const [refreshYouTubeStatus, setRefreshYouTubeStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStorageStats(getStorageUsageStats());
    setStorageFailure(getStorageFailureInfo());
    setAnalyticsOff(isAnalyticsDisabled());
    setLogCount(getStoredAnalyticsEvents().length);

    const refreshStorageInfo = () => {
      setStorageStats(getStorageUsageStats());
      setStorageFailure(getStorageFailureInfo());
    };

    const refreshAnalyticsInfo = () => {
      setLogCount(getStoredAnalyticsEvents().length);
    };

    window.addEventListener('curatecal:items_updated', refreshStorageInfo);
    window.addEventListener('curatecal:storage_error', refreshStorageInfo);
    window.addEventListener('curatecal:storage_recovered', refreshStorageInfo);
    window.addEventListener('curate:analytics', refreshAnalyticsInfo);
    window.addEventListener('curate:analytics_cleared', refreshAnalyticsInfo);
    return () => {
      window.removeEventListener('curatecal:items_updated', refreshStorageInfo);
      window.removeEventListener('curatecal:storage_error', refreshStorageInfo);
      window.removeEventListener('curatecal:storage_recovered', refreshStorageInfo);
      window.removeEventListener('curate:analytics', refreshAnalyticsInfo);
      window.removeEventListener('curate:analytics_cleared', refreshAnalyticsInfo);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggleAnalyticsOff = () => {
    const next = !analyticsOff;
    setAnalyticsOff(next);
    setAnalyticsDisabled(next);
  };

  const handleCopySessionLog = async () => {
    const ok = await copySessionLogToClipboard();
    if (ok) {
      setCopiedLog(true);
      setTimeout(() => setCopiedLog(false), 2000);
    }
  };

  const handleClearSessionLog = () => {
    clearAnalyticsEvents();
    setLogCount(0);
  };

  const handleToggleDayPreferences = () => {
    const next = !dayPreferencesEnabled;
    setDayPreferencesEnabled(next);
    saveStoredDayPreferencesEnabled(next);
  };

  const handleRunSelfCheck = async () => {
    const res = await runSelfCheckTests();
    setSelfCheckResult(res);
  };

  const handleRefreshYouTubeDurations = async () => {
    setIsRefreshingYouTube(true);
    setRefreshYouTubeStatus(null);
    try {
      const currentItems = getStoredItems();
      const res = await refreshAllEstimatedYouTubeItems(currentItems);
      if (res.error) {
        setRefreshYouTubeStatus(res.error);
      } else if (res.updatedCount > 0) {
        saveStoredItems(res.updatedItems);
        onDataReloaded();
        setRefreshYouTubeStatus(`Updated ${res.updatedCount} YouTube duration${res.updatedCount === 1 ? '' : 's'}.`);
      } else {
        setRefreshYouTubeStatus('All YouTube durations are up to date or already customized.');
      }
    } catch (err: any) {
      setRefreshYouTubeStatus('Refresh failed: ' + (err?.message || 'unknown error'));
    } finally {
      setIsRefreshingYouTube(false);
    }
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

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        saveCustomBrandLogo(dataUrl);
        setCurrentLogo(dataUrl);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleResetLogo = () => {
    saveCustomBrandLogo(null);
    setCurrentLogo(null);
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
            <SettingsIcon className="w-4 h-4 text-stone-600 dark:text-stone-300" />
            <h3 className="font-serif text-lg font-semibold text-stone-900 dark:text-stone-100">
              Settings
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
          {/* Storage Save Failure / Safe Mode Alert */}
          {storageFailure && (
            <div className="p-4 rounded-xl bg-red-500/10 dark:bg-red-500/15 border border-red-500/30 text-red-950 dark:text-red-200 space-y-2.5">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="font-semibold block font-sans">
                    Saving to browser storage failed
                  </span>
                  <p className="mt-0.5 text-stone-600 dark:text-stone-300 leading-relaxed font-sans">
                    {storageFailure.errorMessage}
                  </p>
                  <p className="mt-1 text-stone-600 dark:text-stone-300 text-[11px] leading-relaxed font-sans">
                    All your changes are safely kept in memory for this session, but will be lost if you refresh or close this tab. Please export a backup immediately to prevent data loss.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleExport}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-sans text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export backup</span>
              </button>
            </div>
          )}

          {/* Browser Storage Used Percentage & 80% Warning */}
          <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-stone-600 dark:text-stone-400" />
                <span className="font-sans text-xs font-semibold text-stone-900 dark:text-stone-100">
                  Browser Storage Used
                </span>
              </div>
              <span
                className={`text-xs font-mono font-medium ${
                  storageStats.isWarning
                    ? 'text-amber-600 dark:text-amber-400 font-bold'
                    : 'text-stone-700 dark:text-stone-300'
                }`}
              >
                {storageStats.percentage}% ({storageStats.formattedUsed} / {storageStats.formattedQuota})
              </span>
            </div>

            {/* Storage Progress Bar */}
            <div className="w-full bg-stone-100 dark:bg-stone-800 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  storageStats.isWarning
                    ? 'bg-amber-500 dark:bg-amber-400'
                    : 'bg-stone-800 dark:bg-stone-200'
                }`}
                style={{ width: `${Math.min(100, Math.max(2, storageStats.percentage))}%` }}
              />
            </div>

            {/* 80% Warning Banner */}
            {storageStats.isWarning && (
              <div className="p-3 rounded-xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/25 flex items-start gap-2.5 text-amber-950 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-[11px] flex-1">
                  <span className="font-semibold block font-sans">
                    Storage Warning: {storageStats.percentage}% used
                  </span>
                  <p className="mt-0.5 text-stone-600 dark:text-stone-300 leading-relaxed font-sans">
                    Browser storage has exceeded 80% capacity. We recommend downloading an offline backup now to ensure no data is lost if your browser reaches the quota limit.
                  </p>
                  <button
                    type="button"
                    onClick={handleExport}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-sans font-medium bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    <span>Export backup</span>
                  </button>
                </div>
              </div>
            )}

            {!storageStats.isWarning && (
              <div className="flex items-center justify-between text-[10px] text-stone-400 dark:text-stone-500 font-mono">
                <span>Safe Media: Screenshots stored via IndexedDB</span>
                <span>Max: 5 MB quota</span>
              </div>
            )}
          </div>

          {/* Application Logo & Brand Mark */}
          <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-sans text-xs font-semibold text-stone-900 dark:text-stone-100 block">
                  Application Logo
                </span>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  Seamless brand mark rendered directly without black or white background box
                </p>
              </div>
              <div className="w-8 h-8 flex items-center justify-center shrink-0">
                {currentLogo ? (
                  <img src={currentLogo} alt="Brand Logo" className="w-full h-full object-contain" />
                ) : (
                  <CurateLogo className="w-full h-full text-stone-900 dark:text-stone-100" />
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-stone-100 dark:border-stone-800/80">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans font-medium bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 transition-opacity cursor-pointer"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Upload Logo</span>
              </button>
              {currentLogo && (
                <button
                  type="button"
                  onClick={handleResetLogo}
                  className="px-3 py-1.5 rounded-lg text-xs font-sans font-medium text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
                >
                  Reset to Default
                </button>
              )}
              <span className="text-[10px] text-stone-400 font-mono ml-auto">
                Capped at 200 KB
              </span>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
            />
          </div>

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
            {/* Quick Plan Built-in Day Preferences Setting (Rule 6) */}
            <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-sans text-xs font-semibold text-stone-900 dark:text-stone-100 block">
                    Quick Plan Built-in Day Preferences
                  </span>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    Articles Mon/Tue · Podcasts Wed/Thu · Videos & Books Fri/Sat/Sun
                  </p>
                </div>
                {/* Off/On Switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={dayPreferencesEnabled}
                  onClick={handleToggleDayPreferences}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                    dayPreferencesEnabled ? 'bg-black dark:bg-white' : 'bg-stone-200 dark:bg-stone-700'
                  }`}
                  title={dayPreferencesEnabled ? 'Day preferences enabled' : 'Day preferences disabled'}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white dark:bg-stone-900 shadow-xs ring-0 transition duration-200 ease-in-out ${
                      dayPreferencesEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <p className="text-[10px] text-stone-400 dark:text-stone-500 font-sans">
                {dayPreferencesEnabled
                  ? 'Switch is ON: Quick Plan factors in built-in media day affinities when choosing days.'
                  : 'Switch is OFF: Quick Plan balances daily loads purely from today onward without media type biases.'}
              </p>
            </div>

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

            {/* Refresh YouTube durations (Requirement 5) */}
            <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-sans text-xs font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                    <Youtube className="w-3.5 h-3.5 text-red-600" />
                    <span>Refresh YouTube durations</span>
                  </span>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    Fetch real durations for estimated YouTube links using YouTube Data API v3
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRefreshYouTubeDurations}
                  disabled={isRefreshingYouTube}
                  className="px-2.5 py-1 rounded-lg text-xs font-sans font-medium bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-750 text-stone-800 dark:text-stone-200 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                >
                  <RefreshCw className={`w-3 h-3 ${isRefreshingYouTube ? 'animate-spin' : ''}`} />
                  <span>{isRefreshingYouTube ? 'Refreshing...' : 'Refresh YouTube durations'}</span>
                </button>
              </div>
              {refreshYouTubeStatus && (
                <div className="pt-2 border-t border-stone-100 dark:border-stone-850 flex items-center justify-between text-[11px]">
                  <span className="font-mono text-stone-600 dark:text-stone-400">
                    {refreshYouTubeStatus}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRefreshYouTubeStatus(null)}
                    className="text-stone-400 hover:text-stone-600 text-[10px]"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>

            {/* Analytics & Privacy Instrumentation */}
            <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-sans text-xs font-semibold text-stone-900 dark:text-stone-100 block">
                    Turn off analytics on this device
                  </span>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    Prevent Umami analytics script from tracking events or pageviews
                  </p>
                </div>
                {/* Analytics Off/On Toggle */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={analyticsOff}
                  onClick={handleToggleAnalyticsOff}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                    analyticsOff ? 'bg-black dark:bg-white' : 'bg-stone-200 dark:bg-stone-700'
                  }`}
                  title={analyticsOff ? 'Analytics is disabled' : 'Analytics is active'}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white dark:bg-stone-900 shadow-xs ring-0 transition duration-200 ease-in-out ${
                      analyticsOff ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="pt-2.5 border-t border-stone-100 dark:border-stone-800/80 flex items-center justify-between gap-2">
                <div>
                  <span className="text-[11px] font-sans text-stone-600 dark:text-stone-400 font-medium block">
                    Local Session Log ({logCount} event{logCount === 1 ? '' : 's'})
                  </span>
                  <p className="text-[10px] text-stone-400 dark:text-stone-500">
                    JSON with ISO timestamps · URLs & titles strictly omitted
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopySessionLog}
                    className="px-2.5 py-1 rounded-lg text-xs font-sans font-medium bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-750 text-stone-800 dark:text-stone-200 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    {copiedLog ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-stone-500" />
                        <span>Copy session log</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleClearSessionLog}
                    className="px-2.5 py-1 rounded-lg text-xs font-sans font-medium text-stone-500 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                  >
                    Clear log
                  </button>
                </div>
              </div>
            </div>

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

            {/* About Curate (Requirement 3: Settings > About) */}
            <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-1 text-center">
              <div className="flex items-center justify-center gap-1.5 text-stone-900 dark:text-stone-100 font-serif text-xs font-semibold">
                <Info className="w-3.5 h-3.5 text-stone-500" />
                <span>About</span>
              </div>
              <p className="text-[11px] font-mono text-stone-600 dark:text-stone-400">
                Version {APP_VERSION} · built {BUILD_DATE_STRING}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
