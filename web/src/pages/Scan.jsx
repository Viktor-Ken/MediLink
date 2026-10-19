import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { api } from '../api.js';
import CriticalBanner from '../components/CriticalBanner.jsx';

export default function Scan() {
  const [departments, setDepartments] = useState([]);
  const [location, setLocation] = useState('');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState('');
  const scannerRef = useRef(null);
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    api('/departments')
      .then((d) => {
        setDepartments(d.departments);
        setLocation(d.departments[0]?.name || 'Emergency Department');
      })
      .catch(() => {});
    return () => {
      if (scannerRef.current) scannerRef.current.clear().catch(() => {});
    };
  }, []);

  async function lookup(code) {
    const id = String(code || '').trim().toUpperCase();
    if (!id) return;
    setBusy(true);
    setError('');
    setQuery(id);
    try {
      const data = await api('/scans', {
        method: 'POST',
        body: JSON.stringify({
          patientId: id,
          location: locationRef.current,
          action: 'scan',
        }),
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  async function stopCamera() {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) {
      setScanning(false);
      return;
    }
    try { await scanner.stop(); } catch { /* noop */ }
    try { await scanner.clear(); } catch { /* noop */ }
    setScanning(false);
  }

  async function startCamera() {
    setCamError('');
    try {
      if (scannerRef.current) await stopCamera();
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 260, height: 200 },
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
          ],
        },
        (decoded) => {
          stopCamera();
          lookup(decoded);
        },
        () => {},
      );
      setScanning(true);
    } catch {
      setCamError('Camera unavailable in this browser/session. Use manual entry below.');
      setScanning(false);
    }
  }

  const reset = () => {
    setResult(null);
    setError('');
    setQuery('');
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="page-title">Scan Patient</h1>
          <div className="page-sub">
            Scan the patient's bracelet or card (QR or Code 128 barcode) to pull up their emergency record instantly.
          </div>
        </div>
      </div>

      <div className="field" style={{ maxWidth: 420, marginBottom: 18 }}>
        <label>Scanning location</label>
        <select value={location} onChange={(e) => setLocation(e.target.value)}>
          {departments.map((d) => (
            <option key={d.id} value={d.name}>{d.name}</option>
          ))}
        </select>
      </div>

      <div className="scan-view">
        <div className="card">
          <h3>Camera scan</h3>
          {!scanning ? (
            <div className="stack">
              <div className="scanner-box">
                <div className="placeholder-text">
                  {camError && <div className="alert-error" style={{ marginBottom: 10 }}>{camError}</div>}
                  <div style={{ fontSize: 40 }}>⌕</div>
                  <p>Point the camera at the QR code or barcode on the patient's card or bracelet.</p>
                </div>
              </div>
              <button className="btn" onClick={startCamera}>Start camera</button>
            </div>
          ) : (
            <div className="stack">
              <div className="scanner-box" id="qr-reader" />
              <button className="btn btn-danger" onClick={stopCamera}>Stop camera</button>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Manual entry</h3>
          <div className="row">
            <input
              placeholder="e.g. HM-1001"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lookup(query)}
              style={{ flex: 1 }}
            />
            <button className="btn" onClick={() => lookup(query)} disabled={busy}>
              {busy ? 'Looking up…' : 'Look up'}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Typing the patient number works for any card — useful when a scanner isn't handy.
          </p>

          {error && <div className="alert-error" style={{ marginTop: 8 }}>{error}</div>}

          {result && (
            <div className="card result-card" style={{ marginTop: 16, boxShadow: 'none' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="pno">{result.patient.patient_no}</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    {result.patient.first_name} {result.patient.last_name}
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    Scanned {new Date(result.scan.created_at).toLocaleString()}
                  </div>
                </div>
                <Link className="btn" to={`/patients/${result.patient.id}`}>
                  Open full profile →
                </Link>
              </div>
              <div style={{ marginTop: 14 }}>
                <CriticalBanner patient={result.patient} />
              </div>
              <button className="btn btn-ghost" style={{ color: 'var(--primary)', borderColor: 'var(--border)' }} onClick={reset}>
                Clear result
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}