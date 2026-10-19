import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import Layout from './components/Layout.jsx';
import LicenseLocked from './components/LicenseLocked.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Scan from './pages/Scan.jsx';
import Register from './pages/Register.jsx';
import PatientProfile from './pages/PatientProfile.jsx';
import Departments from './pages/Departments.jsx';
import Coordination from './pages/Coordination.jsx';
import Messages from './pages/Messages.jsx';
import Clinical from './pages/Clinical.jsx';
import Wards from './pages/Wards.jsx';
import Pharmacy from './pages/Pharmacy.jsx';
import Reports from './pages/Reports.jsx';
import PortalLogin from './pages/portal/PortalLogin.jsx';
import PortalLayout from './pages/portal/PortalLayout.jsx';
import PortalRecord from './pages/portal/PortalRecord.jsx';
import PortalTimeline from './pages/portal/PortalTimeline.jsx';
import PortalMeds from './pages/portal/PortalMeds.jsx';
import PortalAppointments from './pages/portal/PortalAppointments.jsx';
import PortalConsents from './pages/portal/PortalConsents.jsx';
import PortalMessages from './pages/portal/PortalMessages.jsx';
import PortalAccount from './pages/portal/PortalAccount.jsx';
import Account from './pages/Account.jsx';
import StaffAdmin from './pages/StaffAdmin.jsx';
import Privacy from './pages/Privacy.jsx';
import Terms from './pages/Terms.jsx';

// Clerk lives in its own chunk and is only fetched when SSO is used.
const Sso = lazy(() => import('./pages/Sso.jsx'));

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function ReportsGate() {
  const { user } = useAuth();
  if (!user) return null;
  return user.role === 'admin' || user.role === 'doctor' ? <Reports /> : <Navigate to="/" replace />;
}

function RoleGate({ roles, children }) {
  const { user } = useAuth();
  if (!user) return null;
  return roles.includes(user.role) ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LicenseLocked />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/sso"
            element={<Suspense fallback={<div className="center-screen">Loading…</div>}><Sso /></Suspense>}
          />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/portal/login" element={<PortalLogin />} />
          <Route path="/portal" element={<PortalLayout />}>
            <Route index element={<Navigate to="/portal/record" replace />} />
            <Route path="record" element={<PortalRecord />} />
            <Route path="timeline" element={<PortalTimeline />} />
            <Route path="medications" element={<PortalMeds />} />
            <Route path="appointments" element={<PortalAppointments />} />
            <Route path="consents" element={<PortalConsents />} />
            <Route path="messages" element={<PortalMessages />} />
            <Route path="account" element={<PortalAccount />} />
          </Route>
          <Route element={<Layout />}>
            <Route element={<Protected />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/scan" element={<Scan />} />
              <Route
                path="/register"
                element={<RoleGate roles={['admin']}><Register /></RoleGate>}
              />
              <Route
                path="/staff"
                element={<RoleGate roles={['admin']}><StaffAdmin /></RoleGate>}
              />
              <Route path="/patients/:id" element={<PatientProfile />} />
              <Route
                path="/patients/:id/clinical"
                element={<RoleGate roles={['admin', 'doctor', 'nurse', 'lab_scientist']}><Clinical /></RoleGate>}
              />
              <Route path="/coordination" element={<Coordination />} />
              <Route path="/messages" element={<Messages />} />
              <Route path="/account" element={<Account />} />
              <Route
                path="/wards"
                element={<RoleGate roles={['admin', 'doctor', 'nurse']}><Wards /></RoleGate>}
              />
              <Route
                path="/pharmacy"
                element={<RoleGate roles={['admin', 'pharmacist']}><Pharmacy /></RoleGate>}
              />
              <Route path="/departments" element={<Departments />} />
              <Route path="/reports" element={<ReportsGate />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}