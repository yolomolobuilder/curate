import React from 'react';
import { X, Shield, ExternalLink, Trash2, Database, AlertCircle } from 'lucide-react';
import { THIRD_PARTIES } from '../lib/thirdParties';
import { APP_NAME } from '../types';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Privacy Policy"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#141414] border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-stone-850 bg-stone-50/70 dark:bg-stone-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 flex items-center justify-center text-stone-800 dark:text-stone-200">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif italic text-lg font-bold text-stone-900 dark:text-stone-100">
                Privacy Policy
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {APP_NAME} Transparency & Data Protection
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-stone-600 dark:text-stone-300 leading-relaxed font-sans">
          {/* Legal Review Notice */}
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">[NOTE: Legal review pending by professional]</span>
              <p className="text-[11px] mt-0.5 text-amber-700/80 dark:text-amber-400/80">
                This document details our data handling practices and third-party integrations. Placeholders are clearly marked for legal counsel review.
              </p>
            </div>
          </div>

          {/* Controller info */}
          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              1. Data Controller & Operator
            </h3>
            <p>
              This application is operated by{' '}
              <span className="font-mono bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded text-amber-700 dark:text-amber-400">
                [PLACEHOLDER: Legal Entity Name, e.g. Curate Technologies Ltd.]
              </span>
              . If you have any inquiries regarding your privacy or data, please contact us at{' '}
              <span className="font-mono bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded text-amber-700 dark:text-amber-400">
                [PLACEHOLDER: privacy@curateapp.com]
              </span>
              .
            </p>
          </section>

          {/* YouTube Disclosure */}
          <section className="space-y-2 p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/30">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
              <span>▶</span> 2. YouTube API Services Disclosure
            </h3>
            <p>
              {APP_NAME} utilizes the official YouTube Data API v3 and oEmbed endpoints to retrieve video titles, channel authors, and runtimes when links are added or durations are refreshed.
            </p>
            <p>
              By using these features, you agree to be bound by the{' '}
              <a
                href="https://www.youtube.com/t/terms"
                target="_blank"
                rel="noreferrer"
                className="text-stone-900 dark:text-stone-100 underline inline-flex items-center gap-0.5 font-medium"
              >
                YouTube Terms of Service <ExternalLink className="w-3 h-3 inline" />
              </a>{' '}
              and acknowledge that Google processes data in accordance with the{' '}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noreferrer"
                className="text-stone-900 dark:text-stone-100 underline inline-flex items-center gap-0.5 font-medium"
              >
                Google Privacy Policy <ExternalLink className="w-3 h-3 inline" />
              </a>
              . We do not sell or share any YouTube user data.
            </p>
          </section>

          {/* Third-Party Directory */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              3. Third-Party Services Directory
            </h3>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              Complete inventory of third-party network requests and scripts:
            </p>
            <div className="space-y-2 divide-y divide-stone-100 dark:divide-stone-800 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
              {THIRD_PARTIES.map((party) => (
                <div key={party.id} className="p-3 bg-white dark:bg-[#181818] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-stone-900 dark:text-stone-100">
                      {party.name}
                    </span>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="font-mono text-stone-500 dark:text-stone-400">
                        {party.domain}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          party.setsCookies
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}
                      >
                        {party.setsCookies ? 'Sets Cookies' : 'Cookie-Free'}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400">
                    {party.purpose}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Where Data is Stored */}
          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-stone-500" /> 4. Data Storage & Hosting Region
            </h3>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                <strong>Guest Mode:</strong> All library items, day themes, and media are stored exclusively on your device in your browser's <code className="bg-stone-100 dark:bg-stone-800 px-1 py-0.2 rounded font-mono">localStorage</code> and <code className="bg-stone-100 dark:bg-stone-800 px-1 py-0.2 rounded font-mono">IndexedDB</code>. Zero personal content is transmitted to our servers.
              </li>
              <li>
                <strong>Authenticated Accounts:</strong> When you sign in, your items and settings are synced to a dedicated PostgreSQL database hosted in{' '}
                <span className="font-mono bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded text-amber-700 dark:text-amber-400">
                  [PLACEHOLDER: Supabase EU West (London) / US East region]
                </span>
                . All data is protected with PostgreSQL Row-Level Security ensuring only your authenticated session can access your rows.
              </li>
            </ul>
          </section>

          {/* How to Delete Data */}
          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
              <Trash2 className="w-4 h-4 text-red-500" /> 5. How to Delete Your Data
            </h3>
            <p>You maintain complete control and ownership of your curated library:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                <strong>Guest Users:</strong> Open <em>Settings &gt; Backup & Data</em> and click <strong>Clear all items</strong> to instantly delete all local data from your browser.
              </li>
              <li>
                <strong>Account Users:</strong> Click your Account avatar in the top navigation and select <strong>Delete Account</strong>. After a confirmation step, this triggers an immediate cascade delete removing all cloud database rows, images, settings, and auth credentials.
              </li>
            </ul>
          </section>

          {/* Policy Date */}
          <div className="pt-2 border-t border-stone-200 dark:border-stone-850 text-[11px] text-stone-400 dark:text-stone-500">
            Effective Date: <span className="font-mono">[PLACEHOLDER: October 11, 2026]</span> · Version 1.0
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 dark:border-stone-850 bg-stone-50/50 dark:bg-stone-900/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-stone-900 text-white dark:bg-white dark:text-stone-900 text-xs font-medium hover:opacity-90 transition-opacity"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
