export function StatusBadge({ status }) {
  const map = {
    draft: 'Draft',
    assigned: 'Assigned',
    pending_approval: 'Pending Approval',
    approved: 'Approved',
    rejected: 'Rejected',
    downloaded: 'Downloaded',
  };
  const cls = {
    draft: 'badge-draft',
    assigned: 'badge-assigned',
    pending_approval: 'badge-pending',
    approved: 'badge-approved',
    rejected: 'badge-rejected',
    downloaded: 'badge-downloaded',
  };
  return <span className={`badge ${cls[status] || 'badge-draft'}`}>{map[status] || status}</span>;
}

export function PaymentBadge({ status }) {
  const map = { paid: 'Paid', unpaid: 'Unpaid', partial: 'Partial' };
  return <span className={`badge badge-${status || 'unpaid'}`}>{map[status] || status}</span>;
}

export function fmt(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
