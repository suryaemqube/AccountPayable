import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import toast from 'react-hot-toast';

// ── Constants ─────────────────────────────────────────────────────────────────

const ADDRESS_TYPES = [
  { key: 'registered', label: 'Registered Office Address', required: true  },
  { key: 'billing',    label: 'Billing Address',           required: true  },
  { key: 'shipping',   label: 'Shipping Address',          required: false },
];

// Documents section (uploads)
const DOCUMENT_TYPES = [
  { key: 'cancelled_cheque',  label: 'Cancelled Cheque Copy',            mandatory: true  },
  { key: 'bank_verification', label: 'Bank Verification Letter',         mandatory: false },
  { key: 'company_reg_cert',  label: 'Company Registration Certificate', mandatory: false },
  { key: 'nda',               label: 'NDA (if required)',                 mandatory: false },
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
function DocRow({ dt, uploaded, pending, isUploading, supplierId, onUpload, onDelete, onStage, onRemoveStage, fileRef }) {
  return (
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
            <a href={`/api/suppliers/${supplierId}/documents/${uploaded.id}`} target="_blank" rel="noreferrer" className="btn btn-sm">View</a>
            <button className="btn btn-sm" style={{ color:'var(--red)' }} onClick={() => onDelete(uploaded)}>Remove</button>
          </>
        ) : pending ? (
          <>
            <span style={{ fontSize:12, color:'#ca8a04' }}>Will upload on save</span>
            <button className="btn btn-sm" style={{ color:'var(--red)' }} onClick={onRemoveStage}>×</button>
          </>
        ) : (
          <>
            <input type="file" ref={fileRef} style={{ display:'none' }} accept=".pdf,.jpg,.jpeg,.png"
              onChange={e => onUpload(e.target.files[0])} />
            <button className="btn btn-sm" disabled={isUploading} onClick={() => fileRef.current?.click()}>
              {isUploading ? 'Uploading…' : 'Upload'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Supplier Form ─────────────────────────────────────────────────────────────
function SupplierForm({ supplierId, onSaved }) {
  const isEdit = !!supplierId;

  const [form, setForm] = useState({
    // Basic Information
    supplier_name:'', trade_name:'', vendor_code:'', supplier_type:'',
    gstin:'', cin_number:'', msme_reg_number:'',
    // Tax & Compliance
    pan_number:'', gst_certificate:'', tds_applicable:false,
    lower_deduction_cert:'', msme_declaration:'', udyam_reg_number:'',
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
          supplier_name:s.supplier_name||'', trade_name:s.trade_name||'',
          vendor_code:s.vendor_code||'', supplier_type:s.supplier_type||'',
          gstin:s.gstin||'', cin_number:s.cin_number||'', msme_reg_number:s.msme_reg_number||'',
          pan_number:s.pan_number||'', gst_certificate:s.gst_certificate||'',
          tds_applicable:s.tds_applicable||false, lower_deduction_cert:s.lower_deduction_cert||'',
          msme_declaration:s.msme_declaration||'', udyam_reg_number:s.udyam_reg_number||'',
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
    if (!supplierId) { setPendingFiles(p => ({ ...p, [docType]: file })); return; }
    uploadDocToServer(supplierId, docType, file);
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
    if (!form.gstin.trim())            return 'GST Number is required';
    if (!form.msme_reg_number.trim())  return 'MSME Registration Number is required';
    const c0 = contacts[0];
    if (!c0?.primary_contact_name?.trim()) return 'Contact Person Name is required';
    if (!c0?.designation?.trim())          return 'Contact Designation is required';
    if (!c0?.mobile?.trim())               return 'Contact Mobile Number is required';
    if (!c0?.website?.trim())              return 'Contact Website is required';
    const b0 = banks[0];
    if (!b0?.bank_name?.trim())           return 'Bank Name is required';
    if (!b0?.branch_name?.trim())         return 'Bank Branch Name is required';
    if (!b0?.account_holder_name?.trim()) return 'Account Holder Name is required';
    if (!b0?.account_number?.trim())      return 'Account Number is required';
    if (!b0?.ifsc_code?.trim())           return 'IFSC Code is required';
    if (!form.pan_number.trim())          return 'PAN Number is required';
    if (!form.gst_certificate.trim())     return 'GST Certificate is required';
    if (!form.msme_declaration.trim())    return 'MSME Declaration is required';
    if (!form.udyam_reg_number.trim())    return 'UDYAM Registration Number is required';
    if (!form.products_services)          return 'Products / Services is required';
    if (!form.territory)                  return 'Territory / Region is required';
    return null;
  }

  function handleSave() {
    const err = validate();
    if (err) return toast.error(err);
    if (isEdit) {
      // Show reason modal before updating
      setChangeReason('');
      setShowReasonModal(true);
    } else {
      doSave('New');
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
        toast.success('Supplier updated — pending re-approval');
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
              <Label text="GST Number" required />
              <input style={inp} value={form.gstin} onChange={e => setF('gstin', e.target.value.toUpperCase())} placeholder="27AAXCA1234M1Z5" maxLength={15} />
            </div>
            <div style={fg}>
              <Label text="CIN Number" />
              <input style={inp} value={form.cin_number} onChange={e => setF('cin_number', e.target.value.toUpperCase())} placeholder="U12345MH2000PTC123456" />
            </div>
          </div>
          <div style={row3}>
            <div style={fg}>
              <Label text="MSME Registration Number" required />
              <input style={inp} value={form.msme_reg_number} onChange={e => setF('msme_reg_number', e.target.value)} />
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
                  <Label text="Designation" required={i===0} />
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
                  <Label text="Website" required={i===0} />
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
                      <select style={inp} value={a.state} onChange={e => setAddr(i,'state',e.target.value)}>
                        <option value="">Select state…</option>
                        {stateOptions.map(s => <option key={s.parameterdetid} value={s.parametervalues}>{s.parametervalues}</option>)}
                      </select>
                    ) : (
                      <input style={a.country ? inp : inpRO}
                        value={a.country ? a.state : ''}
                        placeholder={a.country ? 'Enter state' : 'Select country first'}
                        readOnly={!a.country}
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

      {/* ── 5. Tax & Compliance ── */}
      <div className="card" style={{ marginBottom:16 }}>
        <SectionHead title="Tax & Compliance" />
        <div className="card-body">
          <div style={row3}>
            <div style={fg}>
              <Label text="PAN Copy (PAN Number)" required />
              <input style={inp} value={form.pan_number} onChange={e => setF('pan_number', e.target.value.toUpperCase())} placeholder="AAXCA1234M" maxLength={10} />
            </div>
            <div style={fg}>
              <Label text="GST Certificate" required />
              <input style={inp} value={form.gst_certificate} onChange={e => setF('gst_certificate', e.target.value)} placeholder="GST registration certificate no." />
            </div>
            <div style={fg}>
              <Label text="UDYAM Registration Number" required />
              <input style={inp} value={form.udyam_reg_number} onChange={e => setF('udyam_reg_number', e.target.value)} />
            </div>
          </div>
          <div style={row3}>
            <div style={fg}>
              <Label text="MSME Declaration" required />
              <input style={inp} value={form.msme_declaration} onChange={e => setF('msme_declaration', e.target.value)} placeholder="MSME declaration reference" />
            </div>
            <div style={fg}>
              <Label text="Lower Deduction Certificate" />
              <input style={inp} value={form.lower_deduction_cert} onChange={e => setF('lower_deduction_cert', e.target.value)} placeholder="Certificate no. (optional)" />
            </div>
            <div style={{ ...fg, justifyContent:'flex-end' }}>
              <label style={{ fontSize:11, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.4px', display:'block', marginBottom:4 }}>&nbsp;</label>
              <div style={{ display:'flex', alignItems:'center', gap:8, paddingTop:6 }}>
                <input type="checkbox" id="tds_applicable" checked={form.tds_applicable} onChange={e => setF('tds_applicable', e.target.checked)} style={{ width:14, height:14, cursor:'pointer' }} />
                <label htmlFor="tds_applicable" style={{ fontSize:13, cursor:'pointer' }}>TDS Applicable</label>
              </div>
            </div>
          </div>
          <div style={row2}>
            <div style={fg}>
              <Label text="PF Registration" />
              <input style={inp} value={form.pf_registration} onChange={e => setF('pf_registration', e.target.value)} placeholder="Mandatory if Services" />
            </div>
            <div style={fg}>
              <Label text="ESIC Registration" />
              <input style={inp} value={form.esic_registration} onChange={e => setF('esic_registration', e.target.value)} placeholder="Mandatory if Services" />
            </div>
          </div>
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
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Update Supplier' : 'Create Supplier'}
        </button>
      </div>

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
export default function SupplierMaster() {
  const location = useLocation();
  const [suppliers, setSuppliers] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [view,      setView]      = useState('list');
  const [editId,    setEditId]    = useState(null);
  const [search,    setSearch]    = useState('');
  const [filterType,     setFilterType]     = useState('');
  const [filterApproval, setFilterApproval] = useState('');
  const [filterStatus,   setFilterStatus]   = useState('active');

  useEffect(() => { if (view === 'list') fetchSuppliers(); }, [view]);

  // Auto-open supplier when navigated from Supplier Approvals
  useEffect(() => {
    const openId = location.state?.openSupplierId;
    if (openId) { setEditId(openId); setView('edit'); }
  }, [location.state]);

  async function fetchSuppliers() {
    setLoading(true);
    try {
      const r = await api.get('/suppliers?approved_only=true');
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
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
          <div>
            <h1 style={{ fontSize:22, fontWeight:600, marginBottom:2 }}>Supplier Master</h1>
            <div style={{ color:'var(--text3)', fontSize:13 }}>
              {suppliers.filter(s => s.is_active).length} active · {suppliers.length} total
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setView('new')}>+ New Supplier</button>
        </div>

        {/* Filter bar */}
        <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
          <input
            placeholder="Search name, GST, PAN, vendor code…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex:1, minWidth:220, padding:'7px 12px', border:'1px solid var(--border)',
              borderRadius:8, fontSize:13, background:'var(--bg)', color:'var(--text)' }}
          />
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            style={{ padding:'7px 10px', border:'1px solid var(--border)', borderRadius:8, fontSize:13,
              background:'var(--bg)', color:'var(--text)' }}>
            <option value="">All Types</option>
            <option value="RESELLER">Reseller</option>
            <option value="DISTRIBUTOR">Distributor</option>
            <option value="OEM">OEM</option>
          </select>
          <select value={filterApproval} onChange={e => setFilterApproval(e.target.value)}
            style={{ padding:'7px 10px', border:'1px solid var(--border)', borderRadius:8, fontSize:13,
              background:'var(--bg)', color:'var(--text)' }}>
            <option value="">All Approvals</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ padding:'7px 10px', border:'1px solid var(--border)', borderRadius:8, fontSize:13,
              background:'var(--bg)', color:'var(--text)' }}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="">All</option>
          </select>
          {(search || filterType || filterApproval || filterStatus) && (
            <button className="btn btn-sm" onClick={() => { setSearch(''); setFilterType(''); setFilterApproval(''); setFilterStatus('active'); }}>
              Clear
            </button>
          )}
        </div>

        <div className="card">
          {loading ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text3)' }}>Loading…</div>
          ) : suppliers.length === 0 ? (
            <div style={{ padding:60, textAlign:'center', color:'var(--text3)' }}>
              <div style={{ fontSize:32, marginBottom:12 }}>🏢</div>
              <div style={{ fontWeight:500, marginBottom:6 }}>No suppliers yet</div>
              <div style={{ fontSize:13 }}>Add your first supplier to get started</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Vendor Code</th>
                    <th>Supplier Name</th>
                    <th>Trade Name</th>
                    <th>Type</th>
                    <th>GST Number</th>
                    <th>PAN</th>
                    <th>Owned By</th>
                    <th>Status</th>
                    <th>Approval</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.filter(s => {
                    const q = search.toLowerCase();
                    if (q && ![ s.supplier_name, s.gstin, s.pan_number, s.vendor_code ]
                      .some(v => v && v.toLowerCase().includes(q))) return false;
                    if (filterType && (s.supplier_type || '').toUpperCase() !== filterType) return false;
                    if (filterApproval && s.approval_status !== filterApproval) return false;
                    if (filterStatus === 'active'   && !s.is_active) return false;
                    if (filterStatus === 'inactive' &&  s.is_active) return false;
                    return true;
                  }).map(s => (
                    <tr key={s.id}>
                      <td><span className="mono" style={{ fontSize:12 }}>{s.vendor_code||'—'}</span></td>
                      <td style={{ fontWeight:500 }}>{s.supplier_name}</td>
                      <td style={{ color:'var(--text3)' }}>{s.trade_name||'—'}</td>
                      <td>{s.supplier_type_label||'—'}</td>
                      <td className="mono">{s.gstin||'—'}</td>
                      <td className="mono">{s.pan_number||'—'}</td>
                      <td>{s.owned_by_name||'—'}</td>
                      <td>
                        <span className={`badge ${s.is_active ? 'badge-approved' : 'badge-rejected'}`}>
                          {s.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        {s.approval_status === 'approved' && <span className="badge badge-approved">Approved</span>}
                        {s.approval_status === 'rejected' && <span className="badge badge-rejected">Rejected</span>}
                        {(!s.approval_status || s.approval_status === 'pending') && <span className="badge badge-pending">Pending</span>}
                      </td>
                      <td>
                        <div style={{ display:'flex', gap:6 }}>
                          <button className="btn btn-sm" onClick={() => { setEditId(s.id); setView('edit'); }}>Edit</button>
                          <button className="btn btn-sm" style={{ color: s.is_active ? 'var(--red)' : 'var(--green)' }}
                            onClick={() => handleToggle(s)}>
                            {s.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
