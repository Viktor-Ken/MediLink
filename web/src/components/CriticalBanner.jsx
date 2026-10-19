import { patientView } from '../util.js';

export default function CriticalBanner({ patient, role }) {
  const view = patientView(role);
  const showAllergies = view.allergies && patient.allergies?.length > 0;
  const showConditions = view.conditions && patient.conditions?.length > 0;
  const showMeds = view.medications && patient.medications?.length > 0;
  const hasCritical = showAllergies || showConditions || showMeds || patient.blood_type || patient.genotype;

  if (!hasCritical && !patient.emergency_contact_name) return null;

  return (
    <div className="critical-banner">
      <div className="critical-title">⚠ Emergency Record</div>
      <div className="critical-grid">
        {patient.blood_type && (
          <div className="critical-item">
            <div className="critical-label">Blood type</div>
            <div className="critical-blood">{patient.blood_type}</div>
          </div>
        )}
        {patient.genotype && (
          <div className="critical-item">
            <div className="critical-label">Genotype</div>
            <div>{patient.genotype}</div>
          </div>
        )}
        <div className="critical-item">
          <div className="critical-label">Allergies</div>
          <div>{showAllergies ? patient.allergies.join(', ') : 'None recorded'}</div>
        </div>
        {view.conditions && (
          <div className="critical-item">
            <div className="critical-label">Conditions</div>
            <div>{showConditions ? patient.conditions.join(', ') : 'None recorded'}</div>
          </div>
        )}
        {showMeds && (
          <div className="critical-item">
            <div className="critical-label">Current medication</div>
            <div>{patient.medications.join(', ')}</div>
          </div>
        )}
        {patient.emergency_contact_name && (
          <div className="critical-item">
            <div className="critical-label">Emergency contact</div>
            <div>
              {patient.emergency_contact_name}
              {patient.emergency_contact_relation ? ` (${patient.emergency_contact_relation})` : ''}
              {patient.emergency_contact_phone ? ` · ${patient.emergency_contact_phone}` : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}