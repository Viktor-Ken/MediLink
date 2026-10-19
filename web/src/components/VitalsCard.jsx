import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { timeAgo } from '../util.js';

const RISK = {
  low: { label: 'Low risk', color: 'var(--success)' },
  medium: { label: 'Medium risk', color: '#f97316' },
  high: { label: 'High risk', color: 'var(--danger)' },
};

const AVPU = ['alert', 'voice', 'pain', 'unresponsive'];

const EMPTY = { temperature: '', systolic: '', diastolic: '', pulse: '', respiratory_rate: '', spo2: '', consciousness: 'alert', notes: '' };

function EwsSpark({ series }) {
  const pts = series.map((x) => x.ews.total);
  if (pts.length < 2) return null;
  const w = 240;
  const h = 40;
  const pad = 5;
  const max = Math.max(...pts, 3);
  const coords = pts.map((v, i) => {
    const x = pad + ((w - 2 * pad) * i) / (pts.length - 1);
    const y = h - pad - ((h - 2 * pad) * v) / max;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} className="ews-spark" viewBox={`0 0 ${w} ${h}`}>
      <polyline points={coords.join(' ')} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />
      {pts.map((v, i) => {
        const [x, y] = coords[i].split(',');
        return <circle key={i} cx={x} cy={y} r="2.4" fill={v >= 7 ? 'var(--danger)' : v >= 5 ? '#f97316' : 'var(--success)'} />;
      })}
    </svg>
  );
}

function readingRows(r) {
  return [
    ['Temp', r.temperature != null ? `${r.temperature}°C` : null],
    ['BP', r.systolic != null ? `${r.systolic}/${r.diastolic ?? '—'}` : null],
    ['HR', r.pulse != null ? `${r.pulse}` : null],
    ['RR', r.respiratory_rate != null ? `${r.respiratory_rate}` : null],
    ['SpO2', r.spo2 != null ? `${r.spo2}%` : null],
    ['AVPU', r.consciousness || null],
  ].filter(([, v]) => v != null);
}

export default function VitalsCard({ patientId }) {
  const { user } = useAuth();
  const canRecord = ['nurse', 'doctor'].includes(user?.role);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [justRecorded, setJustRecorded] = useState(null);

  async function load() {
    try {
      setData(await api(`/vitals/patient/${patientId}`));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load();
  }, [patientId]);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { patientId, consciousness: form.consciousness };
      for (const k of ['temperature', 'systolic', 'diastolic', 'pulse', 'respiratory_rate', 'spo2']) {
        if (form[k] !== '') body[k] = Number(form[k]);
      }
      const resp = await api('/vitals', { method: 'POST', body: JSON.stringify(body) });
      setForm({ ...EMPTY, consciousness: 'alert' });
      setOpen(false);
      setJustRecorded(resp.ews);
      await load();
      setTimeout(() => setJustRecorded(null), 6000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const latest = data?.latest;
  const risk = latest ? RISK[latest.ews.risk] : null;

  return (
    <div className="card">
      <div className="vitals-head">
        <h3>Vitals &amp; early warning score</h3>
        {canRecord && (
          <button className="btn btn-sm" onClick={() => setOpen(!open)}>
            {open ? 'Cancel' : '+ Record vitals'}
          </button>
        )}
      </div>

      {justRecorded && (
        <div className={`alert ${justRecorded.risk === 'high' ? 'alert-error' : 'alert-info'}`}>
          Recorded — EWS {justRecorded.total} · {justRecorded.risk}
        </div>
      )}
      {error && <div className="alert-error">{error}</div>}

      {open && (
        <form className="form-grid vitals-form" onSubmit={submit}>
          <div className="field">
            <label>Temperature (°C)</label>
            <input type="number" step="0.1" value={form.temperature} onChange={set('temperature')} />
          </div>
          <div className="field">
            <label>Systolic (mmHg)</label>
            <input type="number" value={form.systolic} onChange={set('systolic')} />
          </div>
          <div className="field">
            <label>Diastolic (mmHg)</label>
            <input type="number" value={form.diastolic} onChange={set('diastolic')} />
          </div>
          <div className="field">
            <label>Pulse (/min)</label>
            <input type="number" value={form.pulse} onChange={set('pulse')} />
          </div>
          <div className="field">
            <label>Resp rate (/min)</label>
            <input type="number" value={form.respiratory_rate} onChange={set('respiratory_rate')} />
          </div>
          <div className="field">
            <label>SpO2 (%)</label>
            <input type="number" value={form.spo2} onChange={set('spo2')} />
          </div>
          <div className="field">
            <label>Consciousness (AVPU)</label>
            <select value={form.consciousness} onChange={set('consciousness')}>
              {AVPU.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Notes</label>
            <input value={form.notes} onChange={set('notes')} placeholder="optional" />
          </div>
          <div className="field">
            <button className="btn" disabled={busy}>{busy ? 'Recording…' : 'Save reading'}</button>
          </div>
        </form>
      )}

      {!latest && <p className="muted">No vitals recorded yet.</p>}

      {latest && (
        <div className="vitals-grid">
          <div className="ews-now" style={{ borderColor: risk.color }}>
            <div className="ews-num" style={{ color: risk.color }}>{latest.ews.total}</div>
            <div className="kpi-label" style={{ marginTop: 2 }}>EWS · {risk.label}</div>
            <div className="psub">{timeAgo(latest.recorded_at)}{latest.recorded_by_name ? ` · ${latest.recorded_by_name}` : ''}</div>
          </div>

          <div className="vitals-values">
            {readingRows(latest).map(([label, value]) => (
              <div key={label} className="vit-pair">
                <div className="k">{label}</div>
                <div className="v">{value}</div>
              </div>
            ))}
          </div>

          <div className="vitals-trend">
            <div className="k">EWS trend (last {data.series.length})</div>
            <EwsSpark series={data.series} />
          </div>
        </div>
      )}

      {data && data.readings.length > 0 && (
        <table className="table vitals-table">
          <thead>
            <tr><th>When</th><th>Temp</th><th>BP</th><th>HR</th><th>RR</th><th>SpO2</th><th>AVPU</th><th>EWS</th></tr>
          </thead>
          <tbody>
            {data.readings.slice(0, 8).map((r) => (
              <tr key={r.id}>
                <td>{timeAgo(r.recorded_at)}</td>
                <td>{r.temperature ?? '—'}</td>
                <td>{r.systolic != null ? `${r.systolic}/${r.diastolic ?? '—'}` : '—'}</td>
                <td>{r.pulse ?? '—'}</td>
                <td>{r.respiratory_rate ?? '—'}</td>
                <td>{r.spo2 != null ? `${r.spo2}%` : '—'}</td>
                <td>{r.consciousness ?? '—'}</td>
                <td><span className="ews-pill" style={{ background: RISK[r.ews.risk].color }}>{r.ews.total}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}