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
  const map = { paid: 'Paid', unpaid: 'Unpaid', partial: 'Partial', pending_verification: 'Pending Verification' };
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

export function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  const date = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const time = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}
