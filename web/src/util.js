export function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function patientView(role) {
  const clinical = ['admin', 'doctor', 'nurse'].includes(role);
  return {
    nin: ['admin', 'doctor', 'receptionist'].includes(role),
    nhis: ['admin', 'doctor', 'receptionist'].includes(role),
    allergies: ['admin', 'doctor', 'nurse', 'pharmacist', 'optometrist', 'lab_scientist'].includes(role),
    conditions: ['admin', 'doctor', 'nurse', 'pharmacist'].includes(role),
    medications: ['admin', 'doctor', 'nurse', 'pharmacist'].includes(role),
    notes: clinical,
    consents: clinical,
    vitals: clinical,
    timeline: ['admin', 'doctor', 'nurse', 'receptionist'].includes(role),
    clinicalLink: clinical,
    canEdit: role === 'admin',
    canDelete: role === 'admin',
    message: ['admin', 'doctor'].includes(role),
  };
}

export function fmtDateTime(iso) {
  return new Date(iso).toLocaleString();
}

export const EVENT_META = {
  registration: { icon: '✎', label: 'Patient registered' },
  scan: { icon: '⌕', label: 'Card scanned' },
  referral_created: { icon: '⇶', label: 'Referral sent' },
  referral_accepted: { icon: '✓', label: 'Referral accepted' },
  referral_completed: { icon: '✔', label: 'Referral completed' },
  referral_declined: { icon: '✕', label: 'Referral declined' },
  handoff_created: { icon: '⇄', label: 'Handoff created' },
  handoff_accepted: { icon: '✓', label: 'Handoff accepted' },
  handoff_completed: { icon: '✔', label: 'Handoff completed' },
  message: { icon: '✉', label: 'Message' },
  appointment_created: { icon: '🗓', label: 'Appointment scheduled' },
  appointment_checked_in: { icon: '∷', label: 'Appointment checked in' },
  appointment_completed: { icon: '✔', label: 'Appointment completed' },
  appointment_cancelled: { icon: '✕', label: 'Appointment cancelled' },
  appointment_no_show: { icon: '◌', label: 'Appointment no-show' },
  admission_admitted: { icon: '▤', label: 'Admitted to ward' },
  admission_discharged: { icon: '▨', label: 'Discharged' },
  prescription_created: { icon: '💊', label: 'Prescription written' },
  prescription_dispensed: { icon: '⚗', label: 'Prescription dispensed' },
  investigation_ordered: { icon: '⚬', label: 'Test ordered' },
  investigation_resulted: { icon: '◈', label: 'Test resulted' },
  note_added: { icon: '✎', label: 'Clinical note' },
  portal_login: { icon: '◉', label: 'Portal sign-in' },
  appointment_requested: { icon: '🗓', label: 'Appointment requested' },
  consent_granted: { icon: '✓', label: 'Consent granted' },
  consent_revoked: { icon: '✕', label: 'Consent withdrawn' },
  vitals_recorded: { icon: '♥', label: 'Vitals recorded' },
};

export function eventSummary(kind, data = {}) {
  switch (kind) {
    case 'registration':
      return `Assigned ID ${data.patient_no || ''}`.trim();
    case 'scan':
      return data.location ? `at ${data.location}` : 'profile accessed';
    case 'referral_created':
      return `${data.from || ''} → ${data.to || ''}${data.priority ? ` (${data.priority})` : ''}${data.reason ? ` — ${data.reason}` : ''}`;
    case 'referral_accepted':
      return `receiving team took over the case`;
    case 'referral_completed':
      return `case closed by receiving team`;
    case 'referral_declined':
      return `${data.reason ? `— ${data.reason}` : 'referring team declined'}`;
    case 'handoff_created':
      return `${data.summary || ''}${data.from && data.to ? ` · ${data.from} → ${data.to}` : ''}`;
    case 'handoff_accepted':
      return 'receiving team acknowledged';
    case 'handoff_completed':
      return 'handoff closed';
    case 'message':
      return `in ${data.conversation || 'conversation'}${data.body ? `: "${data.body.length > 90 ? `${data.body.slice(0, 90)}…` : data.body}"` : ''}`;
    case 'appointment_created':
      return data.department ? `in ${data.department}${data.scheduledFor ? ` on ${new Date(data.scheduledFor).toLocaleString()}` : ''}` : '';
    case 'appointment_checked_in':
      return 'patient arrived at clinic';
    case 'appointment_completed':
      return 'visit completed';
    case 'appointment_cancelled':
    case 'appointment_no_show':
      return 'appointment not kept';
    case 'admission_admitted':
      return `${data.ward || 'ward'} · bed ${data.bed || '—'}${data.reason ? ` — ${data.reason}` : ''}`;
    case 'admission_discharged':
      return 'patient left hospital care';
    case 'prescription_created':
      return `${data.drugs || ''}${data.notes ? ` — ${data.notes}` : ''}`;
    case 'prescription_dispensed':
      return 'medication handed to pharmacy';
    case 'investigation_ordered':
      return `${data.type === 'radiology' ? 'radiology' : 'lab'} — ${data.test || ''}${data.note ? ` (${data.note})` : ''}`;
    case 'investigation_resulted':
      return `${data.type === 'radiology' ? 'radiology' : 'lab'} — ${data.test || ''}: ${data.result || ''}`;
    case 'note_added':
      return `${data.type || 'progress'} note`;
    case 'portal_login':
      return 'signed into the patient portal';
    case 'appointment_requested':
      return `${data.department ? `in ${data.department}` : 'requested'}${data.when ? ` for ${new Date(data.when).toLocaleString()}` : ''} via portal`;
    case 'consent_granted':
      return `${data.kind || ''} sharing consented`.trim();
    case 'consent_revoked':
      return `${data.kind || ''} sharing withdrawn`.trim();
    case 'vitals_recorded':
      return [
        data.temperature != null ? `Temp ${data.temperature}°C` : null,
        data.systolic != null ? `BP ${data.systolic}/${data.diastolic ?? '—'}` : null,
        data.pulse != null ? `HR ${data.pulse}` : null,
        data.respiratoryRate != null ? `RR ${data.respiratoryRate}` : null,
        data.spo2 != null ? `SpO2 ${data.spo2}%` : null,
        data.consciousness ? data.consciousness : null,
        data.ews != null ? `EWS ${data.ews} (${data.risk || '—'})` : null,
      ].filter(Boolean).join(' · ');
    default:
      return '';
  }
}