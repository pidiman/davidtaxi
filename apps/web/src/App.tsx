import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import type { Role } from './lib/api';
import { AuthProvider, homeFor, useAuth } from './lib/auth';
import { Admin } from './pages/Admin';
import { Dispatch } from './pages/Dispatch';
import { Driver } from './pages/Driver';
import { History } from './pages/History';
import { Login } from './pages/Login';

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
              <Guard roles={['admin', 'dispatcher']}>
                <Dispatch />
              </Guard>
            }
          />
          <Route
            path="/history"
            element={
              <Guard roles={['admin', 'dispatcher']}>
                <History />
              </Guard>
            }
          />
          <Route
            path="/admin"
            element={
              <Guard roles={['admin']}>
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
