import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { clerkEnabled } from '../clerk.js';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username, password);
      nav('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <ThemeToggle className="login-theme" />
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark">✚</span>
          <div>
            <div className="brand-name">MediLink</div>
            <div className="brand-sub">Hospital Management System</div>
          </div>
        </div>
        <div className="login-title">Staff sign in</div>
        {error && <div className="alert-error" style={{ margin: '10px 0' }}>{error}</div>}
        <div className="stack" style={{ marginTop: 16 }}>
          <div className="field">
            <label>Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>
          <div className="field">
            <label>Password</label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button className="btn btn-block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {clerkEnabled && (
            <Link className="btn btn-ghost btn-block" to="/sso">Sign in with single sign-on</Link>
          )}
        </div>
        <div className="login-hint">
          Demo accounts — <strong>admin / admin123</strong> (admin),
          <br />
          <strong>reception / reception</strong>,
          <br />
          <strong>er.nurse / er.nurse</strong>, <strong>dr.okafor / dr.okafor</strong>
          <br />
          <strong>pharmacist / pharmacist</strong>, <strong>optometrist / optometrist</strong>,
          <br />
          <strong>lab.scientist / lab.scientist</strong>
        </div>
        <Link className="btn btn-ghost btn-block" style={{ marginTop: 14 }} to="/portal/login">
          Patient self-service portal →
        </Link>
        <p className="legal-links">
          <Link to="/privacy">Privacy Policy</Link>
          <span aria-hidden="true"> · </span>
          <Link to="/terms">Terms of Service</Link>
        </p>
      </form>
    </div>
  );
}