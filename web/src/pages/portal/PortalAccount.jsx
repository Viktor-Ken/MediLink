import { useEffect, useState } from 'react';
import { portalApi } from '../../portalApi.js';
import PasswordInput from '../../components/PasswordInput.jsx';

export default function PortalAccount() {
  const [me, setMe] = useState(null);
  const [form, setForm] = useState({ current_pin: '', new_pin: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    portalApi('/portal/me')
      .then((d) => setMe(d.patient))
      .catch(() => {});
  }, []);

  async function changePin(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!/^\d{4,8}$/.test(form.new_pin)) {
      setError('New PIN must be 4–8 digits.');
      return;
    }
    if (form.new_pin !== form.confirm) {
      setError('New PIN and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      await portalApi('/portal/pin', {
        method: 'POST',
        body: JSON.stringify({ current_pin: form.current_pin, new_pin: form.new_pin }),
      });
      setForm({ current_pin: '', new_pin: '', confirm: '' });
      setInfo('Portal PIN updated. Use your new PIN next time you sign in.');
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
        {me ? `${me.first_name} ${me.last_name} · ${me.patient_no}` : 'Patient'}
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      {info && <div className="alert-info" style={{ marginBottom: 16, borderColor: 'var(--success)' }}>{info}</div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Change portal PIN</h3>
        <p className="muted">
          Used to sign into the MediLink portal alongside your {me?.patient_no || 'patient'} number. Use 4–8 digits.
        </p>
        <form onSubmit={changePin}>
          <div className="field">
            <label>Current PIN</label>
            <PasswordInput inputMode="numeric" value={form.current_pin} onChange={set('current_pin')} autoComplete="current-password" placeholder="••••" required />
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>New PIN</label>
              <PasswordInput inputMode="numeric" value={form.new_pin} onChange={set('new_pin')} autoComplete="new-password" placeholder="••••" required />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Confirm new PIN</label>
              <PasswordInput inputMode="numeric" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" placeholder="••••" required />
            </div>
          </div>
          <button className="btn" style={{ marginTop: 12 }} disabled={busy}>
            {busy ? 'Saving…' : 'Update PIN'}
          </button>
        </form>
      </div>
    </div>
  );
}