import { useEffect, useState } from 'react';
import { portalApi } from '../../portalApi.js';
import { fmtDateTime } from '../../util.js';

export default function PortalMeds() {
  const [prescriptions, setPrescriptions] = useState([]);
  const [invs, setInvs] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      portalApi('/portal/prescriptions'),
      portalApi('/portal/investigations'),
    ])
      .then(([rx, inv]) => {
        setPrescriptions(rx.prescriptions);
        setInvs(inv.investigations);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert-error">{error}</div>;

  return (
    <>
      <h1 className="page-title">Medications &amp; results</h1>

      <div className="card">
        <h3>Prescriptions</h3>
        {prescriptions.length === 0 && <p className="muted">None.</p>}
        {prescriptions.map((p) => (
          <div key={p.id} className="presc-row">
            <div className="presc-head">
              <strong>{p.items.map((i) => i.drug_name).join(', ')}</strong>
              <span className={`tag status-tag`}>{p.status}</span>
            </div>
            <div className="psub">
              {p.items.map((i) => `${i.dose}${i.frequency ? ` · ${i.frequency}` : ''}${i.route ? ` · ${i.route}` : ''}${i.duration_days ? ` · ${i.duration_days}d` : ''}`).join(' — ')}
            </div>
            <div className="psub">
              prescribed by {p.prescribed_by_name || '—'} on {fmtDateTime(p.created_at)}
              {p.notes ? ` · ${p.notes}` : ''}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Tests &amp; results</h3>
        {invs.length === 0 && <p className="muted">None.</p>}
        {invs.map((i) => (
          <div key={i.id} className="presc-row">
            <div className="presc-head">
              <strong>{i.test_name}</strong>
              <span className={`tag status-tag`}>{i.status}</span>
            </div>
            <div className="psub">
              {i.kind === 'radiology' ? 'Radiology' : 'Lab'} · {i.department_name || '—'}
              {i.clinical_note ? ` · ${i.clinical_note}` : ''}
            </div>
            {i.result_json && (
              <div className="result-box">
                <strong>Result:</strong> {i.result_json.text || ''}
                {i.result_json.note ? ` (${i.result_json.note})` : ''}
                {i.resulted_at ? ` — ${fmtDateTime(i.resulted_at)}` : ''}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}