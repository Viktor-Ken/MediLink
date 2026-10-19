import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { timeAgo } from '../util.js';

const ROLES = ['doctor', 'nurse', 'receptionist', 'pharmacist', 'optometrist', 'lab_scientist', 'admin'];

const EMPTY = { username: '', password: '', full_name: '', role: '', department_id: '' };

export default function StaffAdmin() {
  const { user } = useAuth();
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = () => {
    api('/staff')
      .then((d) => setStaff(d.staff))
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    reload();
    api('/departments')
      .then((d) => setDepartments(d.departments))
      .catch(() => {});
  }, []);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/staff', { method: 'POST', body: JSON.stringify(form) });
      setForm(EMPTY);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(s) {
    if (!window.confirm(`Deactivate ${s.full_name} (${s.username})? They will no longer be able to sign in.`)) return;
    setError('');
    try {
      await api(`/staff/${s.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="page-title">Staff management</h1>
          <div className="page-sub">Create and deactivate staff accounts. Deactivated staff can no longer sign in.</div>
        </div>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="grid grid-2">
        <div className="card">
          <h3>Add a staff member</h3>
          <form className="stack" onSubmit={create}>
            <div className="field">
              <label>Full name</label>
              <input value={form.full_name} onChange={set('full_name')} placeholder="e.g. Dr. Amina Bello" required />
            </div>
            <div className="field">
              <label>Username</label>
              <input value={form.username} onChange={set('username')} placeholder="e.g. dr.bello" required />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={form.password} onChange={set('password')} placeholder="min 6 characters" minLength="6" required />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={form.role} onChange={set('role')} required>
                <option value="">Select…</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Department</label>
              <select value={form.department_id} onChange={set('department_id')}>
                <option value="">— None —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          </form>
        </div>

        <div className="card">
          <h3>Staff directory ({staff.length})</h3>
          {staff.length === 0 && <p className="muted">No staff found.</p>}
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Department</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.full_name}</strong>
                    <div className="psub">joined {timeAgo(s.created_at)}</div>
                  </td>
                  <td>{s.username}</td>
                  <td>{s.role}</td>
                  <td>{s.department_name || '—'}</td>
                  <td>
                    <span className={`tag${s.active ? ' status-tag' : ''}`} style={!s.active ? { background: 'var(--danger)' } : undefined}>
                      {s.active ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td>
                    {s.active && s.id !== user?.id && (
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', borderColor: 'var(--border)' }} onClick={() => deactivate(s)}>
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}