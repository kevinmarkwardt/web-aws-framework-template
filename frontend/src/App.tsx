import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, useContext, createContext, lazy, Suspense } from 'react';
import { getUser } from './auth';
import type { User } from './types';
import { fetchAccount } from './api';
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
const AdminLinks = lazy(() => import('./pages/admin/data/LinksPage'));
const AdminPitches = lazy(() => import('./pages/admin/data/PitchesPage'));
const AdminFeatureToggles = lazy(() => import('./pages/admin/config/FeatureTogglesPage'));
const AdminPlanLimits = lazy(() => import('./pages/admin/config/PlanLimitsPage'));
const AdminCrawlSettings = lazy(() => import('./pages/admin/config/CrawlSettingsPage'));
const AdminEmailTemplates = lazy(() => import('./pages/admin/config/EmailTemplatesPage'));

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useContext(AuthContext);
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }
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
          <Route path="data/links" element={<AdminLinks />} />
          <Route path="data/pitches" element={<AdminPitches />} />
          <Route path="config/features" element={<AdminFeatureToggles />} />
          <Route path="config/plans" element={<AdminPlanLimits />} />
          <Route path="config/crawl" element={<AdminCrawlSettings />} />
          <Route path="config/email" element={<AdminEmailTemplates />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Suspense>
  );
}

function UserApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const cognitoUser = await getUser();
      if (cognitoUser) {
        const account = await fetchAccount();
        setUser(account);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh }}>
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
