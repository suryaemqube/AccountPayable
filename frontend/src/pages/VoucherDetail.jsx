import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import { StatusBadge, PaymentBadge, fmt, fmtDate, fmtDateTime, isAndroid } from '../components/Helpers';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { SalesproStatusCard } from '../components/SalesproStatus';
import EmailModal from '../components/EmailModal';
import { VS } from '../constants/voucherStatus';
import { validateAttachmentFiles, ALLOWED_ATTACHMENT_EXTENSIONS, MAX_ATTACHMENT_SIZE_MB } from '../constants/upload';

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
  const [assigning, setAssigning] = useState(false);
  const [rejectReason, setRejectReason]           = useState('');
  const [showReject, setShowReject]               = useState(false);
  const [showFinalReject, setShowFinalReject]     = useState(false);
  const [finalRejectReason, setFinalRejectReason] = useState('');
  const [utrInput, setUtrInput]                   = useState('');
  const [savingUtr, setSavingUtr]                 = useState(false);
  const [showUtrModal, setShowUtrModal]           = useState(false);
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [viewer, setViewer]       = useState(null); // { url, mimeType, name }
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [billAttachments, setBillAttachments] = useState([]);
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
      if (r.data.voucher.bill_id) {
        api.get(`/bills/${r.data.voucher.bill_id}/attachments`)
          .then(br => setBillAttachments(br.data.attachments || []))
          .catch(() => {});
      }
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
      const payload = { narration: form.narration, amount: form.amount ? Number(form.amount) : undefined, payment_mode: form.payment_mode || null, due_days: form.due_days !== '' && form.due_days != null ? Number(form.due_days) : null };

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

  async function handleDelete() {
    if (!window.confirm(`Delete voucher ${voucher.voucher_no || id}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/vouchers/${id}`);
      toast.success('Voucher deleted');
      const roleBase = `/${user.role === 'executive' ? 'executive' : 'admin'}`;
      nav(`${roleBase}/vouchers`, { replace: true });
    } catch (err) { toast.error(err.response?.data?.error || 'Delete failed'); }
    finally { setDeleting(false); }
  }

  async function handleAssign() {
    if (!assignTo) return toast.error('Select a manager or approver');
    setAssigning(true);
    try {
      const r = await api.post(`/vouchers/${id}/assign`, { manager_id: assignTo });
      if (r.data.due_today_mail === 'sent') {
        toast.success('Voucher assigned — due-today email sent');
      } else if (r.data.due_today_mail === 'failed') {
        toast.error('Voucher assigned, but the due-today email failed to send — check Activity Log');
      } else {
        toast.success('Voucher assigned');
      }
      await fetchVoucher();
    } catch (err) { toast.error(err.response?.data?.error || 'Assign failed'); }
    finally { setAssigning(false); }
  }

  async function handleManagerAction(action) {
    if (action === 'reject' && !rejectReason) return toast.error('Please provide rejection reason');
    try {
      await api.post(`/vouchers/${id}/manager-action`, {
        action, comment: action === 'reject' ? rejectReason : comment, rejected_reason: rejectReason,
      });
      toast.success(action === 'approve' ? 'Approved by manager' : 'Voucher rejected');
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
      toast.success(action === 'approve' ? 'Voucher ready to remit. Executive can now enter UTR and generate PDF.' : 'Voucher rejected.');
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
      toast.success(action === 'approve' ? 'Reviewed — Exported to bank' : 'Voucher rejected.');
      fetchVoucher();
      setComment('');
      setFinalRejectReason('');
      setShowFinalReject(false);
    } catch (err) { toast.error(err.response?.data?.error || 'Action failed'); }
  }

  async function handleSaveUtr(andSend = false) {
    if (!utrInput.trim()) return toast.error('Enter UTR number');
    setSavingUtr(true);
    try {
      await api.post(`/vouchers/${id}/utr`, { utr_no: utrInput.trim() });
      toast.success('UTR saved — voucher marked as Paid');
      setUtrInput('');
      setShowUtrModal(false);
      await fetchVoucher();
      if (andSend) setShowEmailModal(true);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save UTR'); }
    finally { setSavingUtr(false); }
  }

  async function handlePreviewPdf() {
    setPdfLoading(true);
    try {
      if (!voucher.voucher_pdf_path) {
        await api.post(`/vouchers/${id}/generate`);
        await fetchVoucher();
      }
      const r = await api.get(`/vouchers/${id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const name = voucher.voucher_no ? `voucher-${voucher.voucher_no.replace(/\//g, '-')}.pdf` : `voucher-${id.slice(0, 8)}.pdf`;
      setViewer({ url, mimeType: 'application/pdf', name });
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to load PDF'); }
    finally { setPdfLoading(false); }
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
    const { valid, errors } = validateAttachmentFiles(Array.from(files));
    if (errors.length) errors.forEach(e => toast.error(e));
    if (!valid.length) return;
    setUploading(true);
    const fd = new FormData();
    for (const f of valid) fd.append('files', f);
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

  async function openBillAttachment(att, billId) {
    try {
      const r = await api.get(`/bills/${billId}/attachments/${att.id}`, { responseType: 'blob' });
      const mimeType = r.headers['content-type'] || att.mime_type || 'application/octet-stream';
      const url = URL.createObjectURL(new Blob([r.data], { type: mimeType }));
      setViewer({ url, mimeType, name: att.original_name });
    } catch { toast.error('Could not open file'); }
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
  const isApprover    = user.role === 'approver';
  const canEdit        = (isAdmin || isExecutive || isApprover) && [VS.DRAFT, VS.ASSIGNED].includes(voucher.status);
  const canAssign      = (isAdmin || isExecutive) && [VS.DRAFT, VS.ASSIGNED].includes(voucher.status);
  const canDelete        = (isAdmin) && ![VS.READY_TO_REMIT, VS.PAID].includes(voucher.status);
  const canManagerAct  = ['manager', 'approver'].includes(user.role) && voucher.status === VS.ASSIGNED && voucher.assigned_to === user.id;
  const canApproverVerify  = user.role === 'approver' && voucher.status === VS.APPROVED;
  const canApproverApprove = user.role === 'approver' && voucher.status === VS.EXPORTED;
  const canGenerate        = (isAdmin || isExecutive || isApprover) && [VS.READY_TO_REMIT, VS.PAID].includes(voucher.status) && !!voucher.utr_no;
  const canEnterUTR        = (isAdmin || isExecutive) && voucher.status === VS.READY_TO_REMIT && !voucher.utr_no;

  // Financial values: if bill-based voucher, pull from bill; else from form/voucher
  const hasBill = !!voucher.bill_id;
  const src = editing ? form : voucher;
  const taxable  = parseFloat(hasBill ? voucher.bill_taxable_amount : src.taxable_amount) || 0;
  const cgst     = parseFloat(hasBill ? voucher.bill_cgst           : src.cgst)           || 0;
  const sgst     = parseFloat(hasBill ? voucher.bill_sgst           : src.sgst)           || 0;
  const igst     = parseFloat(hasBill ? voucher.bill_igst           : src.igst)           || 0;
  const tds      = parseFloat(hasBill ? voucher.bill_tds_amount     : src.tds_amount)     || 0;
  const creditNote  = hasBill ? (parseFloat(voucher.bill_credit_note_amount) || 0) : 0;
  const grossTotal  = taxable + cgst + sgst + igst;
  const netPayable  = grossTotal - tds - creditNote;
  // For bill-based vouchers, amount to pay is the voucher's specific amount
  const amountToPay = hasBill
    ? (parseFloat(voucher.amount) || 0)
    : netPayable - balance - balanceSplit;

  const gstin = supplierInfo?.gstin || voucher.supplier_gstin || '';

  return (
    <Layout><>
      <div style={{ padding: 28, maxWidth: 980 }}>

        {/* ── Bill link banner ── */}
        {hasBill && voucher.bill_no && (
          <div style={{ background: '#e8f4fd', borderRadius: 8, padding: '8px 14px', marginBottom: 14, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#555' }}>Bill:</span>
            <button onClick={() => nav(`/${user?.role === 'admin' ? 'admin' : 'executive'}/bills/${voucher.bill_id}`)}
              style={{ background: 'none', border: 'none', color: '#0d6efd', cursor: 'pointer', fontWeight: 600, fontSize: 13, padding: 0 }}>
              {voucher.bill_no}
            </button>
            {voucher.bill_ref_no && <span style={{ color: '#888' }}>· Invoice Ref: {voucher.bill_ref_no}</span>}
            {voucher.bill_status && (
              <span style={{ marginLeft: 4, background: voucher.bill_status === 'fully_paid' ? '#d1e7dd' : voucher.bill_status === 'partially_paid' ? '#cff4fc' : '#fff3cd', color: voucher.bill_status === 'fully_paid' ? '#0a3622' : voucher.bill_status === 'partially_paid' ? '#055160' : '#856404', borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                {voucher.bill_status === 'fully_paid' ? 'Fully Paid' : voucher.bill_status === 'partially_paid' ? 'Partially Paid' : 'Open'}
              </span>
            )}
          </div>
        )}

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
          <button className="btn btn-sm" onClick={() => nav(-1)}>← Back</button>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h1 style={{ fontSize: 20, fontWeight: 600 }}>{isNew ? 'New Voucher' : `Voucher - ${voucher.voucher_no}`}</h1>
              <StatusBadge status={voucher.status} />
              {(voucher.tally_vch_no || voucher.bill_no) && (
                <span style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', padding: '2px 8px', borderRadius: 99 }}>
                  Vch #{voucher.tally_vch_no || voucher.bill_no}
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
            {isAdmin && !editing && canDelete && (
              <button className="btn" onClick={handleDelete} disabled={deleting}
                style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
            {editing && (
              <>
                <button className="btn btn-green" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                <button className="btn" onClick={() => isNew ? nav(-1) : (() => { setEditing(false); setForm(voucher); })()}>Cancel</button>
              </>
            )}
            {canGenerate && (
              <button className="btn btn-green" onClick={handlePreviewPdf} disabled={pdfLoading}>
                {pdfLoading
                  ? <><span className="pdf-spinner" /> {voucher.voucher_pdf_path ? 'Loading PDF…' : 'Generating…'}</>
                  : <>📄 {voucher.voucher_pdf_path ? 'Preview PDF' : 'Generate & Preview'}</>}
              </button>
            )}
            {/* {canGenerate && voucher.voucher_pdf_path && (
              <button className="btn" style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}
                disabled={pdfLoading}
                onClick={async () => {
                  setPdfLoading(true);
                  try {
                    await api.post(`/vouchers/${id}/generate`);
                    await fetchVoucher();
                    toast.success('PDF regenerated');
                  } catch (err) { toast.error(err.response?.data?.error || 'Regenerate failed'); }
                  finally { setPdfLoading(false); }
                }}>
                {pdfLoading ? <><span className="pdf-spinner" /> Regenerating…</> : '↺ Regenerate'}
              </button>
            )} */}
            {/* {canGenerate && (
              <button className="btn" style={{ background: '#fefce8', color: '#854d0e', border: '1px solid #fde68a' }}
                onClick={() => window.open(`/api/vouchers/${voucher.id}/preview-html?token=${localStorage.getItem('token')}`, '_blank')}>
                🧪 Preview HTML
              </button>
            )} */}
            {(isAdmin || isExecutive) && [VS.READY_TO_REMIT, VS.PAID].includes(voucher.status) && voucher.utr_no && (
              <button className="btn" style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}
                onClick={() => setShowEmailModal(true)}>
                ✉ Send Payment Advice
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
                  <input ref={fileInputRef} type="file" multiple accept={ALLOWED_ATTACHMENT_EXTENSIONS.join(',')}
                    style={{ display: 'none' }}
                    onChange={e => handleFileUpload(Array.from(e.target.files))} />
                </div>
              </div>
              <div className="card-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
                {/* Bill attachments (read-only) */}
                {billAttachments.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, padding: '4px 0 6px' }}>From Bill</div>
                    {billAttachments.map(att => (
                      <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 18 }}><FileIcon mime={att.mime_type} /></span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.original_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                            {att.uploaded_by_name} · {fmtDate(att.created_at)}
                            {att.file_size && ` · ${(att.file_size / 1024).toFixed(0)} KB`}
                          </div>
                        </div>
                        <button className="btn btn-sm" onClick={() => openBillAttachment(att, voucher.bill_id)}>View</button>
                      </div>
                    ))}
                    {attachments.length > 0 && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, padding: '10px 0 6px' }}>Voucher Files</div>
                    )}
                  </>
                )}
                {/* Voucher attachments */}
                {attachments.length === 0 && billAttachments.length === 0 && (
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
                    <div className="form-group">
                      <label>Payment Mode</label>
                      <select value={form.payment_mode || ''} onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))}>
                        <option value=''>— Select —</option>
                        <option value='NEFT'>NEFT</option>
                        <option value='RTGS'>RTGS</option>
                        <option value='FT'>FT</option>
                        <option value="CHEQUE">CHEQUE</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Credit Days</label>
                      <input type="number" min="0" value={form.due_days ?? ''} placeholder={`Default: ${voucher.bill_due_days ?? '—'} (from bill)`}
                        onChange={e => setForm(f => ({ ...f, due_days: e.target.value }))} />
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
                    const approvedStatuses = ['approved', 'ready_to_remit', 'exported', 'downloaded', 'paid'];
                    if (approvedStatuses.includes(voucher.status)) return null;
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
                      ['Supplier',        voucher.supplier_name],
                      ['GSTIN',           gstin],
                      ['Invoice Date',    fmtDate(voucher.bill_invoice_date)],
                      ['Invoice Ref No.', voucher.bill_ref_no],
                      ['Bill No.',        voucher.bill_no],
                      ['Purchase Type',   voucher.bill_purchase_type_label],
                      ['Account Name',    voucher.bill_purchase_type_code === 'PROJECT' ? voucher.bill_salespro_act_name : null],
                      ['Due Days',        (voucher.due_days ?? voucher.bill_due_days) != null ? `${voucher.due_days ?? voucher.bill_due_days} days` : null],
                      ['Due Date',        voucher.due_date ? fmtDate(voucher.due_date) : null],
                      ['Assigned Date',   voucher.assigned_at ? fmtDate(voucher.assigned_at) : null],
                      [voucher.bill_purchase_type_code === 'CONSUME' ? 'State' : 'Payment Ref.', voucher.bill_payment_reference],
                    ].map(([l, v]) => v ? (
                      <div key={l}>
                        <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>{l}</div>
                        <div style={{ fontWeight: 500 }}>{v}</div>
                      </div>
                    ) : null)}
                    {voucher.payment_mode && (
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>Payment Mode</div>
                        <div style={{ fontWeight: 600 }}>{voucher.payment_mode}</div>
                      </div>
                    )}
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
                  <div className="form-group">
                    <label>Payment Amount</label>
                    <input type="number" step="0.01" value={form.amount || ''}
                      onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                  </div>
                </div>
              ) : (
                <div style={{ padding: '4px 18px 16px' }}>
                  {hasBill && [
                    taxable > 0 && ['Taxable Amount', taxable],
                    cgst > 0    && ['CGST',            cgst],
                    sgst > 0    && ['SGST',            sgst],
                    igst > 0    && ['IGST',            igst],
                  ].filter(Boolean).map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
                      padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                      <span style={{ color: 'var(--text2)' }}>{label}</span>
                      <span className="mono">{fmt(val)}</span>
                    </div>
                  ))}
                  {hasBill && grossTotal > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                      padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
                      <span style={{ color: 'var(--text2)' }}>Gross Total</span>
                      <span className="mono">{fmt(grossTotal)}</span>
                    </div>
                  )}
                  {hasBill && tds > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                      padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                      <span style={{ color: 'var(--text2)' }}>TDS Deducted</span>
                      <span className="mono" style={{ color: 'var(--red)' }}>− {fmt(tds)}</span>
                    </div>
                  )}
                  {hasBill && creditNote > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                      padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                      <span style={{ color: 'var(--text2)' }}>Credit Note</span>
                      <span className="mono" style={{ color: 'var(--red)' }}>− {fmt(creditNote)}</span>
                    </div>
                  )}
                  {hasBill && (
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                      padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
                      <span style={{ color: 'var(--text2)' }}>Net Payable (Bill)</span>
                      <span className="mono">{fmt(netPayable)}</span>
                    </div>
                  )}
                  {/* This voucher's amount */}
                  <div style={{ display: 'flex', justifyContent: 'space-between',
                    padding: '10px 0 6px', fontSize: 15, fontWeight: 700 }}>
                    <span>This Voucher</span>
                    <span className="mono">{fmt(amountToPay)}</span>
                  </div>
                  {hasBill && (() => {
                    const allocated = parseFloat(voucher.bill_allocated_amount) || 0;
                    const remaining = netPayable - allocated;
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between',
                          padding: '5px 0', fontSize: 12, color: 'var(--text3)' }}>
                          <span>Total Vouchers Raised</span>
                          <span className="mono">{fmt(allocated)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between',
                          padding: '5px 0 0', fontSize: 13, fontWeight: 600,
                          color: remaining > 0.01 ? '#b45309' : 'var(--green)' }}>
                          <span>{remaining > 0.01 ? '⚠ Balance Remaining' : '✓ Fully Allocated'}</span>
                          <span className="mono">{remaining > 0.01 ? fmt(remaining) : fmt(0)}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
            {/* ── SalesPro Status (hidden for Consume purchase type — Cost Centre is a State, not a SalesPro ref) ── */}
            {voucher.bill_purchase_type_code !== 'CONSUME' && (
              <SalesproStatusCard
                paymentRef={voucher.bill_payment_reference || null}
                supplierName={voucher.supplier_name || ''}
                voucherId={voucher.id}
                editing={editing}
                paymentStatus={voucher.payment_status}
                onStatusSynced={() => fetchVoucher()}
              />
            )}

          </div>

          {/* ── Right Panel ── */}
          <div>

            {/* Assign */}
            {canAssign && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><div className="card-title">Assign to Manager / Approver</div></div>
                <div className="card-body">
                  {/* {supplierInfo?.manager_name && (
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
                      💡 Supplier's manager: <strong>{supplierInfo.manager_name}</strong>
                    </div>
                  )} */}
                  <div className="form-group">
                    <label>Manager / Approver</label>
                    <select value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                      <option value="">Select manager or approver…</option>
                      {managers.filter(m => m.role === 'manager' || m.role === 'approver').map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name}{m.role === 'approver' ? ' (Approver)' : ''}{supplierInfo?.owned_by === m.id ? ' ★' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                    onClick={handleAssign}
                    disabled={!assignTo || assignTo === voucher.assigned_to || assigning}>
                    {assigning ? 'Assigning…' : voucher.assigned_to && assignTo === voucher.assigned_to ? 'Already Assigned' : 'Assign'}
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
                      <button className="btn btn-green" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleApproverVerify('approve')}>✓ Verify</button>
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
                    <button className="btn btn-green" onClick={() => { if (!utrInput.trim()) { toast.error('Enter UTR number'); return; } setShowUtrModal(true); }} disabled={savingUtr}>
                      Submit
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* UTR display — once UTR is set on approved voucher */}
            {[VS.READY_TO_REMIT, VS.PAID].includes(voucher.status) && voucher.utr_no && (
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
            {voucher.status === VS.REJECTED && (
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
                          <span style={{ color: 'var(--text3)', marginLeft: 8, fontSize: 11 }}>{fmtDateTime(a.created_at)}</span>
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

      {/* ── UTR Confirm Modal ── */}
      {showUtrModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Confirm UTR Submission</h3>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 20px' }}>
              UTR: <strong style={{ fontFamily: 'monospace' }}>{utrInput}</strong>
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowUtrModal(false)} disabled={savingUtr}>Cancel</button>
              <button className="btn btn-green" onClick={() => handleSaveUtr(false)} disabled={savingUtr}>
                {savingUtr ? 'Saving…' : 'Save'}
              </button>
              <button className="btn" style={{ background: '#0d6efd', color: '#fff', border: 'none' }} onClick={() => handleSaveUtr(true)} disabled={savingUtr}>
                {savingUtr ? 'Saving…' : 'Save & Send'}
              </button>
            </div>
          </div>
        </div>
      )}

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
              isAndroid() ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text3)' }}>
                  <div style={{ fontSize: 40 }}>📄</div>
                  <div>{viewer.name}</div>
                  <a href={viewer.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">Open PDF</a>
                </div>
              ) : (
                <iframe src={viewer.url} style={{ width: '100%', height: '100%', border: 'none' }} title="File" />
              )
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
