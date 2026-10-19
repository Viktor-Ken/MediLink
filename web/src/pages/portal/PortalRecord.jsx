import { useEffect, useState } from 'react';
import { portalApi } from '../../portalApi.js';

export default function PortalRecord() {
  const [patient, setPatient] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    portalApi('/portal/me')
      .then((d) => setPatient(d.patient))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert-error">{error}</div>;
  if (!patient) return <p className="muted">Loading…</p>;

  const tags = (arr) =>
    arr && arr.length ? arr.map((a) => <span key={a} className="tag">{a}</span>) : <span className="muted">—</span>;

  return (
    <>
      <h1 className="page-title">{patient.first_name} {patient.last_name}</h1>
      <div className="page-sub">{patient.patient_no} · emergency record</div>

      {patient.allergies?.length > 0 && (
        <div className="alert-danger" style={{ margin: '14px 0' }}>
          <strong>Allergies:</strong> {patient.allergies.join(', ')}
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <h3>Details</h3>
          <dl className="info-list">
            <dt>Blood type</dt><dd>{patient.blood_type || '—'}</dd>
            <dt>Genotype</dt><dd>{patient.genotype || '—'}</dd>
            {patient.nin && <><dt>NIN</dt><dd>{patient.nin}</dd></>}
            {patient.nhis_no && <><dt>NHIS / HMO</dt><dd>{patient.nhis_no}</dd></>}
            <dt>DOB</dt><dd>{patient.dob || '—'}</dd>
            <dt>Gender</dt><dd>{patient.gender || '—'}</dd>
          </dl>
        </div>
        <div className="card">
          <h3>Conditions</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{tags(patient.conditions)}</div>
        </div>
        <div className="card">
          <h3>Medications</h3>
          <ul className="plain-list">
            {(patient.medications || []).map((m) => <li key={m}>💊 {m}</li>)}
          </ul>
        </div>
        <div className="card">
          <h3>Emergency contact</h3>
          <p>
            <strong>{patient.emergency_contact_name || '—'}</strong>
            {patient.emergency_contact_relation ? ` (${patient.emergency_contact_relation})` : ''}
            <br />
            {patient.emergency_contact_phone || ''}
          </p>
          {patient.notes && <p className="psub" style={{ marginTop: 8 }}>Note: {patient.notes}</p>}
        </div>
      </div>
    </>
  );
}