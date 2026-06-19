import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import { StatusBadge, PaymentBadge, fmt, fmtDate } from '../components/Helpers';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { SalesproStatusCard } from '../components/SalesproStatus';
import EmailModal from '../components/EmailModal';

function FileIcon({ mime }) {
  if (!mime) return '📎';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime === 'application/pdf') return '📄';
  return '📎';
}

export default function VoucherDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();

  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [editing, setEditing]     = useState(false);
  const [form, setForm]           = useState({});
  const [managers, setManagers]   = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [comment, setComment]     = useState('');
  const [assignTo, setAssignTo]   = useState('');
  const [rejectReason, setRejectReason]           = useState('');
  const [showReject, setShowReject]               = useState(false);
  const [showFinalReject, setShowFinalReject]     = useState(false);
  const [finalRejectReason, setFinalRejectReason] = useState('');
  const [utrInput, setUtrInput]                   = useState('');
  const [savingUtr, setSavingUtr]                 = useState(false);
  const [saving, setSaving]       = useState(false);
  const [viewer, setViewer]       = useState(null); // { url, mimeType, name }
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef();

  const isNew = id === 'new';

  useEffect(() => {
    if (isNew) {
      setEditing(true);
      setLoading(false);
      setData({ voucher: {}, comments: [], activity_log: [], attachments: [] });
      setForm({});
    } else {
      fetchVoucher();
    }
    if (user.role === 'admin' || user.role === 'executive') { fetchManagers(); fetchSuppliers(); }
  }, [id]);

  async function fetchVoucher() {
    try {
      const r = await api.get(`/vouchers/${id}`);
      setData(r.data);
      setForm(r.data.voucher);
      setAttachments(r.data.attachments || []);
      // Auto-select manager from supplier's owned_by
      if (r.data.supplier_info?.owned_by && !r.data.voucher.assigned_to) {
        setAssignTo(r.data.supplier_info.owned_by);
      } else if (r.data.voucher.assigned_to) {
        setAssignTo(r.data.voucher.assigned_to);
      }
    } catch { toast.error('Failed to load voucher'); }
    finally { setLoading(false); }
  }

  async function fetchManagers() {
    try {
      const r = await api.get('/managers');
      setManagers(r.data.managers);
    } catch { }
  }

  async function fetchSuppliers() {
    try {
      const r = await api.get('/suppliers?approved_only=true');
      setSuppliers(r.data.suppliers || []);
    } catch { }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const taxable = parseFloat(form.taxable_amount) || 0;
      const cgst    = parseFloat(form.cgst)    || 0;
      const sgst    = parseFloat(form.sgst)    || 0;
      const igst    = parseFloat(form.igst)    || 0;
      const tds     = parseFloat(form.tds_amount) || 0;
      const total   = taxable + cgst + sgst + igst - tds;
      const payload = { ...form, total_amount: total };

      if (isNew) {
        const r = await api.post('/vouchers', payload);
        toast.success('Voucher created');
        // Redirect to the real voucher detail page
        const roleBase = `/${user.role === 'executive' ? 'executive' : 'admin'}`;
        nav(`${roleBase}/vouchers/${r.data.id}`, { replace: true });
      } else {
        await api.put(`/vouchers/${id}`, payload);
        toast.success('Voucher updated');
        setEditing(false);
        fetchVoucher();
      }
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleAssign() {
    if (!assignTo) return toast.error('Select a manager');
    try {
      await api.post(`/vouchers/${id}/assign`, { manager_id: assignTo });
      toast.success('Assigned to manager');
      fetchVoucher();
    } catch (err) { toast.error(err.response?.data?.error || 'Assign failed'); }
  }

  async function handleManagerAction(action) {
    if (action === 'reject' && !rejectReason) return toast.error('Please provide rejection reason');
    try {
      await api.post(`/vouchers/${id}/manager-action`, {
        action, comment: action === 'reject' ? rejectReason : comment, rejected_reason: rejectReason,
      });
      toast.success(action === 'approve' ? 'Sent for Verification' : 'Voucher rejected');
      fetchVoucher();
      setComment(''); setRejectReason(''); setShowReject(false);
    } catch (err) { toast.error(err.response?.data?.error || 'Action failed'); }
  }

  async function handleFinalApproval(action, rejectReason = '') {
    try {
      await api.post(`/vouchers/${id}/final-approval`, {
        action,
        comment,
        rejected_reason: action === 'reject' ? rejectReason : undefined,
      });
      toast.success(action === 'approve' ? 'Voucher approved. Executive can now enter UTR and generate PDF.' : 'Voucher rejected.');
      fetchVoucher();
      setComment('');
      setFinalRejectReason('');
      setShowFinalReject(false);
    } catch (err) { toast.error(err.response?.data?.error || 'Action failed'); }
  }

  async function handleApproverVerify(action, rejectReason = '') {
    try {
      await api.post(`/vouchers/${id}/verify`, {
        action,
        comment,
        rejected_reason: action === 'reject' ? rejectReason : undefined,
      });
      toast.success(action === 'approve' ? 'Verified — Ready For Bank' : 'Voucher rejected.');
      fetchVoucher();
      setComment('');
      setFinalRejectReason('');
      setShowFinalReject(false);
    } catch (err) { toast.error(err.response?.data?.error || 'Action failed'); }
  }

  async function handleSaveUtr() {
    if (!utrInput.trim()) return toast.error('Enter UTR number');
    setSavingUtr(true);
    try {
      await api.post(`/vouchers/${id}/utr`, { utr_no: utrInput.trim() });
      toast.success('UTR saved');
      setUtrInput('');
      fetchVoucher();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save UTR'); }
    finally { setSavingUtr(false); }
  }

  async function handlePreviewPdf() {
    try {
      // Generate if not yet generated
      if (!voucher.voucher_pdf_path) {
        await api.post(`/vouchers/${id}/generate`);
        await fetchVoucher();
      }
      const r = await api.get(`/vouchers/${id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const name = voucher.voucher_no ? `voucher-${voucher.voucher_no.replace(/\//g, '-')}.pdf` : `voucher-${id.slice(0, 8)}.pdf`;
      setViewer({ url, mimeType: 'application/pdf', name });
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to load PDF'); }
  }

  async function handleAddComment() {
    if (!comment.trim()) return;
    try {
      await api.post(`/vouchers/${id}/comments`, { comment });
      toast.success('Comment added'); setComment(''); fetchVoucher();
    } catch { toast.error('Failed to add comment'); }
  }

  // ── Attachment upload ──
  async function handleFileUpload(files) {
    if (!files || !files.length) return;
    setUploading(true);
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    try {
      const r = await api.post(`/vouchers/${id}/attachments`, fd);
      setAttachments(a => [...a, ...r.data.attachments]);
      toast.success(`${r.data.attachments.length} file(s) uploaded`);
    } catch (err) { toast.error(err.response?.data?.error || 'Upload failed'); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  }

  async function handleDeleteAttachment(aid) {
    if (!window.confirm('Delete this attachment?')) return;
    try {
      await api.delete(`/vouchers/${id}/attachments/${aid}`);
      setAttachments(a => a.filter(x => x.id !== aid));
      toast.success('Deleted');
    } catch { toast.error('Delete failed'); }
  }

  async function openAttachment(att) {
    try {
      const r = await api.get(`/vouchers/${id}/attachments/${att.id}`, { responseType: 'blob' });
      const mimeType = r.headers['content-type'] || att.mime_type || 'application/octet-stream';
      const url = URL.createObjectURL(new Blob([r.data], { type: mimeType }));
      setViewer({ url, mimeType, name: att.original_name });
    } catch { toast.error('Failed to open file'); }
  }


  if (loading) return <Layout><div style={{ padding: 40, textAlign: 'center' }}>Loading…</div></Layout>;
  if (!data)   return <Layout><div style={{ padding: 40 }}>Voucher not found</div></Layout>;

  const { voucher, comments, activity_log: activityLog = [] } = data;
  const supplierInfo = data.supplier_info;
  const isAdmin        = user.role === 'admin';
  const isExecutive    = user.role === 'executive';
  const canEdit        = (isAdmin || isExecutive) && ['draft', 'assigned'].includes(voucher.status);
  const canAssign      = (isAdmin || isExecutive) && ['draft', 'assigned'].includes(voucher.status);
  const canManagerAct  = user.role === 'manager' && voucher.status === 'assigned';
  const canApproverVerify  = user.role === 'approver' && voucher.status === 'verification';
  const canApproverApprove = user.role === 'approver' && voucher.status === 'proceed';
  const canGenerate        = (isAdmin || isExecutive) && ['approved', 'downloaded'].includes(voucher.status) && !!voucher.utr_no;
  const canEnterUTR        = (isAdmin || isExecutive) && voucher.status === 'approved' && !voucher.utr_no;

  // Financial values (from form when editing, else from voucher)
  const src = editing ? form : voucher;
  const taxable    = parseFloat(src.taxable_amount) || 0;
  const cgst       = parseFloat(src.cgst)    || 0;
  const sgst       = parseFloat(src.sgst)    || 0;
  const igst       = parseFloat(src.igst)    || 0;
  const tds        = parseFloat(src.tds_amount) || 0;
  const balance    = parseFloat(src.balance_amount) || 0;
  // Sum of all balance (child) vouchers split from this source
  const balanceSplit = (voucher.balance_vouchers || []).reduce((s, bv) => s + (parseFloat(bv.total_amount) || 0), 0);
  const grossTotal   = taxable + cgst + sgst + igst;   // before TDS
  const totalAmount  = parseFloat(src.total_amount) || grossTotal; // stored = gross - tds
  const netPayable   = grossTotal - tds;               // gross − TDS
  const amountToPay  = netPayable - balance - balanceSplit;

  const gstin = supplierInfo?.gstin || voucher.supplier_gstin || '';

  return (
    <Layout><>
      <div style={{ padding: 28, maxWidth: 980 }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
          <button className="btn btn-sm" onClick={() => nav(-1)}>← Back</button>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h1 style={{ fontSize: 20, fontWeight: 600 }}>{isNew ? 'New Voucher' : `Voucher - ${voucher.voucher_no}`}</h1>
              <StatusBadge status={voucher.status} />
              <PaymentBadge status={voucher.payment_status} />
              {voucher.tally_vch_no && (
                <span style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', padding: '2px 8px', borderRadius: 99 }}>
                  Vch #{voucher.tally_vch_no}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>
              {voucher.supplier_name} · Created {fmtDate(voucher.created_at)}
              {voucher.assigned_to_name && ` · Assigned to ${voucher.assigned_to_name}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {canEdit && !editing && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
            {editing && (
              <>
                <button className="btn btn-green" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                <button className="btn" onClick={() => isNew ? nav(-1) : (() => { setEditing(false); setForm(voucher); })()}>Cancel</button>
              </>
            )}
            {canGenerate && <button className="btn btn-green" onClick={handlePreviewPdf}>📄 {voucher.voucher_pdf_path ? 'Preview PDF' : 'Generate & Preview'}</button>}
            {(isAdmin || isExecutive) && ['approved', 'downloaded'].includes(voucher.status) && voucher.utr_no && (
              <button className="btn" style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}
                onClick={() => setShowEmailModal(true)}>
                ✉ Send Payment Advice
              </button>
            )}
            {(isAdmin || isExecutive) && ['approved', 'downloaded'].includes(voucher.status) && Number(voucher.balance_amount) > 0 && (
              <button className="btn" style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fcd34d' }}
                onClick={async () => {
                  try {
                    const r = await api.post('/vouchers/create-balance', { source_id: voucher.id });
                    toast.success('Balance voucher created');
                    nav(`/${user.role}/vouchers/${r.data.voucher.id}`);
                  } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
                }}>
                + Create Balance Voucher
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
          <div>

            {/* ── Invoice Files ── */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <div className="card-title">Invoice Files</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {uploading && <span style={{ fontSize: 12, color: 'var(--text3)' }}>Uploading…</span>}
                  <button className="btn btn-sm btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    + Upload Files
                  </button>
                  <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx"
                    style={{ display: 'none' }}
                    onChange={e => handleFileUpload(Array.from(e.target.files))} />
                </div>
              </div>
              <div className="card-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
                {/* Uploaded attachments */}
                {attachments.length === 0 && (
                  <div style={{ padding: '10px 0', color: 'var(--text3)', fontSize: 13 }}>
                    No files attached. Click "Upload Files" to add invoice documents.
                  </div>
                )}
                {attachments.map(att => (
                  <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
                    borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 18 }}><FileIcon mime={att.mime_type} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {att.original_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {att.uploaded_by_name} · {fmtDate(att.created_at)}
                        {att.file_size && ` · ${(att.file_size / 1024).toFixed(0)} KB`}
                      </div>
                    </div>
                    <button className="btn btn-sm" onClick={() => openAttachment(att)}>View</button>
                    {isAdmin && (
                      <button className="btn btn-sm" style={{ color: 'var(--red)' }}
                        onClick={() => handleDeleteAttachment(att.id)}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Voucher Details ── */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><div className="card-title">Voucher details</div></div>
              <div className="card-body">
                {editing ? (
                  <>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Supplier</label>
                        <select value={form.supplier_id || ''} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value || null }))}>
                          <option value="">— Select supplier —</option>
                          {suppliers.map(s => (
                            <option key={s.id} value={s.id}>{s.supplier_name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Payment Reference</label>
                        <input value={form.payment_reference || ''} onChange={e => setForm(f => ({ ...f, payment_reference: e.target.value }))}
                          placeholder="UTR / Cheque No. / App Ref" />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Invoice Date</label>
                        <input type="date" value={form.invoice_date ? form.invoice_date.slice(0, 10) : ''}
                          onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label>Due Days</label>
                        <input type="number" min="0" placeholder="e.g. 30"
                          value={form.due_days ?? ''}
                          onChange={e => setForm(f => ({ ...f, due_days: e.target.value === '' ? null : parseInt(e.target.value) }))} />
                        {form.due_days && (() => {
                          const base = voucher.assigned_at ? new Date(voucher.assigned_at) : new Date();
                          base.setDate(base.getDate() + parseInt(form.due_days));
                          return <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                            Due: {base.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            {!voucher.assigned_at && ' (est. from today)'}
                          </div>;
                        })()}
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Payment Status</label>
                        <select value={form.payment_status || 'unpaid'} onChange={e => setForm(f => ({ ...f, payment_status: e.target.value }))}>
                          <option value="unpaid">Unpaid</option>
                          <option value="paid">Paid</option>
                          <option value="partial">Partial</option>
                        </select>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Narration</label>
                      <textarea rows={2} value={form.narration || ''} onChange={e => setForm(f => ({ ...f, narration: e.target.value }))} />
                    </div>
                  </>
                ) : (
                  <>
                  {/* Due date warning banner */}
                  {(() => {
                    if (!voucher.due_date) return null;
                    const today    = new Date(); today.setHours(0,0,0,0);
                    const due      = new Date(voucher.due_date); due.setHours(0,0,0,0);
                    const daysLeft = Math.round((due - today) / 86400000);
                    if (daysLeft > 5) return null;
                    const bg    = daysLeft <= 0 ? '#fef2f2' : daysLeft <= 2 ? '#fff7ed' : '#fefce8';
                    const color = daysLeft <= 0 ? '#dc2626' : daysLeft <= 2 ? '#d97706' : '#ca8a04';
                    const label = daysLeft < 0  ? `Overdue by ${Math.abs(daysLeft)} day(s)!`
                                : daysLeft === 0 ? 'Due TODAY!'
                                : daysLeft === 1 ? 'Due TOMORROW!'
                                : `Due in ${daysLeft} days`;
                    return (
                      <div style={{ background: bg, border: `1px solid ${color}30`, borderRadius: 8,
                        padding: '8px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16 }}>⏰</span>
                        <span style={{ color, fontSize: 13, fontWeight: 600 }}>{label}</span>
                        <span style={{ color: 'var(--text3)', fontSize: 12, marginLeft: 4 }}>
                          — Due {new Date(voucher.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    );
                  })()}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {[
                      ['Invoice Ref No.',    voucher.payment_reference],
                      ['Supplier',        voucher.supplier_name],
                      ['GSTIN',           gstin],
                      ['Bill Date',    fmtDate(voucher.invoice_date)],
                      ['Due Days',        voucher.due_days ? `${voucher.due_days} days` : null],
                      ['Due Date',        voucher.due_date ? fmtDate(voucher.due_date) : null],
                      ['Assigned Date',   voucher.assigned_at ? fmtDate(voucher.assigned_at) : null],
                      ['Vch No. (Tally)', voucher.tally_vch_no],
                      ['Ref No.',         voucher.bill_ref_no],
                    ].map(([l, v]) => v ? (
                      <div key={l}>
                        <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>{l}</div>
                        <div style={{ fontWeight: 500 }}>{v}</div>
                      </div>
                    ) : null)}
                    {voucher.narration && (
                      <div style={{ gridColumn: '1/-1' }}>
                        <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>Narration</div>
                        <div>{voucher.narration}</div>
                      </div>
                    )}
                  </div>
                  </>
                )}
              </div>
            </div>

            {/* ── Financial Breakdown ── */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><div className="card-title">Financial Breakdown</div></div>
              {editing ? (
                <div className="card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div className="form-group">
                      <label>Taxable Amount</label>
                      <input type="number" value={form.taxable_amount || ''} step="0.01"
                        onChange={e => setForm(f => ({ ...f, taxable_amount: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label>CGST</label>
                      <input type="number" value={form.cgst || ''} step="0.01"
                        onChange={e => setForm(f => ({ ...f, cgst: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label>SGST</label>
                      <input type="number" value={form.sgst || ''} step="0.01"
                        onChange={e => setForm(f => ({ ...f, sgst: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label>IGST</label>
                      <input type="number" value={form.igst || ''} step="0.01"
                        onChange={e => setForm(f => ({ ...f, igst: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label>TDS Deducted</label>
                      <input type="number" value={form.tds_amount || ''} step="0.01"
                        onChange={e => setForm(f => ({ ...f, tds_amount: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label>Balance (Held Back)</label>
                      <input type="number" value={form.balance_amount || ''} step="0.01" min="0"
                        placeholder="0.00"
                        onChange={e => setForm(f => ({ ...f, balance_amount: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text3)', marginBottom: 4 }}>
                      <span>Net Payable</span>
                      <span className="mono">{fmt(netPayable)}</span>
                    </div>
                    {balance > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--red)', marginBottom: 4 }}>
                        <span>Balance (Held Back)</span>
                        <span className="mono">− {fmt(balance)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                      <span>Amount to Pay</span>
                      <span className="mono">{fmt(balance > 0 ? amountToPay : netPayable)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '4px 18px 16px' }}>
                  {[
                    taxable > 0  && ['Taxable Amount',  taxable,  false],
                    cgst > 0     && ['CGST',             cgst,     false],
                    sgst > 0     && ['SGST',             sgst,     false],
                    igst > 0     && ['IGST',             igst,     false],
                  ].filter(Boolean).map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
                      padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                      <span style={{ color: 'var(--text2)' }}>{label}</span>
                      <span className="mono">{fmt(val)}</span>
                    </div>
                  ))}
                  {/* Total Amount — gross subtotal before deductions */}
                  <div style={{ display: 'flex', justifyContent: 'space-between',
                    padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
                    <span style={{ color: 'var(--text2)' }}>Total Amount</span>
                    <span className="mono">{fmt(grossTotal)}</span>
                  </div>
                  {[
                    tds > 0          && ['TDS Deducted',        tds],
                    balance > 0      && ['Balance (Held Back)',  balance],
                    balanceSplit > 0 && ['Balance Voucher Split', balanceSplit],
                  ].filter(Boolean).map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
                      padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                      <span style={{ color: 'var(--text2)' }}>{label}</span>
                      <span className="mono" style={{ color: 'var(--red)' }}>− {fmt(val)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between',
                    padding: '10px 0 0', fontSize: 16, fontWeight: 700 }}>
                    <span>Amount to Pay</span>
                    <span className="mono">{fmt(amountToPay)}</span>
                  </div>
                </div>
              )}
            </div>
            {/* ── SalesPro Status ── */}
            <SalesproStatusCard
              paymentRef={voucher.payment_reference || null}
              supplierName={voucher.supplier_name || ''}
              voucherId={voucher.id}
              editing={editing}
              onStatusSynced={() => fetchVoucher()}
            />

          </div>

          {/* ── Right Panel ── */}
          <div>

            {/* Assign */}
            {canAssign && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><div className="card-title">Assign to Manager</div></div>
                <div className="card-body">
                  {/* {supplierInfo?.manager_name && (
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
                      💡 Supplier's manager: <strong>{supplierInfo.manager_name}</strong>
                    </div>
                  )} */}
                  <div className="form-group">
                    <label>Manager</label>
                    <select value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                      <option value="">Select manager…</option>
                      {managers.filter(m => m.role === 'manager').map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name}{supplierInfo?.owned_by === m.id ? ' ★' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                    onClick={handleAssign}
                    disabled={!assignTo || assignTo === voucher.assigned_to}>
                    {voucher.assigned_to && assignTo === voucher.assigned_to ? 'Already Assigned' : 'Assign'}
                  </button>
                </div>
              </div>
            )}

            {/* Manager action */}
            {canManagerAct && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><div className="card-title">Approval</div></div>
                <div className="card-body">
                  {!showReject ? (
                    <>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-green" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleManagerAction('approve')}>✓ Approve</button>
                        <button className="btn btn-red"   style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowReject(true)}>✕ Reject</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="form-group">
                        <label>Rejection reason *</label>
                        <textarea rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Explain why…" />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-red" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleManagerAction('reject')}>Confirm Reject</button>
                        <button className="btn" onClick={() => setShowReject(false)}>Cancel</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Approver verification — visible to approver when manager has approved */}
            {canApproverVerify && (
              <div className="card" style={{ marginBottom: 16, borderColor: '#93c5fd' }}>
                <div className="card-head" style={{ background: '#eff6ff' }}>
                  <div className="card-title" style={{ color: '#1d4ed8' }}>Verification</div>
                </div>
                <div className="card-body">
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
                    Manager has approved this voucher. Verify and move it to Ready For Bank.
                  </div>
                  {!showFinalReject ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-green" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleApproverVerify('approve')}>✓ Verify & Ready For Bank</button>
                      <button className="btn btn-red"   style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowFinalReject(true)}>✕ Reject</button>
                    </div>
                  ) : (
                    <>
                      <div className="form-group">
                        <label>Rejection reason *</label>
                        <textarea rows={3} value={finalRejectReason} onChange={e => setFinalRejectReason(e.target.value)} placeholder="Explain why…" />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-red" style={{ flex: 1, justifyContent: 'center' }}
                          disabled={!finalRejectReason.trim()}
                          onClick={() => handleApproverVerify('reject', finalRejectReason)}>Confirm Reject</button>
                        <button className="btn" onClick={() => { setShowFinalReject(false); setFinalRejectReason(''); }}>Cancel</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Approver action — visible to approver on exported vouchers */}
            {canApproverApprove && (
              <div className="card" style={{ marginBottom: 16, borderColor: '#B8AEED' }}>
                <div className="card-head" style={{ background: 'var(--purple-l)' }}>
                  <div className="card-title" style={{ color: 'var(--purple)' }}>Approval</div>
                </div>
                <div className="card-body">
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
                    Payment has been exported to the bank. Review and approve this voucher.
                  </div>
                  {!showFinalReject ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-green" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleFinalApproval('approve')}>✓ Approve</button>
                      <button className="btn btn-red"   style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowFinalReject(true)}>✕ Reject</button>
                    </div>
                  ) : (
                    <>
                      <div className="form-group">
                        <label>Rejection reason *</label>
                        <textarea rows={3} value={finalRejectReason} onChange={e => setFinalRejectReason(e.target.value)} placeholder="Explain why…" />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-red" style={{ flex: 1, justifyContent: 'center' }}
                          disabled={!finalRejectReason.trim()}
                          onClick={() => handleFinalApproval('reject', finalRejectReason)}>Confirm Reject</button>
                        <button className="btn" onClick={() => { setShowFinalReject(false); setFinalRejectReason(''); }}>Cancel</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* UTR entry — visible to executive/admin on approved vouchers without UTR */}
            {canEnterUTR && (
              <div className="card" style={{ marginBottom: 16, borderColor: '#86efac' }}>
                <div className="card-head" style={{ background: '#f0faf4' }}>
                  <div className="card-title" style={{ color: 'var(--green)' }}>Enter UTR Number</div>
                </div>
                <div className="card-body">
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
                    Voucher approved. Enter the bank UTR number to enable PDF generation.
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input style={{ flex: 1 }} placeholder="UTR / Transaction Ref No."
                      value={utrInput} onChange={e => setUtrInput(e.target.value)} />
                    <button className="btn btn-green" onClick={handleSaveUtr} disabled={savingUtr || !utrInput.trim()}>
                      {savingUtr ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* UTR display — once UTR is set on approved voucher */}
            {['approved', 'downloaded'].includes(voucher.status) && voucher.utr_no && (
              <div className="card" style={{ marginBottom: 16, borderColor: '#86efac' }}>
                <div className="card-head" style={{ background: '#f0faf4' }}>
                  <div className="card-title" style={{ color: 'var(--green)' }}>UTR Number</div>
                </div>
                <div className="card-body">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ color: 'var(--green)', fontSize: 16 }}>✓</span>
                    <strong style={{ fontFamily: 'monospace' }}>{voucher.utr_no}</strong>
                  </div>
                </div>
              </div>
            )}

            {/* Rejected */}
            {voucher.status === 'rejected' && (
              <div className="card" style={{ marginBottom: 16, borderColor: '#f09595' }}>
                <div className="card-head" style={{ background: 'var(--red-l)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div className="card-title" style={{ color: 'var(--red)' }}>Rejected</div>
                  {isAdmin && (
                    <button
                      className="btn btn-sm"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={async () => {
                        if (!window.confirm('Reopen this voucher and reset it to Draft?')) return;
                        try {
                          await api.post(`/vouchers/${id}/reopen`);
                          toast.success('Voucher reopened');
                          fetchVoucher();
                        } catch (err) { toast.error(err.response?.data?.error || 'Failed to reopen'); }
                      }}
                    >↩ Reopen</button>
                  )}
                </div>
                {voucher.rejected_reason && (
                  <div className="card-body" style={{ fontSize: 13, color: 'var(--red)' }}>
                    {voucher.rejected_reason}
                  </div>
                )}
              </div>
            )}

            {/* Balance Vouchers — shows linked children + settlement summary */}
            {Array.isArray(voucher.balance_vouchers) && voucher.balance_vouchers.length > 0 && (
              <div className="card" style={{ marginBottom: 16}}>
                <div className="card-head"><div className="card-title">Balance Vouchers</div></div>
                <div className="card-body" style={{ padding: '10px 16px' }}>
                  {voucher.balance_vouchers.map(bv => {
                    const paid = !!bv.utr_no;
                    return (
                      <div key={bv.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <a href={`/${user.role}/vouchers/${bv.id}`} style={{ color: 'var(--primary)', fontWeight: 600 }}>
                              {bv.voucher_no || bv.id.slice(0, 8)}
                            </a>
                            {/* <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                              background: paid ? '#dcfce7' : '#fef9c3',
                              color:      paid ? '#166534' : '#92400e' }}>
                              {paid ? `Paid · UTR ${bv.utr_no}` : 'Payment Pending'}
                            </span> */}
                            {bv.has_further_split && (
                              <span style={{ fontSize: 11, color: 'var(--text3)' }}>↳ has further split</span>
                            )}
                          </span>
                          <span className="mono">{fmt(parseFloat(bv.total_amount) || 0)}</span>
                        </div>
                      </div>
                    );
                  })}
                  {/* Settlement summary */}
                  {(() => {
                    const balanceSplit   = voucher.balance_vouchers.reduce((s, bv) => s + (parseFloat(bv.total_amount) || 0), 0);
                    const originalTotal  = parseFloat(voucher.total_amount) || 0;
                    const netPayable     = originalTotal - balanceSplit;
                    return (
                      <div style={{ marginTop: 10, padding: '8px 0', fontSize: 13 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text2)', marginBottom: 4 }}>
                          <span>Original Invoice Total</span>
                          <span className="mono">{fmt(originalTotal)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--red)', marginBottom: 4 }}>
                          <span>Balance Split ({voucher.balance_vouchers.length} voucher{voucher.balance_vouchers.length > 1 ? 's' : ''})</span>
                          <span className="mono">− {fmt(balanceSplit)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700,
                          borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                          <span>Net Payable (This Voucher)</span>
                          <span className="mono">{fmt(netPayable)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Source voucher link — shown on balance voucher side */}
            {voucher.source_voucher_id && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><div className="card-title">Split From</div></div>
                <div className="card-body" style={{ fontSize: 13, padding: '10px 16px' }}>
                  This is a balance voucher split from{' '}
                  <a href={`/${user.role}/vouchers/${voucher.source_voucher_id}`} style={{ color: 'var(--primary)', fontWeight: 700 }}>
                    source voucher
                  </a>.
                </div>
              </div>
            )}

             {/* Comments */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><div className="card-title">Comments</div></div>
              <div className="card-body">
                {comments.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>No comments yet</div>}
                {comments.map(c => (
                  <div key={c.id} style={{ marginBottom: 10, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>
                      <strong>{c.user_name}</strong> · {c.role} · {fmtDate(c.created_at)}
                    </div>
                    <div style={{ fontSize: 13 }}>{c.comment}</div>
                  </div>
                ))}
                <div style={{ marginTop: 8 }}>
                  <textarea rows={2} value={comment} onChange={e => setComment(e.target.value)}
                    placeholder="Add a comment…"
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8,
                      padding: '7px 10px', fontSize: 13, background: 'var(--bg)',
                      color: 'var(--text)', resize: 'vertical', outline: 'none' }} />
                  <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={handleAddComment}>Post comment</button>
                </div>
              </div>
            </div>

            {/* Activity Log */}
            {activityLog.length > 0 && (
              <div className="card">
                <div className="card-head"><div className="card-title">Activity Log</div></div>
                <div className="card-body" style={{ padding: '8px 16px' }}>
                  <div style={{ position: 'relative', paddingLeft: 24 }}>
                    <div style={{ position: 'absolute', left: 7, top: 0, bottom: 0,
                      width: 2, background: 'var(--border)' }} />
                    {activityLog.map(a => (
                      <div key={a.id} style={{ position: 'relative', marginBottom: 14 }}>
                        <div style={{
                          position: 'absolute', left: -21, top: 4,
                          width: 10, height: 10, borderRadius: '50%',
                          background: 'var(--primary)', border: '2px solid var(--primary)',
                        }} />
                        <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                          <span style={{ fontWeight: 600 }}>{a.user_name || 'System'}</span>
                          <span style={{ color: 'var(--text3)', margin: '0 6px' }}>·</span>
                          <span>{a.description}</span>
                          <span style={{ color: 'var(--text3)', marginLeft: 8, fontSize: 11 }}>{fmtDate(a.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

           
          </div>
        </div>
      </div>

      {/* ── Email Modal ── */}
      {showEmailModal && (
        <EmailModal
          voucherId={id}
          onClose={() => setShowEmailModal(false)}
          onSent={() => { setShowEmailModal(false); fetchVoucher(); }}
        />
      )}

      {/* ── File Viewer Modal ── */}
      {viewer && (
        <div onClick={() => { URL.revokeObjectURL(viewer.url); setViewer(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.82)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {/* toolbar */}
          <div onClick={e => e.stopPropagation()}
            style={{ width: '90vw', maxWidth: 900, display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', padding: '10px 14px',
              background: '#1c1a15', borderRadius: '10px 10px 0 0' }}>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>{viewer.name}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <a href={viewer.url} download={viewer.name}
                style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, padding: '4px 10px',
                  border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, textDecoration: 'none' }}>
                ⬇ Download
              </a>
              <button onClick={() => { URL.revokeObjectURL(viewer.url); setViewer(null); }}
                style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
                  width: 28, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
          </div>
          {/* content */}
          <div onClick={e => e.stopPropagation()}
            style={{ width: '90vw', maxWidth: 900, height: '80vh', background: '#fff',
              borderRadius: '0 0 10px 10px', overflow: 'hidden' }}>
            {viewer.mimeType === 'application/pdf' ? (
              <iframe src={viewer.url} style={{ width: '100%', height: '100%', border: 'none' }} title="File" />
            ) : (
              <div style={{ width: '100%', height: '100%', background: '#f0ede6',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'auto', padding: 16 }}>
                <img src={viewer.url} alt="Attachment"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
    </Layout>
  );
}
