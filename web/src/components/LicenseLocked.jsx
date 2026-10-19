import { useEffect, useState } from 'react';

export const LICENSE_EVENT = 'medilink:license-locked';

export function signalLicenseLocked() {
  try { window.dispatchEvent(new Event(LICENSE_EVENT)); } catch { /* noop */ }
}

export default function LicenseLocked() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onLock = () => setOpen(true);
    window.addEventListener(LICENSE_EVENT, onLock);
    return () => window.removeEventListener(LICENSE_EVENT, onLock);
  }, []);

  if (!open) return null;

  return (
    <div className="license-overlay" role="alertdialog" aria-modal="true" aria-label="License expired">
      <div className="license-card">
        <div className="license-icon">!</div>
        <h1>License Expired</h1>
        <p>
          This MediLink installation is no longer licensed to run.
          All features are disabled until the license is renewed.
        </p>
        <p className="license-contact">
          Contact your software vendor to renew your license and restore access.
        </p>
      </div>
    </div>
  );
}
