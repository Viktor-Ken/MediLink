import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { timeAgo } from '../util.js';

export default function Dashboard() {
  const { user } = useAuth();
  const [scans, setScans] = useState([]);
  const [stats, setStats] = useState({ patients: null, departments: null });
  const [tasks, setTasks] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [myDept, setMyDept] = useState(null);

  const reload = () => {
    api('/scans?limit=8')
      .then((d) => setScans(d.scans))
      .catch(() => {});
    api('/tasks?status=open')
      .then((d) => setTasks(d.tasks))
      .catch(() => {});
    api('/referrals')
      .then((d) => setReferrals(d.referrals.filter((r) => r.status === 'open' || r.status === 'accepted')))
      .catch(() => {});
    Promise.all([api('/patients/count'), api('/departments')])
      .then(([p, d]) => {
        setStats({ patients: p.total, departments: d.departments.length });
        if (user?.department_id) {
          setMyDept(d.departments.find((dep) => dep.id === user.department_id) || null);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    reload();
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, []);

  async function doneTask(id) {
    await api(`/tasks/${id}/done`, { method: 'POST' }).catch(() => {});
    reload();
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <div className="page-sub">Hospital activity at a glance</div>
        </div>
        <div className="row">
          <Link className="btn" to="/scan">Scan patient</Link>
          {user?.role === 'admin' && <Link className="btn" to="/register">Register patient</Link>}
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-value">{stats.patients ?? '…'}</div>
          <div className="stat-label">Registered patients</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{tasks.length}</div>
          <div className="stat-label">Open tasks</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{referrals.filter((r) => r.status === 'open').length}</div>
          <div className="stat-label">Open referrals</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.departments ?? '…'}</div>
          <div className="stat-label">Departments</div>
        </div>
      </div>

      {myDept && (
        <div className="card dept-about" style={{ marginBottom: 20 }}>
          <div className="dept-about-head">
            <span className="d-code">{myDept.code}</span>
            <div className="d-name">{myDept.name}</div>
          </div>
          {myDept.description && <div className="d-desc"><strong>What this department does: </strong>{myDept.description}</div>}
          <div className="d-meta">
            {myDept.floor && <span>📍 {myDept.floor}</span>}
            {myDept.phone_ext && <span>☎ ext. {myDept.phone_ext}</span>}
            {myDept.head && <span>Head: {myDept.head}</span>}
            {myDept.hours && <span>Hours: {myDept.hours}</span>}
            <Link to="/departments" style={{ color: 'var(--primary)' }}>All departments →</Link>
          </div>
        </div>
      )}

      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <h3>My tasks</h3>
          {tasks.length === 0 && <p className="muted">All caught up.</p>}
          {tasks.map((t) => (
            <div key={t.id} className="task-row">
              <div className="task-main">
                <div className="task-title">{t.title}</div>
                {t.details && <div className="psub">{t.details}</div>}
                <div className="psub">
                  {t.kind !== 'task' && <span className="tag">{t.kind}</span>}
                  {t.department_name && <span> · {t.department_name}</span>}
                </div>
              </div>
              {user?.role !== 'admin' && <button className="btn" onClick={() => doneTask(t.id)}>Done</button>}
            </div>
          ))}
          {tasks.length > 0 && (
            <Link className="muted" to="/coordination" style={{ display: 'inline-block', marginTop: 6 }}>Manage in Coordation →</Link>
          )}
        </div>

        <div className="card">
          <h3>Open referrals</h3>
          {referrals.length === 0 && <p className="muted">No open referrals.</p>}
          {referrals.map((r) => (
            <Link key={r.id} className="patient-row" to="/coordination">
              <div>
                <div className="pname">
                  <span className="pno">{r.patient_no}</span> {r.first_name} {r.last_name}
                </div>
                <div className="psub">{r.from_department} → {r.to_department}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="psub">“{r.reason.length > 40 ? `${r.reason.slice(0, 40)}…` : r.reason}”</div>
                <div className="psub">{timeAgo(r.created_at)}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Latest patient scans</h3>
        {scans.length === 0 && <p className="muted">No scans yet. Try the Scan Patient page.</p>}
        {scans.map((s) => (
          <Link key={s.id} className="patient-row" to={`/patients/${s.patient_id}`}>
            <div>
              <div className="pname">{s.first_name} {s.last_name}</div>
              <div className="psub">
                {s.location || 'Location not set'} · {s.staff_name || 'unknown staff'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="pno">{s.patient_no}</div>
              <div className="psub">{timeAgo(s.created_at)}</div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
