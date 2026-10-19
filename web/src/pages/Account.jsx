import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import PasswordInput from '../components/PasswordInput.jsx';

export default function Account() {
  const { user } = useAuth();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function changePassword(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (form.new_password.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (form.new_password !== form.confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      await api('/account/password', {
        method: 'POST',
        body: JSON.stringify({ current_password: form.current_password, new_password: form.new_password }),
      });
      setForm({ current_password: '', new_password: '', confirm: '' });
      setInfo('Password updated. Use your new password next time you sign in.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <h2 className="page-title" style={{ marginBottom: 4 }}>My account</h2>
      <div className="page-sub" style={{ marginBottom: 16 }}>
        {user?.full_name} · {user?.username} · {user?.role}
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      {info && <div className="alert-info" style={{ marginBottom: 16, borderColor: 'var(--success)' }}>{info}</div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Change password</h3>
        <p className="muted">Use your current password to set a new one. Minimum 6 characters.</p>
        <form onSubmit={changePassword}>
          <div className="field">
            <label>Current password</label>
            <PasswordInput value={form.current_password} onChange={set('current_password')} autoComplete="current-password" required />
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>New password</label>
              <PasswordInput value={form.new_password} onChange={set('new_password')} autoComplete="new-password" required />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Confirm new password</label>
              <PasswordInput value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
            </div>
          </div>
          <button className="btn" style={{ marginTop: 12 }} disabled={busy}>
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}