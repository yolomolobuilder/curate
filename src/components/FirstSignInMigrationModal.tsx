import React, { useState } from 'react';
import { CloudUpload, Check, X, Shield, Info, Sparkles } from 'lucide-react';
import { ContentItem } from '../types';
import { CurateSettings } from '../lib/dataStore';
import { cloudStore } from '../lib/cloudStore';

interface FirstSignInMigrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  guestItems: ContentItem[];
  guestSettings: CurateSettings;
  onMigrationComplete: (migratedCount: number) => void;
  onSkipMigration: () => void;
}

export const FirstSignInMigrationModal: React.FC<FirstSignInMigrationModalProps> = ({
  isOpen,
  onClose,
  guestItems,
  guestSettings,
  onMigrationComplete,
  onSkipMigration,
}) => {
  const [isMigrating, setIsMigrating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Filter out sample items: sample items are strictly excluded
  const nonSampleItems = guestItems.filter((it) => !it.isSample);

  // Count screenshot images
  let imageCount = 0;
  for (const it of nonSampleItems) {
    if (it.screenshots && it.screenshots.length > 0) {
      imageCount += it.screenshots.length;
    }
  }

  const handleUpload = async () => {
    setIsMigrating(true);
    setErrorMsg(null);

    const res = await cloudStore.migrateGuestDataToCloud(
      nonSampleItems,
      guestSettings
    );

    setIsMigrating(false);

    if (res.error) {
      setErrorMsg(res.error);
    } else {
      onMigrationComplete(res.migratedCount);
      onClose();
    }
  };

  const handleSkip = () => {
    onSkipMigration();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upload your items to the cloud"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md bg-white dark:bg-[#141414] border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 pb-2 text-center">
          <div className="w-12 h-12 rounded-full bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 flex items-center justify-center mx-auto text-stone-800 dark:text-stone-200 mb-3">
            <CloudUpload className="w-6 h-6" />
          </div>
          <h3 className="font-serif italic text-xl font-bold text-stone-900 dark:text-stone-100">
            Upload items to your account?
          </h3>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            We found items in your local browser library. Would you like to sync them to your cloud account?
          </p>
        </div>

        {/* Content Details */}
        <div className="p-6 pt-2 space-y-4">
          <div className="p-3.5 rounded-xl bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 space-y-2 text-xs">
            <span className="font-semibold text-stone-900 dark:text-stone-100 block">
              What will be uploaded:
            </span>
            <ul className="space-y-1.5 text-stone-600 dark:text-stone-300">
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  <strong>{nonSampleItems.length}</strong> user-curated item{nonSampleItems.length === 1 ? '' : 's'} (sample starter items are excluded)
                </span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  <strong>{imageCount}</strong> screenshot{imageCount === 1 ? '' : 's'} &amp; custom covers
                </span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Personalized day themes, topics, and week budgets</span>
              </li>
            </ul>
          </div>

          <div className="p-3 rounded-xl bg-stone-100/60 dark:bg-stone-850/60 border border-stone-200/50 dark:border-stone-800/50 text-[11px] text-stone-500 dark:text-stone-400 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
            <span>
              Temporary YouTube duration caches and local telemetry logs remain local on this device and are never uploaded.
            </span>
          </div>

          {errorMsg && (
            <p className="text-xs text-red-600 dark:text-red-400">{errorMsg}</p>
          )}

          <div className="space-y-2 pt-2">
            <button
              type="button"
              disabled={isMigrating}
              onClick={handleUpload}
              className="w-full py-2.5 px-4 rounded-xl bg-stone-900 text-white dark:bg-white dark:text-stone-900 text-xs font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <CloudUpload className="w-4 h-4" />
              <span>{isMigrating ? 'Uploading...' : `Upload ${nonSampleItems.length} Items to Account`}</span>
            </button>

            <button
              type="button"
              disabled={isMigrating}
              onClick={handleSkip}
              className="w-full py-2 px-3 rounded-xl border border-stone-200 dark:border-stone-800 text-xs text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-850 transition-colors cursor-pointer"
            >
              Start Fresh in Cloud (Keep Local Items in Browser)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
