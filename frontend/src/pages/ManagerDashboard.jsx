import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import { StatusBadge, PaymentBadge, fmt, fmtDate } from '../components/Helpers';
import toast from 'react-hot-toast';

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

  const pending = vouchers.filter(v => v.status === 'assigned');
  const reviewed = vouchers.filter(v => !['assigned', 'draft'].includes(v.status));

  return (
    <Layout>
      <div style={{ padding: 28 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>My Approval Queue</h1>
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>{pending.length} voucher{pending.length !== 1 ? 's' : ''} awaiting your review</div>
        </div>

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
                    <tr><th>Invoice No.</th><th>Supplier</th><th>Invoice Date</th><th>Amount</th><th>Due Date</th><th>Payment</th><th></th></tr>
                  </thead>
                  <tbody>
                    {pending.map(v => (
                      <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/manager/vouchers/${v.id}`)}>
                        <td><span className="mono">{v.invoice_no || '—'}</span></td>
                        <td style={{ fontWeight: 500 }}>{v.supplier_name || '—'}</td>
                        <td>{fmtDate(v.invoice_date)}</td>
                        <td><span className="mono">{fmt(v.total_amount)}</span></td>
                        <td style={{ color: v.due_date && new Date(v.due_date) < new Date() ? 'var(--red)' : 'inherit' }}>
                          {fmtDate(v.due_date)}
                        </td>
                        <td><PaymentBadge status={v.payment_status} /></td>
                        <td>
                          <button className="btn btn-sm btn-primary" onClick={e => { e.stopPropagation(); nav(`/manager/vouchers/${v.id}`); }}>
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
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
                    <tr><th>Invoice No.</th><th>Supplier</th><th>Amount</th><th>Status</th><th></th></tr>
                  </thead>
                  <tbody>
                    {reviewed.map(v => (
                      <tr key={v.id}>
                        <td><span className="mono">{v.invoice_no || '—'}</span></td>
                        <td>{v.supplier_name || '—'}</td>
                        <td><span className="mono">{fmt(v.total_amount)}</span></td>
                        <td><StatusBadge status={v.status} /></td>
                        <td><button className="btn btn-sm" onClick={() => nav(`/manager/vouchers/${v.id}`)}>View</button></td>
                      </tr>
                    ))}
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
