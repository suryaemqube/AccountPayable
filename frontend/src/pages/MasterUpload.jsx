import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

function fmt(n) {
  if (!n && n !== 0) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─────────────────────────────────────────────
//  Tab: Tally Voucher Import
// ─────────────────────────────────────────────
function TallyImport() {
  const nav = useNavigate();
  const { user } = useAuth();

  const [file, setFile]       = useState(null);
  const [drag, setDrag]       = useState(false);
  const [parsing, setParsing] = useState(false);

  const [vouchers,            setVouchers]            = useState([]);
  const [suppliers,           setSuppliers]           = useState([]);
  const [banks,               setBanks]               = useState([]);
  const [states,              setStates]              = useState([]);
  const [importing,           setImporting]           = useState(false);
  const [pendingAttachments,  setPendingAttachments]  = useState({}); // rowIndex → File[]
  const [uploadProgress,      setUploadProgress]      = useState({}); // voucherId → 'uploading'|'done'|'error'
  const fileRef    = useRef();
  const attachRefs = useRef({});

  function handleFile(f) {
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name)) { toast.error('Only Excel (.xlsx / .xls) files allowed'); return; }
    setFile(f);
  }

  async function handleParse() {
    if (!file) return;
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append('xlfile', file);
      const r = await api.post('/import/xl-parse', fd);
      setBanks(r.data.banks);
      setSuppliers(r.data.suppliers);
      setStates(r.data.states || []);
      const allBanks = r.data.banks;
      const primary  = allBanks.find(b => b.is_primary) || allBanks[0];
      // Auto-select bank by purchase_type_code, fall back to primary
      setVouchers(r.data.vouchers.map(v => {
        const matched = v.purchase_type_code
          ? allBanks.find(b => b.purchase_type_code === v.purchase_type_code)
          : null;
        return { ...v, company_bank_id: matched?.id || primary?.id || null };
      }));
      toast.success(`${r.data.vouchers.length} voucher(s) found in file`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Parse failed');
    } finally { setParsing(false); }
  }

  function reset() { setFile(null); setVouchers([]); setSuppliers([]); setBanks([]); setStates([]); setPendingAttachments({}); setUploadProgress({}); }

  function stageAttachments(rowIdx, files) {
    if (!files?.length) return;
    const arr = Array.from(files); // snapshot before FileList is cleared by e.target.value=''
    setPendingAttachments(p => ({
      ...p,
      [rowIdx]: [...(p[rowIdx] || []), ...arr],
    }));
  }

  function removeAttachment(rowIdx, fileIdx) {
    setPendingAttachments(p => ({
      ...p,
      [rowIdx]: (p[rowIdx] || []).filter((_, i) => i !== fileIdx),
    }));
  }
  function setRow(i, field, val) {
    setVouchers(vs => vs.map((v, idx) => {
      if (idx !== i) return v;
      const updated = { ...v, [field]: val };
      if (field === 'purchase_type_code') {
        const primary = banks.find(b => b.is_primary) || banks[0];
        const matched = val ? banks.find(b => b.purchase_type_code === val) : null;
        updated.company_bank_id = matched?.id || primary?.id || null;
      }
      return updated;
    }));
  }
  function setSupplierForRow(i, suppId) {
    const s = suppliers.find(s => s.id === suppId);
    setVouchers(vs => vs.map((v, idx) =>
      idx === i ? { ...v, supplier_id: suppId, supplier_name: s?.supplier_name || v.party_name, matched: true } : v
    ));
  }
  function removeRow(i) {
    setVouchers(vs => vs.filter((_, idx) => idx !== i));
    setPendingAttachments(p => {
      const next = {};
      Object.entries(p).forEach(([key, files]) => {
        const k = Number(key);
        if (k < i) next[k] = files;
        else if (k > i) next[k - 1] = files;
      });
      return next;
    });
  }

  async function handleImport() {
    if (!vouchers.length) return toast.error('No vouchers to import');
    const missing = vouchers.filter(v => !v.supplier_id);
    if (missing.length) return toast.error('Some rows have unmatched suppliers — please remove them first');
    setImporting(true);
    try {
      const r = await api.post('/import/xl-confirm', { vouchers });

      // Upload attachments: map created vouchers back to original row indices
      // created[] is ordered same as the non-duplicate rows sent
      const created = r.data.created || [];
      let createdIdx = 0;
      const uploadTasks = [];

      vouchers.forEach((v, rowIdx) => {
        if (v.duplicate) return; // skipped row, no voucher created
        const voucher = created[createdIdx++];
        if (!voucher) return;
        const files = pendingAttachments[rowIdx];
        if (!files?.length) return;

        uploadTasks.push(
          (async () => {
            setUploadProgress(p => ({ ...p, [voucher.id]: 'uploading' }));
            const fd = new FormData();
            files.forEach(f => fd.append('files', f));
            try {
              await api.post(`/bills/${voucher.id}/attachments`, fd);
              setUploadProgress(p => ({ ...p, [voucher.id]: 'done' }));
            } catch (attachErr) {
              setUploadProgress(p => ({ ...p, [voucher.id]: 'error' }));
              toast.error(`Attachment upload failed: ${attachErr.response?.data?.error || attachErr.message}`);
            }
          })()
        );
      });

      if (uploadTasks.length) await Promise.allSettled(uploadTasks);

      const msg = r.data.skipped_count > 0
        ? `${r.data.count} bill(s) created, ${r.data.skipped_count} duplicate(s) skipped`
        : `${r.data.count} bill(s) created successfully!`;
      toast.success(msg);
      nav(user?.role === 'executive' ? '/executive/bills' : '/admin/bills');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally { setImporting(false); }
  }

  const inPreview   = vouchers.length > 0;
  const unmatched   = vouchers.filter(v => !v.matched).length;
  const duplicates  = vouchers.filter(v => v.duplicate).length;
  const suppMap     = Object.fromEntries(suppliers.map(s => [s.id, s]));
  const unapproved  = vouchers.filter(v => v.supplier_id && !v.duplicate && suppMap[v.supplier_id]?.approval_status !== 'approved').length;

  return (
    <div style={{ width: inPreview ? '100%' : '45%' }}>
      {!inPreview && (
        <>
          {!file ? (
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => fileRef.current.click()}
              style={{
                border: `2px dashed ${drag ? 'var(--text)' : 'var(--border2)'}`,
                borderRadius: 12, padding: '60px 40px', textAlign: 'center',
                cursor: 'pointer', transition: 'all 0.15s',
                background: drag ? 'var(--surface2)' : 'var(--surface)',
              }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
              <div style={{ fontWeight: 500, marginBottom: 6 }}>Drop Tally Excel file here or click to browse</div>
              <div style={{ color: 'var(--text3)', fontSize: 12 }}>Supports .xlsx and .xls · Purchase Register format</div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])} />
              <div style={{ marginTop: 16 }} onClick={e => e.stopPropagation()}>
                <a href="#" onClick={async e => { e.preventDefault(); const r = await api.get('/import/template/bills', { responseType: 'blob' }); const url = URL.createObjectURL(r.data); const a = document.createElement('a'); a.href = url; a.download = 'Invoice_Data_To_Upload.xlsx'; a.click(); URL.revokeObjectURL(url); }}
                  style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  ⬇ Download Template
                </a>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 28 }}>📊</span>
                  <div>
                    <div style={{ fontWeight: 500 }}>{file.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                </div>
                <button className="btn btn-sm" onClick={() => setFile(null)}>Remove</button>
              </div>
              <div className="card-body">
                {parsing ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{ fontWeight: 500, marginBottom: 6 }}>Parsing Excel file…</div>
                    <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'var(--green-m)', width: '70%', borderRadius: 99,
                        animation: 'pulse 1.5s ease-in-out infinite' }} />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-primary" onClick={handleParse}>📂 Parse &amp; Preview Invoices</button>
                    <button className="btn" onClick={() => nav(-1)}>Cancel</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {inPreview && (
        <>
          <div style={{ marginBottom: 12 }}>
            <button className="btn" onClick={reset}>← Upload Another File</button>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-body" style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{vouchers.length}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Total</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: unmatched ? 'var(--red)' : 'var(--green)' }}>{unmatched}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Unmatched</div>
              </div>
              {duplicates > 0 && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--red)' }}>{duplicates}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>Duplicates</div>
                </div>
              )}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>₹{fmt(vouchers.reduce((s, v) => s + Number(v.total_amount || 0), 0))}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Total Invoice Value</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>₹{fmt(vouchers.reduce((s, v) => s + Number(v.net_payable || (v.total_amount - (v.tds_amount||0)) || 0), 0))}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Net Payable</div>
              </div>
            </div>
          </div>

          {unmatched > 0 && (
            <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 8, padding: '10px 14px',
              fontSize: 13, marginBottom: 10, color: '#856404' }}>
              ⚠️ {unmatched} row(s) have unmatched suppliers — please select from the dropdown in the Supplier column.
            </div>
          )}
          {duplicates > 0 && (
            <div style={{ background: '#fdecea', border: '1px solid #f5a5a5', borderRadius: 8, padding: '10px 14px',
              fontSize: 13, marginBottom: 10, color: '#9b1c1c' }}>
              🚫 {duplicates} row(s) reuse an Invoice Ref No or Cost Centre that's already in the system (or repeated within this file) and will be <strong>skipped</strong> on import. Invoice Ref No and Cost Centre must each be unique.
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="table-wrap" style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 1000 }}>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>#</th>
                    <th>Vch No.</th>
                    <th>Date</th>
                    <th>Supplier</th>
                    <th>Invoice No.</th>
                    <th>Purchase Type</th>
                    <th>Payment Mode</th>
                    <th>Cos Centre</th>
                    <th>Credit Days</th>
                    <th>Bank Account</th>
                    <th style={{ textAlign: 'right' }}>Basic Amt</th>
                    <th style={{ textAlign: 'right' }}>GST</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>TDS</th>
                    <th style={{ textAlign: 'right' }}>Net Payable</th>
                    <th>Attachments</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((v, i) => (
                    <tr key={i} style={{ background: v.duplicate ? '#fdecea' : !v.matched ? '#fff8f0' : undefined,
                      opacity: v.duplicate ? 0.7 : 1 }}>
                      <td style={{ color: 'var(--text3)', fontSize: 12 }}>{i + 1}</td>
                      <td style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>Auto</td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{v.date || '—'}</td>
                      <td style={{ minWidth: 200 }}>
                        {v.matched ? (
                          <div>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <span style={{ fontWeight: 500, fontSize: 13 }}>{v.supplier_name}</span>
                              {(() => {
                                const s = suppliers.find(x => x.id === v.supplier_id);
                                if (s?.approval_status === 'approved')
                                  return <span style={{ fontSize:10, padding:'1px 6px', borderRadius:99, background:'#dcfce7', color:'#166534', fontWeight:600 }}>Approved</span>;
                                if (s?.approval_status === 'waiting_for_approval' || s?.approval_status === 'pending')
                                  return <span style={{ fontSize:10, padding:'1px 6px', borderRadius:99, background:'#fef9c3', color:'#92400e', fontWeight:600 }}>Approval Pending</span>;
                                if (s?.approval_status === 'rejected')
                                  return <span style={{ fontSize:10, padding:'1px 6px', borderRadius:99, background:'#fdecea', color:'#9b1c1c', fontWeight:600 }}>Rejected</span>;
                                return <span style={{ fontSize:10, padding:'1px 6px', borderRadius:99, background:'#f3f4f6', color:'#6b7280', fontWeight:600 }}>{s?.approval_status || 'Unknown'}</span>;
                              })()}
                            </div>
                            {v.supplier_name !== v.party_name && (
                              <div style={{ fontSize: 11, color: 'var(--text3)' }}>from: {v.party_name}</div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 3 }}>⚠ {v.party_name} - <span style={{ fontSize:10, padding:'1px 6px', borderRadius:99, background:'#fef9c3', color:'#92400e', fontWeight:600 }}>No Match</span></div>
                            <select value={v.supplier_id || ''} onChange={e => setSupplierForRow(i, e.target.value)}
                              style={{ fontSize: 12, width: '100%' }}>
                              <option value="">— Select supplier —</option>
                              {suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                            </select>
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace' }}>
                        {v.bill_ref_no || '—'}
                        {v.duplicate_ref_reason && (
                          <div style={{ fontSize: 10, color: '#9b1c1c', fontWeight: 600, marginTop: 2 }}>🚫 {v.duplicate_ref_reason}</div>
                        )}
                      </td>
                      <td>
                        <select value={v.purchase_type_code || ''} onChange={e => setRow(i, 'purchase_type_code', e.target.value || null)}
                          style={{ fontSize: 12, padding: '3px 6px' }}>
                          <option value="">— Type —</option>
                          <option value="SALE">Sale</option>
                          <option value="SALE_MULTIPLE">Sale - Multiple</option>
                          <option value="CONSUME">Consume</option>
                          <option value="PROJECT">Project</option>
                        </select>
                        {!v.purchase_type_code && v.vch_type && (
                          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>from file: {v.vch_type}</div>
                        )}
                      </td>
                      <td>
                        <select value={v.payment_mode || 'NEFT'} onChange={e => setRow(i, 'payment_mode', e.target.value)}
                          style={{ fontSize: 12, padding: '3px 6px' }}>
                          <option value="NEFT">NEFT</option>
                          <option value="RTGS">RTGS</option>
                          <option value="FT">FT</option>
                          <option value="CHEQUE">CHEQUE</option>
                        </select>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {v.purchase_type_code === 'CONSUME' ? (
                          <select value={v.payment_reference || ''} onChange={e => setRow(i, 'payment_reference', e.target.value)}
                            style={{ fontSize: 12, padding: '3px 6px', minWidth: 130 }}>
                            <option value="">— Select state —</option>
                            {states.map(s => <option key={s.parameterdetid} value={s.parametervalues}>{s.parametervalues}</option>)}
                          </select>
                        ) : (
                          <span style={{ color: 'var(--text3)', fontFamily: 'monospace' }}>{v.payment_reference || '—'}</span>
                        )}
                        {v.duplicate_centre_reason && (
                          <div style={{ fontSize: 10, color: '#9b1c1c', fontWeight: 600, marginTop: 2 }}>🚫 {v.duplicate_centre_reason}</div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, textAlign: 'center' }}>
                        <input value={v.due_days || ''} onChange={e => setRow(i, 'due_days', e.target.value ? parseInt(e.target.value) : null)}
                          style={{ width: 50, fontSize: 12, padding: '3px 6px', textAlign: 'center' }} type="number" min="0" />
                      </td>
                      <td style={{ minWidth: 170 }}>
                        <select value={v.company_bank_id || ''} onChange={e => setRow(i, 'company_bank_id', e.target.value || null)}
                          style={{ fontSize: 12, padding: '3px 6px', width: '100%' }}>
                          <option value="">— None —</option>
                          {banks.map(b => (
                            <option key={b.id} value={b.id}>
                              {b.bank_name} · ···{String(b.account_number).slice(-4)}{b.is_primary ? ' ★' : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{v.taxable_amount > 0 ? fmt(v.taxable_amount) : '—'}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text3)' }}>
                        {((v.igst||0)+(v.cgst||0)+(v.sgst||0)) > 0 ? fmt((v.igst||0)+(v.cgst||0)+(v.sgst||0)) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{fmt(v.total_amount)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--red)' }}>
                        {v.tds_amount > 0 ? `(${fmt(v.tds_amount)})` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 700 }}>
                        {fmt(v.net_payable || (v.total_amount - (v.tds_amount || 0)))}
                      </td>
                      <td style={{ minWidth: 160 }}>
                        <input
                          ref={el => attachRefs.current[i] = el}
                          type="file"
                          multiple
                          style={{ display: 'none' }}
                          onChange={e => { stageAttachments(i, e.target.files); e.target.value = ''; }}
                        />
                        <button className="btn btn-sm" onClick={() => attachRefs.current[i]?.click()}
                          style={{ fontSize: 11, padding: '2px 8px', marginBottom: 4 }}>
                          📎 Attach
                        </button>
                        {(pendingAttachments[i] || []).map((f, fi) => (
                          <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                            <span style={{ fontSize: 10, color: 'var(--text2)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>
                              📄 {f.name}
                            </span>
                            <button onClick={() => removeAttachment(i, fi)}
                              style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                          </div>
                        ))}
                      </td>
                      <td>
                        <button className="btn btn-sm" style={{ color: 'var(--red)', padding: '2px 8px' }}
                          onClick={() => removeRow(i)} title="Remove row">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'right', fontWeight: 600, fontSize: 13, padding: '10px 12px', borderTop: '2px solid var(--border)' }}>Total</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 14, padding: '10px 12px', borderTop: '2px solid var(--border)' }}>
                      ₹{fmt(vouchers.reduce((s, v) => s + Number(v.total_amount || 0), 0))}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 14, padding: '10px 12px', borderTop: '2px solid var(--border)', color: 'var(--red)' }}>
                      ({fmt(vouchers.reduce((s, v) => s + Number(v.tds_amount || 0), 0))})
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 14, padding: '10px 12px', borderTop: '2px solid var(--border)' }}>
                      ₹{fmt(vouchers.reduce((s, v) => s + Number(v.net_payable || (v.total_amount - (v.tds_amount||0)) || 0), 0))}
                    </td>
                    <td colSpan={2} style={{ borderTop: '2px solid var(--border)' }}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {unapproved > 0 && (
            <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 8, padding: '10px 14px', marginBottom: 10, fontSize: 13, color: '#856404' }}>
              ⚠ {unapproved} row(s) have suppliers with pending approval — bills cannot be created for these. Please get the supplier(s) approved first or remove those rows.
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={handleImport} disabled={importing || !vouchers.length || unapproved > 0}>
              {importing
                ? 'Importing…'
                : `✅ Import ${vouchers.length} bill(s)${Object.values(pendingAttachments).flat().length ? ` + ${Object.values(pendingAttachments).flat().length} file(s)` : ''}`}
            </button>
            <button className="btn" onClick={reset}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  Tab: Bank UTR Upload
//  Voucher-centric: shows all exported vouchers,
//  each checked against the bank file by
//  bill_ref_no === bank_row.Remark
// ─────────────────────────────────────────────
function BankUtrUpload() {
  const [file, setFile]             = useState(null);
  const [drag, setDrag]             = useState(false);
  const [parsing, setParsing]       = useState(false);
  const [vouchers, setVouchers]     = useState([]);   // exported vouchers (annotated)
  const [totalBankRows, setTotalBankRows] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef();

  function handleFile(f) {
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name)) { toast.error('Only Excel (.xlsx / .xls) files allowed'); return; }
    setFile(f);
  }

  async function handleParse() {
    if (!file) return;
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append('bankfile', file);
      const r = await api.post('/import/bank-parse', fd);
      setVouchers(r.data.vouchers);
      setTotalBankRows(r.data.total_bank_rows);
      if (!r.data.vouchers.length) {
        toast.error('No eligible vouchers found. Vouchers must be in Exported or Ready to Remit status.');
      } else {
        toast.success(`${r.data.vouchers.length} voucher(s) · ${r.data.matched} matched from bank file`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Parse failed');
    } finally { setParsing(false); }
  }

  function reset() { setFile(null); setVouchers([]); setTotalBankRows(0); }

  // Allow manual override of UTR per voucher
  function setVoucherUtr(i, val) {
    setVouchers(vs => vs.map((v, idx) => idx === i ? { ...v, utr_no: val } : v));
  }

  async function handleConfirm() {
    const toUpdate = vouchers.filter(v => v.utr_no?.trim());
    if (!toUpdate.length) return toast.error('No vouchers with UTR numbers to save');
    setConfirming(true);
    try {
      const r = await api.post('/import/bank-confirm', { vouchers: toUpdate });
      toast.success(r.data.message);
      reset();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Confirm failed');
    } finally { setConfirming(false); }
  }

  const inPreview    = vouchers.length > 0;
  const matchedCount = vouchers.filter(v => v.bank_row).length;
  const utrCount     = vouchers.filter(v => v.utr_no?.trim()).length;

  return (
    <div style={{ maxWidth: inPreview ? 1060 : 720 }}>

      {!inPreview && (
        <>
          {!file ? (
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => fileRef.current.click()}
              style={{
                border: `2px dashed ${drag ? 'var(--text)' : 'var(--border2)'}`,
                borderRadius: 12, padding: '60px 40px', textAlign: 'center',
                cursor: 'pointer', transition: 'all 0.15s',
                background: drag ? 'var(--surface2)' : 'var(--surface)',
              }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🏦</div>
              <div style={{ fontWeight: 500, marginBottom: 6 }}>Drop Bank Transaction Excel file here or click to browse</div>
              <div style={{ color: 'var(--text3)', fontSize: 12 }}>Supports .xlsx and .xls · Auto-matches Exported vouchers via Bill Ref No</div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])} />
            </div>
          ) : (
            <div className="card">
              <div className="card-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 28 }}>🏦</span>
                  <div>
                    <div style={{ fontWeight: 500 }}>{file.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                </div>
                <button className="btn btn-sm" onClick={() => setFile(null)}>Remove</button>
              </div>
              <div className="card-body">
                {parsing ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{ fontWeight: 500, marginBottom: 6 }}>Matching bank file against exported vouchers…</div>
                    <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'var(--purple)', width: '70%', borderRadius: 99,
                        animation: 'pulse 1.5s ease-in-out infinite' }} />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-primary" onClick={handleParse}>🏦 Parse &amp; Match Vouchers</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {inPreview && (
        <>
          {/* Summary bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 24 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{vouchers.length}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Exported Vouchers</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{totalBankRows}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Bank Rows</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>{matchedCount}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Matched</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: vouchers.length - matchedCount > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {vouchers.length - matchedCount}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Not in Bank File</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--purple)' }}>{utrCount}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>UTR Ready</div>
              </div>
            </div>
            <button className="btn" onClick={reset}>← Upload Another File</button>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="table-wrap" style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>#</th>
                    <th>Voucher No</th>
                    <th>Supplier</th>
                    <th>Bill Ref No</th>
                    <th>Beneficiary (Bank)</th>
                    <th>Customer Ref No</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>UTR No</th>
                    <th style={{ width: 90 }}>Match</th>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((v, i) => {
                    const hasMatch = !!v.bank_row;
                    return (
                      <tr key={v.id} style={{ background: !hasMatch ? '#fafafa' : undefined }}>
                        <td style={{ color: 'var(--text3)', fontSize: 12 }}>{i + 1}</td>
                        <td style={{ fontSize: 12, fontWeight: 500 }}>{v.voucher_no || v.tally_vch_no || '—'}</td>
                        <td style={{ fontSize: 12 }}>{v.supplier_name}</td>
                        <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text2)' }}>{v.bill_ref_no || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text3)' }}>{v.bank_row?.beneficiary_name || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text3)' }}>{v.bank_row?.customer_ref_no || '—'}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>₹{fmt(v.amount)}</td>
                        <td>
                          <input
                            value={v.utr_no || ''}
                            onChange={e => setVoucherUtr(i, e.target.value)}
                            style={{ width: 160, fontSize: 12, padding: '3px 6px' }}
                            placeholder="UTR number"
                            readOnly={hasMatch}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {hasMatch ? (
                            <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>✓ Matched</span>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--text3)' }}>— Not found</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={confirming || utrCount === 0}>
              {confirming ? 'Saving…' : `💾 Save UTR for ${utrCount} Voucher(s)`}
            </button>
            <button className="btn" onClick={reset}>Cancel</button>
            {utrCount === 0 && (
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>No UTR numbers to save yet</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  Tab: Supplier Master Import
// ─────────────────────────────────────────────
function SupplierImport() {
  const [file,       setFile]       = useState(null);
  const [drag,       setDrag]       = useState(false);
  const [parsing,    setParsing]    = useState(false);
  const [suppliers,  setSuppliers]  = useState([]);
  const [counts,     setCounts]     = useState({});
  const [importing,  setImporting]  = useState(false);
  const fileRef = useRef();

  function handleFile(f) {
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name)) { toast.error('Only Excel (.xlsx / .xls) files allowed'); return; }
    setFile(f);
  }

  async function handleParse() {
    if (!file) return;
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append('xlfile', file);
      const r = await api.post('/import/supplier-parse', fd);
      setSuppliers(r.data.suppliers);
      setCounts(r.data.counts);
      toast.success(`${r.data.suppliers.length} supplier row(s) found`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Parse failed');
    } finally { setParsing(false); }
  }

  function reset() { setFile(null); setSuppliers([]); setCounts({}); }
  function removeRow(i) { setSuppliers(ss => ss.filter((_, idx) => idx !== i)); }

  async function handleImport() {
    const toImport = suppliers.filter(s => s.status !== 'duplicate');
    if (!toImport.length) return toast.error('No suppliers to import');
    setImporting(true);
    try {
      const r = await api.post('/import/supplier-confirm', { suppliers });
      toast.success(
        `${r.data.created_count} created · ${r.data.updated_count} updated · ${r.data.skipped_count} skipped`
      );
      reset();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally { setImporting(false); }
  }

  const inPreview  = suppliers.length > 0;
  const statusColor = { new:'#16a34a', update:'#ca8a04', duplicate:'#dc2626' };
  const statusLabel = { new:'New', update:'Update', duplicate:'Duplicate' };
  const statusBadge = { new:'badge-approved', update:'badge-pending', duplicate:'badge-rejected' };

  return (
    <div style={{ maxWidth: inPreview ? 1200 : 720 }}>
      {!inPreview && (
        <>
          {!file ? (
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => fileRef.current.click()}
              style={{
                border: `2px dashed ${drag ? 'var(--text)' : 'var(--border2)'}`,
                borderRadius: 12, padding: '60px 40px', textAlign: 'center',
                cursor: 'pointer', transition: 'all 0.15s',
                background: drag ? 'var(--surface2)' : 'var(--surface)',
              }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
              <div style={{ fontWeight: 500, marginBottom: 6 }}>Drop Supplier Master Excel file here or click to browse</div>
              <div style={{ color: 'var(--text3)', fontSize: 12 }}>Supports .xlsx and .xls · Use the Supplier Master Template</div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])} />
              <div style={{ marginTop: 16 }} onClick={e => e.stopPropagation()}>
                <a href="#" onClick={async e => { e.preventDefault(); const r = await api.get('/import/template/suppliers', { responseType: 'blob' }); const url = URL.createObjectURL(r.data); const a = document.createElement('a'); a.href = url; a.download = 'Supplier_Master_Template_Upload.xlsx'; a.click(); URL.revokeObjectURL(url); }}
                  style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  ⬇ Download Template
                </a>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 28 }}>🏢</span>
                  <div>
                    <div style={{ fontWeight: 500 }}>{file.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                </div>
                <button className="btn btn-sm" onClick={() => setFile(null)}>Remove</button>
              </div>
              <div className="card-body">
                {parsing ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{ fontWeight: 500, marginBottom: 6 }}>Parsing supplier file…</div>
                    <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'var(--primary)', width: '70%', borderRadius: 99,
                        animation: 'pulse 1.5s ease-in-out infinite' }} />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-primary" onClick={handleParse}>🏢 Parse &amp; Preview Suppliers</button>
                    <button className="btn" onClick={() => setFile(null)}>Cancel</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {inPreview && (
        <>
          <div style={{ marginBottom: 12 }}>
            <button className="btn" onClick={reset}>← Upload Another File</button>
          </div>

          {/* Summary */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-body" style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{suppliers.length}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Total Rows</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: statusColor.new }}>{counts.new || 0}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>New</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: statusColor.update }}>{counts.update || 0}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Update</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: statusColor.duplicate }}>{counts.duplicate || 0}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Duplicate (skip)</div>
              </div>
            </div>
          </div>

          {counts.duplicate > 0 && (
            <div style={{ background: '#fdecea', border: '1px solid #f5a5a5', borderRadius: 8, padding: '10px 14px',
              fontSize: 13, marginBottom: 10, color: '#9b1c1c' }}>
              🚫 {counts.duplicate} row(s) are duplicates (same GST / Name already in this file) and will be <strong>skipped</strong>.
            </div>
          )}
          {counts.update > 0 && (
            <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 8, padding: '10px 14px',
              fontSize: 13, marginBottom: 10, color: '#713f12' }}>
              ⚠️ {counts.update} row(s) will <strong>update</strong> existing suppliers and reset their approval status to Pending.
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="table-wrap" style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 960 }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Action</th>
                    <th>Supplier Name</th>
                    <th>Trade Name</th>
                    <th>Type</th>
                    <th>GST Number</th>
                    <th>PAN</th>
                    <th>Contact</th>
                    <th>Mobile</th>
                    <th>Bank Acct</th>
                    <th>Note</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s, i) => (
                    <tr key={i}
                      style={{ background: s.status === 'duplicate' ? '#fdecea' : s.status === 'update' ? '#fefce8' : undefined,
                        opacity: s.status === 'duplicate' ? 0.7 : 1 }}>
                      <td style={{ color: 'var(--text3)', fontSize: 12 }}>{s._rowIdx || i + 2}</td>
                      <td><span className={`badge ${statusBadge[s.status]}`}>{statusLabel[s.status]}</span></td>
                      <td style={{ fontWeight: 500, fontSize: 13 }}>
                        {s.supplier_name}
                        {s.status === 'update' && (
                          <div style={{ fontSize: 10, color: 'var(--text3)' }}>was: {s.existing_name}</div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text3)' }}>{s.trade_name || '—'}</td>
                      <td style={{ fontSize: 12 }}>{s.supplier_type || '—'}</td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{s.gstin || '—'}</td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{s.pan_number || '—'}</td>
                      <td style={{ fontSize: 12 }}>{s.contact_name || '—'}</td>
                      <td style={{ fontSize: 12 }}>{s.mobile || '—'}</td>
                      <td style={{ fontSize: 12 }}>{s.account_number ? `···${String(s.account_number).slice(-4)}` : '—'}</td>
                      <td style={{ fontSize: 11, color: 'var(--text3)', maxWidth: 160 }}>
                        {s.duplicate_reason || (s.status === 'new' ? 'Will create — approval: New' : 'Will update — approval: Import')}
                      </td>
                      <td>
                        <button className="btn btn-sm" style={{ color: 'var(--red)', padding: '2px 8px' }}
                          onClick={() => removeRow(i)} title="Remove row">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
              {importing
                ? 'Importing…'
                : `✅ Import ${suppliers.filter(s => s.status !== 'duplicate').length} Supplier(s)`}
            </button>
            <button className="btn" onClick={reset}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  Main page with tabs
// ─────────────────────────────────────────────
export default function MasterUpload() {
  const [tab, setTab] = useState('tally');

  const tabs = [
    { key: 'tally',    label: '📊 Tally Bill Import',     desc: 'Import vouchers from Tally Day Book export' },
    { key: 'bank',     label: '🏦 Bank UTR Upload',        desc: 'Match bank transactions and save UTR numbers to vouchers' },
    { key: 'supplier', label: '🏢 Supplier Master Import', desc: 'Bulk create or update suppliers from Excel template' },
  ];

  return (
    <Layout>
      <div style={{ padding: 28 }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>Master Upload</h1>
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>
            {tabs.find(t => t.key === tab)?.desc}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--border)' }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 20px', fontSize: 13, fontWeight: 500,
                color: tab === t.key ? 'var(--text)' : 'var(--text3)',
                borderBottom: tab === t.key ? '2px solid var(--text)' : '2px solid transparent',
                marginBottom: -2, transition: 'all 0.15s',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'tally'    && <TallyImport />}
        {tab === 'bank'     && <BankUtrUpload />}
        {tab === 'supplier' && <SupplierImport />}
      </div>
    </Layout>
  );
}
