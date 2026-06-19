import { useState, useRef } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import { fmt, fmtDate } from '../components/Helpers';
import toast from 'react-hot-toast';

// ── Payment status badge ───────────────────────────────────────────
function PaidBadge({ outstanding, paidAmount, invoiceAmount }) {
  if (!invoiceAmount || invoiceAmount === 0) return null;
  if (outstanding <= 0)
    return <span style={{ background: '#d1fae5', color: '#065f46', borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>✓ Paid</span>;
  if (paidAmount > 0)
    return <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>⏳ Partial</span>;
  return <span style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>✗ Unpaid</span>;
}

// ── Result table ───────────────────────────────────────────────────
function ResultTable({ rows }) {
  if (!rows || rows.length === 0)
    return <div style={{ padding: '20px 0', color: 'var(--text3)', fontSize: 13 }}>No records found.</div>;

  return (
    <div className="table-wrap" style={{ overflowX: 'auto' }}>
      <table style={{ minWidth: 1000 }}>
        <thead>
          <tr>
            <th>Account</th>
            <th>Executive</th>
            <th>Order No.</th>
            <th style={{ textAlign: 'right' }}>Order Value</th>
            <th>Order Date</th>
            <th>Invoice No.</th>
            <th>Invoice Date</th>
            <th style={{ textAlign: 'right' }}>Invoice Amt</th>
            <th style={{ textAlign: 'right' }}>Paid</th>
            <th style={{ textAlign: 'right' }}>Outstanding</th>
            <th>Payment Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 500, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.actName}
              </td>
              <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.executive || '—'}</td>
              <td><span className="mono" style={{ fontSize: 12 }}>{r.orderNo || '—'}</span></td>
              <td style={{ textAlign: 'right' }}><span className="mono">₹{fmt(r.orderValue)}</span></td>
              <td style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{r.orderDate || '—'}</td>
              <td><span className="mono" style={{ fontSize: 12 }}>{r.invoiceNo || '—'}</span></td>
              <td style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{r.invoiceDate || '—'}</td>
              <td style={{ textAlign: 'right' }}><span className="mono">₹{fmt(r.invoiceAmount)}</span></td>
              <td style={{ textAlign: 'right', color: 'var(--green)' }}><span className="mono">₹{fmt(r.paidAmount)}</span></td>
              <td style={{ textAlign: 'right', color: r.outstanding > 0 ? 'var(--red)' : undefined, fontWeight: r.outstanding > 0 ? 600 : undefined }}>
                <span className="mono">₹{fmt(r.outstanding)}</span>
              </td>
              <td style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{r.lastPaymentDate || '—'}</td>
              <td>
                <PaidBadge outstanding={r.outstanding} paidAmount={r.paidAmount} invoiceAmount={r.invoiceAmount} />
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr style={{ background: 'var(--surface2)' }}>
              <td colSpan={7} style={{ textAlign: 'right', fontWeight: 600, fontSize: 12, padding: '8px 12px' }}>Totals</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>
                <span className="mono">₹{fmt(rows.reduce((s, r) => s + (r.invoiceAmount || 0), 0))}</span>
              </td>
              <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--green)' }}>
                <span className="mono">₹{fmt(rows.reduce((s, r) => s + (r.paidAmount || 0), 0))}</span>
              </td>
              <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--red)' }}>
                <span className="mono">₹{fmt(rows.reduce((s, r) => s + (r.outstanding || 0), 0))}</span>
              </td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ── Installation status badge ──────────────────────────────────────
function InstallBadge({ status }) {
  if (!status) return null;
  const map = {
    Draft:      { bg: '#f3f4f6', color: '#374151' },
    Assigned:   { bg: '#dbeafe', color: '#1e40af' },
    InProgress: { bg: '#fef3c7', color: '#92400e' },
    Completed:  { bg: '#d1fae5', color: '#065f46' },
    Locked:     { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] || { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>
      {status}
    </span>
  );
}

// ── Installation detail panel ──────────────────────────────────────
function InstallPanel({ rows, onClear }) {
  if (!rows || rows.length === 0)
    return <div style={{ padding: '16px 0', color: 'var(--text3)', fontSize: 13 }}>No installation record found for this order.</div>;

  return (
    <>
      {rows.map((r, i) => (
        <div key={i} style={{ marginBottom: i < rows.length - 1 ? 20 : 0 }}>
          {/* Project block */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14,
            background: 'var(--surface2)', borderRadius: 10, padding: '14px 16px' }}>
            <Field label="Project Title"  value={r.projectTitle} wide />
            <Field label="Project Code"   value={r.projectCode} />
            <Field label="Project Status" value={<span style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ width:10, height:10, borderRadius:'50%', display:'inline-block',
                background: r.projectStatus === 'Closed' ? '#10b981' : '#f59e0b' }} />
              {r.projectStatus || '—'}
            </span>} />
            <Field label="Start Date"  value={r.startDate  || '—'} />
            <Field label="End Date"    value={r.endDate    || '—'} />
            <Field label="Delivery Date" value={r.deliveryDate || '—'} />
            {r.projectStatusComment && <Field label="Status Note" value={r.projectStatusComment} wide />}
          </div>

          {/* IR block */}
          {r.irId ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14,
              border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <Field label="IR No"        value={r.irNo} />
              <Field label="Planned Date" value={r.irPlannedDate || '—'} />
              <Field label="Install Date" value={r.installationDate || '—'} />
              <Field label="IR Status"    value={<InstallBadge status={r.installationStatus} />} />
              <Field label="Location"     value={[r.locationCity, r.locationAddress].filter(Boolean).join(', ') || '—'} />
              <Field label="IRSP Status"  value={r.irspStatus || '—'} />
              <Field label="Customer Contact" value={`${r.customerContactName || ''} ${r.customerContactNo ? '· ' + r.customerContactNo : ''}`.trim() || '—'} />
              <Field label="Installer"    value={`${r.installerName || ''} ${r.installerContactNo ? '· ' + r.installerContactNo : ''}`.trim() || '—'} />
              {r.installerRemarks && <Field label="Installer Remarks" value={r.installerRemarks} wide />}
              {r.customerRemark   && <Field label="Customer Remark"   value={r.customerRemark}   wide />}
            </div>
          ) : (
            <div style={{ padding: '12px 16px', border: '1px dashed var(--border)', borderRadius: 10,
              fontSize: 13, color: 'var(--text3)' }}>
              No Installation Request raised yet
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function Field({ label, value, wide }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{value || '—'}</div>
    </div>
  );
}

// ── Account table — includes inline 📦 install expand ─────────────
function ResultTableWithInstall({ rows, inlineInstall, inlineLoading, onInstall }) {
  if (!rows || rows.length === 0)
    return <div style={{ padding: '20px 0', color: 'var(--text3)', fontSize: 13 }}>No records found.</div>;

  // Track unique orderNos already rendered (avoid repeating install panel per invoice row)
  const renderedInstallOrders = new Set();

  return (
    <div className="table-wrap" style={{ overflowX: 'auto' }}>
      <table style={{ minWidth: 1000 }}>
        <thead>
          <tr>
            <th>Account</th>
            <th>Executive</th>
            <th>Order No.</th>
            <th style={{ textAlign: 'right' }}>Order Value</th>
            <th>Order Date</th>
            <th>Invoice No.</th>
            <th>Invoice Date</th>
            <th style={{ textAlign: 'right' }}>Invoice Amt</th>
            <th style={{ textAlign: 'right' }}>Paid</th>
            <th style={{ textAlign: 'right' }}>Outstanding</th>
            <th>Payment Date</th>
            <th>Status</th>
            <th style={{ width: 60 }}>Install</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const showInstallBtn = true;
            const installOpen    = inlineInstall[r.orderNo] !== undefined;
            const isLoading      = inlineLoading[r.orderNo];
            // Only render the expand row once per orderNo
            const renderExpand   = installOpen && !renderedInstallOrders.has(r.orderNo);
            if (installOpen) renderedInstallOrders.add(r.orderNo);

            return (
              <>
                <tr key={i}>
                  <td style={{ fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.actName}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text2)' }}>{r.executive || '—'}</td>
                  <td><span className="mono" style={{ fontSize: 12 }}>{r.orderNo || '—'}</span></td>
                  <td style={{ textAlign: 'right' }}><span className="mono">₹{fmt(r.orderValue)}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{r.orderDate || '—'}</td>
                  <td><span className="mono" style={{ fontSize: 12 }}>{r.invoiceNo || '—'}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{r.invoiceDate || '—'}</td>
                  <td style={{ textAlign: 'right' }}><span className="mono">₹{fmt(r.invoiceAmount)}</span></td>
                  <td style={{ textAlign: 'right', color: 'var(--green)' }}><span className="mono">₹{fmt(r.paidAmount)}</span></td>
                  <td style={{ textAlign: 'right', color: r.outstanding > 0 ? 'var(--red)' : undefined, fontWeight: r.outstanding > 0 ? 600 : undefined }}>
                    <span className="mono">₹{fmt(r.outstanding)}</span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{r.lastPaymentDate || '—'}</td>
                  <td>
                    <PaidBadge outstanding={r.outstanding} paidAmount={r.paidAmount} invoiceAmount={r.invoiceAmount} />
                  </td>
                  <td>
                    {r.orderNo && (
                      <button className="btn btn-sm"
                        style={{ padding: '2px 8px', fontSize: 11, background: installOpen ? 'var(--surface2)' : undefined }}
                        onClick={() => onInstall(r.orderNo)}
                        title="Check installation status">
                        {isLoading ? '…' : '📦'}
                      </button>
                    )}
                  </td>
                </tr>
                {renderExpand && (
                  <tr key={`inst-${r.orderNo}`}>
                    <td colSpan={13} style={{ background: 'var(--surface2)', padding: '16px 20px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 10 }}>
                        📦 Installation — {r.orderNo}
                      </div>
                      <InstallPanel rows={inlineInstall[r.orderNo]} />
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
export default function PaymentStatus() {
  // ── Flow 1: direct lookup by payment_reference ──
  const [refInput,    setRefInput]    = useState('');
  const [refLoading,  setRefLoading]  = useState(false);
  const [refRows,     setRefRows]     = useState(null);

  // ── Flow 2: account search → order filter ──
  const [searchInput,   setSearchInput]   = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [accounts,      setAccounts]      = useState([]);
  const [selectedAct,   setSelectedAct]   = useState(null);  // { actId, actName }
  const [actLoading,    setActLoading]     = useState(false);
  const [actRows,       setActRows]        = useState([]);   // all rows for account
  const [orderFilter,   setOrderFilter]    = useState('');   // client-side order filter

  // ── Flow 3: installation lookup ──
  const [installInput,   setInstallInput]   = useState('');
  const [installLoading, setInstallLoading] = useState(false);
  const [installRows,    setInstallRows]    = useState(null);
  // inline installation lookup from order row
  const [inlineInstall,  setInlineInstall]  = useState({});  // { orderNo: rows[] }
  const [inlineLoading,  setInlineLoading]  = useState({});  // { orderNo: bool }

  const searchTimer = useRef(null);

  // ─────────────────────────────────────────────
  //  Flow 1 — lookup by ref
  // ─────────────────────────────────────────────
  async function handleRefLookup(e) {
    e.preventDefault();
    if (!refInput.trim()) return toast.error('Enter a payment reference');
    setRefLoading(true);
    setRefRows(null);
    try {
      const r = await api.post('/salespro/payment-by-ref', { extRef: refInput.trim() });
      const rows = normalise(r.data.Data || []);
      setRefRows(rows);
      if (!rows.length) toast('No records found for this reference.', { icon: '🔍' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Lookup failed');
    } finally {
      setRefLoading(false);
    }
  }

  // ─────────────────────────────────────────────
  //  Flow 2a — account search (debounced, min 3 chars → DB call)
  // ─────────────────────────────────────────────
  function handleSearchChange(val) {
    setSearchInput(val);
    setSelectedAct(null);
    setActRows([]);
    setAccounts([]);
    clearTimeout(searchTimer.current);

    if (val.trim().length < 3) return;

    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const r = await api.post('/salespro/search-accounts', { searchTerm: val.trim() });
        setAccounts(r.data.Data || []);
      } catch { /* silent */ }
      finally { setSearchLoading(false); }
    }, 400);
  }

  // ─────────────────────────────────────────────
  //  Flow 2b — load all orders+invoices for chosen account
  // ─────────────────────────────────────────────
  async function handleSelectAccount(acct) {
    setSelectedAct(acct);
    setSearchInput(acct.actName);
    setAccounts([]);
    setOrderFilter('');
    setActLoading(true);
    setActRows([]);
    try {
      const r = await api.post('/salespro/payment-by-account', { actId: acct.actId });
      setActRows(normalise(r.data.Data || []));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load data');
    } finally {
      setActLoading(false);
    }
  }

  // client-side filter by OrderNo
  const filteredActRows = orderFilter.trim()
    ? actRows.filter(r => r.orderNo?.toLowerCase().includes(orderFilter.trim().toLowerCase()))
    : actRows;

  // ─────────────────────────────────────────────
  //  Flow 3 — installation lookup (standalone)
  // ─────────────────────────────────────────────
  async function handleInstallLookup(e) {
    e.preventDefault();
    if (!installInput.trim()) return toast.error('Enter an order number');
    setInstallLoading(true);
    setInstallRows(null);
    try {
      const r = await api.post('/salespro/installation', { orderNo: installInput.trim() });
      const rows = normaliseInstall(r.data.Data || []);
      setInstallRows(rows);
      if (!rows.length) toast('No installation record found.', { icon: '🔍' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Lookup failed');
    } finally {
      setInstallLoading(false);
    }
  }

  // Inline installation fetch from a row in the account table
  async function fetchInlineInstall(orderNo) {
    if (inlineInstall[orderNo] !== undefined) {
      // toggle off if already shown
      setInlineInstall(s => { const n = { ...s }; delete n[orderNo]; return n; });
      return;
    }
    setInlineLoading(s => ({ ...s, [orderNo]: true }));
    try {
      const r = await api.post('/salespro/installation', { orderNo });
      setInlineInstall(s => ({ ...s, [orderNo]: normaliseInstall(r.data.Data || []) }));
    } catch {
      toast.error('Failed to load installation info');
    } finally {
      setInlineLoading(s => ({ ...s, [orderNo]: false }));
    }
  }

  // ─────────────────────────────────────────────
  //  Normalise API keys (PascalCase → camelCase)
  // ─────────────────────────────────────────────
  function normaliseInstall(rows) {
    return rows.map(r => ({
      orderNo:              r.OrderNo              ?? r.orderNo,
      orderDate:            r.OrderDate            ?? r.orderDate,
      invoiceNo:            r.InvoiceNo            ?? r.invoiceNo,
      orderAmount:          r.OrderAmount          ?? r.orderAmount,
      deliveryDate:         r.DeliveryDate         ?? r.deliveryDate,
      irspStatus:           r.IRSPStatus           ?? r.irspStatus,
      projectId:            r.ProjectId            ?? r.projectId,
      projectCode:          r.ProjectCode          ?? r.projectCode,
      projectTitle:         r.ProjectTitle         ?? r.projectTitle,
      startDate:            r.StartDate            ?? r.startDate,
      endDate:              r.EndDate              ?? r.endDate,
      projectDetail:        r.ProjectDetail        ?? r.projectDetail,
      projectStatusComment: r.ProjectStatusComment ?? r.projectStatusComment,
      projectStatus:        r.ProjectStatus        ?? r.projectStatus,
      irId:                 r.IRId                 ?? r.irId,
      irNo:                 r.IRNo                 ?? r.irNo,
      irPlannedDate:        r.IRPlannedDate        ?? r.irPlannedDate,
      installationDate:     r.InstallationDate     ?? r.installationDate,
      locationCity:         r.LocationCity         ?? r.locationCity,
      locationAddress:      r.LocationAddress      ?? r.locationAddress,
      customerContactName:  r.CustomerContactName  ?? r.customerContactName,
      customerContactNo:    r.CustomerContactNo    ?? r.customerContactNo,
      customerRemark:       r.CustomerRemark       ?? r.customerRemark,
      installerName:        r.InstallerName        ?? r.installerName,
      installerContactNo:   r.InstallerContactNo   ?? r.installerContactNo,
      installerRemarks:     r.InstallerRemarks     ?? r.installerRemarks,
      installationStatus:   r.InstallationStatus   ?? r.installationStatus,
    }));
  }

  function normalise(rows) {
    return rows.map(r => ({
      actId:           r.ActId           ?? r.actId,
      actName:         r.ActName         ?? r.actName,
      executive:       r.Executive       ?? r.executive,
      orderId:         r.OrderId         ?? r.orderId,
      orderNo:         r.OrderNo         ?? r.orderNo,
      orderValue:      r.OrderValue      ?? r.orderValue,
      orderDate:       r.OrderDate       ?? r.orderDate,
      invoiceId:       r.InvoiceId       ?? r.invoiceId,
      invoiceNo:       r.InvoiceNo       ?? r.invoiceNo,
      invoiceDate:     r.InvoiceDate     ?? r.invoiceDate,
      invoiceAmount:   r.InvoiceAmount   ?? r.invoiceAmount,
      paymentReference:r.PaymentReference?? r.paymentReference,
      paidAmount:      r.PaidAmount      ?? r.paidAmount      ?? 0,
      outstanding:     r.Outstanding     ?? r.outstanding     ?? 0,
      lastPaymentDate: r.LastPaymentDate ?? r.lastPaymentDate,
      paymentNo:       r.PaymentNo       ?? r.paymentNo,
    }));
  }

  return (
    <Layout>
      <div style={{ padding: 28, maxWidth: 1200 }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>Payment Status</h1>
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>
            Check payment status from SalesPro — lookup by reference or search by account
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 28 }}>

          {/* ── Card 1: Lookup by payment reference ── */}
          <div className="card">
            <div className="card-head">
              <div className="card-title">🔍 Lookup by Payment Reference</div>
            </div>
            <div className="card-body">
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
                Use the <strong>payment_reference</strong> from the voucher (e.g. <code>2026/05/1487</code>)
              </div>
              <form onSubmit={handleRefLookup} style={{ display: 'flex', gap: 8 }}>
                <input
                  value={refInput}
                  onChange={e => { setRefInput(e.target.value); setRefRows(null); }}
                  placeholder="e.g. 2026/05/1487"
                  style={{ flex: 1 }}
                />
                <button className="btn btn-primary" type="submit" disabled={refLoading}>
                  {refLoading ? 'Looking…' : 'Search'}
                </button>
              </form>
            </div>
          </div>

          {/* ── Card 2: Search by account name ── */}
          <div className="card">
            <div className="card-head">
              <div className="card-title">🏢 Search by Account</div>
            </div>
            <div className="card-body">
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
                Type at least 3 letters to search accounts, then select one to see all orders
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  value={searchInput}
                  onChange={e => handleSearchChange(e.target.value)}
                  placeholder="Type account name…"
                  style={{ width: '100%' }}
                  autoComplete="off"
                />
                {searchLoading && (
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Searching…</div>
                )}
                {/* Dropdown */}
                {accounts.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                    maxHeight: 220, overflowY: 'auto', marginTop: 4,
                  }}>
                    {accounts.map(a => (
                      <div key={a.ActId ?? a.actId}
                        onClick={() => handleSelectAccount({ actId: a.ActId ?? a.actId, actName: a.ActName ?? a.actName })}
                        style={{
                          padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                          borderBottom: '1px solid var(--border)',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <div style={{ fontWeight: 500 }}>{a.ActName ?? a.actName}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{a.CityName ?? a.cityName}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Order filter (client-side) — shown once account loaded */}
              {selectedAct && actRows.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <input
                    value={orderFilter}
                    onChange={e => setOrderFilter(e.target.value)}
                    placeholder="Filter by Order No…"
                    style={{ width: '100%', fontSize: 12 }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                    {filteredActRows.length} of {actRows.length} orders shown
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* ── Card 3: Installation lookup by OrderNo ── */}
          <div className="card">
            <div className="card-head">
              <div className="card-title">📦 Installation Status</div>
            </div>
            <div className="card-body">
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
                Enter an <strong>Order No.</strong> to check project &amp; installation request status
              </div>
              <form onSubmit={handleInstallLookup} style={{ display: 'flex', gap: 8 }}>
                <input
                  value={installInput}
                  onChange={e => { setInstallInput(e.target.value); setInstallRows(null); }}
                  placeholder="e.g. ORD03202529525"
                  style={{ flex: 1 }}
                />
                <button className="btn btn-primary" type="submit" disabled={installLoading}>
                  {installLoading ? 'Looking…' : 'Search'}
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* ── Results: Flow 1 ── */}
        {refRows !== null && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-head">
              <div className="card-title">Results — Ref: <code>{refInput}</code></div>
              <button className="btn btn-sm" onClick={() => setRefRows(null)}>Clear</button>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <ResultTable rows={refRows} />
            </div>
          </div>
        )}

        {/* ── Results: Flow 3 — installation standalone ── */}
        {installRows !== null && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-head">
              <div className="card-title">Installation — <code>{installInput}</code></div>
              <button className="btn btn-sm" onClick={() => setInstallRows(null)}>Clear</button>
            </div>
            <div className="card-body">
              <InstallPanel rows={installRows} />
            </div>
          </div>
        )}

        {/* ── Results: Flow 2 ── */}
        {selectedAct && (
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">{selectedAct.actName}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>All orders &amp; invoices</div>
              </div>
              <button className="btn btn-sm" onClick={() => {
                setSelectedAct(null); setActRows([]); setSearchInput(''); setOrderFilter('');
                setInlineInstall({}); setInlineLoading({});
              }}>Clear</button>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {actLoading
                ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)' }}>Loading…</div>
                : <ResultTableWithInstall
                    rows={filteredActRows}
                    inlineInstall={inlineInstall}
                    inlineLoading={inlineLoading}
                    onInstall={fetchInlineInstall}
                  />
              }
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}
