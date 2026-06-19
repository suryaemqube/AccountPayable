import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

const STATUS_BADGE = {
  pending:  { label:'Pending',  cls:'badge-pending'  },
  approved: { label:'Approved', cls:'badge-approved' },
  rejected: { label:'Rejected', cls:'badge-rejected' },
};

const inp = { border:'1px solid var(--border)', borderRadius:6, padding:'7px 10px', fontSize:13, background:'var(--bg)', color:'var(--text)', outline:'none', width:'100%', fontFamily:'inherit' };

export default function SupplierApprovals() {
  const { user } = useAuth();
  const nav = useNavigate();
  const isApprover = user?.role === 'approver';

  const [suppliers, setSuppliers] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState('pending');
  const [modal,     setModal]     = useState(null); // { supplier, action }
  const [notes,     setNotes]     = useState('');
  const [saving,    setSaving]    = useState(false);

  useEffect(() => { fetchSuppliers(); }, []);

  async function fetchSuppliers() {
    setLoading(true);
    try {
      const r = await api.get('/suppliers');
      setSuppliers(r.data.suppliers);
    } catch { toast.error('Failed to load suppliers'); }
    finally { setLoading(false); }
  }

  const displayed = filter === 'all'
    ? suppliers
    : suppliers.filter(s => s.approval_status === filter);

  async function handleAction() {
    if (!modal) return;
    if (modal.action === 'reject' && !notes.trim()) return toast.error('Rejection reason is required');
    setSaving(true);
    try {
      await api.post(`/suppliers/${modal.supplier.id}/approve`, { action: modal.action, notes });
      toast.success(modal.action === 'approve' ? 'Supplier approved' : 'Supplier rejected');
      setModal(null); setNotes('');
      fetchSuppliers();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    } finally { setSaving(false); }
  }

  const counts = {
    all:      suppliers.length,
    pending:  suppliers.filter(s => s.approval_status === 'pending').length,
    approved: suppliers.filter(s => s.approval_status === 'approved').length,
    rejected: suppliers.filter(s => s.approval_status === 'rejected').length,
  };

  const supplierMasterPath = `/${user?.role === 'executive' ? 'executive' : 'approver'}/supplier-master`;

  return (
    <Layout>
      <div style={{ padding:28 }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
          <div>
            <h1 style={{ fontSize:22, fontWeight:600, marginBottom:2 }}>Supplier Approvals</h1>
            <div style={{ color:'var(--text3)', fontSize:13 }}>
              {counts.pending} pending · {counts.approved} approved · {counts.rejected} rejected
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display:'flex', gap:8, marginBottom:20 }}>
          {[['pending','Pending'],['approved','Approved'],['rejected','Rejected'],['all','All']].map(([k,l]) => (
            <button key={k} onClick={() => setFilter(k)}
              style={{ padding:'6px 16px', borderRadius:20, fontSize:13, cursor:'pointer', fontFamily:'inherit',
                border: filter===k ? '1.5px solid var(--primary)' : '1.5px solid var(--border)',
                background: filter===k ? 'var(--primary)' : 'transparent',
                color: filter===k ? '#fff' : 'var(--text2)',
                fontWeight: filter===k ? 600 : 400 }}>
              {l} <span style={{ fontSize:11, opacity:0.75 }}>({counts[k]})</span>
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="card">
          {loading ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text3)' }}>Loading…</div>
          ) : displayed.length === 0 ? (
            <div style={{ padding:60, textAlign:'center', color:'var(--text3)' }}>
              No {filter === 'all' ? '' : filter} suppliers
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Vendor Code</th>
                    <th>Supplier Name</th>
                    <th>Type</th>
                    <th>GST Number</th>
                    <th>Submitted</th>
                    <th>Approval</th>
                    <th>Approved By</th>
                    <th>Last Approved</th>
                    <th>Notes / Reason</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map(s => {
                    const badge = STATUS_BADGE[s.approval_status] || STATUS_BADGE.pending;
                    return (
                      <tr key={s.id}>
                        <td><span className="mono" style={{ fontSize:12 }}>{s.vendor_code||'—'}</span></td>
                        <td style={{ fontWeight:500 }}>{s.supplier_name}</td>
                        <td>{s.supplier_type_label||'—'}</td>
                        <td className="mono">{s.gstin||'—'}</td>
                        <td style={{ color:'var(--text3)' }}>{fmtDate(s.created_at)}</td>
                        <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                        <td style={{ color:'var(--text3)' }}>{s.approved_by_name||'—'}</td>
                        <td style={{ color:'var(--text3)' }}>{fmtDate(s.last_approved_at)}</td>
                        <td style={{ fontSize:12, color: s.approval_status === 'rejected' ? 'var(--red)' : 'var(--text3)', maxWidth:200 }}>
                          {s.approval_notes || '—'}
                        </td>
                        <td>
                          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                            {/* View button — all roles */}
                            <button className="btn btn-sm"
                              onClick={() => nav(supplierMasterPath, { state: { openSupplierId: s.id } })}>
                              View
                            </button>
                            {/* Approve/Reject — approver only */}
                            {isApprover && s.approval_status === 'pending' && (
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
                            {isApprover && s.approval_status !== 'pending' && (
                              <button className="btn btn-sm"
                                onClick={() => { setModal({ supplier:s, action:'approve' }); setNotes(''); }}>
                                Re-approve
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                  placeholder={modal.action === 'reject' ? 'Reason for rejection…' : 'Any notes for this approval…'} />
              </div>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button className="btn" onClick={() => setModal(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}
                  style={{ background: modal.action==='approve' ? 'var(--green)' : 'var(--red)', borderColor: modal.action==='approve' ? 'var(--green)' : 'var(--red)' }}
                  onClick={handleAction}>
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
