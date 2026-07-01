import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { fmt, fmtDate } from '../components/Helpers';
import toast from 'react-hot-toast';

const STATUS_COLORS = {
  open:            { background: '#fff3cd', color: '#856404' },
  partially_paid:  { background: '#cff4fc', color: '#055160' },
  fully_paid:      { background: '#d1e7dd', color: '#0a3622' },
};
const STATUS_LABELS = {
  open:            'Open',
  partially_paid:  'Partially Paid',
  fully_paid:      'Fully Paid',
};

export default function BillList() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');

  const basePath = user?.role === 'admin' ? '/admin' : user?.role === 'approver' ? '/approver' : '/executive';

  async function fetchBills() {
    setLoading(true);
    try {
      const q = filterStatus ? `?bill_status=${filterStatus}` : '';
      const res = await fetch(`/api/bills${q}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      setBills(data.bills || []);
    } catch {
      toast.error('Failed to load bills');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchBills(); }, [filterStatus]);

  const filtered = bills.filter(b => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (b.supplier_name || '').toLowerCase().includes(s) ||
      (b.bill_no || '').toLowerCase().includes(s) ||
      (b.bill_ref_no || '').toLowerCase().includes(s)
    );
  });

  return (
    <Layout>
      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>Bills</h2>
          {['admin', 'executive'].includes(user?.role) && (
            <button
              onClick={() => nav(`${basePath}/bills/new`)}
              style={{ background: '#0d6efd', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontWeight: 600, cursor: 'pointer' }}
            >
              + New Bill
            </button>
          )}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap', width:'30%' }}>
          <input
            placeholder="Search supplier / bill no / invoice ref…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 220, padding: '7px 12px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }}
          />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }}
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="fully_paid">Fully Paid</option>
          </select>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>No bills found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                  {['Bill No', 'Supplier', 'Invoice Date', 'Invoice Ref', 'Gross Total', 'TDS', 'Net Payable', 'Vouchers', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((b, i) => {
                  const vArr = Array.isArray(b.vouchers) ? b.vouchers : [];
                  const allocated = vArr.reduce((s, v) => s + (Number(v.amount) || 0), 0);
                  const grossTotal = Number(b.total_amount) || 0;
                  const tds = Number(b.tds_amount) || 0;
                  const netPayable = grossTotal - tds;
                  const statusStyle = STATUS_COLORS[b.bill_status] || {};
                  return (
                    <tr
                      key={b.id}
                      onClick={() => nav(`${basePath}/bills/${b.id}`)}
                      style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer', background: i % 2 === 0 ? '#fff' : '#fafafa' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafafa'}
                    >
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{b.bill_no || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>{b.supplier_name || '—'}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmtDate(b.invoice_date)}</td>
                      <td style={{ padding: '10px 12px' }}>{b.bill_ref_no || '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(grossTotal)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#dc3545' }}>{tds > 0 ? fmt(tds) : '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmt(netPayable)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{ background: vArr.length > 0 ? '#e8f4fd' : '#f8f9fa', color: vArr.length > 0 ? '#0d6efd' : '#888', borderRadius: 12, padding: '2px 10px', fontWeight: 600, fontSize: 12 }}>
                          {vArr.length}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ ...statusStyle, borderRadius: 12, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
                          {STATUS_LABELS[b.bill_status] || b.bill_status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
