import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { fmt, fmtDate } from '../components/Helpers';
import api from '../api/client';
import toast from 'react-hot-toast';
import Pagination from '../components/Pagination';

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

const COLUMNS = [
  { key: 'bill_no',              label: 'Bill No' },
  { key: 'supplier_name',        label: 'Supplier' },
  { key: 'invoice_date',         label: 'Bill Date' },
  { key: 'bill_ref_no',          label: 'Invoice Ref' },
  { key: 'purchase_type_label',  label: 'Purchase Type' },
  { key: 'gross_total',     label: 'Gross Total',  align: 'right' },
  { key: 'tds_amount',      label: 'TDS',           align: 'right' },
  { key: 'net_payable',     label: 'Net Payable',   align: 'right' },
  { key: 'vouchers_count',  label: 'Vouchers',      align: 'center' },
  { key: 'bill_status',     label: 'Status' },
  { key: 'created_by_name', label: 'Created By' },
];

function sortValue(row, key) {
  switch (key) {
    case 'gross_total':    return row.grossTotal;
    case 'tds_amount':     return row.tds;
    case 'net_payable':    return row.netPayable;
    case 'vouchers_count': return row.vouchersCount;
    case 'invoice_date':   return row.invoice_date || '';
    default:                return (row[key] || '').toString().toLowerCase();
  }
}

export default function BillList() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('open');
  const [filterPurchaseType, setFilterPurchaseType] = useState('');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const basePath = user?.role === 'admin' ? '/admin' : user?.role === 'approver' ? '/approver' : '/executive';

  async function handleExport() {
    setExporting(true);
    try {
      const r = await api.get('/bills/export', {
        params: filterStatus ? { bill_status: filterStatus } : {},
        responseType: 'blob',
      });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      const today = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `bills-export-${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported successfully');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

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
  useEffect(() => { setPage(1); }, [filterStatus, filterPurchaseType, search, sortConfig, pageSize]);

  const rows = bills.map(b => {
    const vArr = Array.isArray(b.vouchers) ? b.vouchers : [];
    const allocated   = vArr.reduce((s, v) => s + (Number(v.amount) || 0), 0);
    const grossTotal  = Number(b.total_amount) || 0;
    const tds         = Number(b.tds_amount) || 0;
    const creditNote  = Number(b.credit_note_amount) || 0;
    const netPayable  = grossTotal - tds - creditNote;
    return { ...b, vArr, allocated, grossTotal, tds, creditNote, netPayable, vouchersCount: vArr.length };
  });

  const filtered = rows.filter(b => {
    if (filterPurchaseType && b.purchase_type_code !== filterPurchaseType) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (b.supplier_name || '').toLowerCase().includes(s) ||
      (b.trade_name || '').toLowerCase().includes(s) ||
      (b.bill_no || '').toLowerCase().includes(s) ||
      (b.bill_ref_no || '').toLowerCase().includes(s)
    );
  });

  const sorted = sortConfig.key ? [...filtered].sort((a, b) => {
    const av = sortValue(a, sortConfig.key);
    const bv = sortValue(b, sortConfig.key);
    let cmp;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return sortConfig.direction === 'asc' ? cmp : -cmp;
  }) : filtered;

  function handleSort(key) {
    setSortConfig(prev => prev.key === key
      ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' });
  }

  const paginated = sorted.slice((page - 1) * pageSize, page * pageSize);

  return (
    <Layout>
      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>Bills</h2>
          {['admin', 'executive', 'approver'].includes(user?.role) && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleExport}
                disabled={exporting}
                style={{ background: '#198754', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontWeight: 600, cursor: exporting ? 'default' : 'pointer' }}
              >
                {exporting ? 'Exporting…' : '⬇ Export'}
              </button>
              <button
                onClick={() => nav(`${basePath}/bills/new`)}
                style={{ background: '#0d6efd', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontWeight: 600, cursor: 'pointer' }}
              >
                + New Bill
              </button>
            </div>
          )}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap', width:'45%' }}>
          <input
            placeholder="Search supplier / trade name / bill no / invoice ref…"
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
          <select
            value={filterPurchaseType}
            onChange={e => setFilterPurchaseType(e.target.value)}
            style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }}
          >
            <option value="">All Purchase Types</option>
            <option value="SALE">Sale</option>
            <option value="SALE_MULTIPLE">Sale - Multiple</option>
            <option value="CONSUME">Consume</option>
            <option value="PROJECT">Project</option>
          </select>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading…</div>
        ) : sorted.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>No bills found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      style={{ padding: '10px 12px', textAlign: col.align || 'left', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                      title="Click to sort"
                    >
                      {col.label}
                      <span style={{ marginLeft: 4, fontSize: 10, color: sortConfig.key === col.key ? '#212529' : '#ccc' }}>
                        {sortConfig.key === col.key ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '▲▼'}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((b, i) => {
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
                      <td style={{ padding: '10px 12px' }}>{b.purchase_type_label || '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(b.grossTotal)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#dc3545' }}>{b.tds > 0 ? fmt(b.tds) : '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmt(b.netPayable)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{ background: b.vouchersCount > 0 ? '#e8f4fd' : '#f8f9fa', color: b.vouchersCount > 0 ? '#0d6efd' : '#888', borderRadius: 12, padding: '2px 10px', fontWeight: 600, fontSize: 12 }}>
                          {b.vouchersCount}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ ...statusStyle, borderRadius: 12, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
                          {STATUS_LABELS[b.bill_status] || b.bill_status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>{b.created_by_name || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={page} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        )}
      </div>
    </Layout>
  );
}
