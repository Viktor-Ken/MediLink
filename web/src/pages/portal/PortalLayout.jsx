import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { portalApi, clearPatientToken, getPatientToken } from '../../portalApi.js';
import ThemeToggle from '../../components/ThemeToggle.jsx';

const TABS = [
  { to: '/portal/record', label: 'My record', icon: '✚' },
  { to: '/portal/timeline', label: 'Timeline', icon: '≡' },
  { to: '/portal/medications', label: 'Medications & results', icon: '💊' },
  { to: '/portal/appointments', label: 'Appointments', icon: '🗓' },
  { to: '/portal/consents', label: 'Consents', icon: '✓' },
  { to: '/portal/messages', label: 'Messages', icon: '✉' },
  { to: '/portal/account', label: 'Account', icon: '⚙' },
];

export default function PortalLayout() {
  const nav = useNavigate();
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getPatientToken()) {
      setLoading(false);
      return;
    }
    portalApi('/auth/patient-me')
      .then((d) => setMe(d.patient))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (!getPatientToken()) return <Navigate to="/portal/login" replace />;
  if (loading) return <div className="page-pad muted">Loading…</div>;

  return (
    <div>
      <header className="app-header">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="login-brand" style={{ padding: 0 }}>
            <span className="brand-mark">✚</span>
            <div>
              <div className="brand-name">MediLink portal</div>
              <div className="brand-sub">
                {me ? `${me.first_name} ${me.last_name} · ${me.patient_no}` : 'Patient'}
              </div>
            </div>
          </div>
          <div className="row" style={{ marginLeft: 'auto', gap: 10 }}>
            <ThemeToggle />
            <Link to="/login" className="btn btn-ghost btn-sm">Staff sign in</Link>
            <button
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--danger)' }}
              onClick={() => {
                clearPatientToken();
                nav('/portal/login');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <nav className="portal-tabs">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => `portal-tab${isActive ? ' active' : ''}`}
          >
            <span>{t.icon}</span> {t.label}
          </NavLink>
        ))}
      </nav>
      <main className="page-pad">
        <Outlet />
      </main>
    </div>
  );
}