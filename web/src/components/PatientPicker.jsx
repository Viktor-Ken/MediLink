import { useState } from 'react';
import { api } from '../api.js';

export default function PatientPicker({ value, onChange, placeholder = 'Search patient by name or ID…' }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function search(term) {
    setQ(term);
    if (!term.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const d = await api(`/patients?q=${encodeURIComponent(term)}`);
      setResults(d.patients);
      setOpen(true);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="picker">
      <input
        value={q}
        onChange={(e) => search(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => q.trim() && setOpen(true)}
        placeholder={placeholder}
      />
      {value && (
        <div className="picker-value" onClick={() => { onChange(null); setQ(''); }}>
          <strong>{value.patient_no}</strong> · {value.first_name} {value.last_name}
          <span className="picker-clear">✕</span>
        </div>
      )}
      {open && !value && (
        <ul className="picker-list">
          {!busy && results.length === 0 && <li className="picker-empty">No matches</li>}
          {busy && <li className="picker-empty">Searching…</li>}
          {results.map((p) => (
            <li key={p.id} onMouseDown={() => { onChange(p); setOpen(false); setQ(''); }}>
              <strong>{p.patient_no}</strong> {p.first_name} {p.last_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}