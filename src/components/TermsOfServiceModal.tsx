import React from 'react';
import { X, FileText, AlertCircle } from 'lucide-react';
import { APP_NAME } from '../types';

interface TermsOfServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TermsOfServiceModal: React.FC<TermsOfServiceModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Terms of Service"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#141414] border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-stone-850 bg-stone-50/70 dark:bg-stone-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 flex items-center justify-center text-stone-800 dark:text-stone-200">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif italic text-lg font-bold text-stone-900 dark:text-stone-100">
                Terms of Service
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {APP_NAME} User Agreement & Acceptable Use
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
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs text-stone-600 dark:text-stone-300 leading-relaxed font-sans">
          {/* Legal Review Notice */}
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">[NOTE: Legal review pending by professional]</span>
              <p className="text-[11px] mt-0.5 text-amber-700/80 dark:text-amber-400/80">
                These Terms of Service outline standard expectations for software utility usage. Specific clauses are marked with placeholders for formal counsel review.
              </p>
            </div>
          </div>

          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              1. Acceptance of Terms
            </h3>
            <p>
              By accessing or using {APP_NAME}, whether as a guest or with an authenticated account, you agree to comply with and be bound by these Terms of Service provided by{' '}
              <span className="font-mono bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded text-amber-700 dark:text-amber-400">
                [PLACEHOLDER: Legal Entity Name / Operator]
              </span>
              . If you do not agree, please discontinue using the service.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              2. Nature of the Service
            </h3>
            <p>
              {APP_NAME} is an editorial visual planner designed for scheduling and organizing articles, videos, podcasts, and books. It does not host copyrighted media files directly, but stores links, metadata, and user-provided notes.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              3. User Accounts & Responsibilities
            </h3>
            <p>
              You are responsible for maintaining the confidentiality of your sign-in link or credentials and all activities that occur under your account. You agree not to use the service for any unlawful or abusive activities.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              4. Third-Party Media & APIs
            </h3>
            <p>
              All external media and content accessed via {APP_NAME} (including YouTube, Spotify, and article publishers) remain the intellectual property of their respective creators. Your use of third-party features is subject to the respective platform terms.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              5. Termination & Data Deletion
            </h3>
            <p>
              You may terminate your account at any time via the Account Menu. We reserve the right to suspend or terminate accounts that violate these terms or abuse service limits.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              6. Limitation of Liability & Governing Law
            </h3>
            <p>
              {APP_NAME} is provided on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis without warranties of any kind. These terms are governed by the laws of{' '}
              <span className="font-mono bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded text-amber-700 dark:text-amber-400">
                [PLACEHOLDER: Governing Jurisdiction, e.g. England &amp; Wales / Delaware, USA]
              </span>
              .
            </p>
          </section>

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
