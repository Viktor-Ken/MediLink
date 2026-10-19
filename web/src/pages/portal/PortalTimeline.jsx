import { useEffect, useState } from 'react';
import { portalApi } from '../../portalApi.js';
import { EVENT_META, eventSummary, fmtDateTime } from '../../util.js';

export default function PortalTimeline() {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    portalApi('/portal/timeline')
      .then((d) => setEvents(d.events))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert-error">{error}</div>;

  return (
    <>
      <h1 className="page-title">Care timeline</h1>
      <div className="page-sub">Everything that has happened on your record.</div>
      {events.length === 0 && <p className="muted">Nothing here yet.</p>}
      <div className="timeline">
        {events.map((e) => {
          const meta = EVENT_META[e.kind] || { icon: '•', label: e.kind };
          return (
            <div key={e.id} className="timeline-item">
              <div className="tl-icon">{meta.icon}</div>
              <div className="tl-body">
                <div className="tl-head">
                  <strong>{meta.label}</strong>
                  <span className="psub">{fmtDateTime(e.created_at)}</span>
                </div>
                <div className="tl-detail">
                  {eventSummary(e.kind, e.data) || e.kind}
                  {e.staff_name ? ` — by ${e.staff_name}` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}