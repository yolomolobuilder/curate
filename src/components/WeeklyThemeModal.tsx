import React, { useState } from 'react';
import { X, SlidersHorizontal, Check } from 'lucide-react';
import { DayTheme } from '../types';

interface WeeklyThemeModalProps {
  isOpen: boolean;
  onClose: () => void;
  themes: DayTheme[];
  onSave: (themes: DayTheme[]) => void;
  availableTopics: string[];
}

export const WeeklyThemeModal: React.FC<WeeklyThemeModalProps> = ({
  isOpen,
  onClose,
  themes,
  onSave,
  availableTopics,
}) => {
  const [localThemes, setLocalThemes] = useState<DayTheme[]>(themes);

  if (!isOpen) return null;

  const dayNames = [
    { index: 1, name: 'Monday' },
    { index: 2, name: 'Tuesday' },
    { index: 3, name: 'Wednesday' },
    { index: 4, name: 'Thursday' },
    { index: 5, name: 'Friday' },
    { index: 6, name: 'Saturday' },
    { index: 0, name: 'Sunday' },
  ];

  const handleToggle = (dayIdx: number) => {
    setLocalThemes((prev) =>
      prev.map((t) => (t.dayOfWeek === dayIdx ? { ...t, enabled: !t.enabled } : t))
    );
  };

  const handleTopicChange = (dayIdx: number, topic: string) => {
    setLocalThemes((prev) =>
      prev.map((t) => (t.dayOfWeek === dayIdx ? { ...t, topic } : t))
    );
  };

  const handleSave = () => {
    onSave(localThemes);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-lg bg-[#FAF8F5] dark:bg-[#181716] rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-stone-800">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-amber-700 dark:text-amber-400" />
            <h3 className="font-serif text-lg font-semibold text-stone-900 dark:text-stone-100">
              Weekly Learning Themes
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Optionally guide your learning rhythm by pairing weekdays with topics. These appear as gentle visual cues at the top of your calendar columns without rigid constraints.
          </p>

          <div className="space-y-2.5">
            {dayNames.map(({ index, name }) => {
              const currentTheme = localThemes.find((t) => t.dayOfWeek === index) || {
                dayOfWeek: index,
                topic: 'General',
                enabled: false,
              };

              return (
                <div
                  key={index}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                    currentTheme.enabled
                      ? 'bg-white dark:bg-stone-900 border-stone-300 dark:border-stone-700'
                      : 'bg-stone-100/50 dark:bg-stone-950/40 border-stone-200/50 dark:border-stone-800/50 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleToggle(index)}
                      className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all ${
                        currentTheme.enabled
                          ? 'bg-stone-900 dark:bg-amber-600 border-stone-900 dark:border-amber-600 text-white'
                          : 'border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900'
                      }`}
                    >
                      {currentTheme.enabled && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </button>
                    <span className="font-serif text-sm font-medium text-stone-800 dark:text-stone-200 min-w-24">
                      {name}
                    </span>
                  </div>

                  <select
                    disabled={!currentTheme.enabled}
                    value={currentTheme.topic}
                    onChange={(e) => handleTopicChange(index, e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 text-xs font-sans text-stone-800 dark:text-stone-200 disabled:opacity-40"
                  >
                    {availableTopics.map((topic) => (
                      <option key={topic} value={topic}>
                        {topic}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 dark:border-stone-800 flex items-center justify-end gap-3 bg-stone-100/50 dark:bg-stone-900/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-xl text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 dark:bg-amber-600 transition-colors shadow-xs"
          >
            Save Themes
          </button>
        </div>
      </div>
    </div>
  );
};
