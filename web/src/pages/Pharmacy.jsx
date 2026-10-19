import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { timeAgo } from '../util.js';

export default function Pharmacy() {
  const { user } = useAuth();
  const isPharmacist = user?.role === 'pharmacist';
  const [prescriptions, setPrescriptions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = () => {
    api('/prescriptions')
      .then((d) => setPrescriptions(d.prescriptions))
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    reload();
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, []);

  async function dispense(id) {
    if (user?.role !== 'pharmacist') return;
    setBusy(true);
    setError('');
    try {
      await api(`/prescriptions/${id}/dispense`, { method: 'POST' });
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const queue = prescriptions.filter((p) => p.status === 'active');
  const dispensed = prescriptions.filter((p) => p.status !== 'active');

  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="page-title">Pharmacy</h1>
          <div className="page-sub">Prescriptions awaiting dispense.</div>
        </div>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="grid grid-2">
        <div className="card">
          <h3>To dispense ({queue.length})</h3>
          {queue.length === 0 && <p className="muted">Queue is clear.</p>}
          {queue.map((p) => (
            <div key={p.id} className="pharm-row">
              <div className="task-main">
                <Link className="task-title" to={`/patients/${p.patient_id}`}>
                  {p.patient_no} {p.first_name} {p.last_name}
                </Link>
                <div className="psub">{p.items.map((i) => `${i.drug_name}${i.dose ? ` ${i.dose}` : ''}${i.frequency ? ` — ${i.frequency}` : ''}`).join('; ')}</div>
                <div className="psub">prescribed by {p.prescribed_by_name} · {timeAgo(p.created_at)}</div>
              </div>
              {isPharmacist && <button className="btn" onClick={() => dispense(p.id)} disabled={busy}>Dispense</button>}
            </div>
          ))}
        </div>

        <div className="card">
          <h3>Dispensed / cancelled ({dispensed.length})</h3>
          {dispensed.length === 0 && <p className="muted">Nothing yet.</p>}
          {dispensed.map((p) => (
            <div key={p.id} className="pharm-row">
              <div className="task-main">
                <Link className="task-title" to={`/patients/${p.patient_id}`}>
                  {p.patient_no} {p.first_name} {p.last_name}
                </Link>
                <div className="psub">{p.items.map((i) => i.drug_name).join(', ')}</div>
              </div>
              <span className={`tag status-tag`}>{p.status}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}