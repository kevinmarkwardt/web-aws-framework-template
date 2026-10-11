import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, useContext, lazy, Suspense } from 'react';
import { getUser, logout } from './auth';
import { AuthContext } from './auth-context';
import type { User } from './types';
import { ApiError, fetchAccount } from './api';
import { hasAdminToken } from './admin-api';

import LandingPage from './pages/LandingPage';
import LoginPage from './pages/auth/LoginPage';
import SignupPage from './pages/auth/SignupPage';
import VerifyPage from './pages/auth/VerifyPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import DashboardLayout from './pages/dashboard/DashboardLayout';
import ItemsPage from './pages/dashboard/ItemsPage';
import SettingsPage from './pages/dashboard/SettingsPage';
import ReportsPage from './pages/dashboard/ReportsPage';

// Admin pages — lazy loaded (only fetched on manager.yourapp.com)
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminOverview = lazy(() => import('./pages/admin/OverviewPage'));
const AdminUsers = lazy(() => import('./pages/admin/UsersPage'));
const AdminHealth = lazy(() => import('./pages/admin/HealthPage'));
const AdminBilling = lazy(() => import('./pages/admin/BillingPage'));
const AdminItems = lazy(() => import('./pages/admin/data/ItemsPage'));
const AdminFeatureToggles = lazy(() => import('./pages/admin/config/FeatureTogglesPage'));
const AdminPlanLimits = lazy(() => import('./pages/admin/config/PlanLimitsPage'));
const AdminJobSettings = lazy(() => import('./pages/admin/config/JobSettingsPage'));
const AdminEmailTemplates = lazy(() => import('./pages/admin/config/EmailTemplatesPage'));

function NoticePage({ message }: { message: string }) {
  const signOut = async () => {
    await logout().catch(() => {});
    window.location.assign('/');
  };
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4 text-center">
      <p className="text-lg text-gray-900">{message}</p>
      <button onClick={signOut} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
        Sign out
      </button>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, notice } = useContext(AuthContext);
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }
  if (!user && notice) return <NoticePage message={notice} />;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

const isManagerHost = window.location.hostname.startsWith('manager.');

function AdminApp() {
  const [authenticated, setAuthenticated] = useState(hasAdminToken());

  if (!authenticated) {
    return (
      <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-gray-900"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400" /></div>}>
        <AdminLogin onLogin={() => setAuthenticated(true)} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<AdminOverview />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="billing" element={<AdminBilling />} />
          <Route path="health" element={<AdminHealth />} />
          <Route path="data/items" element={<AdminItems />} />
          <Route path="config/features" element={<AdminFeatureToggles />} />
          <Route path="config/plans" element={<AdminPlanLimits />} />
          <Route path="config/jobs" element={<AdminJobSettings />} />
          <Route path="config/email" element={<AdminEmailTemplates />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Suspense>
  );
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
      setUser(r.account);
      setNotice(r.notice);
      setLoading(false);
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, notice, refresh }}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<ItemsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="reports" element={<ReportsPage />} />
        </Route>
      </Routes>
    </AuthContext.Provider>
  );
}

export default function App() {
  return isManagerHost ? <AdminApp /> : <UserApp />;
}
