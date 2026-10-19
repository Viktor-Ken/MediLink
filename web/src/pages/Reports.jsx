import { useEffect, useState } from 'react';
import { api, getToken } from '../api.js';

const EXPORTS = [
  ['patients', 'Patients registry'],
  ['referrals', 'Referrals'],
  ['admissions', 'Admissions'],
  ['prescriptions', 'Prescriptions'],
  ['investigations', 'Investigations'],
  ['events', 'Audit event log'],
  ['consents', 'Consents'],
  ['scans', 'Scan access log'],
  ['vitals', 'Vitals log'],
];

function kpiCards(s) {
  return [
    { label: 'Patients', value: s.patients.total, sub: `+${s.patients.registered_7d} this week` },
    { label: 'Active admissions', value: s.admissions.find((a) => a.status === 'active')?.n || 0, sub: `${(s.admissions.find((a) => a.status === 'active')?.n || 0)} in-hospital` },
    { label: 'Beds occupied', value: s.beds.find((b) => b.status === 'occupied')?.n || 0, sub: `${s.beds.find((b) => b.status === 'occupied')?.n || 0}/${s.beds.reduce((t, b) => t + b.n, 0)} total` },
    { label: 'Upcoming appts', value: s.appointments.upcoming, sub: `${s.appointments.completed_7d} completed in 7d` },
    { label: 'Open referrals', value: s.referrals.find((r) => r.status === 'open')?.n || 0, sub: `${s.referrals.find((r) => r.status === 'open')?.stat || 0} stat` },
    { label: 'Events (7d)', value: s.events_7d },
  ];
}

export default function Reports() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState('');

  useEffect(() => {
    api('/reports/stats')
      .then(setS)
      .catch((e) => setError(e.message));
  }, []);

  async function exportCsv(type) {
    setDownloading(type);
    setError('');
    try {
      const res = await fetch(`/api/reports/export/${type}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading('');
    }
  }

  if (error) return <div className="alert-error">{error}</div>;
  if (!s) return <p className="muted">Loading…</p>;

  const totalBeds = s.beds.reduce((t, b) => t + b.n, 0);
  const occBeds = s.beds.find((b) => b.status === 'occupied')?.n || 0;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="page-title">Reports &amp; operations</h1>
          <div className="page-sub">Live hospital metrics and compliance exports (admin / doctor).</div>
        </div>
      </div>

      <div className="kpi-grid">
        {kpiCards(s).map((k) => (
          <div key={k.label} className="card kpi-card">
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-label">{k.label}</div>
            <div className="psub">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>Referrals by status</h3>
          <table className="table">
            <thead><tr><th>Status</th><th>Count</th><th>Stat</th><th>Urgent</th><th>Routine</th></tr></thead>
            <tbody>
              {s.referrals.map((r) => (
                <tr key={r.status}><td>{r.status}</td><td>{r.n}</td><td>{r.stat}</td><td>{r.urgent}</td><td>{r.routine}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Medications &amp; tests</h3>
          <div className="kv">
            <div><div className="k">Prescriptions</div><div className="v">{s.prescriptions.map((r) => `${r.status} ${r.n}`).join(' · ')}</div></div>
            <div><div className="k">Investigations</div><div className="v">{s.investigations.map((r) => `${r.status} ${r.n}`).join(' · ')}</div></div>
            <div><div className="k">Tasks</div><div className="v">{s.tasks.map((r) => `${r.status} ${r.n}`).join(' · ') || '—'}</div></div>
          </div>
        </div>

        <div className="card">
          <h3>Consents</h3>
          <table className="table">
            <thead><tr><th>Kind</th><th>Granted</th><th>Revoked</th></tr></thead>
            <tbody>
              {s.consents.map((c) => (
                <tr key={c.kind}>
                  <td>{c.kind}</td>
                  <td>{c.status === 'granted' ? c.n : 0}</td>
                  <td>{c.status === 'revoked' ? c.n : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Staff by role</h3>
          <table className="table">
            <thead><tr><th>Role</th><th>Count</th></tr></thead>
            <tbody>
              {s.staff.map((r) => <tr key={r.role}><td>{r.role}</td><td>{r.n}</td></tr>)}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Ward occupancy</h3>
          <div className="kpi-value">{occBeds}<span className="kpi-label"> / {totalBeds} beds</span></div>
          <div className="meter">
            <div className="meter-fill" style={{ width: `${Math.round((100 * occBeds) / totalBeds)}%` }} />
          </div>
          <div className="psub">{Math.round((100 * occBeds) / totalBeds)}% occupied</div>
        </div>
      </div>

      <div className="card">
        <h3>Compliance exports (CSV)</h3>
        <p className="psub" style={{ marginTop: -6 }}>
          Downloads are restricted to admin / doctor. Filenames are machine-readable for auditors.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {EXPORTS.map(([type, label]) => (
            <button key={type} className="btn btn-ghost" style={{ borderColor: 'var(--border)' }} disabled={downloading === type} onClick={() => exportCsv(type)}>
              {downloading === type ? 'Exporting…' : `⬇ ${label}`}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}