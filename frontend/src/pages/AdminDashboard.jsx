import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import { StatusBadge, PaymentBadge, fmt, fmtDate } from '../components/Helpers';
import toast from 'react-hot-toast';

export default function AdminDashboard() {
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const nav = useNavigate();

  useEffect(() => { fetchVouchers(); }, []);

  async function fetchVouchers() {
    try {
      const r = await api.get('/vouchers');
      setVouchers(r.data.vouchers);
    } catch { toast.error('Failed to load vouchers'); }
    finally { setLoading(false); }
  }

  const filtered = filter === 'all' ? vouchers : vouchers.filter(v => v.status === filter);
  const counts = vouchers.reduce((a, v) => { a[v.status] = (a[v.status] || 0) + 1; return a; }, {});

  return (
    <Layout>
      <div style={{ padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>Vouchers</h1>
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>{vouchers.length} total</div>
          </div>
          <button className="btn btn-primary" onClick={() => nav('/admin/vouchers/new')}>
            + Upload Invoice
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { key: 'all', label: 'All', count: vouchers.length },
            { key: 'draft', label: 'Draft', count: counts.draft || 0 },
            { key: 'assigned', label: 'Assigned', count: counts.assigned || 0 },
            { key: 'pending_approval', label: 'Pending', count: counts.pending_approval || 0 },
            { key: 'approved', label: 'Approved', count: counts.approved || 0 },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{
                background: filter === f.key ? 'var(--text)' : 'var(--surface)',
                color: filter === f.key ? '#fff' : 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 10,
                padding: '12px 16px', cursor: 'pointer', textAlign: 'left',
              }}>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{f.count}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{f.label}</div>
            </button>
          ))}
        </div>

        <div className="card">
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>No vouchers found</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Invoice No.</th>
                    <th>Supplier</th>
                    <th>Invoice Date</th>
                    <th>Amount</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th>Assigned To</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(v => (
                    <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/admin/vouchers/${v.id}`)}>
                      <td><span className="mono">{v.invoice_no || '—'}</span></td>
                      <td style={{ fontWeight: 500 }}>{v.supplier_name || '—'}</td>
                      <td>{fmtDate(v.invoice_date)}</td>
                      <td><span className="mono">{fmt(v.total_amount)}</span></td>
                      <td><PaymentBadge status={v.payment_status} /></td>
                      <td><StatusBadge status={v.status} /></td>
                      <td>{v.assigned_to_name || <span className="text-muted">Unassigned</span>}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <button className="btn btn-sm" onClick={() => nav(`/admin/vouchers/${v.id}`)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
