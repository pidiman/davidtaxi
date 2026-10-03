import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ADMIN_ROLES, DISPATCH_ROLES, type Role } from './lib/api';
import { AuthProvider, homeFor, useAuth } from './lib/auth';
import { Admin } from './pages/Admin';
import { Dispatch } from './pages/Dispatch';
import { Driver } from './pages/Driver';
import { History } from './pages/History';
import { Incidents } from './pages/Incidents';
import { Login } from './pages/Login';
import { Schedule } from './pages/Schedule';

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-muted">Načítavam…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? homeFor(user) : '/login'} replace />;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/dispatch"
            element={
              <Guard roles={DISPATCH_ROLES}>
                <Dispatch />
              </Guard>
            }
          />
          <Route
            path="/history"
            element={
              <Guard roles={DISPATCH_ROLES}>
                <History />
              </Guard>
            }
          />
          <Route
            path="/schedule"
            element={
              <Guard roles={DISPATCH_ROLES}>
                <Schedule />
              </Guard>
            }
          />
          <Route
            path="/incidents"
            element={
              <Guard roles={DISPATCH_ROLES}>
                <Incidents />
              </Guard>
            }
          />
          <Route
            path="/admin"
            element={
              <Guard roles={ADMIN_ROLES}>
                <Admin />
              </Guard>
            }
          />
          <Route
            path="/driver"
            element={
              <Guard roles={['driver']}>
                <Driver />
              </Guard>
            }
          />
          <Route path="*" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
