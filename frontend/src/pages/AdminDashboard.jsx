import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import { StatusBadge, PaymentBadge, fmt, fmtDate } from '../components/Helpers';
import { VS } from '../constants/voucherStatus';

export default function AdminDashboard() {
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading]   = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    api.get('/vouchers')
      .then(r => setVouchers(r.data.vouchers || []))
      .finally(() => setLoading(false));
  }, []);

  const counts = vouchers.reduce((a, v) => {
    a[v.status] = (a[v.status] || 0) + 1;
    return a;
  }, {});

  const totalAmount    = vouchers.reduce((s, v) => s + Number(v.total_amount || 0), 0);
  const unpaidAmount   = vouchers.filter(v => v.payment_status === 'unpaid').reduce((s, v) => s + Number(v.total_amount || 0), 0);
  const pendingAction  = (counts.draft || 0) + (counts.assigned || 0) + (counts.ready_for_bank || 0) + (counts.proceed || 0);

  // Recent vouchers — last 8
  const recent = [...vouchers].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8);

  const statCards = [
    { label: 'Total Vouchers',   value: vouchers.length,                  color: 'var(--text)',    bg: 'var(--surface2)' },
    { label: 'Pending Action',   value: pendingAction,                    color: '#d97706',        bg: '#fffbeb' },
    { label: 'Approved',         value: counts.approved || 0,             color: '#059669',        bg: '#f0fdf4' },
    { label: 'Rejected',         value: counts.rejected || 0,             color: '#dc2626',        bg: '#fef2f2' },
    // { label: 'Total Value',      value: `₹${fmt(totalAmount)}`,           color: 'var(--text)',    bg: 'var(--surface2)', wide: true },
    // { label: 'Unpaid Amount',    value: `₹${fmt(unpaidAmount)}`,          color: '#dc2626',        bg: '#fef2f2', wide: true },
  ];

  const statusFlow = [
    { key: VS.DRAFT,          label: 'Draft',           count: counts[VS.DRAFT]          || 0 },
    { key: VS.ASSIGNED,       label: 'Assigned',        count: counts[VS.ASSIGNED]       || 0 },
    { key: VS.APPROVED,       label: 'Approved',        count: counts[VS.APPROVED]       || 0 },
    { key: VS.REVIEWED,       label: 'Reviewed',        count: counts[VS.REVIEWED]       || 0 },
    { key: VS.EXPORTED,       label: 'Exported',        count: counts[VS.EXPORTED]       || 0 },
    { key: VS.READY_TO_REMIT, label: 'Ready to Remit',  count: counts[VS.READY_TO_REMIT] || 0 },
    { key: VS.PAID,           label: 'Paid',            count: counts[VS.PAID]           || 0 },
  ];

  return (
    <Layout>
      <div style={{ padding: 28 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>Dashboard</h1>
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>Overview of accounts payable</div>
          </div>
          {/* <button className="btn btn-primary" onClick={() => nav('/admin/vouchers/new')}>
            + Upload Invoice
          </button> */}
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
          {statCards.map(s => (
            <div key={s.label} style={{
              background: s.bg, border: '1px solid var(--border)',
              borderRadius: 12, padding: '16px 20px',
              gridColumn: s.wide ? 'span 2' : undefined,
            }}>
              <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{loading ? '—' : s.value}</div>
            </div>
          ))}
        </div>

        {/* Pipeline */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-head"><div className="card-title">Voucher Pipeline</div></div>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {statusFlow.map((s, i) => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                  <div
                    onClick={() => nav(`/admin/vouchers?status=${s.key}`)}
                    style={{
                      flex: 1, background: s.count > 0 ? 'var(--surface2)' : 'var(--surface)',
                      border: '1px solid var(--border)', borderRadius: 8,
                      padding: '12px 14px', cursor: 'pointer', textAlign: 'center',
                      transition: 'background 0.15s',
                    }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.count > 0 ? 'var(--text)' : 'var(--text3)' }}>{s.count}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{s.label}</div>
                  </div>
                  {i < statusFlow.length - 1 && (
                    <div style={{ color: 'var(--text3)', fontSize: 16, padding: '0 6px' }}>→</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent vouchers */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Recent Vouchers</div>
            <button className="btn btn-sm" onClick={() => nav('/admin/vouchers')}>View All →</button>
          </div>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)' }}>Loading…</div>
          ) : recent.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)' }}>No vouchers yet</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Bill Ref</th>
                    <th>Bill Date</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    {/* <th>Payment (SalesPro)</th> */}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map(v => (
                    <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/admin/vouchers/${v.id}`)}>
                      <td style={{ fontWeight: 500 }}>{v.supplier_name || '—'}</td>
                      <td><span className="mono" style={{ fontSize: 12 }}>{v.bill_ref_no || v.payment_reference || '—'}</span></td>
                      <td>{fmtDate(v.bill_invoice_date)}</td>
                      <td style={{ textAlign: 'right' }}><span className="mono">{fmt(v.amount || v.total_amount)}</span></td>
                      {/* <td><PaymentBadge status={v.payment_status} /></td> */}
                      <td><StatusBadge status={v.status} /></td>
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
