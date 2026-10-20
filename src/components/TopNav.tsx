import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Inbox,
  Search,
  Sun,
  Moon,
  Settings,
  User as UserIcon,
  Cloud,
  LogIn,
} from 'lucide-react';
import { CalendarView, APP_NAME } from '../types';
import { CurateLogo } from './CurateLogo';
import { formatHoursMinutes } from '../lib/timeAccounting';
import { getCustomBrandLogo, getCustomBrandName } from '../lib/brand';

interface TopNavProps {
  activeTab: 'home' | 'calendar' | 'collections';
  onTabChange: (tab: 'home' | 'calendar' | 'collections') => void;
  currentDate: Date;
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  inboxCount: number;
  totalMonthlyMinutes?: number;
  monthPlannedMinutes?: number;
  monthCompletedMinutes?: number;
  onOpenAddModal: () => void;
  onToggleInbox: () => void;
  isInboxOpen: boolean;
  onOpenSearch: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenSettings?: () => void;
  onOpenWeeklyReview?: () => void;
  onOpenShareWeek?: () => void;
  currentUser?: { email?: string; id: string } | null;
  onOpenAuth?: () => void;
  onOpenAccountMenu?: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  activeTab,
  onTabChange,
  currentDate,
  view,
  onViewChange,
  onPrev,
  onNext,
  onToday,
  inboxCount,
  totalMonthlyMinutes = 0,
  monthPlannedMinutes,
  monthCompletedMinutes = 0,
  onOpenAddModal,
  onToggleInbox,
  isInboxOpen,
  onOpenSearch,
  darkMode,
  onToggleDarkMode,
  onOpenSettings,
  onOpenWeeklyReview,
  onOpenShareWeek,
  currentUser = null,
  onOpenAuth,
  onOpenAccountMenu,
}) => {
  const [customLogo, setCustomLogo] = React.useState<string | null>(() => getCustomBrandLogo());
  const [brandName, setBrandName] = React.useState<string>(() => getCustomBrandName());

  React.useEffect(() => {
    const handleBrandUpdate = () => {
      setCustomLogo(getCustomBrandLogo());
      setBrandName(getCustomBrandName());
    };
    window.addEventListener('curate:brand_updated', handleBrandUpdate);
    return () => window.removeEventListener('curate:brand_updated', handleBrandUpdate);
  }, []);

  const effectivePlanned = monthPlannedMinutes !== undefined ? monthPlannedMinutes : totalMonthlyMinutes;
  const effectiveCompleted = monthCompletedMinutes;
  const currentLabel = React.useMemo(() => {
    if (view === 'month') {
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      return `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    }

    if (view === 'week') {
      const currentDay = currentDate.getDay();
      const diffToMon = currentDay === 0 ? -6 : 1 - currentDay;
      const monday = new Date(currentDate);
      monday.setDate(currentDate.getDate() + diffToMon);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const monStr = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const sunStr = sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${monStr} – ${sunStr}`;
    }

    return currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }, [currentDate, view]);

  return (
    <header className="sticky top-0 z-30 w-full bg-[#FAF9F6]/90 dark:bg-[#0C0C0C]/90 backdrop-blur-xl border-b border-stone-200/40 dark:border-stone-900 px-4 sm:px-8 py-3 transition-colors">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Zone 1: Minimalist Icon Logo + Wordmark + Primary Mode Switcher */}
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={() => onTabChange('home')}
            className="flex items-center gap-2.5 shrink-0 cursor-pointer group focus:outline-hidden"
            title={brandName}
            aria-label={brandName}
          >
            <div className="w-7 h-7 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              {customLogo ? (
                <img src={customLogo} alt={brandName} className="w-full h-full object-contain" />
              ) : (
                <CurateLogo className="w-full h-full text-stone-900 dark:text-stone-100" />
              )}
            </div>
            <span className="font-serif text-lg font-medium tracking-tight text-stone-900 dark:text-stone-100 select-none">
              {brandName}
            </span>
          </button>

          {/* Primary View Switcher: Home vs Calendar */}
          <div className="flex items-center gap-1 text-xs font-sans">
            <button
              onClick={() => onTabChange('home')}
              className={`px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                activeTab === 'home'
                  ? 'bg-black text-white dark:bg-white dark:text-black font-medium'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              Home
            </button>
            <button
              onClick={() => onTabChange('calendar')}
              className={`px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                activeTab === 'calendar'
                  ? 'bg-black text-white dark:bg-white dark:text-black font-medium'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              Calendar
            </button>
            <button
              onClick={() => onTabChange('collections')}
              className={`px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                activeTab === 'collections'
                  ? 'bg-black text-white dark:bg-white dark:text-black font-medium'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              Collections
            </button>
          </div>
        </div>

        {/* Zone 2: Month Navigator (Active when on Calendar) */}
        {activeTab === 'calendar' ? (
          <div className="flex items-center gap-3 sm:gap-4 animate-in fade-in duration-150">
            <div className="flex items-center gap-1">
              <button
                onClick={onPrev}
                title="Previous"
                className="p-1 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-serif text-sm sm:text-base font-normal tracking-tight text-stone-900 dark:text-stone-100 min-w-28 sm:min-w-44 text-center select-none truncate">
                {currentLabel}
              </span>
              <button
                onClick={onNext}
                title="Next"
                className="p-1 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                onClick={onToday}
                className="ml-1 text-[11px] font-sans text-stone-400 hover:text-stone-900 dark:hover:text-stone-200 transition-colors cursor-pointer hidden sm:inline-block"
              >
                Today
              </button>

              {onOpenWeeklyReview && (
                <button
                  type="button"
                  onClick={onOpenWeeklyReview}
                  className="ml-1 text-[11px] font-sans text-stone-400 hover:text-stone-900 dark:hover:text-stone-200 transition-colors cursor-pointer hidden md:inline-block"
                  title="Weekly Review (Previous-week totals & triage)"
                >
                  Review
                </button>
              )}
            </div>

            {/* Minimal Calendar Sub-View Switcher (Month / Week / Day) */}
            <div className="flex items-center gap-2 sm:gap-3 text-xs font-sans text-stone-400 border-l border-stone-200/60 dark:border-stone-800/60 pl-2.5 sm:pl-4">
              {(['month', 'week', 'day'] as CalendarView[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onViewChange(v)}
                  className={`capitalize transition-colors cursor-pointer text-xs ${
                    view === v
                      ? 'text-stone-900 dark:text-white font-medium underline underline-offset-4 decoration-stone-400'
                      : 'hover:text-stone-700 dark:hover:text-stone-300'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>

            {/* Month Time Totals: Planned & Done (same rule as Week budget bar) */}
            {effectivePlanned > 0 && (
              <div className="hidden xl:flex items-center gap-1.5 text-xs font-sans text-stone-500 dark:text-stone-400 border-l border-stone-200/60 dark:border-stone-800/60 pl-2.5 sm:pl-3">
                <span className="font-serif text-stone-900 dark:text-stone-100 tabular-nums">
                  {formatHoursMinutes(effectivePlanned)} planned
                </span>
                <span className="opacity-40">·</span>
                <span className="font-sans text-stone-600 dark:text-stone-300 tabular-nums">
                  Done {formatHoursMinutes(effectiveCompleted)}
                </span>
              </div>
            )}
          </div>
        ) : null}

        {/* Zone 3: Quiet Actions */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Search */}
          <button
            onClick={onOpenSearch}
            title="Search (⌘K)"
            className="p-1.5 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Inbox Button */}
          <button
            onClick={onToggleInbox}
            className={`flex items-center gap-1.5 text-xs font-sans transition-colors cursor-pointer ${
              isInboxOpen
                ? 'text-stone-900 dark:text-stone-100 font-medium'
                : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Inbox</span>
            {inboxCount > 0 && (
              <span className="text-[11px] font-mono opacity-60">({inboxCount})</span>
            )}
          </button>

          {/* + Add Button */}
          <button
            onClick={onOpenAddModal}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium text-white bg-stone-900 hover:bg-black dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white transition-all cursor-pointer shadow-2xs hover:scale-102"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>

          {/* Account / Cloud Sync or Guest Mode button */}
          {currentUser ? (
            <button
              type="button"
              onClick={onOpenAccountMenu}
              title="Account settings & sync"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-sans text-stone-700 bg-stone-100 border border-stone-200 dark:text-stone-200 dark:bg-stone-900 dark:border-stone-800 hover:border-stone-400 dark:hover:border-stone-600 transition-colors cursor-pointer"
            >
              <div className="w-4 h-4 rounded-full bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 flex items-center justify-center text-[10px] font-bold font-serif">
                {currentUser.email ? currentUser.email.charAt(0).toUpperCase() : 'U'}
              </div>
              <span className="max-w-[100px] truncate text-[11px] font-medium hidden md:inline">
                {currentUser.email?.split('@')[0] || 'Account'}
              </span>
              <Cloud className="w-3 h-3 text-emerald-500 shrink-0" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              title="Create an account or sign in for multi-device cloud sync"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-sans text-stone-700 bg-stone-100/90 border border-stone-200/90 hover:bg-stone-200/60 dark:text-stone-300 dark:bg-stone-900/80 dark:border-stone-800 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100 transition-all cursor-pointer shadow-2xs hover:scale-102"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-[11px] font-medium hidden sm:inline">Guest</span>
              <span className="text-[11px] text-stone-400 dark:text-stone-500 hidden sm:inline">·</span>
              <span className="text-[11px] font-medium text-stone-900 dark:text-stone-100 flex items-center gap-1">
                <LogIn className="w-3 h-3" />
                Sign in
              </span>
            </button>
          )}

          {/* Theme toggle */}
          <button
            onClick={onToggleDarkMode}
            title={darkMode ? 'Switch to Light mode' : 'Switch to Dark mode'}
            className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 hover:bg-stone-200/50 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            aria-label="Toggle dark/light mode"
          >
            {darkMode ? (
              <Sun className="w-4 h-4 text-amber-400 transition-transform hover:rotate-45" />
            ) : (
              <Moon className="w-4 h-4 text-stone-600 transition-transform hover:-rotate-12" />
            )}
          </button>

          {/* Settings & Backups */}
          <button
            onClick={onOpenSettings}
            title="Settings & Backups (Guest data stored in this browser only)"
            className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 hover:bg-stone-200/50 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            aria-label="Open settings and storage backups"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
