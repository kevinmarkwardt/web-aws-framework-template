import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, useState, useEffect, useContext } from 'react';
import { currentLanguage, languageChosen, LANGUAGE_CODES, switchLanguage, useTranslation } from '@yourapp/shared';
import { getUser, logout } from './auth';
import { AuthContext } from './auth-context';
import type { User } from './types';
import { ApiError, fetchAccount } from './api';

import LandingPage from './pages/LandingPage';
import LegalPage from './pages/LegalPage';
import LoginPage from './pages/auth/LoginPage';
import SignupPage from './pages/auth/SignupPage';
import VerifyPage from './pages/auth/VerifyPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import DashboardLayout from './pages/dashboard/DashboardLayout';
import ItemsPage from './pages/dashboard/ItemsPage'; // example:items (scripts/init.py removes these lines once the spec has entities)
import { dashboardEntityRoutes, publicEntityRoutes } from './entities/routes.gen';
import SettingsPage from './pages/dashboard/SettingsPage';
import ReportsPage from './pages/dashboard/ReportsPage';
import PlansPage from './pages/dashboard/PlansPage';
import WalletPage from './pages/dashboard/WalletPage';
import SupportPage from './pages/dashboard/SupportPage';

// Design directions preview (playbook step 4): dev server and test builds only. VITE_STAGE is replaced at build time,
// so in a prod build this is `null` and the whole design/ folder is left out of the bundle.
const DirectionsPage = import.meta.env.VITE_STAGE !== 'prod' ? lazy(() => import('./design/DirectionsPage')) : null;

function NoticePage({ message }: { message: string }) {
  const { t } = useTranslation();
  const signOut = async () => {
    await logout().catch(() => {});
    window.location.assign('/');
  };
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4 text-center">
      <p className="text-lg text-ink">{message}</p>
      <button onClick={signOut} className="text-sm font-medium text-brand-600 hover:text-brand-500">
        {t('app.signOut')}
      </button>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, notice } = useContext(AuthContext);
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" aria-label={t('common.loading')}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }
  if (!user && notice) return <NoticePage message={notice} />;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

/** The signed-in account, or why there is none to show (maintenance mode, sign-ups closed). */
async function loadAccount(): Promise<{ account: User | null; notice: string | null }> {
  try {
    return { account: (await getUser()) ? await fetchAccount() : null, notice: null };
  } catch (e) {
    // say so instead of bouncing back to the login page
    const shown = e instanceof ApiError && (e.code === 'MAINTENANCE' || e.code === 'SIGNUPS_CLOSED');
    return { account: null, notice: shown ? e.message : null };
  }
}

/** On a device where the visitor hasn't picked a language, the one saved on their profile wins (Settings). */
function adoptProfileLanguage(account: User | null) {
  const lang = account?.language;
  if (lang && !languageChosen() && LANGUAGE_CODES.includes(lang) && lang !== currentLanguage()) switchLanguage(lang);
}

function UserApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    const r = await loadAccount();
    setUser(r.account);
    setNotice(r.notice);
  };

  useEffect(() => {
    loadAccount().then((r) => {
      adoptProfileLanguage(r.account);
      setUser(r.account);
      setNotice(r.notice);
      setLoading(false);
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, notice, refresh }}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/terms" element={<LegalPage doc="terms" />} />
        <Route path="/privacy" element={<LegalPage doc="privacy" />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        {/* the spec's entities (scripts/new-entity.py): public list and detail pages */}
        {publicEntityRoutes}
        {DirectionsPage && <Route path="/__directions/*" element={<DirectionsPage />} />}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<ItemsPage />} /> {/* example:items */}
          {/* the spec's entities: my records, forms, signed-in-only entities (and the index once Items is gone) */}
          {dashboardEntityRoutes}
          <Route path="settings" element={<SettingsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          {/* billing pages; hidden from the nav when their module is off (the API answers 404 then) */}
          <Route path="plans" element={<PlansPage />} />
          <Route path="wallet" element={<WalletPage />} />
          <Route path="support" element={<SupportPage />} />
        </Route>
      </Routes>
    </AuthContext.Provider>
  );
}

/** The user site. The admin site is its own app (admin/) on admin.<domain>, with its own sign-in. */
export default function App() {
  return <UserApp />;
}
