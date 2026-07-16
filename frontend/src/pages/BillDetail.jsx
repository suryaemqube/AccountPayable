import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { fmt, fmtDate, toDateInputValue, isAndroid } from '../components/Helpers';
import api from '../api/client';
import toast from 'react-hot-toast';
import { validateAttachmentFiles, ALLOWED_ATTACHMENT_EXTENSIONS, MAX_ATTACHMENT_SIZE_MB } from '../constants/upload';
import { AccountSearchField } from '../components/SalesproStatus';

function AttachmentPreviewModal({ billId, attachment, onClose }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const name  = attachment.original_name || '';
  const isPdf = /\.pdf$/i.test(name);
  const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);

  useEffect(() => {
    let objectUrl;
    api.get(`/bills/${billId}/attachments/${attachment.id}`, { responseType: 'blob' })
      .then(r => { objectUrl = URL.createObjectURL(r.data); setBlobUrl(objectUrl); })
      .catch(() => setError('Could not load file'))
      .finally(() => setLoading(false));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [billId, attachment.id]);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:10, overflow:'hidden', width:'min(90vw,860px)', maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 8px 40px rgba(0,0,0,0.4)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid #dee2e6', flexShrink:0 }}>
          <span style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
          <button onClick={onClose} style={{ background:'none', border:'1px solid #dee2e6', borderRadius:5, padding:'3px 12px', cursor:'pointer', fontSize:13 }}>✕ Close</button>
        </div>
        <div style={{ flex:1, overflow:'auto', minHeight:300, display:'flex', alignItems:'center', justifyContent:'center' }}>
          {loading && <div style={{ color:'#888', padding:40 }}>Loading…</div>}
          {error   && <div style={{ color:'#dc3545', padding:40 }}>{error}</div>}
          {blobUrl && (isPdf ? (
            isAndroid() ? (
              <div style={{ padding:40, textAlign:'center', color:'#888' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>📄</div>
                <div style={{ marginBottom:12 }}>{name}</div>
                <a href={blobUrl} target="_blank" rel="noopener noreferrer" style={{ background:'#0d6efd', color:'#fff', padding:'8px 18px', borderRadius:6, textDecoration:'none', fontWeight:600 }}>Open PDF</a>
              </div>
            ) : (
              <iframe src={blobUrl} style={{ width:'100%', height:'75vh', border:'none' }} title={name} />
            )
          ) : isImg ? (
            <img src={blobUrl} alt={name} style={{ maxWidth:'100%', display:'block', margin:'0 auto' }} />
          ) : (
            <div style={{ padding:40, textAlign:'center', color:'#888' }}>
              <div style={{ fontSize:40, marginBottom:12 }}>📄</div>
              <div style={{ marginBottom:12 }}>{name}</div>
              <a href={blobUrl} download={name} style={{ background:'#0d6efd', color:'#fff', padding:'8px 18px', borderRadius:6, textDecoration:'none', fontWeight:600 }}>Download</a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#212529', marginTop: 2 }}>{value || '—'}</div>
    </div>
  );
}

const VOUCHER_STATUS_COLORS = {
  draft:          { background: '#f8f9fa', color: '#495057' },
  assigned:       { background: '#fff3cd', color: '#856404' },
  verification:   { background: '#cff4fc', color: '#055160' },
  ready_for_bank: { background: '#d1ecf1', color: '#0c5460' },
  proceed:        { background: '#d4edda', color: '#155724' },
  approved:       { background: '#d4edda', color: '#155724' },
  rejected:       { background: '#f8d7da', color: '#721c24' },
  downloaded:     { background: '#e2e3e5', color: '#383d41' },
  paid:           { background: '#e2e3e5', color: '#2a2d30' },
};

export default function BillDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const isNew = id === 'new';

  const basePath = user?.role === 'admin' ? '/admin' : user?.role === 'approver' ? '/approver' : '/executive';
  const voucherBase = basePath;

  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [suppliers, setSuppliers] = useState([]);
  const [banks, setBanks] = useState([]);
  const [supplierBanks, setSupplierBanks] = useState([]);
  const [states, setStates] = useState([]);

  // Form state for new/edit bill
  const [form, setForm] = useState({
    supplier_id: '', invoice_date: '', bill_ref_no: '', bill_date: '',
    taxable_amount: '', cgst: '', sgst: '', igst: '', tds_amount: '',
    narration: '', payment_reference: '', tally_vch_no: '', due_days: '',
    purchase_type_code: '', company_bank_id: '',
    salespro_act_id: '', salespro_act_name: '',
    credit_note_amount: '',
  });
  const [editMode, setEditMode] = useState(isNew || searchParams.get('edit') === '1');
  const [saving, setSaving] = useState(false);

  // Create voucher modal
  const [showVoucherModal, setShowVoucherModal] = useState(false);
  const [voucherForm, setVoucherForm] = useState({ amount: '', narration: '', supplier_bank_id: '', due_days: '', salespro_account_name: '' });
  const [creatingVoucher, setCreatingVoucher] = useState(false);

  // Attachments
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const attachRef = useRef();

  const token = localStorage.getItem('token');
  const authH = { Authorization: `Bearer ${token}` };

  async function fetchBill() {
    try {
      const res = await fetch(`/api/bills/${id}`, { headers: authH });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to load bill'); return; }
      setBill(data.bill);
      setForm({
        supplier_id:        data.bill.supplier_id || '',
        invoice_date:       toDateInputValue(data.bill.invoice_date),
        bill_ref_no:        data.bill.bill_ref_no || '',
        bill_date:          toDateInputValue(data.bill.bill_date),
        taxable_amount:     data.bill.taxable_amount ?? '',
        cgst:               data.bill.cgst ?? '',
        sgst:               data.bill.sgst ?? '',
        igst:               data.bill.igst ?? '',
        tds_amount:         data.bill.tds_amount ?? '',
        narration:          data.bill.narration || '',
        payment_reference:  data.bill.payment_reference || '',
        tally_vch_no:       data.bill.tally_vch_no || '',
        due_days:           data.bill.due_days ?? '',
        purchase_type_code: data.bill.purchase_type_code || '',
        company_bank_id:    data.bill.company_bank_id || '',
        salespro_act_id:    data.bill.salespro_act_id || '',
        salespro_act_name:  data.bill.salespro_act_name || '',
        credit_note_amount: data.bill.credit_note_amount ?? '',
      });
    } catch {
      toast.error('Failed to load bill');
    } finally {
      setLoading(false);
    }
  }

  async function fetchMeta() {
    const [sRes, bRes, stRes] = await Promise.all([
      api.get('/suppliers?approved_only=true'),
      api.get('/company'),
      api.get('/parameters/8'), // State/UT
    ]);
    setSuppliers(sRes.data.suppliers || []);
    const allBanks = [];
    for (const co of (bRes.data.companies || [])) {
      for (const bk of (co.banks || [])) {
        allBanks.push({ ...bk, company_name: co.company_name });
      }
    }
    setBanks(allBanks);
    setStates(stRes.data.details || []);
  }

  async function fetchSupplierBanks(supplierId) {
    if (!supplierId) return;
    try {
      const r = await api.get(`/suppliers/${supplierId}`);
      setSupplierBanks(r.data.banks || []);
      // Auto-select primary bank
      const primary = (r.data.banks || []).find(b => b.is_primary) || (r.data.banks || [])[0];
      if (primary) setVoucherForm(f => ({ ...f, supplier_bank_id: primary.id }));
    } catch { /* silent */ }
  }

  async function fetchAttachments() {
    if (isNew) return;
    try {
      const r = await api.get(`/bills/${id}/attachments`);
      setAttachments(r.data.attachments || []);
    } catch { /* silent */ }
  }

  async function handleUploadAttachments(files) {
    if (!files?.length) return;
    const { valid, errors } = validateAttachmentFiles(Array.from(files));
    if (errors.length) errors.forEach(e => toast.error(e));
    if (!valid.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      valid.forEach(f => fd.append('files', f));
      await api.post(`/bills/${id}/attachments`, fd);
      toast.success('Attachment(s) uploaded');
      fetchAttachments();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      if (attachRef.current) attachRef.current.value = '';
    }
  }

  async function handleDeleteAttachment(aid, name) {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await api.delete(`/bills/${id}/attachments/${aid}`);
      toast.success('Attachment deleted');
      setAttachments(a => a.filter(x => x.id !== aid));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    }
  }

  useEffect(() => {
    fetchMeta();
    if (!isNew) { fetchBill(); fetchAttachments(); }
  }, [id]);

  useEffect(() => {
    if (bill?.supplier_id) fetchSupplierBanks(bill.supplier_id);
  }, [bill?.supplier_id]);

  // Auto-select company bank matching the selected purchase type
  useEffect(() => {
    if (!form.purchase_type_code || !banks.length) return;
    const match = banks.find(b => b.purchase_type_code === form.purchase_type_code);
    if (match) setForm(f => ({ ...f, company_bank_id: match.id }));
  }, [form.purchase_type_code, banks]);

  async function handleSave() {
    setSaving(true);
    try {
      const method = isNew ? 'POST' : 'PUT';
      const url    = isNew ? '/api/bills' : `/api/bills/${id}`;
      const res = await fetch(url, {
        method,
        headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          taxable_amount: Number(form.taxable_amount) || 0,
          cgst:           Number(form.cgst)           || 0,
          sgst:           Number(form.sgst)           || 0,
          igst:           Number(form.igst)           || 0,
          tds_amount:     Number(form.tds_amount)     || 0,
          due_days:       form.due_days !== '' && form.due_days != null ? Number(form.due_days) : null,
          credit_note_amount: Number(form.credit_note_amount) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Save failed'); return; }
      toast.success(isNew ? 'Bill created' : 'Bill updated');
      if (isNew) nav(`${basePath}/bills/${data.bill.id}`, { replace: true });
      else { setBill(data.bill); setEditMode(false); }
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteBill() {
    if (!window.confirm(`Delete bill ${bill?.bill_no}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/bills/${id}`, { method: 'DELETE', headers: authH });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Delete failed'); return; }
      toast.success('Bill deleted');
      nav(`${basePath}/bills`);
    } catch {
      toast.error('Delete failed');
    }
  }

  async function handleCreateVoucher() {
    if (!voucherForm.amount || Number(voucherForm.amount) <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (bill?.purchase_type_code === 'PROJECT' && !voucherForm.salespro_account_name.trim()) {
      toast.error('SalesPro Account Name is required for Project type');
      return;
    }
    setCreatingVoucher(true);
    try {
      const res = await fetch(`/api/bills/${id}/voucher`, {
        method: 'POST',
        headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount:                Number(voucherForm.amount),
          narration:             voucherForm.narration || '',
          supplier_bank_id:      voucherForm.supplier_bank_id || null,
          due_days:              voucherForm.due_days !== '' && voucherForm.due_days != null ? Number(voucherForm.due_days) : null,
          salespro_account_name: voucherForm.salespro_account_name || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to create voucher'); return; }
      toast.success(`Voucher ${data.voucher_no} created`);
      setShowVoucherModal(false);
      setVoucherForm({ amount: '', narration: '', supplier_bank_id: '', due_days: '', salespro_account_name: '' });
      nav(`${voucherBase}/vouchers/${data.id}`);
    } catch {
      toast.error('Failed to create voucher');
    } finally {
      setCreatingVoucher(false);
    }
  }

  const fld = (k, v) => setForm(p => ({ ...p, [k]: v }));

  if (loading) return <Layout><div style={{ padding: 60, textAlign: 'center', color: '#888' }}>Loading…</div></Layout>;

  // Computed amounts
  const taxable  = Number(editMode ? form.taxable_amount : bill?.taxable_amount) || 0;
  const cgst     = Number(editMode ? form.cgst           : bill?.cgst)           || 0;
  const sgst     = Number(editMode ? form.sgst           : bill?.sgst)           || 0;
  const igst     = Number(editMode ? form.igst           : bill?.igst)           || 0;
  const tds      = Number(editMode ? form.tds_amount     : bill?.tds_amount)     || 0;
  const creditNote = Number(editMode ? form.credit_note_amount : bill?.credit_note_amount) || 0;
  const gross    = taxable + cgst + sgst + igst;
  const netPay   = gross - tds - creditNote;

  const vouchersArr = Array.isArray(bill?.vouchers) ? bill.vouchers : [];
  const allocated   = vouchersArr.reduce((s, v) => s + (Number(v.amount) || 0), 0);
  const remaining   = netPay - allocated;

  const STATUS_COLORS = {
    open:            { background: '#fff3cd', color: '#856404' },
    partially_paid:  { background: '#cff4fc', color: '#055160' },
    fully_paid:      { background: '#d1e7dd', color: '#0a3622' },
  };
  const STATUS_LABELS = { open: 'Open', partially_paid: 'Partially Paid', fully_paid: 'Fully Paid' };

  return (
    <Layout>
      <div style={{ padding: '24px 32px', maxWidth: 960, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <button onClick={() => nav(`${basePath}/bills`)} style={{ background: 'none', border: 'none', color: '#0d6efd', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 6 }}>← Back to Bills</button>
            <h2 style={{ margin: 0, fontSize: 22 }}>
              {isNew ? 'New Bill' : (bill?.bill_no || 'Bill Detail')}
              {!isNew && bill?.bill_status && (
                <span style={{ marginLeft: 10, ...(STATUS_COLORS[bill.bill_status] || {}), borderRadius: 12, padding: '3px 12px', fontSize: 13, fontWeight: 600 }}>
                  {STATUS_LABELS[bill.bill_status] || bill.bill_status}
                </span>
              )}
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!isNew && !editMode && ['admin', 'executive'].includes(user?.role) && (
              <>
                {bill?.supplier_approval_status && bill.supplier_approval_status !== 'approved' && (
                  <span style={{ fontSize: 12, color: '#92400e', background: '#fef9c3', border: '1px solid #fde047', borderRadius: 6, padding: '6px 12px', fontWeight: 500 }}>
                    ⚠ Supplier approval pending — voucher creation blocked
                  </span>
                )}
                <button
                  onClick={() => {
                    setVoucherForm(f => ({ ...f, amount: remaining > 0 ? remaining.toFixed(2) : '', due_days: bill?.due_days ?? '', supplier_bank_id: supplierBanks.find(b => b.is_primary)?.id || supplierBanks[0]?.id || '', salespro_account_name: bill?.salespro_act_name || '' }));
                    setShowVoucherModal(true);
                  }}
                  disabled={remaining <= 0.01 || (bill?.supplier_approval_status && bill.supplier_approval_status !== 'approved')}
                  style={{
                    background: (remaining > 0.01 && (!bill?.supplier_approval_status || bill.supplier_approval_status === 'approved')) ? '#198754' : '#6c757d',
                    color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 600,
                    cursor: (remaining > 0.01 && (!bill?.supplier_approval_status || bill.supplier_approval_status === 'approved')) ? 'pointer' : 'default'
                  }}
                >
                  + Create Voucher
                </button>
                <button onClick={() => setEditMode(true)} style={{ background: '#0d6efd', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>Edit</button>
                {user?.role === 'admin' && (
                  <button onClick={handleDeleteBill} style={{ background: '#dc3545', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>Delete</button>
                )}
              </>
            )}
            {!isNew && !editMode && user?.role === 'approver' && (
              <button onClick={() => setEditMode(true)} style={{ background: '#0d6efd', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>Edit</button>
            )}
            {editMode && (
              <>
                <button onClick={handleSave} disabled={saving} style={{ background: '#198754', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {!isNew && <button onClick={() => setEditMode(false)} style={{ background: '#6c757d', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>Cancel</button>}
              </>
            )}
          </div>
        </div>

        {/* Bill Info + Financial grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          {/* Left: Bill Info */}
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e9ecef', padding: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 15 }}>Bill Information</div>
            {editMode ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Supplier</label>
                  <select value={form.supplier_id} onChange={e => fld('supplier_id', e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }}>
                    <option value="">— select —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Invoice Date</label>
                  <input type="date" value={form.invoice_date} onChange={e => fld('invoice_date', e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }} />
                  {form.invoice_date && (
                    <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>{fmtDate(form.invoice_date)}</div>
                  )}
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Invoice Ref No.</label>
                  <input value={form.bill_ref_no} onChange={e => fld('bill_ref_no', e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>
                    {form.purchase_type_code === 'CONSUME' ? 'State' : 'SalesPro Invoice Ref No.'}
                  </label>
                  {form.purchase_type_code === 'CONSUME' ? (
                    <select value={form.payment_reference} onChange={e => fld('payment_reference', e.target.value)}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }}>
                      <option value="">— Select state —</option>
                      {states.map(s => <option key={s.parameterdetid} value={s.parametervalues}>{s.parametervalues}</option>)}
                    </select>
                  ) : (
                    <input value={form.payment_reference} onChange={e => fld('payment_reference', e.target.value)}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }} />
                  )}
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Narration</label>
                  <textarea value={form.narration} onChange={e => fld('narration', e.target.value)} rows={2}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, resize: 'vertical' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Credit Days</label>
                    <input type="number" value={form.due_days} onChange={e => fld('due_days', e.target.value)}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Purchase Type</label>
                    <select value={form.purchase_type_code} onChange={e => fld('purchase_type_code', e.target.value)}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }}>
                      <option value="">Select Purchase Type</option>
                      <option value="SALE">Sale</option>
                      <option value="SALE_MULTIPLE">Sale - Multiple</option>
                      <option value="CONSUME">Consume</option>
                      <option value="PROJECT">Project</option>
                    </select>
                  </div>
                  {form.purchase_type_code === 'PROJECT' && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Account Name</label>
                      <AccountSearchField
                        value={form.salespro_act_name}
                        onSelect={acct => setForm(p => ({ ...p, salespro_act_id: acct.actId, salespro_act_name: acct.actName }))}
                      />
                      {form.salespro_act_name && (
                        <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                          Selected: <strong>{form.salespro_act_name}</strong>
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Company Bank</label>
                    <select value={form.company_bank_id} onChange={e => fld('company_bank_id', e.target.value)}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }}>
                      <option value="">— Select bank —</option>
                      {banks.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.bank_name}{b.account_number ? ` (${b.account_number})` : ''}{b.is_primary ? ' ★' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            ) : (
              <>
                <Field label="Supplier" value={bill?.supplier_name} />
                <Field label="Vendor Code" value={bill?.vendor_code} />
                <Field label="Invoice Date" value={fmtDate(bill?.invoice_date)} />
                <Field label="Invoice Ref No." value={bill?.bill_ref_no} />
                <Field
                  label={bill?.purchase_type_code === 'CONSUME' ? 'State' : 'Cost Centre (SalesPro Invoice Ref No.)'}
                  value={bill?.payment_reference}
                />
                {/* <Field label="Tally Vch No." value={bill?.tally_vch_no} /> */}
                <Field label="Narration" value={bill?.narration} />
                <Field label="Credit Days" value={bill?.due_days != null ? `${bill.due_days} days` : null} />
                <Field label="Purchase Type" value={bill?.purchase_type_label} />
                {bill?.purchase_type_code === 'PROJECT' && (
                  <Field label="Account Name (Salespro)" value={bill?.salespro_act_name} />
                )}
                {(bill?.company_bank_name || bill?.company_bank_account) && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Company Bank</div>
                    <div style={{ fontSize: 14, color: '#212529', marginTop: 2 }}>{bill?.company_bank_name || '—'}</div>
                    {bill?.company_bank_account && (
                      <div style={{ fontSize: 12, color: '#555', fontFamily: 'monospace', marginTop: 2 }}>A/C: {bill.company_bank_account}</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right: Financial Breakdown */}
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e9ecef', padding: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 15 }}>Financial Breakdown</div>
            {editMode ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[['taxable_amount','Taxable Amount'],['cgst','CGST'],['sgst','SGST'],['igst','IGST'],['tds_amount','TDS'],['credit_note_amount','Credit Note']].map(([k, label]) => (
                  <div key={k}>
                    <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>{label}</label>
                    <input type="number" step="0.01" value={form[k]} onChange={e => fld(k, e.target.value)}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }} />
                  </div>
                ))}
              </div>
            ) : (
              <table style={{ width: '100%', fontSize: 13 }}>
                <tbody>
                  {[
                    ['Taxable Amount', fmt(taxable)],
                    ['CGST', fmt(cgst)],
                    ['SGST', fmt(sgst)],
                    ['IGST', fmt(igst)],
                  ].map(([l, v]) => (
                    <tr key={l}>
                      <td style={{ padding: '6px 0', color: '#555' }}>{l}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'monospace' }}>{v}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '1px solid #dee2e6' }}>
                    <td style={{ padding: '8px 0', fontWeight: 700 }}>Gross Total</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(gross)}</td>
                  </tr>
                  {tds > 0 && (
                    <tr>
                      <td style={{ padding: '6px 0', color: '#dc3545' }}>TDS Deduction</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'monospace', color: '#dc3545' }}>− {fmt(tds)}</td>
                    </tr>
                  )}
                  {creditNote > 0 && (
                    <tr>
                      <td style={{ padding: '6px 0', color: '#dc3545' }}>Credit Note</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'monospace', color: '#dc3545' }}>− {fmt(creditNote)}</td>
                    </tr>
                  )}
                  <tr style={{ borderTop: '2px solid #dee2e6' }}>
                    <td style={{ padding: '8px 0', fontWeight: 700, fontSize: 15 }}>Net Payable</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 15 }}>{fmt(netPay)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 0', color: '#555' }}>Vouchers Allocated</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'monospace', color: allocated > 0 ? '#198754' : '#555' }}>− {fmt(allocated)}</td>
                  </tr>
                  <tr style={{ borderTop: '1px dashed #dee2e6' }}>
                    <td style={{ padding: '8px 0', fontWeight: 600 }}>Remaining Balance</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: remaining <= 0.01 ? '#198754' : '#dc3545' }}>
                      {fmt(Math.max(remaining, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Attachments section */}
        {!isNew && (
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e9ecef', padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Attachments ({attachments.length})</div>
              {['admin', 'executive'].includes(user?.role) && (
                <>
                  <button
                    onClick={() => attachRef.current?.click()}
                    disabled={uploading}
                    style={{ background: '#0d6efd', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
                    {uploading ? 'Uploading…' : '+ Upload'}
                  </button>
                  <input ref={attachRef} type="file" multiple style={{ display: 'none' }}
                    accept={ALLOWED_ATTACHMENT_EXTENSIONS.join(',')}
                    onChange={e => handleUploadAttachments(e.target.files)} />
                </>
              )}
            </div>
            {attachments.length === 0 ? (
              <div style={{ color: '#888', fontSize: 13 }}>No attachments yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {attachments.map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f8f9fa', borderRadius: 7, padding: '8px 12px' }}>
                    <span style={{ fontSize: 18 }}>
                      {/pdf/i.test(a.mime_type) ? '📄' : /image/i.test(a.mime_type) ? '🖼️' : '📎'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.original_name}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>
                        {a.uploaded_by_name || '—'} · {fmtDate(a.created_at)} · {a.file_size ? `${(a.file_size / 1024).toFixed(1)} KB` : ''}
                      </div>
                    </div>
                    <button onClick={() => setPreviewAttachment(a)}
                      style={{ background: 'none', border: '1px solid #dee2e6', borderRadius: 5, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>
                      👁 View
                    </button>
                    {['admin', 'executive'].includes(user?.role) && (
                      <button onClick={() => handleDeleteAttachment(a.id, a.original_name)}
                        style={{ background: 'none', border: '1px solid #dee2e6', borderRadius: 5, padding: '3px 10px', fontSize: 12, color: '#dc3545', cursor: 'pointer' }}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Vouchers section */}
        {!isNew && (
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e9ecef', padding: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 15 }}>
              Payment Vouchers ({vouchersArr.length})
            </div>
            {vouchersArr.length === 0 ? (
              <div style={{ color: '#888', fontSize: 13 }}>No vouchers created yet. Click "+ Create Voucher" to create one.</div>
            ) : (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                    {['Voucher No', 'Amount', 'Status', 'UTR No', 'Created'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vouchersArr.map(v => {
                    const sc = VOUCHER_STATUS_COLORS[v.status] || {};
                    return (
                      <tr
                        key={v.id}
                        onClick={() => nav(`${voucherBase}/vouchers/${v.id}`)}
                        style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                        onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                      >
                        <td style={{ padding: '9px 12px', fontWeight: 600 }}>{v.voucher_no || '—'}</td>
                        <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontWeight: 600 }}>{fmt(v.amount)}</td>
                        <td style={{ padding: '9px 12px' }}>
                          <span style={{ ...sc, borderRadius: 10, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>
                            {v.status?.replace(/_/g, ' ')}
                          </span>
                        </td>
                        {/* <td style={{ padding: '9px 12px' }}>
                          {v.utr_no
                            ? <span style={{ background: '#d1e7dd', color: '#0a3622', borderRadius: 10, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>Paid</span>
                            : <span style={{ background: '#fff3cd', color: '#856404', borderRadius: 10, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>Pending</span>
                          }
                        </td> */}
                        <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontSize: 12 }}>{v.utr_no || '—'}</td>
                        <td style={{ padding: '9px 12px', color: '#888', fontSize: 12 }}>{fmtDate(v.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Create Voucher Modal */}
      {showVoucherModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 420, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 17 }}>Create Payment Voucher</h3>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
                Net Payable: {fmt(netPay)} &nbsp;|&nbsp; Remaining: <strong style={{ color: remaining > 0 ? '#198754' : '#dc3545' }}>{fmt(remaining)}</strong>
              </div>
              {creditNote > 0 && (
                <div style={{ fontSize: 12, color: '#dc3545' }}>
                  Credit Note applied: − {fmt(creditNote)} (already deducted from Net Payable above)
                </div>
              )}
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Amount *</label>
              <input
                type="number" step="0.01" placeholder={`Max ${remaining.toFixed(2)}`}
                value={voucherForm.amount}
                onChange={e => setVoucherForm(f => ({ ...f, amount: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 14 }}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Narration</label>
              <textarea
                rows={2} value={voucherForm.narration}
                onChange={e => setVoucherForm(f => ({ ...f, narration: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, resize: 'vertical' }}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Credit Days</label>
              <input
                type="number" min="0" placeholder={bill?.due_days ?? 'e.g. 30'}
                value={voucherForm.due_days}
                onChange={e => setVoucherForm(f => ({ ...f, due_days: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 14 }}
              />
            </div>
            {bill?.purchase_type_code === 'PROJECT' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>SalesPro Account Name *</label>
                <AccountSearchField
                  value={voucherForm.salespro_account_name}
                  onSelect={acct => setVoucherForm(f => ({ ...f, salespro_account_name: acct.actName }))}
                />
              </div>
            )}
            {bill?.purchase_type_code === 'CONSUME' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>State</label>
                <input value={bill?.payment_reference || '—'} readOnly disabled
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 14, background: '#f8f9fa', color: '#555' }} />
              </div>
            )}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Bank Account</label>
              <select
                value={voucherForm.supplier_bank_id}
                onChange={e => setVoucherForm(f => ({ ...f, supplier_bank_id: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }}
              >
                <option value="">— select bank —</option>
                {supplierBanks.map(b => (
                  <option key={b.id} value={b.id}>{b.bank_name} — {b.account_holder_name} ({b.account_number}){b.is_primary ? ' ★' : ''}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setShowVoucherModal(false)} style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid #dee2e6', background: '#fff', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreateVoucher} disabled={creatingVoucher} style={{ padding: '8px 18px', borderRadius: 6, background: '#198754', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                {creatingVoucher ? 'Creating…' : 'Create Voucher'}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewAttachment && (
        <AttachmentPreviewModal
          billId={id}
          attachment={previewAttachment}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </Layout>
  );
}
