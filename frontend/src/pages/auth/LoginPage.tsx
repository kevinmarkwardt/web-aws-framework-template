import { useState, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login, MOCK_AUTH, TEST_LOGIN } from '../../auth';
import { AuthContext } from '../../auth-context';
import { useTranslation } from '@yourapp/shared';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useContext(AuthContext);
  const { t } = useTranslation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      await refresh();
      navigate('/dashboard');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('auth.login.failed');
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
        <h2 className="mt-6 text-center text-2xl font-bold text-gray-900">{t('auth.login.title')}</h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm sm:rounded-xl sm:px-10 border border-gray-200">
          <form onSubmit={handleSubmit} className="space-y-5">
            {TEST_LOGIN && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3">
                {t('auth.login.testSite')}
              </div>
            )}
            {MOCK_AUTH && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3">
                {t('auth.login.mockAuth')}
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                {TEST_LOGIN ? t('auth.login.username') : t('auth.email')}
              </label>
              <input
                id="email"
                type={TEST_LOGIN ? 'text' : 'email'}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-brand-500 focus:ring-brand-500 sm:text-sm"
              />
            </div>
            {!TEST_LOGIN && (
              <>
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
                  />
                </div>
                <div className="flex items-center justify-end">
                  <Link to="/forgot-password" className="text-sm text-brand-600 hover:text-brand-500">
                    {t('auth.login.forgot')}
                  </Link>
                </div>
              </>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 focus:outline-2 focus:outline-offset-2 focus:outline-brand-600 disabled:opacity-50 transition-colors"
            >
              {loading ? t('auth.login.submitting') : t('auth.login.submit')}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-gray-500">
            {t('auth.login.noAccount')}{' '}
            <Link to="/signup" className="font-medium text-brand-600 hover:text-brand-500">
              {t('auth.login.signup')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
