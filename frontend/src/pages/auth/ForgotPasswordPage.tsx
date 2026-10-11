import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { forgotPassword, confirmForgotPassword } from '../../auth';
import { Trans, useTranslation } from '@yourapp/shared';

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await forgotPassword(email);
      setStep('confirm');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('auth.forgot.requestFailed');
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await confirmForgotPassword(email, code, newPassword);
      navigate('/login');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('auth.forgot.resetFailed');
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link to="/" className="flex items-center justify-center gap-2">
          <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
          </svg>
          <span className="text-2xl font-bold text-gray-900">YourApp</span>
        </Link>
        <h2 className="mt-6 text-center text-2xl font-bold text-gray-900">
          {step === 'request' ? t('auth.forgot.title') : t('auth.forgot.confirmTitle')}
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm sm:rounded-xl sm:px-10 border border-gray-200">
          {step === 'request' ? (
            <form onSubmit={handleRequest} className="space-y-5">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                  {error}
                </div>
              )}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  {t('auth.email')}
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-brand-500 focus:ring-brand-500 sm:text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {loading ? t('auth.forgot.sending') : t('auth.forgot.send')}
              </button>
            </form>
          ) : (
            <form onSubmit={handleConfirm} className="space-y-5">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                  {error}
                </div>
              )}
              <p className="text-sm text-gray-600">
                <Trans i18nKey="auth.forgot.sentTo" values={{ email }} components={{ b: <strong /> }} />
              </p>
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                  {t('auth.forgot.code')}
                </label>
                <input
                  id="code"
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-brand-500 focus:ring-brand-500 sm:text-sm text-center tracking-widest"
                  maxLength={6}
                />
              </div>
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
                  {t('auth.forgot.newPassword')}
                </label>
                <input
                  id="newPassword"
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-brand-500 focus:ring-brand-500 sm:text-sm"
                  placeholder={t('auth.passwordHint')}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {loading ? t('auth.forgot.resetting') : t('auth.forgot.reset')}
              </button>
            </form>
          )}
          <p className="mt-6 text-center text-sm text-gray-500">
            <Link to="/login" className="font-medium text-brand-600 hover:text-brand-500">
              {t('auth.backToSignIn')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
