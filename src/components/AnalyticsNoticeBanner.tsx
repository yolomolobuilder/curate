import React, { useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { isAnalyticsDisabled, setAnalyticsDisabled } from '../lib/analyticsConfig';

const NOTICE_DISMISSED_KEY = 'curate_analytics_notice_dismissed';

export const AnalyticsNoticeBanner: React.FC = () => {
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    try {
      if (typeof localStorage === 'undefined') return false;
      const dismissed = localStorage.getItem(NOTICE_DISMISSED_KEY) === 'true';
      const alreadyOff = isAnalyticsDisabled();
      return !dismissed && !alreadyOff;
    } catch {
      return false;
    }
  });

  if (!isVisible) return null;

  const handleDismiss = () => {
    setIsVisible(false);
    try {
      localStorage.setItem(NOTICE_DISMISSED_KEY, 'true');
    } catch {
      // Ignore
    }
  };

  const handleTurnOff = () => {
    setAnalyticsDisabled(true);
    handleDismiss();
  };

  return (
    <aside
      role="region"
      aria-label="Analytics notice"
      className="fixed bottom-4 right-4 z-40 max-w-xs sm:max-w-sm w-full p-3.5 rounded-2xl bg-white/95 dark:bg-[#181716]/95 backdrop-blur-md border border-stone-200/80 dark:border-stone-850 shadow-xl text-stone-900 dark:text-stone-100 font-sans text-xs animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2 min-w-0">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold block text-[12px] leading-tight">
              Privacy & Analytics
            </span>
            <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-relaxed">
              Curate uses privacy-friendly telemetry (Umami) for feature counts. We never track titles, notes, or URLs.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          title="Dismiss notice"
          aria-label="Dismiss notice"
          className="p-1 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-850 transition-colors shrink-0 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="mt-3 pt-2.5 border-t border-stone-100 dark:border-stone-850 flex items-center justify-between gap-2">
        <span className="text-[10px] text-stone-400 font-mono">
          Manage anytime in Settings
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleTurnOff}
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-red-600 hover:text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
          >
            Turn off
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 hover:opacity-90 transition-opacity cursor-pointer shadow-2xs"
          >
            Got it
          </button>
        </div>
      </div>
    </aside>
  );
};
