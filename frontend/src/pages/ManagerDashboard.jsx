import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import { StatusBadge, PaymentBadge, fmt, fmtDate } from '../components/Helpers';
import toast from 'react-hot-toast';

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
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    api.get('/vouchers')
      .then(r => setVouchers(r.data.vouchers))
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const pending  = vouchers.filter(v => v.status === 'assigned');
  const dueSoon  = pending.filter(v => getDueSeverity(v.due_date) !== null);
  const reviewed = vouchers.filter(v => !['assigned', 'draft'].includes(v.status));

  return (
    <Layout>
      <div style={{ padding: 28 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>My Approval Queue</h1>
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>{pending.length} voucher{pending.length !== 1 ? 's' : ''} awaiting your review</div>
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

        {pending.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--amber)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--amber-m)', display: 'inline-block' }}></span>
              Pending review
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Voucher No.</th><th>Bill Ref No.</th><th>Supplier</th><th>Bill Date</th><th>Amount</th><th>Due Date</th><th>Payment</th><th></th></tr>
                  </thead>
                  <tbody>
                    {pending.map(v => {
                      const sev = getDueSeverity(v.due_date);
                      const finalAmt = (parseFloat(v.total_amount) || 0) - (parseFloat(v.balance_amount) || 0);
                      return (
                        <tr key={v.id} style={{ cursor: 'pointer', background: sev ? sev.bg : undefined }}
                          onClick={() => nav(`/manager/vouchers/${v.id}`)}>
                          <td><span className="mono">{v.voucher_no || v.tally_vch_no || '—'}</span></td>
                          <td><span className="mono">{v.invoice_no || v.bill_ref_no || '—'}</span></td>
                          <td style={{ fontWeight: 500 }}>{v.supplier_name || '—'}</td>
                          <td>{fmtDate(v.invoice_date)}</td>
                          <td>
                            <span className="mono">{fmt(v.total_amount)}</span>
                            {parseFloat(v.balance_amount) > 0 && (
                              <div style={{ fontSize: 11, color: '#d97706', marginTop: 2 }}>
                                Pay: {fmt(finalAmt)}
                              </div>
                            )}
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
                          <td>
                            <button className="btn btn-sm btn-primary" onClick={e => { e.stopPropagation(); nav(`/manager/vouchers/${v.id}`); }}>
                              Review
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

        {reviewed.length > 0 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text3)', marginBottom: 10 }}>Previously reviewed</div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Voucher No.</th><th>Bill Date</th><th>Supplier</th><th>Amount</th><th>Status</th><th></th></tr>
                  </thead>
                  <tbody>
                    {reviewed.map(v => {
                      const finalAmt = (parseFloat(v.total_amount) || 0) - (parseFloat(v.balance_amount) || 0);
                      return (
                      <tr key={v.id}>
                        <td><span className="mono">{v.voucher_no || v.tally_vch_no || '—'}</span></td>
                        <td><span className="mono">{fmtDate(v.invoice_date) || '—'}</span></td>
                        <td>{v.supplier_name || '—'}</td>
                        <td>
                          <span className="mono">{fmt(v.total_amount)}</span>
                          {parseFloat(v.balance_amount) > 0 && (
                            <div style={{ fontSize: 11, color: '#d97706', marginTop: 2 }}>
                              Pay: {fmt(finalAmt)}
                            </div>
                          )}
                        </td>
                        <td><StatusBadge status={v.status} /></td>
                        <td><button className="btn btn-sm" onClick={() => nav(`/manager/vouchers/${v.id}`)}>View</button></td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
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
