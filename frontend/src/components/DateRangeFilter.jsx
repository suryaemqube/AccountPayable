import { useEffect, useRef, useState } from 'react';
import { toDateInputValue } from './Helpers';

// Month the year/quarter calendar starts in (0 = January). Set to 3 for an
// April–March financial year.
const YEAR_START_MONTH = 0;

const PRESETS = [
  { value: '',        label: 'Select' },
  { value: 'cw',      label: 'Current Week Till Date' },
  { value: 'lw',      label: 'Last Week' },
  { value: 'cm',      label: 'Current Month Till Date' },
  { value: 'lm',      label: 'Last Month' },
  { value: 'cq',      label: 'Current Quarter Till Date' },
  { value: 'cy',      label: 'Current Year Till Date' },
  { value: 'custom',  label: 'Custom' },
];

// Returns [from, to] as YYYY-MM-DD strings (local time) for a preset.
function presetRange(preset) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const mondayOffset = (today.getDay() + 6) % 7; // weeks run Monday–Sunday
  const monday = new Date(y, m, today.getDate() - mondayOffset);
  let from, to;
  switch (preset) {
    case 'cw': from = monday; to = today; break;
    case 'lw':
      from = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
      to   = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1);
      break;
    case 'cm': from = new Date(y, m, 1); to = today; break;
    case 'lm': from = new Date(y, m - 1, 1); to = new Date(y, m, 0); break;
    case 'cq': {
      const monthsIntoYear = (m - YEAR_START_MONTH + 12) % 12;
      from = new Date(y, m - (monthsIntoYear % 3), 1);
      to = today;
      break;
    }
    case 'cy': {
      from = new Date(m >= YEAR_START_MONTH ? y : y - 1, YEAR_START_MONTH, 1);
      to = today;
      break;
    }
    default: return ['', ''];
  }
  return [toDateInputValue(from), toDateInputValue(to)];
}

export default function DateRangeFilter({ label, from, to, onChange, inputStyle }) {
  const [preset, setPreset] = useState('');
  const prev = useRef({ from, to });

  // If the parent clears both dates (e.g. a "Clear" button), go back to "Select".
  useEffect(() => {
    if ((prev.current.from || prev.current.to) && !from && !to) setPreset('');
    prev.current = { from, to };
  }, [from, to]);

  function handlePreset(e) {
    const value = e.target.value;
    setPreset(value);
    if (value === 'custom') return;
    const [f, t] = presetRange(value);
    onChange(f, t);
  }

  const base = inputStyle || { padding: '7px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 };
  const muted = { fontSize: 12, color: '#6c757d', whiteSpace: 'nowrap' };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {label && <span style={muted}>{label}</span>}
      <select value={preset} onChange={handlePreset} style={base}>
        {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      {preset === 'custom' && (
        <>
          <input type="date" style={base} value={from} onChange={e => onChange(e.target.value, to)} />
          <span style={muted}>–</span>
          <input type="date" style={base} value={to} onChange={e => onChange(from, e.target.value)} />
        </>
      )}
      {preset && preset !== 'custom' && from && to && (
        <span style={muted}>{from} → {to}</span>
      )}
    </div>
  );
}
