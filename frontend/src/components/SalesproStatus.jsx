/**
 * SalesproStatus.jsx
 * Shared components + data helpers for SalesPro payment & installation lookup.
 * Used by: PaymentStatus.jsx (standalone page) and VoucherDetail.jsx (inline card).
 */

import { useState, useRef } from 'react';
import api from '../api/client';
import { fmt } from './Helpers';
import toast from 'react-hot-toast';

// ─────────────────────────────────────────────────────────────────
//  Badges
// ─────────────────────────────────────────────────────────────────
export function PaidBadge({ outstanding, paidAmount, invoiceAmount }) {
  if (!invoiceAmount || invoiceAmount === 0) return null;
  if (outstanding <= 0)
    return <span style={{ background: '#d1fae5', color: '#065f46', borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>✓ Paid</span>;
  if (paidAmount > 0)
    return <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>⏳ Partial</span>;
  return <span style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>✗ Unpaid</span>;
}

export function SyncedBadge({ status }) {
  const map = {
    paid:    { bg: '#d1fae5', color: '#065f46', label: '✓ Synced: Paid' },
    partial: { bg: '#fef3c7', color: '#92400e', label: '✓ Synced: Partial' },
    unpaid:  { bg: '#fee2e2', color: '#991b1b', label: '✓ Synced: Unpaid' },
  };
  const s = map[status] || { bg: '#f3f4f6', color: '#374151', label: `✓ Synced: ${status}` };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

export function InstallBadge({ status }) {
  if (!status) return <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>;
  const map = {
    Draft:      { bg: '#f3f4f6', color: '#374151' },
    Assigned:   { bg: '#dbeafe', color: '#1e40af' },
    InProgress: { bg: '#fef3c7', color: '#92400e' },
    Completed:  { bg: '#d1fae5', color: '#065f46' },
    Locked:     { bg: '#fee2e2', color: '#991b1b' },
  };
  const s = map[status] || { bg: '#f3f4f6', color: '#374151' };
  return <span style={{ background: s.bg, color: s.color, borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>{status}</span>;
}

// ─────────────────────────────────────────────────────────────────
//  Label + value field (used in InstallPanel)
// ─────────────────────────────────────────────────────────────────
export function Field({ label, value, wide }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{value || '—'}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  Installation detail panel
// ─────────────────────────────────────────────────────────────────
export function InstallPanel({ rows }) {
  if (!rows || rows.length === 0)
    return <div style={{ padding: '10px 0', color: 'var(--text3)', fontSize: 13 }}>No installation record found for this order.</div>;

  return (
    <>
      {rows.map((r, i) => (
        <div key={i} style={{ marginBottom: i < rows.length - 1 ? 20 : 0 }}>
          {/* Project block */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
            background: 'var(--surface2)', borderRadius: 10, padding: '14px 16px', marginBottom: 10 }}>
            <Field label="Project Title"   value={r.projectTitle} wide />
            <Field label="Project Code"    value={r.projectCode} />
            <Field label="Project Status"  value={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', display: 'inline-block',
                  background: r.projectStatus === 'Closed' ? '#10b981' : '#f59e0b' }} />
                {r.projectStatus || '—'}
              </span>
            } />
            <Field label="Start Date"   value={r.startDate    || '—'} />
            <Field label="End Date"     value={r.endDate      || '—'} />
            <Field label="Delivery Date" value={r.deliveryDate || '—'} />
            {r.projectStatusComment && <Field label="Status Note" value={r.projectStatusComment} wide />}
          </div>

          {/* Installation Request block */}
          {r.irId ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
              border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <Field label="IR No"         value={r.irNo} />
              <Field label="Planned Date"  value={r.irPlannedDate    || '—'} />
              <Field label="Install Date"  value={r.installationDate || '—'} />
              <Field label="IR Status"     value={<InstallBadge status={r.installationStatus} />} />
              <Field label="IRSP Status"   value={r.irspStatus || '—'} />
              <Field label="Location"      value={[r.locationCity, r.locationAddress].filter(Boolean).join(', ') || '—'} />
              <Field label="Customer"
                value={[r.customerContactName, r.customerContactNo].filter(Boolean).join(' · ') || '—'} />
              <Field label="Installer"
                value={[r.installerName, r.installerContactNo].filter(Boolean).join(' · ') || '—'} />
              {r.installerRemarks && <Field label="Installer Remarks" value={r.installerRemarks} wide />}
              {r.customerRemark   && <Field label="Customer Remark"   value={r.customerRemark}   wide />}
            </div>
          ) : (
            <div style={{ padding: '10px 14px', border: '1px dashed var(--border)', borderRadius: 10,
              fontSize: 13, color: 'var(--text3)' }}>
              No Installation Request raised yet
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
//  Payment summary rows table (compact, used inside VoucherDetail)
// ─────────────────────────────────────────────────────────────────
// selectable=true  → show a radio-style checkbox column
// selectedRef      → currently selected paymentReference value
// onSelect(ref)    → called when a row checkbox is clicked
export function PaymentTable({ rows, selectable, selectedRef, onSelect }) {
  if (!rows || rows.length === 0)
    return <div style={{ padding: '10px 0', color: 'var(--text3)', fontSize: 13 }}>No payment records found.</div>;

  const thStyle = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text3)', fontWeight: 500 };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            {selectable && <th style={{ ...thStyle, width: 32 }} />}
            <th style={thStyle}>ActName</th>
            <th style={thStyle}>Executive</th>
            <th style={thStyle}>Order No.</th>
            <th style={thStyle}>Invoice No.</th>
            <th style={thStyle}>Invoice Date</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Invoice Amt</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Paid</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Outstanding</th>
            <th style={thStyle}>Payment Date</th>
            <th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const ref       = r.paymentReference;
            const isChecked = selectable && ref && ref === selectedRef;
            return (
              <tr key={i}
                onClick={selectable && ref ? () => onSelect?.(isChecked ? null : ref) : undefined}
                style={{
                  borderBottom: '1px solid var(--border)',
                  cursor: selectable && ref ? 'pointer' : undefined,
                  background: isChecked ? 'var(--surface2)' : undefined,
                }}>
                {selectable && (
                  <td style={{ padding: '7px 8px', textAlign: 'center' }}>
                    {ref ? (
                      <input type="radio" readOnly
                        checked={isChecked}
                        style={{ accentColor: 'var(--primary)', width: 15, height: 15, cursor: 'pointer' }}
                      />
                    ) : <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>}
                  </td>
                )}
                <td style={{ padding: '7px 8px' }}><span className="mono">{r.actName || '—'}</span></td>
                <td style={{ padding: '7px 8px' }}><span className="mono">{r.executive || '—'}</span></td>
                <td style={{ padding: '7px 8px' }}><span className="mono">{r.orderNo || '—'}</span></td>
                <td style={{ padding: '7px 8px' }}><span className="mono">{r.invoiceNo || '—'}</span></td>
                <td style={{ padding: '7px 8px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{r.invoiceDate || '—'}</td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}><span className="mono">₹{fmt(r.invoiceAmount)}</span></td>
                <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--green)' }}><span className="mono">₹{fmt(r.paidAmount)}</span></td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: r.outstanding > 0 ? 600 : undefined,
                  color: r.outstanding > 0 ? 'var(--red)' : undefined }}>
                  <span className="mono">₹{fmt(r.outstanding)}</span>
                </td>
                <td style={{ padding: '7px 8px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{r.lastPaymentDate || '—'}</td>
                <td style={{ padding: '7px 8px' }}>
                  <PaidBadge outstanding={r.outstanding} paidAmount={r.paidAmount} invoiceAmount={r.invoiceAmount} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  Data normalisers  (PascalCase API → camelCase)
// ─────────────────────────────────────────────────────────────────
export function normalisePayment(rows) {
  return (rows || []).map(r => ({
    actId:            r.ActId            ?? r.actId,
    actName:          r.ActName          ?? r.actName,
    executive:        r.Executive        ?? r.executive,
    orderId:          r.OrderId          ?? r.orderId,
    orderNo:          r.OrderNo          ?? r.orderNo,
    orderValue:       r.OrderValue       ?? r.orderValue,
    orderDate:        r.OrderDate        ?? r.orderDate,
    invoiceId:        r.InvoiceId        ?? r.invoiceId,
    invoiceNo:        r.InvoiceNo        ?? r.invoiceNo,
    invoiceDate:      r.InvoiceDate      ?? r.invoiceDate,
    invoiceAmount:    r.InvoiceAmount    ?? r.invoiceAmount    ?? 0,
    paymentReference: r.PaymentReference ?? r.paymentReference,
    paidAmount:       r.PaidAmount       ?? r.paidAmount       ?? 0,
    outstanding:      r.Outstanding      ?? r.outstanding      ?? 0,
    lastPaymentDate:  r.LastPaymentDate  ?? r.lastPaymentDate,
    paymentNo:        r.PaymentNo        ?? r.paymentNo,
  }));
}

export function normaliseInstall(rows) {
  return (rows || []).map(r => ({
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

// ─────────────────────────────────────────────────────────────────
//  SalesproStatusCard — the full self-contained card
//  Props:
//    paymentRef      (string|null)  — from voucher.payment_reference
//    supplierName    (string|null)  — pre-populate account search hint
//    voucherId       (string|null)  — AP voucher id for payment_status sync
//    onStatusSynced  (fn|null)      — called with new status string after sync
// ─────────────────────────────────────────────────────────────────
export function SalesproStatusCard({ paymentRef, supplierName, voucherId, onStatusSynced, editing }) {
  // ── auto mode state (payment_reference exists) ──
  const [autoPayRows,    setAutoPayRows]    = useState(null);   // null=not loaded
  const [autoInstRows,   setAutoInstRows]   = useState(null);
  const [autoLoading,    setAutoLoading]    = useState(false);
  const [autoLoaded,     setAutoLoaded]     = useState(false);
  const [syncedStatus,   setSyncedStatus]   = useState(null);   // synced payment_status value

  // ── manual mode state ──
  const [searchInput,    setSearchInput]    = useState(supplierName || '');
  const [searchLoading,  setSearchLoading]  = useState(false);
  const [accounts,       setAccounts]       = useState([]);
  const [selectedAct,    setSelectedAct]    = useState(null);
  const [actLoading,     setActLoading]     = useState(false);
  const [actRows,        setActRows]        = useState([]);    // all rows for account
  const [orderFilter,    setOrderFilter]    = useState('');   // client-side order filter
  const [selectedOrder,  setSelectedOrder]  = useState(null); // chosen order { orderNo, orderId }
  const [invoiceFilter,      setInvoiceFilter]      = useState('');   // client-side invoice filter
  const [selectedInvoiceRef, setSelectedInvoiceRef] = useState(null); // chosen paymentReference
  const [savingRef,          setSavingRef]          = useState(false);
  const [installRows,    setInstallRows]    = useState(null);
  const [installLoading, setInstallLoading] = useState(false);

  const searchTimer = useRef(null);
  const isAuto      = !!paymentRef && !editing; // force manual mode when parent is in edit

  // ── Auto: fetch both payment + installation on demand ──
  async function loadAuto() {
    // if (autoLoading || autoLoaded) return;
    setAutoLoading(true);
    try {
      const payRes = await api.post('/salespro/payment-by-ref', { extRef: paymentRef });
      const payRows = normalisePayment(payRes.data.Data || []);
      setAutoPayRows(payRows);

      // Get OrderNo from first result → fetch installation
      const orderNo = payRows[0]?.orderNo;
      if (orderNo) {
        const instRes = await api.post('/salespro/installation', { orderNo });
        setAutoInstRows(normaliseInstall(instRes.data.Data || []));
      } else {
        setAutoInstRows([]);
      }
      setAutoLoaded(true);

      // Auto-sync payment_status to AP DB if voucherId provided
      if (voucherId) {
        try {
          const syncRes = await api.post(`/vouchers/${voucherId}/sync-payment-status`);
          const newStatus = syncRes.data.payment_status;
          setSyncedStatus(newStatus);
          onStatusSynced?.(newStatus);
        } catch {
          // non-fatal — SalesPro data still shown
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'SalesPro lookup failed');
      setAutoPayRows([]);
      setAutoInstRows([]);
    } finally {
      setAutoLoading(false);
    }
  }

  // ── Manual: debounced account search ──
  function handleSearchChange(val) {
    setSearchInput(val);
    setSelectedAct(null);
    setActRows([]);
    setAccounts([]);
    setSelectedOrder(null);
    setInstallRows(null);
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

  // ── Manual: account selected → load all orders ──
  async function handleSelectAccount(acct) {
    setSelectedAct(acct);
    setSearchInput(acct.actName);
    setAccounts([]);
    setOrderFilter('');
    setSelectedOrder(null);
    setInvoiceFilter('');
    setSelectedInvoiceRef(null);
    setInstallRows(null);
    setActLoading(true);
    setActRows([]);
    try {
      const r = await api.post('/salespro/payment-by-account', { actId: acct.actId });
      setActRows(normalisePayment(r.data.Data || []));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load account data');
    } finally {
      setActLoading(false);
    }
  }

  // ── Manual: order selected → fetch installation ──
  async function handleSelectOrder(orderNo, orderId) {
    if (selectedOrder?.orderNo === orderNo) {
      // toggle off
      setSelectedOrder(null); setInstallRows(null); setInvoiceFilter(''); setSelectedInvoiceRef(null); return;
    }
    setSelectedOrder({ orderNo, orderId });
    setInvoiceFilter('');
    setSelectedInvoiceRef(null);
    setInstallLoading(true);
    setInstallRows(null);
    try {
      const r = await api.post('/salespro/installation', { orderNo });
      setInstallRows(normaliseInstall(r.data.Data || []));
    } catch {
      toast.error('Failed to load installation info');
    } finally {
      setInstallLoading(false);
    }
  }

  // ── Derived data for manual mode ──
  // unique orders (client-side filter)
  const filteredOrders = (() => {
    const seen = new Set();
    return actRows.filter(r => {
      if (!r.orderNo || seen.has(r.orderNo)) return false;
      if (orderFilter && !r.orderNo.toLowerCase().includes(orderFilter.toLowerCase())) return false;
      seen.add(r.orderNo); return true;
    });
  })();

  // invoices for selected order (with optional invoice no filter)
  const selectedInvoiceRows = selectedOrder
    ? actRows.filter(r => {
        if (r.orderNo !== selectedOrder.orderNo) return false;
        if (invoiceFilter && !(r.invoiceNo || '').toLowerCase().includes(invoiceFilter.toLowerCase())) return false;
        return true;
      })
    : [];

  return (
    <div className="card" style={{ marginBottom: 16, overflow:'visible' }}>
      <div className="card-head">
        <div className="card-title">🔗 SalesPro Status</div>
        {isAuto && !autoLoaded && (
          <button className="btn btn-sm btn-primary" onClick={loadAuto} disabled={autoLoading}>
            {autoLoading ? 'Loading…' : '↻ Load from SalesPro'}
          </button>
        )}
        {isAuto && autoLoaded && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {syncedStatus && <SyncedBadge status={syncedStatus} />}
            <button className="btn btn-sm" onClick={loadAuto}>
              ↻ Refresh
            </button>
          </div>
        )}
      </div>

      <div className="card-body">

        {/* ══ AUTO MODE ══ */}
        {isAuto && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
              Payment Ref: <code style={{ background: 'var(--surface2)', padding: '1px 6px', borderRadius: 4 }}>{paymentRef}</code>
            </div>

            {autoLoading && (
              <div style={{ padding: '16px 0', color: 'var(--text3)', fontSize: 13 }}>Fetching from SalesPro…</div>
            )}

            {autoPayRows !== null && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase',
                  letterSpacing: '0.5px', marginBottom: 8 }}>💳 Payment Status</div>
                <PaymentTable rows={autoPayRows} />

                {autoPayRows.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase',
                      letterSpacing: '0.5px', marginBottom: 10 }}>📦 Installation Status</div>
                    <InstallPanel rows={autoInstRows} />
                  </div>
                )}
              </>
            )}

            {!autoLoaded && !autoLoading && (
              <div style={{ fontSize: 13, color: 'var(--text3)' }}>
                Click "Load from SalesPro" to fetch payment &amp; installation status.
              </div>
            )}
          </>
        )}

        {/* ══ MANUAL MODE ══ */}
        {!isAuto && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
              {editing && paymentRef
                ? <>Current ref: <code style={{ background: 'var(--surface2)', padding: '1px 6px', borderRadius: 4 }}>{paymentRef}</code> — search below to replace it.</>
                : 'No payment reference on this voucher — search account manually.'
              }
            </div>

            {/* Step 1: Account search */}
            <div style={{ marginBottom: 14, position: 'relative' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)',
                textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>
                1 · Account Name
              </label>
              <input
                value={searchInput}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Type at least 3 letters…"
                autoComplete="off"
                style={{ width: '100%' }}
              />
              {searchLoading && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>Searching…</div>}

              {/* Dropdown */}
              {accounts.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  maxHeight: 400, overflowY: 'auto', marginTop: 4,
                }}>
                  {accounts.map(a => {
                    const id  = a.ActId  ?? a.actId;
                    const nm  = a.ActName ?? a.actName;
                    const cty = a.CityName ?? a.cityName;
                    return (
                      <div key={id}
                        onClick={() => handleSelectAccount({ actId: id, actName: nm })}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                          borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <div style={{ fontWeight: 500 }}>{nm}</div>
                        {cty && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{cty}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Step 2: Order filter (client-side) — once account loaded */}
            {selectedAct && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)',
                  textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>
                  2 · Filter / Select Order <span style={{ fontWeight: 400, color: 'var(--text3)' }}></span>
                </label>
                {actLoading ? (
                  <div style={{ fontSize: 13, color: 'var(--text3)' }}>Loading orders…</div>
                ) : (
                  <>
                    <input
                      value={orderFilter}
                      onChange={e => setOrderFilter(e.target.value)}
                      placeholder="Filter by order no…"
                      style={{ width: '100%', marginBottom: 8 }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                      {filteredOrders.length === 0 && (
                        <div style={{ fontSize: 13, color: 'var(--text3)' }}>No orders found.</div>
                      )}
                      {filteredOrders.map(r => (
                        <div key={r.orderNo}
                          onClick={() => handleSelectOrder(r.orderNo, r.orderId)}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '7px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
                            border: '1px solid var(--border)',
                            background: selectedOrder?.orderNo === r.orderNo ? 'var(--surface2)' : 'var(--surface)',
                            fontWeight: selectedOrder?.orderNo === r.orderNo ? 600 : undefined,
                          }}>
                          <span className="mono">{r.orderNo}</span>
                          <span style={{ color: 'var(--text3)' }}>{r.orderDate}</span>
                          <span className="mono" style={{ color: 'var(--text2)' }}>₹{fmt(r.orderValue)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 3: Invoices for selected order (client-side from actRows) */}
            {selectedOrder && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    3 · 💳 Invoices &amp; Payments — {selectedOrder.orderNo}
                  </div>
                  <input
                    value={invoiceFilter}
                    onChange={e => setInvoiceFilter(e.target.value)}
                    placeholder="Filter invoice no…"
                    style={{ width: 180, fontSize: 12, padding: '4px 8px' }}
                  />
                </div>

                <PaymentTable
                  rows={selectedInvoiceRows}
                  selectable={!!voucherId}
                  selectedRef={selectedInvoiceRef}
                  onSelect={ref => setSelectedInvoiceRef(ref)}
                />
                {invoiceFilter && selectedInvoiceRows.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text3)', padding: '6px 0' }}>No invoices match "{invoiceFilter}"</div>
                )}

                {/* Save selected payment reference to voucher */}
                {voucherId && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                    {selectedInvoiceRef ? (
                      <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                        Selected ref: <code style={{ background: 'var(--surface2)', padding: '1px 6px', borderRadius: 4 }}>{selectedInvoiceRef}</code>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>Select an invoice row to link it to this voucher.</div>
                    )}
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={!selectedInvoiceRef || savingRef}
                      onClick={async () => {
                        setSavingRef(true);
                        try {
                          await api.put(`/vouchers/${voucherId}`, { payment_reference: selectedInvoiceRef });
                          toast.success('Payment reference saved to voucher');
                          onStatusSynced?.();   // re-fetch voucher in parent
                        } catch (err) {
                          toast.error(err.response?.data?.error || 'Failed to save');
                        } finally {
                          setSavingRef(false);
                        }
                      }}
                    >
                      {savingRef ? 'Saving…' : '💾 Save Payment Reference'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Step 4: Installation for selected order */}
            {selectedOrder && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase',
                  letterSpacing: '0.5px', marginBottom: 8 }}>
                  4 · 📦 Installation Status — {selectedOrder.orderNo}
                </div>
                {installLoading
                  ? <div style={{ fontSize: 13, color: 'var(--text3)' }}>Loading installation…</div>
                  : installRows !== null
                    ? <InstallPanel rows={installRows} />
                    : null
                }
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
