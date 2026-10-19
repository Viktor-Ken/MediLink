import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

export default function Wards() {
  const { user } = useAuth();
  const [wards, setWards] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newWard, setNewWard] = useState({ name: '', floor: '' });
  const [newBed, setNewBed] = useState({});

  const isAdmin = user?.role === 'admin';

  const reload = () => {
    api('/wards')
      .then((d) => setWards(d.wards))
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    reload();
    const t = setInterval(reload, 60000);
    return () => clearInterval(t);
  }, []);

  async function createWard(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/wards', { method: 'POST', body: JSON.stringify(newWard) });
      setNewWard({ name: '', floor: '' });
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addBed(wardId) {
    setBusy(true);
    setError('');
    try {
      await api(`/wards/${wardId}/beds`, { method: 'POST', body: JSON.stringify({ label: newBed[wardId] }) });
      setNewBed({});
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const counts = (beds) => ({
    total: beds.length,
    occupied: beds.filter((b) => b.status === 'occupied').length,
    available: beds.filter((b) => b.status === 'available').length,
  });

  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="page-title">Wards &amp; Beds</h1>
          <div className="page-sub">Live bed availability across wards.</div>
        </div>
      </div>

      {error && <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {isAdmin && (
        <form className="card" onSubmit={createWard} style={{ marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>Add ward</h3>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="grow" value={newWard.name} onChange={(e) => setNewWard({ ...newWard, name: e.target.value })} placeholder="Ward name" required />
            <input value={newWard.floor} onChange={(e) => setNewWard({ ...newWard, floor: e.target.value })} placeholder="Floor" style={{ width: 120 }} />
            <button className="btn" disabled={busy}>Add ward</button>
          </div>
        </form>
      )}

      <div className="ward-grid">
        {wards.length === 0 && <p className="muted">No wards yet.</p>}
        {wards.map((w) => {
          const c = counts(w.beds);
          return (
            <div key={w.id} className="card">
              <div className="ward-head">
                <div>
                  <h3 style={{ margin: 0 }}>{w.name}</h3>
                  <div className="psub">{w.floor || '—'} · {c.occupied}/{c.total} occupied</div>
                </div>
              </div>
              <div className="bed-board">
                {w.beds.map((b) => (
                  <div key={b.id} className={`bed bed-${b.status}`}>
                    <div className="bed-label">{b.label}</div>
                    {b.status === 'occupied' ? (
                      <Link className="bed-patient" to={`/patients/${b.patient_id}`}>
                        {b.patient_no}
                        <br />
                        {b.first_name} {b.last_name}
                      </Link>
                    ) : (
                      <div className="bed-empty">{b.status}</div>
                    )}
                  </div>
                ))}
              </div>
              {isAdmin && (
                <div className="row" style={{ gap: 6, marginTop: 10 }}>
                  <input
                    className="grow"
                    placeholder="Bed label (e.g. A5)"
                    value={newBed[w.id] || ''}
                    onChange={(e) => setNewBed({ ...newBed, [w.id]: e.target.value })}
                  />
                  <button className="btn btn-ghost" style={{ color: 'var(--primary)', borderColor: 'var(--border)' }} onClick={() => addBed(w.id)}>Add bed</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}