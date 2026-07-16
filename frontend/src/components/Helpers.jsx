export function StatusBadge({ status }) {
  const map = {
    draft:          'Draft',
    assigned:       'Assigned',
    approved:       'Approved',
    reviewed:       'Reviewed',
    exported:       'Exported',
    ready_to_remit: 'Ready to Remit',
    paid:           'Paid',
    rejected:       'Rejected',
  };
  const cls = {
    draft:          'badge-draft',
    assigned:       'badge-assigned',
    approved:       'badge-pending',
    reviewed:       'badge-export',
    exported:       'badge-proceed',
    ready_to_remit: 'badge-approved',
    paid:           'badge-downloaded',
    rejected:       'badge-rejected',
  };
  return <span className={`badge ${cls[status] || 'badge-draft'}`}>{map[status] || status}</span>;
}

export function PaymentBadge({ status }) {
  const map = { paid: 'Receipt', unpaid: 'Not Receipt', partial: 'Partially Receipt', pending_verification: 'Pending Verification' };
  return <span className={`badge badge-${status || 'pending_verification'}`}>{map[status] || status}</span>;
}

export function fmt(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// For pre-filling <input type="date"> from a backend DATE field.
// The API serializes DATE columns as an ISO instant built from the server's
// local midnight (e.g. a DATE of 14 Jul on an IST server becomes
// "2026-07-13T18:30:00.000Z"), so naively slicing the string's first 10
// characters reads back the wrong (previous) day. Reading the LOCAL date
// parts instead mirrors what fmtDate already does via toLocaleDateString,
// and correctly reverses the shift as long as browser and server agree on
// timezone (true here — both are IST).
export function toDateInputValue(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  const date = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const time = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}

// Chrome on Android reliably fails to render a blob: URL PDF embedded in an
// <iframe> (shows blank, no error) — iOS Safari and desktop Chrome handle it
// fine. Opening the same blob URL as a top-level tab does work on Android
// though, so PDF preview modals should fall back to "open in new tab" there
// instead of embedding.
export function isAndroid() {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}
