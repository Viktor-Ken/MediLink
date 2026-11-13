import { useEffect, useState } from 'react';
import { portalApi } from '../../portalApi.js';
import { fmtDateTime } from '../../util.js';

const CONSENT_LABELS = {
  treatment: { title: 'Care & treatment', desc: 'Let staff carry out examinations and treatment.' },
  data_sharing: { title: 'Data sharing', desc: 'Share your record with other departments and facilities.' },
  research: { title: 'Research', desc: 'Use anonymised data for medical research.' },
  photography: { title: 'Photography', desc: 'Take photos for teaching and documentation.' },
};

export default function PortalConsents() {
  const [consents, setConsents] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const reload = () =>
    portalApi('/portal/consents')
      .then((d) => {
        const map = {};
        d.consents.forEach((c) => {
          map[c.kind] = c;
        });
        setConsents(map);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    reload();
  }, []);

  async function toggle(kind, currentStatus) {
    setBusy(kind);
    setError('');
    try {
      await portalApi('/portal/consents', {
        method: 'POST',
        body: JSON.stringify({ kind, action: currentStatus === 'granted' ? 'revoke' : 'grant' }),
      });
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  if (error) return <div className="alert-error">{error}</div>;

  return (
    <>
      <h1 className="page-title">Consent management</h1>
      <div className="page-sub">
        These choices control how your health information is used. You can change them any time.
      </div>

      {Object.entries(CONSENT_LABELS).map(([kind, meta]) => {
        const c = consents[kind];
        const granted = c?.status === 'granted';
        return (
          <div key={kind} className="card" style={{ marginBottom: 12 }}>
            <div className="presc-head">
              <div>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <h3 style={{ margin: 0 }}>{meta.title}</h3>
                  <span className={`tag status-tag`} style={{ background: granted ? 'var(--success)' : undefined }}>
                    {granted ? 'granted' : 'not granted'}
                  </span>
                </div>
                <p className="psub" style={{ marginTop: 6 }}>{meta.desc}</p>
              </div>
              <button
                className="btn"
                style={granted ? { background: 'var(--panel)', color: 'var(--danger)', border: '1px solid var(--danger-border)' } : undefined}
                onClick={() => toggle(kind, c?.status || 'revoked')}
                disabled={busy === kind}
              >
                {granted ? 'Withdraw consent' : 'Grant consent'}
              </button>
            </div>
            {c && (
              <div className="psub" style={{ marginTop: 8 }}>
                Last updated {fmtDateTime(c.set_at)} via {c.set_via === 'portal' ? 'portal' : `staff${c.set_by_name ? ` (${c.set_by_name})` : ''}`}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}