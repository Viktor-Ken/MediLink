import { Link } from 'react-router-dom';

export default function Terms() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <h1>Terms of Service</h1>
        <p className="legal-meta">Last updated: {new Date().getFullYear()} — template for review by your legal counsel</p>

        <p>
          These Terms govern use of the MediLink Hospital Management System (the "Service") provided by
          <strong> [ORGANISATION NAME]</strong> ("we", "us"). By accessing the Service you agree to these Terms.
        </p>

        <h2>1. Purpose and licence</h2>
        <p>
          The Service is licensed to the hospital for internal clinical and administrative use. Access is
          granted to authorised staff and patients only, using credentials issued by the hospital.
        </p>

        <h2>2. Accounts and access</h2>
        <ul>
          <li>You must keep your credentials confidential and not share them.</li>
          <li>You must use the Service only for legitimate hospital operations and within your authorised role.</li>
          <li>You must notify the hospital administrator of any suspected unauthorised access.</li>
        </ul>

        <h2>3. Acceptable use</h2>
        <ul>
          <li>Do not attempt to access data you are not authorised to view.</li>
          <li>Do not probe, scan or test the vulnerability of the Service without written authorisation.</li>
          <li>Do not upload malware, disrupt the Service, or use it to violate any law or professional duty of confidence.</li>
        </ul>

        <h2>4. Patient data and confidentiality</h2>
        <p>
          The hospital is the data controller for patient records. Staff must handle patient information in
          accordance with applicable law, professional obligations and hospital policy. Eligibility to view
          records is enforced by role, but you remain responsible for lawful use.
        </p>

        <h2>5. The AI assistant</h2>
        <p>
          The optional assistant provides general guidance only. It does not provide medical advice, and its
          output may be inaccurate or incomplete. Do not enter patient-identifying information into it.
          Clinical decisions must be made by qualified professionals.
        </p>

        <h2>6. Availability and changes</h2>
        <p>
          The Service is provided on an "as available" basis. We may modify, suspend or discontinue features,
          and may perform maintenance, without liability where permitted by law.
        </p>

        <h2>7. Intellectual property</h2>
        <p>
          The Service, including its software and documentation, is owned by us or our licensors and is
          protected by intellectual-property laws. No rights are granted except as expressly stated.
        </p>

        <h2>8. Disclaimers</h2>
        <p>
          To the maximum extent permitted by law, the Service is provided without warranties of any kind,
          and we do not warrant that it will be error-free or uninterrupted or that data will be free of loss.
        </p>

        <h2>9. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, we are not liable for indirect or consequential loss, or
          for loss of data, profits or goodwill, arising from use of the Service. Nothing excludes liability
          that cannot lawfully be excluded.
        </p>

        <h2>10. Termination</h2>
        <p>
          Access may be suspended or terminated for breach of these Terms or for security reasons. On
          termination, your right to use the Service ends immediately.
        </p>

        <h2>11. Governing law</h2>
        <p>These Terms are governed by the laws of [JURISDICTION], and its courts have exclusive jurisdiction.</p>

        <h2>12. Contact</h2>
        <p><strong>[ORGANISATION NAME]</strong> — <strong>[contact email]</strong>, [postal address].</p>

        <p className="legal-back"><Link to="/login">← Back to sign in</Link></p>
      </div>
    </div>
  );
}
