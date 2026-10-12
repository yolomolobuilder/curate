import React, { useState } from 'react';
import { X, Mail, AlertCircle, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import { cloudStore, isSupabaseConfigured } from '../lib/cloudStore';
import { APP_NAME } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenPrivacy?: () => void;
  onOpenTerms?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onOpenPrivacy,
  onOpenTerms,
}) => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const isConfigured = isSupabaseConfigured();

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setIsSubmitting(true);
    const { error } = await cloudStore.signInWithGoogle();
    if (error) {
      setErrorMsg(error.message);
      setIsSubmitting(false);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setErrorMsg(null);
    setIsSubmitting(true);
    const { error } = await cloudStore.signInWithOtp(email.trim());
    setIsSubmitting(false);

    if (error) {
      setErrorMsg(error.message);
    } else {
      setMagicLinkSent(true);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign in to Curate"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md bg-white dark:bg-[#141414] border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <span className="font-serif italic text-xl font-bold text-stone-900 dark:text-stone-100">
              {APP_NAME}
            </span>
            <span className="text-[11px] font-sans px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-850 text-stone-600 dark:text-stone-400 border border-stone-200 dark:border-stone-800">
              Cloud Sync
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 pt-2 space-y-5">
          <div>
            <h3 className="font-serif italic text-lg font-semibold text-stone-900 dark:text-stone-100">
              Sign in to sync across devices
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
              Keep your reading, watching, and listening queues in sync with PostgreSQL Row-Level Security.
            </p>
          </div>

          {!isConfigured && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Supabase Environment Setup Required</span>
                <p className="text-[11px] mt-0.5 text-amber-700/90 dark:text-amber-400/90 leading-normal">
                  Configure <code className="font-mono">VITE_SUPABASE_URL</code> and <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> in <code className="font-mono">.env</code> to activate cloud authentication.
                </p>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {magicLinkSent ? (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs space-y-2 text-center">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
                <Mail className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-sm">Magic link sent!</h4>
              <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
                Check your inbox at <strong>{email}</strong> and click the link to sign in.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Google Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSubmitting || !isConfigured}
                className="w-full py-2.5 px-4 rounded-xl border border-stone-300 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-850 flex items-center justify-center gap-3 text-xs font-medium text-stone-800 dark:text-stone-200 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                Continue with Google
              </button>

              <div className="relative flex items-center justify-center">
                <div className="border-t border-stone-200 dark:border-stone-800 w-full" />
                <span className="bg-white dark:bg-[#141414] px-2 text-[10px] uppercase text-stone-400 tracking-wider">
                  or email link
                </span>
                <div className="border-t border-stone-200 dark:border-stone-800 w-full" />
              </div>

              {/* Email OTP form */}
              <form onSubmit={handleEmailSignIn} className="space-y-3">
                <div className="relative">
                  <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email address"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-hidden focus:ring-1 focus:ring-stone-400"
                    disabled={isSubmitting || !isConfigured}
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting || !isConfigured}
                  className="w-full py-2.5 px-4 rounded-xl bg-stone-900 text-white dark:bg-white dark:text-stone-900 text-xs font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>{isSubmitting ? 'Sending...' : 'Send Magic Link'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          )}

          {/* Guest reassurance */}
          <div className="pt-3 border-t border-stone-200 dark:border-stone-800 text-center space-y-2">
            <p className="text-[11px] text-stone-400 dark:text-stone-500 flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-stone-400" />
              <span>Guest mode is fully functional. An account is never required.</span>
            </p>

            <div className="text-[10px] text-stone-400 dark:text-stone-500 flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={onOpenPrivacy}
                className="underline hover:text-stone-700 dark:hover:text-stone-300"
              >
                Privacy Policy
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={onOpenTerms}
                className="underline hover:text-stone-700 dark:hover:text-stone-300"
              >
                Terms of Service
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
