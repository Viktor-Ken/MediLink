import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../api.js';
import Code128 from '../components/Code128.jsx';

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const GENDERS = ['Female', 'Male', 'Other', 'Not disclosed'];
const GENOTYPES = ['AA', 'AS', 'SS', 'AC', 'SC'];

const EMPTY = {
  first_name: '',
  last_name: '',
  dob: '',
  gender: '',
  blood_type: '',
  genotype: '',
  nin: '',
  nhis_no: '',
  allergies: '',
  conditions: '',
  medications: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  emergency_contact_relation: '',
  notes: '',
  pin: '',
};

export default function Register() {
  const [form, setForm] = useState(EMPTY);
  const [created, setCreated] = useState(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  useEffect(() => {
    if (created) {
      QRCode.toDataURL(created.patient_no, { width: 220, margin: 1 })
        .then(setQr)
        .catch(() => {});
    }
  }, [created]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api('/patients', { method: 'POST', body: JSON.stringify(form) });
      setCreated(data.patient);
      setForm(EMPTY);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="stack">
        <div className="page-heading">
          <div>
            <h1 className="page-title">Patient registered</h1>
            <div className="page-sub">Print this QR for the patient's card or wristband.</div>
          </div>
        </div>

        <div className="grid grid-3">
          <div className="card">
            <h3>Patient</h3>
            <div className="pno">{created.patient_no}</div>
            <div style={{ fontSize: 18, fontWeight: 700, margin: '6px 0' }}>
              {created.first_name} {created.last_name}
            </div>
            <div className="muted">
              {created.dob ?? 'DOB not set'} · {created.gender || '—'} · {created.blood_type || 'blood type unknown'}
            </div>
            {created.portal_pin && (
              <div className="alert-info" style={{ marginTop: 12 }}>
                Portal PIN: <strong>{created.portal_pin}</strong> — give it to the patient with the card.
              </div>
            )}
            <div className="row" style={{ marginTop: 14 }}>
              <Link className="btn" to={`/patients/${created.id}`}>Open profile</Link>
              <button className="btn btn-ghost" style={{ color: 'var(--primary)', borderColor: 'var(--border)' }} onClick={() => setCreated(null)}>
                Register another
              </button>
            </div>
          </div>

          <div className="card qr-card">
            <h3>Card / bracelet QR</h3>
            {qr && <img src={qr} alt={`QR for ${created.patient_no}`} />}
            <div className="pno" style={{ marginTop: 8 }}>{created.patient_no}</div>
            <Code128 value={created.patient_no} height={40} />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Code 128 barcode</div>
            <button className="btn no-print" style={{ marginTop: 12 }} onClick={() => window.print()}>
              Print card
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="page-title">Register Patient</h1>
          <div className="page-sub">Create a patient record and issue a scan card/bracelet.</div>
        </div>
      </div>

      <form className="card" onSubmit={submit}>
        {error && <div className="alert-error" style={{ marginBottom: 14 }}>{error}</div>}

        <h3>Identity</h3>
        <div className="form-grid">
          <div className="field">
            <label>First name *</label>
            <input value={form.first_name} onChange={set('first_name')} required />
          </div>
          <div className="field">
            <label>Last name *</label>
            <input value={form.last_name} onChange={set('last_name')} required />
          </div>
          <div className="field">
            <label>Date of birth</label>
            <input type="date" value={form.dob} onChange={set('dob')} />
          </div>
          <div className="field">
            <label>Gender</label>
            <select value={form.gender} onChange={set('gender')}>
              <option value="">Not set</option>
              {GENDERS.map((g) => <option key={g}>{g}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Blood type</label>
            <select value={form.blood_type} onChange={set('blood_type')}>
              <option value="">Unknown</option>
              {BLOOD_TYPES.map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
        </div>

        <h3 style={{ marginTop: 24 }}>Identification (Nigeria)</h3>
        <p className="muted" style={{ fontSize: 13, margin: '-8px 0 14px' }}>
          Genotype is shown on the emergency record alongside blood type. NIN / NHIS numbers
          help match the patient to national records.
        </p>
        <div className="form-grid">
          <div className="field">
            <label>Genotype</label>
            <select value={form.genotype} onChange={set('genotype')}>
              <option value="">Unknown</option>
              {GENOTYPES.map((g) => <option key={g}>{g}</option>)}
            </select>
          </div>
          <div className="field">
            <label>NIN (National ID)</label>
            <input value={form.nin} onChange={(e) => setForm({ ...form, nin: e.target.value.replace(/\D/g, '').slice(0, 11) })} placeholder="11 digits" />
          </div>
          <div className="field">
            <label>NHIS / HMO number</label>
            <input value={form.nhis_no} onChange={set('nhis_no')} placeholder="optional" />
          </div>
        </div>

        <h3 style={{ marginTop: 24 }}>Emergency / critical info</h3>
        <p className="muted" style={{ fontSize: 13, margin: '-8px 0 14px' }}>
          Shown immediately when the card is scanned in an emergency. Use comma-separated lists.
        </p>
        <div className="form-grid">
          <div className="field">
            <label>Allergies</label>
            <input value={form.allergies} onChange={set('allergies')} placeholder="Penicillin, Latex" />
          </div>
          <div className="field">
            <label>Conditions</label>
            <input value={form.conditions} onChange={set('conditions')} placeholder="Diabetes, Asthma" />
          </div>
          <div className="field">
            <label>Current medications</label>
            <input value={form.medications} onChange={set('medications')} placeholder="Insulin, Warfarin" />
          </div>
        </div>

        <h3 style={{ marginTop: 24 }}>Emergency contact</h3>
        <div className="form-grid">
          <div className="field">
            <label>Name</label>
            <input value={form.emergency_contact_name} onChange={set('emergency_contact_name')} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} />
          </div>
          <div className="field">
            <label>Relationship</label>
            <input value={form.emergency_contact_relation} onChange={set('emergency_contact_relation')} placeholder="Spouse, Parent, …" />
          </div>
        </div>

        <h3 style={{ marginTop: 24 }}>Notes</h3>
        <div className="field">
          <textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="Optional internal notes" />
        </div>

        <h3 style={{ marginTop: 24 }}>Portal access</h3>
        <p className="muted" style={{ fontSize: 13, margin: '-8px 0 14px' }}>
          The patient uses this PIN with their number to sign into the self-service portal.
          Give it to them with the printed card — it can be changed later.
        </p>
        <div className="field" style={{ maxWidth: 260 }}>
          <label>Portal PIN</label>
          <input
            value={form.pin}
            placeholder="Leave blank to generate a random PIN"
            inputMode="numeric"
            onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/[^0-9]/g, '') })}
            maxLength={8}
          />
        </div>

        <button className="btn" style={{ marginTop: 18 }} disabled={busy}>
          {busy ? 'Registering…' : 'Register patient'}
        </button>
      </form>
    </>
  );
}