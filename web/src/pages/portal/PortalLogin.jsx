import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { setPatientToken } from '../../portalApi.js';
import PasswordInput from '../../components/PasswordInput.jsx';
import ThemeToggle from '../../components/ThemeToggle.jsx';

export default function PortalLogin() {
  const nav = useNavigate();
  const [patientNo, setPatientNo] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNote('');
    try {
      const res = await fetch('/api/auth/patient-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientNo, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Login failed');
      setPatientToken(data.token);
      nav('/portal/record');
    } catch (err) {
      setError(err.message);
      setNote('Demo PIN for all patients is 1234');
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
            <div className="brand-sub">Patient self-service portal</div>
          </div>
        </div>
        <div className="login-title">Patient sign in</div>
        {error && <div className="alert-error" style={{ margin: '10px 0' }}>{error}</div>}
        {note && <div className="alert-info" style={{ margin: '10px 0' }}>{note}</div>}
        <div className="stack" style={{ marginTop: 16 }}>
          <div className="field">
            <label>Patient number</label>
            <input
              value={patientNo}
              onChange={(e) => setPatientNo(e.target.value.toUpperCase())}
              placeholder="e.g. HM-1001"
              autoComplete="username"
              autoFocus
            />
          </div>
          <div className="field">
            <label>Portal PIN</label>
            <PasswordInput
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="current-password"
              placeholder="4-digit PIN from your card"
            />
          </div>
          <button className="btn btn-block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        <div className="login-hint">
          <Link to="/login">← Staff sign in</Link>
        </div>
      </form>
    </div>
  );
}