import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import { StatusBadge, PaymentBadge, fmt, fmtDate } from '../components/Helpers';
import { VS } from '../constants/voucherStatus';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import Pagination from '../components/Pagination';

const inp = { border:'1px solid var(--border)', borderRadius:6, padding:'7px 10px', fontSize:13, background:'var(--bg)', color:'var(--text)', outline:'none', fontFamily:'inherit' };

const VOUCHER_COLUMNS = [
  { key: 'voucher_no',              label: 'Voucher No.' },
  { key: 'supplier_name',           label: 'Supplier' },
  { key: 'bill_invoice_date',       label: 'Bill Date' },
  { key: 'bill_purchase_type_label',label: 'Purchase Type' },
  { key: 'amount',           label: 'Amount' },
  { key: 'due_days',         label: 'Credit Days' },
  { key: 'payment_status',   label: 'Payment(SalesPro)' },
  { key: 'status',           label: 'Status' },
  { key: 'assigned_to_name', label: 'Assigned To' },
  { key: 'created_by_name',  label: 'Created By' },
];

function voucherCreditDays(v) {
  const d = v.due_days ?? v.bill_due_days;
  return d != null ? d : null;
}

function voucherSortValue(v, key) {
  if (key === 'voucher_no') return (v.voucher_no || v.tally_vch_no || '').toString().toLowerCase();
  if (key === 'amount')     return Number(v.amount || v.total_amount) || 0;
  if (key === 'due_days')   return voucherCreditDays(v) ?? -1;
  return (v[key] || '').toString().toLowerCase();
}

export default function VoucherList() {
  const { user } = useAuth();
  const canDelete = ['admin', 'approver'].includes(user?.role);
  const [vouchers, setVouchers]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState('all');
  const [search, setSearch]         = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterPayment, setFilterPayment]   = useState('');
  const [filterPurchaseType, setFilterPurchaseType] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo]     = useState('');
  const [selected, setSelected]     = useState(new Set());
  const [exporting, setExporting]   = useState(false);
  const [exportingReport, setExportingReport] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const nav = useNavigate();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/approver')  ? '/approver/vouchers'
                 : location.pathname.startsWith('/executive') ? '/executive/vouchers'
                 : '/admin/vouchers';

  useEffect(() => { fetchVouchers(); }, []);
  useEffect(() => { setPage(1); }, [filter, search, filterSupplier, filterPayment, filterPurchaseType, filterDateFrom, filterDateTo, sortConfig, pageSize]);

  async function fetchVouchers() {
    try {
      const r = await api.get('/vouchers');
      setVouchers(r.data.vouchers);
    } catch { toast.error('Failed to load vouchers'); }
    finally { setLoading(false); }
  }

  async function handleDelete(e, id) {
    e.stopPropagation();
    if (!window.confirm('Delete this voucher? This cannot be undone.')) return;
    try {
      await api.delete(`/vouchers/${id}`);
      toast.success('Voucher deleted');
      setVouchers(vs => vs.filter(v => v.id !== id));
    } catch (err) { toast.error(err.response?.data?.error || 'Delete failed'); }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const ids = selected.size > 0 ? [...selected] : exportable.map(v => v.id);
      const r = await api.post('/vouchers/export', { ids }, { responseType: 'blob' });
      const url  = URL.createObjectURL(r.data);
      const a    = document.createElement('a');
      a.href     = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `bank-upload-${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported successfully');
      setSelected(new Set());
      fetchVouchers();
    } catch (err) {
      // blob error response — parse text
      if (err.response?.data instanceof Blob) {
        const text = await err.response.data.text();
        try { toast.error(JSON.parse(text).error || 'Export failed'); } catch { toast.error('Export failed'); }
      } else {
        toast.error(err.response?.data?.error || 'Export failed');
      }
    } finally { setExporting(false); }
  }

  async function handleExportReport() {
    setExportingReport(true);
    try {
      const params = {};
      if (filter && filter !== 'all') params.status = filter;
      if (search)           params.search = search;
      if (filterSupplier)   params.supplier_name = filterSupplier;
      if (filterPayment)    params.payment_status = filterPayment;
      if (filterPurchaseType) params.purchase_type = filterPurchaseType;
      if (filterDateFrom)   params.date_from = filterDateFrom;
      if (filterDateTo)     params.date_to   = filterDateTo;

      const r = await api.get('/vouchers/export-report', { params, responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a   = document.createElement('a');
      a.href    = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `vouchers-export-${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded successfully');
    } catch (err) {
      if (err.response?.data instanceof Blob) {
        const text = await err.response.data.text();
        try { toast.error(JSON.parse(text).error || 'Export failed'); } catch { toast.error('Export failed'); }
      } else {
        toast.error(err.response?.data?.error || 'Export failed');
      }
    } finally { setExportingReport(false); }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const exportableIds = exportable.map(v => v.id);
    const allSelected   = exportableIds.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) exportableIds.forEach(id => next.delete(id));
      else exportableIds.forEach(id => next.add(id));
      return next;
    });
  }

  const APPROVED_STATUSES = ['approved', 'ready_to_remit', 'exported', 'downloaded', 'paid'];

  function getDueSeverity(due_date, status) {
    if (!due_date) return null;
    if (status && APPROVED_STATUSES.includes(status)) return null;
    const today    = new Date(); today.setHours(0,0,0,0);
    const due      = new Date(due_date); due.setHours(0,0,0,0);
    const daysLeft = Math.round((due - today) / 86400000);
    if (daysLeft < 0)   return { label: `Overdue ${Math.abs(daysLeft)}d`, color: '#dc2626' };
    if (daysLeft === 0) return { label: 'Due TODAY',       color: '#dc2626' };
    if (daysLeft === 1) return { label: 'Due tomorrow',    color: '#d97706' };
    if (daysLeft <= 5)  return { label: `Due in ${daysLeft}d`, color: '#ca8a04' };
    return null;
  }

  // 'All' excludes Paid vouchers — they're done, so keep them out of the default view
  // (still reachable via the dedicated Paid filter card).
  const byStatus = filter === 'all' ? vouchers.filter(v => v.status !== VS.PAID) : vouchers.filter(v => v.status === filter);

  const filtered = byStatus.filter(v => {
    if (search) {
      const q = search.toLowerCase();
      const hit = (v.voucher_no||'').toLowerCase().includes(q)
        || (v.bill_no||'').toLowerCase().includes(q)
        || (v.supplier_name||'').toLowerCase().includes(q)
        || (v.bill_ref_no||'').toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (filterSupplier && v.supplier_name !== filterSupplier) return false;
    if (filterPayment  && v.payment_status !== filterPayment)  return false;
    if (filterPurchaseType && v.bill_purchase_type_code !== filterPurchaseType) return false;
    if (filterDateFrom && v.bill_invoice_date && v.bill_invoice_date < filterDateFrom) return false;
    if (filterDateTo   && v.bill_invoice_date && v.bill_invoice_date > filterDateTo)   return false;
    return true;
  });

  const counts         = vouchers.reduce((a, v) => { a[v.status] = (a[v.status] || 0) + 1; return a; }, {});
  const canExport      = v => v.status === VS.REVIEWED || v.status === VS.EXPORTED;
  const isExportFilter = filter === VS.REVIEWED || filter === VS.EXPORTED;
  const exportable     = filtered.filter(canExport);

  const sorted = sortConfig.key ? [...filtered].sort((a, b) => {
    const av = voucherSortValue(a, sortConfig.key);
    const bv = voucherSortValue(b, sortConfig.key);
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

  const uniqueSuppliers = [...new Set(vouchers.map(v => v.supplier_name).filter(Boolean))].sort();
  const hasFilters = search || filterSupplier || filterPayment || filterPurchaseType || filterDateFrom || filterDateTo;
  function clearFilters() { setSearch(''); setFilterSupplier(''); setFilterPayment(''); setFilterPurchaseType(''); setFilterDateFrom(''); setFilterDateTo(''); }

  return (
    <Layout>
      <div style={{ padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>Vouchers</h1>
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>{vouchers.length} total</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn"
              onClick={handleExportReport}
              disabled={exportingReport}
              style={{
                background: exportingReport ? '#6c757d' : '#198754',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontWeight: 600,
                cursor: exportingReport ? 'default' : 'pointer',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              title={`Export ${sorted.length} visible voucher(s) to Excel`}
            >
              {exportingReport ? '⏳ Exporting…' : `⬇ Export XL (${sorted.length})`}
            </button>
            {selected.size > 0 && (
              <button className="btn btn-primary" onClick={handleExport} disabled={exporting}
                style={{ background: '#1d4ed8' }}>
                {exporting ? 'Exporting…' : `⬇ Export Selected (${selected.size})`}
              </button>
            )}
            {isExportFilter && selected.size === 0 && (
              <button className="btn btn-primary" onClick={handleExport} disabled={exporting}
                style={{ background: '#1d4ed8' }}>
                {exporting ? 'Exporting…' : `⬇ Export All (${exportable.length})`}
              </button>
            )}
            {/* <button className="btn btn-primary" onClick={() => nav(`${basePath}/new`)}>
              + Add Voucher
            </button> */}
          </div>
        </div>

        {/* ── Status filter cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 10, marginBottom: 24 }}>
          {[
            { key: 'all',                label: 'All',            count: vouchers.length - (counts[VS.PAID] || 0) },
            { key: VS.DRAFT,             label: 'Draft',          count: counts[VS.DRAFT]          || 0 },
            { key: VS.ASSIGNED,          label: 'Assigned',       count: counts[VS.ASSIGNED]       || 0 },
            { key: VS.APPROVED,          label: 'Approved',       count: counts[VS.APPROVED]       || 0 },
            { key: VS.REVIEWED,          label: 'Reviewed',       count: counts[VS.REVIEWED]       || 0 },
            { key: VS.EXPORTED,          label: 'Exported',       count: counts[VS.EXPORTED]       || 0 },
            { key: VS.READY_TO_REMIT,    label: 'Ready to Remit', count: counts[VS.READY_TO_REMIT] || 0 },
            { key: VS.PAID,              label: 'Paid',           count: counts[VS.PAID]           || 0 },
            { key: VS.REJECTED,          label: 'Rejected',       count: counts[VS.REJECTED]       || 0 },
          ].map(f => (
            <button key={f.key} onClick={() => { setFilter(f.key); setSelected(new Set()); }}
              style={{
                background: filter === f.key ? (f.accent ? '#d97706' : 'var(--text)') : (f.accent ? '#fffbeb' : 'var(--surface)'),
                color:      filter === f.key ? '#fff' : (f.accent ? '#b45309' : 'var(--text)'),
                border: `1px solid ${f.accent ? '#fcd34d' : 'var(--border)'}`, borderRadius: 10,
                padding: '10px 12px', cursor: 'pointer', textAlign: 'left',
              }}>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{f.count}</div>
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{f.label}</div>
            </button>
          ))}
        </div>

        {/* ── Search & filters ── */}
        <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
          <input style={{ ...inp, flex:'1 1 200px', minWidth:180 }}
            placeholder="Search voucher no., supplier, bill ref…"
            value={search} onChange={e => setSearch(e.target.value)} />
          <select style={{ ...inp, flex:'1 1 160px' }}
            value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}>
            <option value="">All Suppliers</option>
            {uniqueSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select style={{ ...inp, flex:'0 0 150px' }}
            value={filterPayment} onChange={e => setFilterPayment(e.target.value)}>
            <option value="">All Payment Status</option>
            <option value="unpaid">Not Receipt</option>
            <option value="partial">Partially Receipt</option>
            <option value="paid">Receipt</option>
            <option value="downloaded">Downloaded</option>
          </select>
          <select style={{ ...inp, flex:'0 0 150px' }}
            value={filterPurchaseType} onChange={e => setFilterPurchaseType(e.target.value)}>
            <option value="">All Purchase Types</option>
            <option value="SALE">Sale</option>
            <option value="SALE_MULTIPLE">Sale - Multiple</option>
            <option value="CONSUME">Consume</option>
            <option value="PROJECT">Project</option>
          </select>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <span style={{ fontSize:12, color:'var(--text3)', whiteSpace:'nowrap' }}>Bill Date:</span>
            <input type="date" style={{ ...inp }} value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
            <span style={{ fontSize:12, color:'var(--text3)' }}>–</span>
            <input type="date" style={{ ...inp }} value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
          </div>
          {hasFilters && (
            <button className="btn" onClick={clearFilters} style={{ whiteSpace:'nowrap' }}>✕ Clear</button>
          )}
        </div>

        <div className="card">
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Loading…</div>
          ) : sorted.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
              No vouchers found{hasFilters ? ' — try clearing filters' : ''}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input type="checkbox"
                        checked={exportable.length > 0 && exportable.every(v => selected.has(v.id))}
                        onChange={toggleSelectAll}
                        style={{ cursor: 'pointer' }}
                        disabled={exportable.length === 0}
                      />
                    </th>
                    {VOUCHER_COLUMNS.map(col => (
                      <th key={col.key} onClick={() => handleSort(col.key)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}  title="Click to sort">
                        {col.label}
                        <span style={{ marginLeft: 4, fontSize: 10, color: sortConfig.key === col.key ? 'var(--text)' : 'var(--text3)' }}>
                          {sortConfig.key === col.key ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '▲▼'}
                        </span>
                      </th>
                    ))}
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(v => (
                    <tr key={v.id}
                      style={{ cursor: 'pointer', background: selected.has(v.id) ? 'var(--surface2)' : undefined }}
                      onClick={() => nav(`${basePath}/${v.id}`)}>
                      <td onClick={e => e.stopPropagation()} style={{ paddingLeft: 12 }}>
                        <input type="checkbox"
                          checked={selected.has(v.id)}
                          onChange={() => toggleSelect(v.id)}
                          disabled={!canExport(v)}
                          style={{ cursor: canExport(v) ? 'pointer' : 'not-allowed', opacity: canExport(v) ? 1 : 0.25 }}
                        />
                      </td>
                      <td><span className="mono">{v.voucher_no || v.tally_vch_no || '—'}</span></td>
                      <td style={{ fontWeight: 500 }}>{v.supplier_name || '—'}</td>
                      <td>
                        {fmtDate(v.bill_invoice_date)}
                        {(() => {
                          const sev = getDueSeverity(v.due_date, v.status);
                          return sev ? (
                            <div style={{ fontSize: 10, background: sev.color, color: '#fff',
                              padding: '1px 5px', borderRadius: 99, verticalAlign: 'middle',width:'fit-content' }}>
                              {sev.label}
                            </div>
                          ) : null;
                        })()}
                      </td>
                      <td>{v.bill_purchase_type_label || '—'}</td>
                      <td>
                        <span className="mono">{fmt(v.amount || v.total_amount)}</span>
                      </td>
                      <td>{voucherCreditDays(v) != null ? `${voucherCreditDays(v)} days` : '—'}</td>
                      <td><PaymentBadge status={v.bill_purchase_type_code !== 'CONSUME' ? v.payment_status : '—'} /></td>
                      <td><StatusBadge status={v.status} /></td>
                      <td>{v.assigned_to_name || <span className="text-muted">Unassigned</span>}</td>
                      <td>{v.created_by_name || '-'}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm" onClick={() => nav(`${basePath}/${v.id}`)}>
                            Edit
                          </button>
                          {canDelete && (
                            <button className="btn btn-sm" style={{ color: 'var(--red)' }}
                              onClick={e => handleDelete(e, v.id)}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                      
                      
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={page} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
