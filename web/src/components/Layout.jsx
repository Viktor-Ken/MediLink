import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { api } from '../api.js';
import ThemeToggle from './ThemeToggle.jsx';
import ChatWidget from './ChatWidget.jsx';
import InstallAppButton from './InstallAppButton.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [summary, setSummary] = useState({ tasks: 0, referrals: 0, handoffs: 0, unread: 0 });

  const role = user?.role;
  const canRegister = role === 'admin';
  const canStaff = role === 'admin';
  const canWards = ['admin', 'doctor', 'nurse'].includes(role);
  const canPharmacy = ['admin', 'pharmacist'].includes(role);
  const canReports = ['admin', 'doctor'].includes(role);

  useEffect(() => {
    async function load() {
      try {
        const s = await api('/inbox/summary');
        setSummary(s);
      } catch {
        /* ignore */
      }
    }
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const linkClass = ({ isActive }) => `nav-link${isActive ? ' active' : ''}`;
  const close = () => setNavOpen(false);
  const coordinationBadge = summary.referrals + summary.handoffs + summary.tasks;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="hamburger" aria-label="Open menu" onClick={() => setNavOpen(true)}>
          <span /><span /><span />
        </button>
        <div className="topbar-brand">
          <span className="brand-mark">✚</span>
          <span className="brand-name">MediLink</span>
        </div>
        <ThemeToggle style={{ marginLeft: 'auto' }} />
      </header>

      {navOpen && <div className="nav-backdrop" onClick={close} />}

      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">✚</span>
          <div>
            <div className="brand-name">MediLink</div>
            <div className="brand-sub">Hospital System</div>
          </div>
        </div>

        <nav className="nav" onClick={close}>
          <NavLink to="/" end className={linkClass}>
            <span className="nav-icon">▦</span> Dashboard
          </NavLink>
          <NavLink to="/scan" className={linkClass}>
            <span className="nav-icon">⌕</span> Scan Patient
          </NavLink>
          {canRegister && (
            <NavLink to="/register" className={linkClass}>
              <span className="nav-icon">✎</span> Register Patient
            </NavLink>
          )}
          {canStaff && (
            <NavLink to="/staff" className={linkClass}>
              <span className="nav-icon">☺</span> Manage Staff
            </NavLink>
          )}
          <NavLink to="/coordination" className={linkClass}>
            <span className="nav-icon">⇶</span> Referrals &amp; Handoffs
            {coordinationBadge > 0 && <span className="badge">{coordinationBadge}</span>}
          </NavLink>
          <NavLink to="/messages" className={linkClass}>
            <span className="nav-icon">✉</span> Messages
            {summary.unread > 0 && <span className="badge">{summary.unread}</span>}
          </NavLink>
          {canWards && (
            <NavLink to="/wards" className={linkClass}>
              <span className="nav-icon">▤</span> Wards &amp; Beds
            </NavLink>
          )}
          {canPharmacy && (
            <NavLink to="/pharmacy" className={linkClass}>
              <span className="nav-icon">⚗</span> Pharmacy
            </NavLink>
          )}
          <NavLink to="/departments" className={linkClass}>
            <span className="nav-icon">◫</span> Departments
          </NavLink>
          {canReports && (
            <NavLink to="/reports" className={linkClass}>
              <span className="nav-icon">≡</span> Reports
            </NavLink>
          )}
          <NavLink to="/account" className={linkClass}>
            <span className="nav-icon">⚙</span> My account
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{user?.full_name?.[0] || '?'}</div>
            <div>
              <div className="user-name">{user?.full_name}</div>
              <div className="user-role">{user?.role}</div>
            </div>
            <ThemeToggle style={{ marginLeft: 'auto' }} />
          </div>
          <InstallAppButton className="btn-block" />
          <button
            className="btn btn-ghost btn-block"
            onClick={() => {
              logout();
              nav('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <ChatWidget />
    </div>
  );
}