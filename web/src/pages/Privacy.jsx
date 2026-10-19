import { Link } from 'react-router-dom';

export default function Privacy() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <h1>Privacy Policy</h1>
        <p className="legal-meta">Last updated: {new Date().getFullYear()} — template for review by your legal counsel</p>

        <p>
          This Privacy Policy explains how <strong>[ORGANISATION NAME]</strong> ("we", "us") collects,
          uses and protects information when you use the MediLink Hospital Management System
          (the "Service"), including the staff application and the patient self-service portal.
        </p>

        <h2>1. Information we collect</h2>
        <ul>
          <li><strong>Account data</strong> — username, full name, role, department and password hash for staff accounts.</li>
          <li><strong>Health and patient data</strong> — records entered by authorised hospital staff (registration, vitals, notes, referrals, prescriptions, laboratory and imaging results, appointments, wards and beds). This is entered and controlled by the hospital, not by MediLink.</li>
          <li><strong>Portal access data</strong> — patient number and a log of portal sign-in events, used to protect patient accounts.</li>
          <li><strong>Technical data</strong> — IP address, request timestamps and server logs used for security, rate limiting and troubleshooting.</li>
        </ul>

        <h2>2. How we use information</h2>
        <ul>
          <li>To provide, secure and operate the Service.</li>
          <li>To authenticate users and enforce role-based access.</li>
          <li>To maintain audit trails of clinical and administrative activity.</li>
          <li>To monitor reliability and detect abuse or security incidents.</li>
          <li>To comply with legal and regulatory obligations.</li>
        </ul>

        <h2>3. Legal bases</h2>
        <p>
          Where required by applicable law (for example the GDPR or the Nigeria Data Protection Act),
          we process personal data on the bases of performing our contract with the hospital,
          our legitimate interests in operating a secure service, compliance with legal obligations,
          and — for health data — the provision of medical diagnosis and treatment by the hospital
          under the supervision of a health professional.
        </p>

        <h2>4. Sharing</h2>
        <p>
          We do not sell personal data. We share it only with: the hospital that operates this
          instance; infrastructure and service providers engaged to run the Service under contract
          (for example hosting, database and, if enabled, an AI assistant provider that receives
          only the text you submit and no patient-identifying data); and authorities where required by law.
        </p>

        <h2>5. Artificial-intelligence assistant</h2>
        <p>
          When the optional assistant is enabled, the text of your messages is sent to the configured
          model provider to generate a reply. Do not enter patient-identifying information into the
          assistant. Assistant output may be inaccurate and must not be used as the sole basis for
          clinical decisions.
        </p>

        <h2>6. Retention</h2>
        <p>
          Health records are retained according to the hospital's records-retention policy and
          applicable law. Technical logs are kept for a limited period for security and
          troubleshooting purposes.
        </p>

        <h2>7. Security</h2>
        <p>
          We use encryption in transit, hashed passwords, role-based access control, audit logging and
          rate limiting. No system is completely secure; please report any suspected incident using the
          contact details below.
        </p>

        <h2>8. Your rights</h2>
        <p>
          Subject to applicable law, you may request access to, correction of, or deletion of your
          personal data, or object to certain processing. Patients should contact the hospital's Data
          Protection Officer; the hospital controls the health data processed in the Service.
        </p>

        <h2>9. Children</h2>
        <p>
          Patient records for minors are created and managed by authorised hospital staff in accordance
          with applicable law and hospital policy.
        </p>

        <h2>10. Changes</h2>
        <p>We may update this policy; material changes will be notified within the Service.</p>

        <h2>11. Contact</h2>
        <p>
          Data Protection Officer, [ORGANISATION NAME] — <strong>[contact email]</strong>, [postal address].
        </p>

        <p className="legal-back"><Link to="/login">← Back to sign in</Link></p>
      </div>
    </div>
  );
}
