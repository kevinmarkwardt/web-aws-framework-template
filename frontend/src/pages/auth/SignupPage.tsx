import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { register, TEST_LOGIN } from '../../auth';
import { fetchPublicConfig } from '../../api';
import { useTranslation } from '@yourapp/shared';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();
  // the admin site's "Signups Enabled" switch (the API also refuses new profiles while it is off)
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    fetchPublicConfig().then((c) => setClosed(!c.signupsEnabled)).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(t('auth.signup.mismatch'));
      return;
    }

    if (password.length < 8) {
      setError(t('auth.signup.tooShort'));
      return;
    }

    setLoading(true);
    try {
      await register(email, password, name);
      navigate('/verify', { state: { email } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('auth.signup.failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // the test stage has no sign-up: any username signs in (and gets an account) on the login page
  if (TEST_LOGIN) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link to="/" className="flex items-center justify-center gap-2">
          <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
          </svg>
          <span className="text-2xl font-bold text-gray-900">YourApp</span>
        </Link>
        <h2 className="mt-6 text-center text-2xl font-bold text-gray-900">{t('auth.signup.title')}</h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {t('auth.signup.subtitle')}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm sm:rounded-xl sm:px-10 border border-gray-200">
          <form onSubmit={handleSubmit} className="space-y-5">
            {closed && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3">
                {t('auth.signup.closed')}
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                {t('auth.signup.name')}
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-brand-500 focus:ring-brand-500 sm:text-sm"
              />
            </div>
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
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                {t('auth.password')}
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-brand-500 focus:ring-brand-500 sm:text-sm"
                placeholder={t('auth.passwordHint')}
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                {t('auth.signup.confirmPassword')}
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-brand-500 focus:ring-brand-500 sm:text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading || closed}
              className="w-full flex justify-center py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 focus:outline-2 focus:outline-offset-2 focus:outline-brand-600 disabled:opacity-50 transition-colors"
            >
              {loading ? t('auth.signup.submitting') : t('auth.signup.submit')}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-gray-500">
            {t('auth.signup.haveAccount')}{' '}
            <Link to="/login" className="font-medium text-brand-600 hover:text-brand-500">
              {t('auth.signup.signIn')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
