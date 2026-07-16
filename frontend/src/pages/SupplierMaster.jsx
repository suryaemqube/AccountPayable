import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { validateAttachmentFiles, ALLOWED_ATTACHMENT_EXTENSIONS } from '../constants/upload';
import { isAndroid } from '../components/Helpers';
import Pagination from '../components/Pagination';

// ── Constants ─────────────────────────────────────────────────────────────────

const ADDRESS_TYPES = [
  { key: 'registered', label: 'Registered Office Address', required: true  },
  { key: 'billing',    label: 'Billing Address',           required: true  },
  { key: 'shipping',   label: 'Shipping Address',          required: false },
];

// Documents section (uploads)
const DOCUMENT_TYPES = [
  { key: 'cancelled_cheque',  label: 'Cancelled Cheque Copy',            mandatory: true  },
  { key: 'pan_card',          label: 'PAN Card Copy',                    mandatory: false },
  { key: 'gst_certificate',   label: 'GST Registration',                  mandatory: false },
  { key: 'bank_verification', label: 'Bank Verification Letter',         mandatory: false },
  { key: 'company_reg_cert',  label: 'Company Registration Certificate', mandatory: false },
  { key: 'nda',               label: 'NDA (if required)',                 mandatory: false },
  { key: 'udyam',             label: 'UDYAM Certificate',                mandatory: false },
];

// ── Factories ─────────────────────────────────────────────────────────────────
function emptyBank()     { return { bank_name:'', account_holder_name:'', ifsc_code:'', branch_name:'', account_number:'', swift_code:'', is_primary:false }; }
function emptyContact()  { return { primary_contact_name:'', email:'', designation:'', mobile:'', alternate_contact:'', website:'', is_primary:false }; }
function emptyAddr(type) { return { address_type:type, address_line:'', city:'', state:'', country:'', pincode:'' }; }
function defaultAddresses() { return ADDRESS_TYPES.map(t => emptyAddr(t.key)); }

// ── Styles ────────────────────────────────────────────────────────────────────
const inp   = { border:'1px solid var(--border)', borderRadius:6, padding:'7px 10px', fontSize:13, background:'var(--bg)', color:'var(--text)', outline:'none', width:'100%', fontFamily:'inherit' };
const inpRO = { ...inp, background:'var(--surface2)', color:'var(--text3)' };
const fg    = { display:'flex', flexDirection:'column', marginBottom:12 };
const row2  = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 };
const row3  = { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 };
const row4  = { display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12 };

function Label({ text, required }) {
  return (
    <label style={{ fontSize:11, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.4px', display:'block', marginBottom:4 }}>
      {text}{required && <span style={{ color:'#ef4444', marginLeft:3 }}>*</span>}
    </label>
  );
}

function SectionHead({ title, action }) {
  return (
    <div className="card-head">
      <div className="card-title">{title}</div>
      {action}
    </div>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

// Reusable document row (used in Documents section)
function DocPreviewModal({ apiPath, name, onClose }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const isPdf = /\.pdf$/i.test(name);
  const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);

  useEffect(() => {
    let objectUrl;
    api.get(apiPath, { responseType: 'blob' })
      .then(r => {
        objectUrl = URL.createObjectURL(r.data);
        setBlobUrl(objectUrl);
      })
      .catch(() => setError('Could not load document'))
      .finally(() => setLoading(false));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [apiPath]);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'var(--bg)', borderRadius:10, overflow:'hidden', width:'min(90vw,860px)', maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 8px 40px rgba(0,0,0,0.4)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <span style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
          <button className="btn btn-sm" onClick={onClose}>✕ Close</button>
        </div>
        <div style={{ flex:1, overflow:'auto', minHeight:300, display:'flex', alignItems:'center', justifyContent:'center' }}>
          {loading && <div style={{ color:'var(--text3)', padding:40 }}>Loading…</div>}
          {error   && <div style={{ color:'var(--red)', padding:40 }}>{error}</div>}
          {blobUrl && (isPdf ? (
            isAndroid() ? (
              <div style={{ padding:40, textAlign:'center', color:'var(--text3)' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>📄</div>
                <div style={{ marginBottom:12 }}>{name}</div>
                <a href={blobUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">Open PDF</a>
              </div>
            ) : (
              <iframe src={blobUrl} style={{ width:'100%', height:'75vh', border:'none' }} title={name} />
            )
          ) : isImg ? (
            <img src={blobUrl} alt={name} style={{ maxWidth:'100%', display:'block', margin:'0 auto' }} />
          ) : (
            <div style={{ padding:40, textAlign:'center', color:'var(--text3)' }}>
              <div style={{ fontSize:40, marginBottom:12 }}>📄</div>
              <div style={{ marginBottom:12 }}>{name}</div>
              <a href={blobUrl} download={name} className="btn btn-primary">Download</a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DocRow({ dt, uploaded, pending, isUploading, supplierId, onUpload, onDelete, onStage, onRemoveStage, fileRef }) {
  const [preview, setPreview] = useState(false);
  const apiPath = uploaded ? `/suppliers/${supplierId}/documents/${uploaded.id}` : null;
  return (
    <>
      {preview && <DocPreviewModal apiPath={apiPath} name={uploaded?.original_name || dt.label} onClose={() => setPreview(false)} />}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', background:'var(--surface2)', borderRadius:8, gap:12 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:500 }}>
            {dt.label}
            {dt.mandatory
              ? <span style={{ color:'#ef4444', marginLeft:4, fontSize:11 }}>*</span>
              : <span style={{ color:'var(--text3)', marginLeft:4, fontSize:11 }}>(optional)</span>}
          </div>
          {uploaded && <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>{uploaded.original_name}{uploaded.file_size ? ` · ${Math.round(uploaded.file_size/1024)} KB` : ''}</div>}
          {pending  && <div style={{ fontSize:11, color:'#ca8a04', marginTop:2 }}>{pending.name} · {Math.round(pending.size/1024)} KB <span style={{ marginLeft:6, background:'#fef9c3', border:'1px solid #fde047', borderRadius:4, padding:'0 5px' }}>staged</span></div>}
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {uploaded ? (
            <>
              <button className="btn btn-sm" onClick={() => setPreview(true)}>👁 View</button>
              <button className="btn btn-sm" style={{ color:'var(--red)' }} onClick={() => onDelete(uploaded)}>Remove</button>
            </>
          ) : pending ? (
            <>
              <span style={{ fontSize:12, color:'#ca8a04' }}>Will upload on save</span>
              <button className="btn btn-sm" style={{ color:'var(--red)' }} onClick={onRemoveStage}>×</button>
            </>
          ) : (
            <>
              <input type="file" ref={fileRef} style={{ display:'none' }} accept={ALLOWED_ATTACHMENT_EXTENSIONS.join(',')}
                onChange={e => onUpload(e.target.files[0])} />
              <button className="btn btn-sm" disabled={isUploading} onClick={() => fileRef.current?.click()}>
                {isUploading ? 'Uploading…' : 'Upload'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Supplier Form ─────────────────────────────────────────────────────────────
function SupplierForm({ supplierId, onSaved }) {
  const isEdit = !!supplierId;
  const { user: formUser } = useAuth();
  const formCanApprove = isEdit && (formUser?.role === 'admin' || formUser?.role === 'approver');

  const [form, setForm] = useState({
    // Basic Information
    supplier_name:'', trade_name:'', name_for_bank:'', vendor_code:'', supplier_type:'',
    gstin:'', cin_number:'',
    // Tax & Compliance
    pan_number:'', gst_certificate:'', tds_applicable:false,
    lower_deduction_cert:'', udyam_reg_number:'',
    pf_registration:'', esic_registration:'',
    // Operational Details
    products_services:'', territory:'',
    // ERP
    owned_by:'', is_active:true,
    created_at:null, updated_at:null, created_by_name:'',
    approval_status:'pending', approved_by_name:'', last_approved_at:null, approval_notes:'',
  });

  const [banks,     setBanks]     = useState([emptyBank()]);
  const [contacts,  setContacts]  = useState([emptyContact()]);
  const [addresses, setAddresses] = useState(defaultAddresses());
  const [documents, setDocuments] = useState([]);

  const [supplierTypes,    setSupplierTypes]    = useState([]);
  const [productServices,  setProductServices]  = useState([]);
  const [regionsServed,    setRegionsServed]    = useState([]);
  const [countries,        setCountries]        = useState([]);
  const [states,           setStates]           = useState([]);
  const [managers,         setManagers]         = useState([]);

  const [saving,          setSaving]          = useState(false);
  const [uploading,       setUploading]       = useState({});
  const [pendingFiles,    setPendingFiles]    = useState({});
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [changeReason,    setChangeReason]    = useState('');
  const [approvalModal,   setApprovalModal]   = useState(null); // { action: 'approve'|'reject' }
  const [approvalNotes,   setApprovalNotes]   = useState('');
  const [approvalSaving,  setApprovalSaving]  = useState(false);
  const fileRefs = useRef({});

  useEffect(() => {
    api.get('/managers').then(r => setManagers(r.data.managers)).catch(() => {});
    api.get('/parameters/4').then(r => setSupplierTypes(r.data.details)).catch(() => {});
    api.get('/parameters/5').then(r => setProductServices(r.data.details)).catch(() => {});
    api.get('/parameters/6').then(r => setRegionsServed(r.data.details)).catch(() => {});
    api.get('/parameters/7').then(r => setCountries(r.data.details)).catch(() => {});
    api.get('/parameters/8').then(r => setStates(r.data.details)).catch(() => {});

    if (isEdit) {
      api.get(`/suppliers/${supplierId}`).then(r => {
        const { supplier:s, banks:b, contacts:c, addresses:a, documents:d } = r.data;
        setForm({
          supplier_name:s.supplier_name||'', trade_name:s.trade_name||'', name_for_bank:s.name_for_bank||'',
          vendor_code:s.vendor_code||'', supplier_type:s.supplier_type||'',
          gstin:s.gstin||'', cin_number:s.cin_number||'',
          pan_number:s.pan_number||'', gst_certificate:s.gst_certificate||'',
          tds_applicable:s.tds_applicable||false, lower_deduction_cert:s.lower_deduction_cert||'',
          udyam_reg_number:s.udyam_reg_number||'',
          pf_registration:s.pf_registration||'', esic_registration:s.esic_registration||'',
          products_services:s.products_services||'', territory:s.territory||'',
          owned_by:s.owned_by||'', is_active:s.is_active,
          created_at:s.created_at, updated_at:s.updated_at, created_by_name:s.created_by_name||'',
          approval_status:s.approval_status||'pending', approved_by_name:s.approved_by_name||'',
          last_approved_at:s.last_approved_at, approval_notes:s.approval_notes||'',
        });
        setBanks(b.length ? b : [emptyBank()]);
        setContacts(c.length ? c.map(x => ({ ...emptyContact(), ...x })) : [emptyContact()]);
        const merged = ADDRESS_TYPES.map(t => {
          const found = (a||[]).find(x => x.address_type === t.key);
          return found
            ? { address_type:t.key, address_line:found.address_line||'', city:found.city||'', state:found.state||'', country:found.country||'', pincode:found.pincode||'' }
            : emptyAddr(t.key);
        });
        setAddresses(merged);
        setDocuments(d||[]);
      }).catch(() => toast.error('Failed to load supplier'));
    }
  }, [supplierId]);

  const setF    = (k,v) => setForm(f => ({ ...f, [k]:v }));
  const setBank = (i,k,v) => setBanks(b => b.map((x,idx) => idx===i ? {...x,[k]:v} : x));
  const setCtc  = (i,k,v) => setContacts(c => c.map((x,idx) => idx===i ? {...x,[k]:v} : x));
  const setAddr = (i,k,v) => setAddresses(a => a.map((x,idx) => idx===i ? {...x,[k]:v} : x));

  const setAddrCountry = (i, country) =>
    setAddresses(a => a.map((x,idx) => idx===i ? {...x, country, state:''} : x));

  function statesFor(countryCode) {
    return countryCode === 'INDIA' ? states : [];
  }

  async function uploadDocToServer(sid, docType, file) {
    setUploading(u => ({ ...u, [docType]:true }));
    const fd = new FormData();
    fd.append('file', file);
    fd.append('document_type', docType);
    try {
      const r = await api.post(`/suppliers/${sid}/documents`, fd);
      setDocuments(d => [...d.filter(x => x.document_type !== docType), r.data.document]);
    } catch (err) {
      toast.error(`${docType}: ${err.response?.data?.error || 'Upload failed'}`);
    } finally {
      setUploading(u => ({ ...u, [docType]:false }));
      if (fileRefs.current[docType]) fileRefs.current[docType].value = '';
    }
  }

  function handleDocUpload(docType, file) {
    if (!file) return;
    const { valid, errors } = validateAttachmentFiles([file]);
    if (errors.length) { errors.forEach(e => toast.error(e)); return; }
    const [validFile] = valid;
    if (!supplierId) { setPendingFiles(p => ({ ...p, [docType]: validFile })); return; }
    uploadDocToServer(supplierId, docType, validFile);
  }

  async function handleDocDelete(doc) {
    if (!window.confirm('Delete this document?')) return;
    try {
      await api.delete(`/suppliers/${supplierId}/documents/${doc.id}`);
      setDocuments(d => d.filter(x => x.id !== doc.id));
      toast.success('Document removed');
    } catch { toast.error('Delete failed'); }
  }

  function removeStaged(docType) {
    setPendingFiles(p => { const n={...p}; delete n[docType]; return n; });
    if (fileRefs.current[docType]) fileRefs.current[docType].value = '';
  }

  function validate() {
    if (!form.supplier_name.trim())    return 'Supplier Name is required';
    if (!form.trade_name.trim())       return 'Trade Name is required';
    if (!form.supplier_type)           return 'Supplier Type is required';
    if (form.supplier_type !== 'OTHER' && !form.gstin.trim()) return 'GST Number is required';

    const c0 = contacts[0];
    if (!c0?.primary_contact_name?.trim()) return 'Contact Person Name is required';
    if (!c0?.mobile?.trim())               return 'Contact Mobile Number is required';
    // if (!c0?.website?.trim())              return 'Contact Website is required';
    const b0 = banks[0];
    if (!b0?.bank_name?.trim())           return 'Bank Name is required';
    if (!b0?.branch_name?.trim())         return 'Bank Branch Name is required';
    if (!b0?.account_holder_name?.trim()) return 'Account Holder Name is required';
    if (!b0?.account_number?.trim())      return 'Account Number is required';
    if (!b0?.ifsc_code?.trim())           return 'IFSC Code is required';
    if (!form.pan_number.trim())          return 'PAN Number is required';

    if (!form.udyam_reg_number.trim())    return 'UDYAM Registration Number is required';
    if (!form.products_services)          return 'Products / Services is required';
    if (!form.territory)                  return 'Territory / Region is required';
    return null;
  }

  function handleSave() {
    const err = validate();
    if (err) return toast.error(err);
    if (isEdit && formUser?.role !== 'admin' && form.approval_status === 'approved') {
      // Only ask for a reason when editing an already-approved supplier
      setChangeReason('');
      setShowReasonModal(true);
    } else {
      doSave('Updated');
    }
  }

  async function doSave(notes) {
    setSaving(true);
    const payload = {
      ...form,
      approval_notes: notes,
      owned_by:  form.owned_by || null,
      banks:     banks.filter(b => b.bank_name || b.account_number),
      contacts:  contacts.filter(c => c.primary_contact_name || c.email || c.mobile),
      addresses: addresses.filter(a => a.address_line || a.city || a.state || a.pincode),
    };
    try {
      if (isEdit) {
        await api.put(`/suppliers/${supplierId}`, payload);
        toast.success(formUser?.role === 'admin' ? 'Supplier updated' : 'Supplier updated — pending re-approval');
      } else {
        const r = await api.post('/suppliers', payload);
        const newId = r.data.supplier.id;
        const pending = Object.entries(pendingFiles);
        if (pending.length) {
          await Promise.allSettled(pending.map(([dt, file]) => uploadDocToServer(newId, dt, file)));
        }
        toast.success('Supplier created — pending approval');
      }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleFormApproval() {
    if (!approvalModal) return;
    setApprovalSaving(true);
    try {
      await api.post(`/suppliers/${supplierId}/approve`, { action: approvalModal.action, notes: approvalNotes });
      toast.success(approvalModal.action === 'approve' ? 'Supplier approved' : 'Supplier rejected');
      setApprovalModal(null); setApprovalNotes('');
      // Refresh form data
      const r = await api.get(`/suppliers/${supplierId}`);
      const s = r.data.supplier;
      setForm(f => ({ ...f, approval_status: s.approval_status, approved_by_name: s.approved_by_name||'', last_approved_at: s.last_approved_at, approval_notes: s.approval_notes||'' }));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    } finally {
      setApprovalSaving(false);
    }
  }

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div>

      {/* ── 1. Basic Information ── */}
      <div className="card" style={{ marginBottom:16 }}>
        <SectionHead title="Basic Information" />
        <div className="card-body">
          <div style={row3}>
            <div style={fg}>
              <Label text="Supplier Name" required />
              <input style={inp} value={form.supplier_name} onChange={e => setF('supplier_name', e.target.value)} placeholder="Legal entity name" />
            </div>
            <div style={fg}>
              <Label text="Trade Name" required />
              <input style={inp} value={form.trade_name} onChange={e => setF('trade_name', e.target.value)} placeholder="DBA / brand name" />
            </div>
            <div style={fg}>
              <Label text="Name for Bank Files (DR/CR)" />
              <input style={inp} value={form.name_for_bank} onChange={e => setF('name_for_bank', e.target.value)} placeholder="Name as it appears in bank files" />
            </div>
            <div style={fg}>
              <Label text="Vendor Code" />
              <input style={inpRO} value={form.vendor_code || (isEdit ? '' : 'Auto-generated')} readOnly />
            </div>
          </div>
          <div style={row3}>
            <div style={fg}>
              <Label text="Supplier Type" required />
              <select style={inp} value={form.supplier_type} onChange={e => setF('supplier_type', e.target.value)}>
                <option value="">Select type…</option>
                {supplierTypes.map(t => <option key={t.parameterdetid} value={t.code}>{t.parametervalues}</option>)}
              </select>
            </div>
            <div style={fg}>
              <Label text="PAN Number" required />
              <input style={inp} value={form.pan_number} onChange={e => setF('pan_number', e.target.value.toUpperCase())} placeholder="AAXCA1234M" maxLength={10} />
            </div>
            <div style={fg}>
              <Label text="GST Number" required={form.supplier_type !== 'OTHER'} />
              <input style={inp} value={form.gstin} onChange={e => setF('gstin', e.target.value.toUpperCase())} placeholder={form.supplier_type === 'OTHER' ? 'Optional for Other type' : '27AAXCA1234M1Z5'} maxLength={15} />
            </div>
          </div>
          <div style={row3}>
            <div style={fg}>
              <Label text="UDYAM Registration Number" required />
              <input style={inp} value={form.udyam_reg_number} onChange={e => setF('udyam_reg_number', e.target.value)} />
            </div>
            <div style={fg}>
              <Label text="CIN Number" />
              <input style={inp} value={form.cin_number} onChange={e => setF('cin_number', e.target.value.toUpperCase())} placeholder="U12345MH2000PTC123456" />
            </div>

            <div style={{ ...fg, justifyContent:'flex-end' }}>
              <label style={{ fontSize:11, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.4px', display:'block', marginBottom:4 }}>&nbsp;</label>
              <div style={{ display:'flex', alignItems:'center', gap:8, paddingTop:6 }}>
                <input type="checkbox" id="tds_applicable" checked={form.tds_applicable} onChange={e => setF('tds_applicable', e.target.checked)} style={{ width:14, height:14, cursor:'pointer' }} />
                <label htmlFor="tds_applicable" style={{ fontSize:13, cursor:'pointer' }}>TDS Applicable</label>
              </div>
            </div>
            {form.tds_applicable &&
            <div style={fg}>
              <Label text="Lower Deduction Certificate" />
              <input style={inp} value={form.lower_deduction_cert} onChange={e => setF('lower_deduction_cert', e.target.value)} placeholder="Certificate no. (optional)" />
            </div>}


            <div style={fg}>
              <Label text="PF Registration" />
              <input style={inp} value={form.pf_registration} onChange={e => setF('pf_registration', e.target.value)} placeholder="Mandatory if Services" />
            </div>
            <div style={fg}>
              <Label text="ESIC Registration" />
              <input style={inp} value={form.esic_registration} onChange={e => setF('esic_registration', e.target.value)} placeholder="Mandatory if Services" />
            </div>

            
            <div style={fg}>
              <Label text="Owned By (Manager)" />
              <select style={inp} value={form.owned_by} onChange={e => setF('owned_by', e.target.value)}>
                <option value="">— None —</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. Contact Details ── */}
      <div className="card" style={{ marginBottom:16 }}>
        <SectionHead title="Contact Details" action={
          <button className="btn btn-sm" onClick={() => setContacts(c => [...c, emptyContact()])} style={{ marginLeft:'auto' }}>+ Add Contact</button>
        } />
        <div className="card-body">
          {contacts.map((c, i) => (
            <div key={i} style={{ background:'var(--surface2)', borderRadius:8, padding:'14px 14px 10px', marginBottom:10, position:'relative', border: c.is_primary ? '1.5px solid #3b82f6' : '1.5px solid transparent' }}>
              {c.is_primary && (
                <span style={{ position:'absolute', top:10, left:14, background:'#dbeafe', color:'#1d4ed8', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, letterSpacing:'0.5px', textTransform:'uppercase' }}>★ Primary</span>
              )}
              {contacts.length > 1 && (
                <button onClick={() => setContacts(c => c.filter((_,idx) => idx!==i))}
                  style={{ position:'absolute', top:10, right:10, background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:18, lineHeight:1 }}>×</button>
              )}
              <div style={{ ...row3, marginTop: c.is_primary ? 26 : 0 }}>
                <div style={fg}>
                  <Label text="Contact Person Name" required={i===0} />
                  <input style={inp} value={c.primary_contact_name||''} onChange={e => setCtc(i,'primary_contact_name',e.target.value)} />
                </div>
                <div style={fg}>
                  <Label text="Designation" />
                  <input style={inp} value={c.designation||''} onChange={e => setCtc(i,'designation',e.target.value)} placeholder="e.g. Accounts Manager" />
                </div>
                <div style={fg}>
                  <Label text="Mobile Number" required={i===0} />
                  <input style={inp} value={c.mobile||''} onChange={e => setCtc(i,'mobile',e.target.value)} placeholder="+91 XXXXX XXXXX" />
                </div>
              </div>
              <div style={row3}>
                <div style={fg}>
                  <Label text="Email ID" />
                  <input style={inp} type="email" value={c.email||''} onChange={e => setCtc(i,'email',e.target.value)} />
                </div>
                <div style={fg}>
                  <Label text="Alternate Contact Number" />
                  <input style={inp} value={c.alternate_contact||''} onChange={e => setCtc(i,'alternate_contact',e.target.value)} />
                </div>
                <div style={fg}>
                  <Label text="Website" />
                  <input style={inp} value={c.website||''} onChange={e => setCtc(i,'website',e.target.value)} placeholder="https://example.com" />
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:2 }}>
                <input type="checkbox" id={`cp_${i}`} checked={c.is_primary}
                  onChange={() => setContacts(prev => prev.map((x,idx) => ({ ...x, is_primary: idx===i ? !x.is_primary : false })))}
                  style={{ width:14, height:14, cursor:'pointer' }} />
                <label htmlFor={`cp_${i}`} style={{ fontSize:13, cursor:'pointer' }}>Is Primary Contact</label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 3. Address Details ── */}
      <div className="card" style={{ marginBottom:16 }}>
        <SectionHead title="Address Details" />
        <div className="card-body">
          {addresses.map((a, i) => {
            const addrType     = ADDRESS_TYPES[i];
            const req          = addrType.required;
            const stateOptions = statesFor(a.country);
            return (
              <div key={a.address_type} style={{ marginBottom: i < addresses.length - 1 ? 24 : 0 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:10, paddingBottom:6, borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:6 }}>
                  {addrType.label}
                  {req
                    ? <span style={{ color:'#ef4444' }}>*</span>
                    : <span style={{ color:'var(--text3)', fontSize:10, fontWeight:400, textTransform:'none' }}>(optional)</span>}
                </div>
                <div style={fg}>
                  <Label text="Address" required={req} />
                  <textarea style={{ ...inp, minHeight:56, resize:'vertical' }} value={a.address_line||''}
                    onChange={e => setAddr(i,'address_line',e.target.value)} placeholder="Building, Street, Area" />
                </div>
                <div style={row4}>
                  <div style={fg}>
                    <Label text="City" required={req} />
                    <input style={inp} value={a.city||''} onChange={e => setAddr(i,'city',e.target.value)} />
                  </div>
                  <div style={fg}>
                    <Label text="Country" required={req} />
                    <select style={inp} value={a.country} onChange={e => setAddrCountry(i, e.target.value)}>
                      <option value="">Select country…</option>
                      {countries.map(c => <option key={c.parameterdetid} value={c.code}>{c.parametervalues}</option>)}
                    </select>
                  </div>
                  <div style={fg}>
                    <Label text="State" required={req} />
                    {stateOptions.length > 0 ? (
                      <select style={inp}
                        value={stateOptions.find(s => s.parametervalues.toLowerCase() === (a.state||'').toLowerCase())?.parametervalues || a.state}
                        onChange={e => setAddr(i,'state',e.target.value)}>
                        <option value="">Select state…</option>
                        {stateOptions.map(s => <option key={s.parameterdetid} value={s.parametervalues}>{s.parametervalues}</option>)}
                      </select>
                    ) : (
                      <input style={inp}
                        value={a.state||''}
                        placeholder="Enter state"
                        onChange={e => setAddr(i,'state',e.target.value)}
                      />
                    )}
                  </div>
                  <div style={fg}>
                    <Label text="PIN Code" required={req} />
                    <input style={inp} value={a.pincode||''} onChange={e => setAddr(i,'pincode',e.target.value)} maxLength={6} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 4. Bank Details ── */}
      <div className="card" style={{ marginBottom:16 }}>
        <SectionHead title="Bank Details" action={
          <button className="btn btn-sm" onClick={() => setBanks(b => [...b, emptyBank()])} style={{ marginLeft:'auto' }}>+ Add Bank</button>
        } />
        <div className="card-body">
          {banks.map((b, i) => (
            <div key={i} style={{ background:'var(--surface2)', borderRadius:8, padding:'14px 14px 10px', marginBottom:10, position:'relative' }}>
              {banks.length > 1 && (
                <button onClick={() => setBanks(b => b.filter((_,idx) => idx!==i))}
                  style={{ position:'absolute', top:10, right:10, background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:18, lineHeight:1 }}>×</button>
              )}
              <div style={row3}>
                <div style={fg}>
                  <Label text="Bank Name" required={i===0} />
                  <input style={inp} value={b.bank_name||''} onChange={e => setBank(i,'bank_name',e.target.value)} placeholder="e.g. ICICI Bank" />
                </div>
                <div style={fg}>
                  <Label text="Account Holder Name" required={i===0} />
                  <input style={inp} value={b.account_holder_name||''} onChange={e => setBank(i,'account_holder_name',e.target.value)} />
                </div>
                <div style={fg}>
                  <Label text="Account Number" required={i===0} />
                  <input style={inp} value={b.account_number||''} onChange={e => setBank(i,'account_number',e.target.value)} />
                </div>
              </div>
              <div style={row3}>
                <div style={fg}>
                  <Label text="IFSC Code" required={i===0} />
                  <input style={inp} value={b.ifsc_code||''} onChange={e => setBank(i,'ifsc_code',e.target.value.toUpperCase())} placeholder="ICIC0001234" />
                </div>
                <div style={fg}>
                  <Label text="Branch Name" required={i===0} />
                  <input style={inp} value={b.branch_name||''} onChange={e => setBank(i,'branch_name',e.target.value)} />
                </div>
                <div style={fg}>
                  <Label text="SWIFT Code" />
                  <input style={inp} value={b.swift_code||''} onChange={e => setBank(i,'swift_code',e.target.value.toUpperCase())} placeholder="ICICINBBXXX (optional)" />
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:2 }}>
                <input type="checkbox" id={`bp_${i}`} checked={b.is_primary}
                  onChange={() => setBanks(prev => prev.map((x,idx) => ({ ...x, is_primary: idx===i ? !x.is_primary : false })))}
                  style={{ width:14, height:14, cursor:'pointer' }} />
                <label htmlFor={`bp_${i}`} style={{ fontSize:13, cursor:'pointer' }}>Is Primary Bank</label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 6. Operational Details ── */}
      <div className="card" style={{ marginBottom:16 }}>
        <SectionHead title="Operational Details" />
        <div className="card-body">
          <div style={row2}>
            <div style={fg}>
              <Label text="Products / Services Supplied" required />
              <select style={inp} value={form.products_services} onChange={e => setF('products_services', e.target.value)}>
                <option value="">Select…</option>
                {productServices.map(p => <option key={p.parameterdetid} value={p.code}>{p.parametervalues}</option>)}
              </select>
            </div>
            <div style={fg}>
              <Label text="Territory / Region" required />
              <select style={inp} value={form.territory} onChange={e => setF('territory', e.target.value)}>
                <option value="">Select…</option>
                {regionsServed.map(r => <option key={r.parameterdetid} value={r.code}>{r.parametervalues}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── 7. Documents ── */}
      <div className="card" style={{ marginBottom:16 }}>
        <SectionHead title="Documents" />
        <div className="card-body">
          <div style={{ display:'grid', gap:10 }}>
            {DOCUMENT_TYPES.map(dt => (
              <DocRow key={dt.key} dt={dt}
                uploaded={documents.find(d => d.document_type === dt.key)}
                pending={!isEdit ? pendingFiles[dt.key] : null}
                isUploading={uploading[dt.key]}
                supplierId={supplierId}
                onUpload={file => handleDocUpload(dt.key, file)}
                onDelete={handleDocDelete}
                onStage={file => handleDocUpload(dt.key, file)}
                onRemoveStage={() => removeStaged(dt.key)}
                fileRef={{ get current(){ return fileRefs.current[dt.key]; }, set current(v){ fileRefs.current[dt.key]=v; } }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── 8. ERP Control ── */}
      <div className="card" style={{ marginBottom:16 }}>
        <SectionHead title="ERP Control" />
        <div className="card-body">
          <div style={row4}>
            <div style={fg}>
              <Label text="Creation Date" required />
              <input style={inpRO} value={isEdit ? fmtDate(form.created_at) : fmtDate(new Date())} readOnly />
            </div>
            <div style={fg}>
              <Label text="Created By" required />
              <input style={inpRO} value={isEdit ? (form.created_by_name||'—') : 'Current User'} readOnly />
            </div>
            <div style={fg}>
              <Label text="Last Updated Date" required />
              <input style={inpRO} value={isEdit ? fmtDate(form.updated_at) : '—'} readOnly />
            </div>
            <div style={fg}>
              <Label text="Status" />
              <div style={{ display:'flex', alignItems:'center', gap:8, paddingTop:10 }}>
                <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => setF('is_active', e.target.checked)} style={{ width:14, height:14, cursor:'pointer' }} />
                <label htmlFor="is_active" style={{ fontSize:13, cursor:'pointer' }}>
                  {form.is_active ? 'Active' : 'Inactive'}
                </label>
              </div>
            </div>
          </div>

          {/* Approval fields (read-only) */}
          <div style={{ ...row4, marginTop:12, paddingTop:12, borderTop:'1px solid var(--border)' }}>
            <div style={fg}>
              <Label text="Approval Status" />
              <div style={{ paddingTop:6 }}>
                {form.approval_status === 'approved' && <span className="badge badge-approved">Approved</span>}
                {form.approval_status === 'rejected' && <span className="badge badge-rejected">Rejected</span>}
                {(!form.approval_status || form.approval_status === 'pending') && <span className="badge badge-pending">Pending Approval</span>}
              </div>
            </div>
            <div style={fg}>
              <Label text="Approved By" />
              <input style={inpRO} value={form.approved_by_name||'—'} readOnly />
            </div>
            <div style={fg}>
              <Label text="Last Approved Date" />
              <input style={inpRO} value={fmtDate(form.last_approved_at)} readOnly />
            </div>
            {form.approval_notes && (
              <div style={fg}>
                <Label text="Approval Notes" />
                <input style={inpRO} value={form.approval_notes} readOnly />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Actions ── */}
      <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
        <button className="btn" onClick={onSaved}>Cancel</button>
        {formCanApprove && form.approval_status !== 'approved' && (
          <button className="btn" style={{ color:'var(--green)', borderColor:'var(--green)' }}
            onClick={() => { setApprovalModal({ action:'approve' }); setApprovalNotes(''); }}>
            ✓ Approve
          </button>
        )}
        {formCanApprove && form.approval_status !== 'rejected' && (
          <button className="btn" style={{ color:'var(--red)', borderColor:'var(--red)' }}
            onClick={() => { setApprovalModal({ action:'reject' }); setApprovalNotes(''); }}>
            ✕ Reject
          </button>
        )}
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Update Supplier' : 'Create Supplier'}
        </button>
      </div>

      {/* ── Approval Modal ── */}
      {approvalModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
          <div className="card" style={{ width:440, margin:0, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <div className="card-head">
              <div className="card-title" style={{ color: approvalModal.action==='approve' ? 'var(--green)' : 'var(--red)' }}>
                {approvalModal.action === 'approve' ? '✓ Approve Supplier' : '✕ Reject Supplier'}
              </div>
            </div>
            <div className="card-body">
              <p style={{ fontSize:13, color:'var(--text3)', marginBottom:14 }}>
                {approvalModal.action === 'approve'
                  ? 'Confirm approval for this supplier.'
                  : 'Please provide a reason for rejection.'}
              </p>
              <label style={{ fontSize:11, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.4px', display:'block', marginBottom:4 }}>
                Notes {approvalModal.action === 'reject' && <span style={{ color:'#ef4444' }}>*</span>}
              </label>
              <textarea rows={3} style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, resize:'vertical' }}
                value={approvalNotes} onChange={e => setApprovalNotes(e.target.value)}
                placeholder={approvalModal.action === 'approve' ? 'Optional notes…' : 'Reason for rejection…'} />
            </div>
            <div className="card-foot" style={{ display:'flex', justifyContent:'flex-end', gap:8, padding:'18px' }}>
              <button className="btn" onClick={() => setApprovalModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={approvalSaving}
                style={{ background: approvalModal.action==='approve' ? 'var(--green)' : 'var(--red)', borderColor: approvalModal.action==='approve' ? 'var(--green)' : 'var(--red)' }}
                onClick={handleFormApproval}>
                {approvalSaving ? 'Saving…' : approvalModal.action === 'approve' ? 'Approve' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Reason Modal (edit only) ── */}
      {showReasonModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
          <div className="card" style={{ width:440, margin:0, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <div className="card-head">
              <div className="card-title">Reason for Changes</div>
            </div>
            <div className="card-body">
              <p style={{ fontSize:13, color:'var(--text3)', marginBottom:14 }}>
                This supplier will be set back to <strong>Pending Approval</strong> after saving. Please provide a reason for the changes.
              </p>
              <div style={{ marginBottom:16 }}>
                <label style={{ fontSize:11, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.4px', display:'block', marginBottom:4 }}>
                  Reason <span style={{ color:'#ef4444' }}>*</span>
                </label>
                <textarea
                  style={{ ...inp, minHeight:90, resize:'vertical' }}
                  value={changeReason}
                  onChange={e => setChangeReason(e.target.value)}
                  placeholder="e.g. Updated bank account details, corrected PAN number…"
                  autoFocus
                />
              </div>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button className="btn" onClick={() => setShowReasonModal(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}
                  onClick={() => {
                    if (!changeReason.trim()) return toast.error('Reason is required');
                    setShowReasonModal(false);
                    doSave(changeReason.trim());
                  }}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main list page ────────────────────────────────────────────────────────────
const APPROVAL_TABS = [
  { key: 'pending',  label: 'Pending'  },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: '',         label: 'All'      },
];

const SUPPLIER_COLUMNS = [
  { key: 'vendor_code',         label: 'Vendor Code' },
  { key: 'trade_name',          label: 'Trader Name' },
  { key: 'supplier_type_label', label: 'Type' },
  { key: 'gstin',               label: 'GST Number' },
  { key: 'approval_status',     label: 'Approval' },
  { key: 'approval_notes',      label: 'Notes / Reason' },
  { key: 'approved_by_name',    label: 'Approved By' },
  { key: 'is_active',           label: 'Active' },
];

function supplierSortValue(s, key) {
  if (key === 'is_active') return s.is_active ? 1 : 0;
  return (s[key] || '').toString().toLowerCase();
}

export default function SupplierMaster() {
  const location = useLocation();
  const { user } = useAuth();
  const isApprover = user?.role === 'approver';
  const isAdmin    = user?.role === 'admin';
  const isExecutive    = user?.role === 'executive';
  const canApprove = isAdmin || isApprover;
  const canEdit    = isAdmin || isApprover || isExecutive;

  const [suppliers, setSuppliers] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [view,      setView]      = useState('list');
  const [editId,    setEditId]    = useState(null);
  const [search,    setSearch]    = useState('');
  const [filterType,     setFilterType]     = useState('');
  const [filterApproval, setFilterApproval] = useState('pending');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [sortConfig,     setSortConfig]     = useState({ key: null, direction: 'asc' });
  const [page,           setPage]           = useState(1);
  const [pageSize,       setPageSize]       = useState(20);

  // Approve / reject modal
  const [modal, setModal]   = useState(null); // { supplier, action }
  const [notes, setNotes]   = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (view === 'list') fetchSuppliers(); }, [view]);

  useEffect(() => { setPage(1); }, [search, filterType, filterApproval, filterStatus, sortConfig, pageSize]);

  useEffect(() => {
    const openId = location.state?.openSupplierId;
    if (openId) { setEditId(openId); setView('edit'); }
  }, [location.state]);

  async function fetchSuppliers() {
    setLoading(true);
    try {
      const r = await api.get('/suppliers');
      setSuppliers(r.data.suppliers);
    } catch { toast.error('Failed to load suppliers'); }
    finally { setLoading(false); }
  }

  async function handleToggle(s) {
    try {
      await api.put(`/suppliers/${s.id}`, { is_active: !s.is_active });
      toast.success(s.is_active ? 'Supplier deactivated' : 'Supplier activated');
      fetchSuppliers();
    } catch { toast.error('Failed to update'); }
  }

  async function handleDelete(s) {
    if (!window.confirm(`Delete "${s.supplier_name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/suppliers/${s.id}`);
      toast.success('Supplier deleted');
      setSuppliers(prev => prev.filter(x => x.id !== s.id));
    } catch (err) { toast.error(err.response?.data?.error || 'Delete failed'); }
  }

  async function handleApprovalAction() {
    if (!modal) return;
    if (modal.action === 'reject' && !notes.trim()) return toast.error('Rejection reason is required');
    setSaving(true);
    try {
      await api.post(`/suppliers/${modal.supplier.id}/approve`, { action: modal.action, notes });
      toast.success(modal.action === 'approve' ? 'Supplier approved' : 'Supplier rejected');
      setModal(null); setNotes('');
      fetchSuppliers();
    } catch (err) { toast.error(err.response?.data?.error || 'Action failed'); }
    finally { setSaving(false); }
  }

  const counts = {
    pending:  suppliers.filter(s => s.approval_status === 'pending').length,
    approved: suppliers.filter(s => s.approval_status === 'approved').length,
    rejected: suppliers.filter(s => s.approval_status === 'rejected').length,
    '':       suppliers.length,
  };

  const displayed = suppliers.filter(s => {
    const q = search.toLowerCase();
    if (q && ![ s.supplier_name, s.trade_name, s.gstin, s.pan_number, s.vendor_code ]
      .some(v => v && v.toLowerCase().includes(q))) return false;
    if (filterType && (s.supplier_type || '').toUpperCase() !== filterType) return false;
    if (filterApproval !== '' && s.approval_status !== filterApproval) return false;
    if (filterStatus === 'active'   && !s.is_active) return false;
    if (filterStatus === 'inactive' &&  s.is_active) return false;
    return true;
  });

  const sorted = sortConfig.key ? [...displayed].sort((a, b) => {
    const av = supplierSortValue(a, sortConfig.key);
    const bv = supplierSortValue(b, sortConfig.key);
    let cmp;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return sortConfig.direction === 'asc' ? cmp : -cmp;
  }) : displayed;

  function handleSort(key) {
    setSortConfig(prev => prev.key === key
      ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' });
  }

  const paginated = sorted.slice((page - 1) * pageSize, page * pageSize);

  if (view !== 'list') return (
    <Layout>
      <div style={{ padding:28, maxWidth:960, margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24 }}>
          <button className="btn btn-sm" onClick={() => setView('list')}>← Back</button>
          <h1 style={{ fontSize:20, fontWeight:600 }}>{view === 'new' ? 'New Supplier' : 'Edit Supplier'}</h1>
        </div>
        <SupplierForm supplierId={view === 'edit' ? editId : null} onSaved={() => setView('list')} />
      </div>
    </Layout>
  );

  return (
    <Layout>
      <div style={{ padding:28 }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
          <div>
            <h1 style={{ fontSize:22, fontWeight:600, marginBottom:2 }}>Suppliers</h1>
            <div style={{ color:'var(--text3)', fontSize:13 }}>
              {counts.pending} pending · {counts.approved} approved · {counts.rejected} rejected
            </div>
          </div>
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setView('new')}>+ New Supplier</button>
          )}
        </div>

        {/* Approval status tabs */}
        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          {APPROVAL_TABS.map(t => (
            <button key={t.key} onClick={() => setFilterApproval(t.key)}
              style={{ padding:'6px 16px', borderRadius:20, fontSize:13, cursor:'pointer', fontFamily:'inherit',
                border: filterApproval === t.key ? '1.5px solid var(--primary)' : '1.5px solid var(--border)',
                background: filterApproval === t.key ? 'var(--primary)' : 'transparent',
                color: filterApproval === t.key ? '#fff' : 'var(--text2)',
                fontWeight: filterApproval === t.key ? 600 : 400 }}>
              {t.label} <span style={{ fontSize:11, opacity:0.75 }}>({counts[t.key]})</span>
            </button>
          ))}
        </div>

        {/* Filter bar */}
        <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center', width:'40%' }}>
          <input
            placeholder="Search name, trader name, GST, PAN, vendor code…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex:'1 1 200px', minWidth:180, padding:'7px 12px', border:'1px solid var(--border)',
              borderRadius:8, fontSize:13, background:'var(--bg)', color:'var(--text)' }}
          />
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            style={{ padding:'7px 10px', border:'1px solid var(--border)', borderRadius:8, fontSize:13, background:'var(--bg)', color:'var(--text)' }}>
            <option value="">All Types</option>
            <option value="RESELLER">Reseller</option>
            <option value="DISTRIBUTOR">Distributor</option>
            <option value="OEM">OEM</option>
            <option value="OTHER">Other</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ padding:'7px 10px', border:'1px solid var(--border)', borderRadius:8, fontSize:13, background:'var(--bg)', color:'var(--text)' }}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {(search || filterType || filterStatus) && (
            <button className="btn btn-sm" onClick={() => { setSearch(''); setFilterType(''); setFilterStatus(''); }}>Clear</button>
          )}
        </div>

        <div className="card">
          {loading ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text3)' }}>Loading…</div>
          ) : sorted.length === 0 ? (
            <div style={{ padding:60, textAlign:'center', color:'var(--text3)' }}>
              <div style={{ fontSize:32, marginBottom:12 }}>🏢</div>
              <div style={{ fontWeight:500, marginBottom:6 }}>No suppliers found</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {SUPPLIER_COLUMNS.map(col => (
                      <th key={col.key} onClick={() => handleSort(col.key)} style={{ cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }} title="Click to sort">
                        {col.label}
                        <span style={{ marginLeft:4, fontSize:10, color: sortConfig.key === col.key ? 'var(--text)' : 'var(--text3)' }}>
                          {sortConfig.key === col.key ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '▲▼'}
                        </span>
                      </th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(s => (
                    <tr key={s.id}>
                      <td><span className="mono" style={{ fontSize:12 }}>{s.vendor_code||'—'}</span></td>
                      <td style={{ fontWeight:500 }}>{s.trade_name || s.supplier_name}</td>
                      <td>{s.supplier_type_label||'—'}</td>
                      <td className="mono">{s.gstin||'—'}</td>
                      <td>
                        {s.approval_status === 'approved' && <span className="badge badge-approved">Approved</span>}
                        {s.approval_status === 'rejected' && <span className="badge badge-rejected">Rejected</span>}
                        {(!s.approval_status || s.approval_status === 'pending') && <span className="badge badge-pending">Pending</span>}
                      </td>
                      <td style={{ fontSize:12, color: s.approval_status === 'rejected' ? 'var(--red)' : 'var(--text3)', maxWidth:180 }}>
                        {s.approval_notes || '—'}
                      </td>
                      <td style={{ color:'var(--text3)', fontSize:12 }}>{s.approved_by_name||'—'}</td>
                      <td>
                        <span className={`badge ${s.is_active ? 'badge-approved' : 'badge-rejected'}`}>
                          {s.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                          <button className="btn btn-sm" onClick={() => { setEditId(s.id); setView('edit'); }}>Edit
                            {/* {canEdit ? 'Edit' : 'View'} */}
                          </button>
                          {/* {canEdit && (
                            <button className="btn btn-sm" style={{ color: s.is_active ? 'var(--red)' : 'var(--green)' }}
                              onClick={() => handleToggle(s)}>
                              {s.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                          )} */}
                          {canApprove && s.approval_status === 'pending' && (
                            <>
                              <button className="btn btn-sm" style={{ color:'var(--green)' }}
                                onClick={() => { setModal({ supplier:s, action:'approve' }); setNotes(''); }}>
                                Approve
                              </button>
                              <button className="btn btn-sm" style={{ color:'var(--red)' }}
                                onClick={() => { setModal({ supplier:s, action:'reject' }); setNotes(''); }}>
                                Reject
                              </button>
                            </>
                          )}
                          {canApprove && s.approval_status !== 'pending' && (
                            <button className="btn btn-sm"
                              onClick={() => { setModal({ supplier:s, action:'approve' }); setNotes(''); }}>
                              Re-approve
                            </button>
                          )}
                          {isAdmin && (
                            <button className="btn btn-sm" style={{ color:'var(--red)' }}
                              onClick={() => handleDelete(s)}>
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

      {/* Approve / Reject Modal */}
      {modal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
          <div className="card" style={{ width:440, margin:0, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <div className="card-head">
              <div className="card-title" style={{ color: modal.action==='approve' ? 'var(--green)' : 'var(--red)' }}>
                {modal.action === 'approve' ? '✓ Approve Supplier' : '✕ Reject Supplier'}
              </div>
            </div>
            <div className="card-body">
              <div style={{ marginBottom:16 }}>
                <div style={{ fontWeight:500 }}>{modal.supplier.supplier_name}</div>
                <div style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>
                  {modal.supplier.vendor_code} · {modal.supplier.gstin||'No GST'}
                </div>
              </div>
              <div style={{ marginBottom:16 }}>
                <label style={{ fontSize:11, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.4px', display:'block', marginBottom:4 }}>
                  {modal.action === 'reject' ? 'Rejection Reason *' : 'Notes (optional)'}
                </label>
                <textarea style={{ ...inp, minHeight:80, resize:'vertical' }}
                  value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder={modal.action === 'reject' ? 'Reason for rejection…' : 'Any notes…'} />
              </div>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button className="btn" onClick={() => setModal(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}
                  style={{ background: modal.action==='approve' ? 'var(--green)' : 'var(--red)', borderColor: modal.action==='approve' ? 'var(--green)' : 'var(--red)' }}
                  onClick={handleApprovalAction}>
                  {saving ? 'Saving…' : modal.action === 'approve' ? 'Approve' : 'Reject'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
