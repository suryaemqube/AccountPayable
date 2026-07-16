import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import { StatusBadge, PaymentBadge, fmt, fmtDate } from '../components/Helpers';
import { VS } from '../constants/voucherStatus';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = [
  { value: 'all',              label: 'All' },
  { value: VS.ASSIGNED,        label: 'Assigned' },
  { value: VS.APPROVED,        label: 'Approved' },
  { value: VS.REVIEWED,        label: 'Reviewed' },
  { value: VS.EXPORTED,        label: 'Exported' },
  { value: VS.READY_TO_REMIT,  label: 'Ready to Remit' },
  { value: VS.PAID,            label: 'Paid' },
  { value: VS.REJECTED,        label: 'Rejected' },
];

function getDueSeverity(due_date) {
  if (!due_date) return null;
  const today    = new Date(); today.setHours(0,0,0,0);
  const due      = new Date(due_date); due.setHours(0,0,0,0);
  const daysLeft = Math.round((due - today) / 86400000);
  if (daysLeft < 0)  return { daysLeft, label: `Overdue ${Math.abs(daysLeft)}d`, color: '#dc2626', bg: '#fef2f2' };
  if (daysLeft === 0) return { daysLeft, label: 'Due TODAY',    color: '#dc2626', bg: '#fef2f2' };
  if (daysLeft === 1) return { daysLeft, label: 'Due tomorrow', color: '#d97706', bg: '#fff7ed' };
  if (daysLeft <= 5)  return { daysLeft, label: `Due in ${daysLeft}d`, color: '#ca8a04', bg: '#fefce8' };
  return null; // not urgent
}

export default function ManagerDashboard() {
  const { user } = useAuth();
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState(VS.ASSIGNED);
  const nav = useNavigate();
  const basePath = user?.role === 'approver' ? '/approver' : '/manager';

  useEffect(() => {
    api.get('/vouchers')
      .then(r => {
        // Manager is already scoped server-side to their own vouchers; approver
        // sees all vouchers by default (needed for verify/final-approval), so
        // scope to "assigned to me" here too — this page is only "my" queue.
        const mine = (r.data.vouchers || []).filter(v => v.assigned_to === user?.id);
        setVouchers(mine);
      })
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const pending  = vouchers.filter(v => v.status === VS.ASSIGNED);
  const dueSoon  = pending.filter(v => getDueSeverity(v.due_date) !== null);
  const filtered = filterStatus === 'all' ? vouchers : vouchers.filter(v => v.status === filterStatus);

  return (
    <Layout>
      <div style={{ padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'start', marginBottom: 24, flexWrap: 'wrap', gap: 100 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>My Approval Queue</h1>
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>{pending.length} voucher{pending.length !== 1 ? 's' : ''} awaiting your review</div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 4 }}>
              Status
            </label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}>
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* ── Due-soon alert strip ── */}
        {dueSoon.length > 0 && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '12px 18px',
            marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 600, color: '#dc2626', fontSize: 14 }}>
                {dueSoon.length} voucher{dueSoon.length > 1 ? 's' : ''} need urgent attention
              </div>
              <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 2 }}>
                {dueSoon.map(v => {
                  const sev = getDueSeverity(v.due_date);
                  return `${v.supplier_name || 'Voucher'} (${sev.label})`;
                }).join(' · ')}
              </div>
            </div>
          </div>
        )}

        {filtered.length > 0 && (
          <div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Voucher No.</th><th>Bill Ref No.</th><th>Supplier</th><th>Bill Date</th><th>Amount</th><th>Due Date</th><th>Payment (SalesPro)</th><th>Status</th><th>Created By</th><th></th></tr>
                  </thead>
                  <tbody>
                    {filtered.map(v => {
                      const sev = v.status === VS.ASSIGNED ? getDueSeverity(v.due_date) : null;
                      return (
                        <tr key={v.id} style={{ cursor: 'pointer', background: sev ? sev.bg : undefined }}
                          onClick={() => nav(`${basePath}/vouchers/${v.id}`)}>
                          <td><span className="mono">{v.voucher_no || v.tally_vch_no || '—'}</span></td>
                          <td><span className="mono">{v.invoice_no || v.bill_ref_no || '—'}</span></td>
                          <td style={{ fontWeight: 500 }}>{v.supplier_name || '—'}</td>
                          <td>{fmtDate(v.bill_invoice_date)}</td>
                          <td>
                            <span className="mono">{fmt(v.amount)}</span>
                          </td>
                          <td>
                            {v.due_date ? (
                              <span style={{ color: sev ? sev.color : 'inherit', fontWeight: sev ? 600 : 400 }}>
                                {fmtDate(v.due_date)}
                                {sev && (
                                  <span style={{ marginLeft: 6, fontSize: 11, background: sev.color, color: '#fff',
                                    padding: '1px 6px', borderRadius: 99 }}>
                                    {sev.label}
                                  </span>
                                )}
                              </span>
                            ) : '—'}
                          </td>
                          <td><PaymentBadge status={v.payment_status} /></td>
                          <td><StatusBadge status={v.status} /></td>
                          <td>{v.created_by_name || '—'}</td>
                          <td>
                            <button className={`btn btn-sm ${v.status === VS.ASSIGNED ? 'btn-primary' : ''}`}
                              onClick={e => { e.stopPropagation(); nav(`${basePath}/vouchers/${v.id}`); }}>
                              {v.status === VS.ASSIGNED ? 'Review' : 'View'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {!loading && filtered.length === 0 && vouchers.length > 0 && (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            <div style={{ fontWeight: 500 }}>No vouchers match this status filter</div>
          </div>
        )}

        {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Loading…</div>}
        {!loading && vouchers.length === 0 && (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <div style={{ fontWeight: 500 }}>No vouchers assigned to you yet</div>
          </div>
        )}
      </div>
    </Layout>
  );
}
