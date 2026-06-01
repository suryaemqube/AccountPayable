import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import { StatusBadge, PaymentBadge, fmt, fmtDate } from '../components/Helpers';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export default function VoucherDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [lineItems, setLineItems] = useState([]);
  const [managers, setManagers] = useState([]);
  const [comment, setComment] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchVoucher();
    if (user.role === 'admin') fetchManagers();
  }, [id]);

  async function fetchVoucher() {
    try {
      const r = await api.get(`/vouchers/${id}`);
      setData(r.data);
      setForm(r.data.voucher);
      setLineItems(r.data.line_items);
    } catch { toast.error('Failed to load voucher'); }
    finally { setLoading(false); }
  }

  async function fetchManagers() {
    try {
      const r = await api.get('/managers');
      setManagers(r.data.managers);
    } catch { }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.put(`/vouchers/${id}`, { ...form, line_items: lineItems });
      toast.success('Voucher updated');
      setEditing(false);
      fetchVoucher();
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
      toast.success(action === 'approve' ? 'Sent for final approval' : 'Voucher rejected');
      fetchVoucher();
      setComment(''); setRejectReason(''); setShowReject(false);
    } catch (err) { toast.error(err.response?.data?.error || 'Action failed'); }
  }

  async function handleFinalApproval(action) {
    try {
      await api.post(`/vouchers/${id}/final-approval`, { action, comment });
      if (action === 'approve') {
        toast.success('Approved! Generating voucher PDF on server…');
        try {
          await api.post(`/vouchers/${id}/generate`);
          toast.success('Voucher PDF saved on server. Ready to download.');
        } catch {
          toast('Voucher approved. PDF will be generated on download.', { icon: '⚠️' });
        }
      } else {
        toast.success('Voucher rejected.');
      }
      fetchVoucher();
      setComment('');
    } catch (err) { toast.error(err.response?.data?.error || 'Action failed'); }
  }

  async function handleGenerate() {
    try {
      await api.post(`/vouchers/${id}/generate`);
      toast.success('Voucher PDF generated and saved on server.');
      fetchVoucher();
    } catch (err) { toast.error(err.response?.data?.error || 'Generate failed'); }
  }

  async function handleAddComment() {
    if (!comment.trim()) return;
    try {
      await api.post(`/vouchers/${id}/comments`, { comment });
      toast.success('Comment added');
      setComment('');
      fetchVoucher();
    } catch { toast.error('Failed to add comment'); }
  }

  async function handleDownload() {
    try {
      const r = await api.get(`/vouchers/${id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = voucher.voucher_no ? `voucher-${voucher.voucher_no.replace(/\//g, '-')}.pdf` : `voucher-${id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Voucher downloaded');
      fetchVoucher();
    } catch { toast.error('Download failed'); }
  }

  function updateLineItem(i, field, val) {
    const updated = [...lineItems];
    updated[i] = { ...updated[i], [field]: val };
    const li = updated[i];
    const taxable = (parseFloat(li.qty) || 0) * (parseFloat(li.rate) || 0);
    const cgst = taxable * ((parseFloat(li.cgst_rate) || 0) / 100);
    const sgst = taxable * ((parseFloat(li.sgst_rate) || 0) / 100);
    updated[i].taxable_amount = taxable;
    updated[i].cgst_amount = cgst;
    updated[i].sgst_amount = sgst;
    updated[i].total = taxable + cgst + sgst;
    setLineItems(updated);
    const totTaxable = updated.reduce((s, l) => s + (parseFloat(l.taxable_amount) || 0), 0);
    const totCgst = updated.reduce((s, l) => s + (parseFloat(l.cgst_amount) || 0), 0);
    const totSgst = updated.reduce((s, l) => s + (parseFloat(l.sgst_amount) || 0), 0);
    setForm(f => ({ ...f, taxable_amount: totTaxable, cgst: totCgst, sgst: totSgst, total_amount: totTaxable + totCgst + totSgst }));
  }

  function addLineItem() {
    setLineItems(l => [...l, { description: '', hsn_code: '', qty: 1, rate: 0, taxable_amount: 0, cgst_rate: 9, cgst_amount: 0, sgst_rate: 9, sgst_amount: 0, igst_rate: 0, igst_amount: 0, total: 0 }]);
  }

  function removeLineItem(i) {
    setLineItems(l => l.filter((_, idx) => idx !== i));
  }

  if (loading) return <Layout><div style={{ padding: 40, textAlign: 'center' }}>Loading…</div></Layout>;
  if (!data) return <Layout><div style={{ padding: 40 }}>Voucher not found</div></Layout>;

  const { voucher, comments } = data;
  const isAdmin = user.role === 'admin';
  const canEdit = isAdmin && ['draft', 'assigned'].includes(voucher.status);
  const canAssign = isAdmin && ['draft', 'assigned'].includes(voucher.status);
  const canManagerAct = user.role === 'manager' && voucher.status === 'assigned';
  const canFinalApprove = isAdmin && voucher.status === 'pending_approval';
  const canDownload = ['approved', 'downloaded'].includes(voucher.status);
  const canGenerate = isAdmin && ['approved', 'downloaded'].includes(voucher.status);

  return (
    <Layout>
      <div style={{ padding: 28, maxWidth: 960 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
          <button className="btn btn-sm" onClick={() => nav(-1)}>← Back</button>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h1 style={{ fontSize: 20, fontWeight: 600 }}>
                {voucher.invoice_no || 'Untitled Invoice'}
              </h1>
              <StatusBadge status={voucher.status} />
              <PaymentBadge status={voucher.payment_status} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>
              {voucher.supplier_name} · Created {fmtDate(voucher.created_at)}
              {voucher.assigned_to_name && ` · Assigned to ${voucher.assigned_to_name}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {canEdit && !editing && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
            {editing && <><button className="btn btn-green" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button><button className="btn" onClick={() => { setEditing(false); setForm(voucher); setLineItems(data.line_items); }}>Cancel</button></>}
            {canGenerate && !voucher.voucher_pdf_path && <button className="btn" onClick={handleGenerate}>⚙ Generate PDF</button>}
            {canDownload && <button className="btn btn-green" onClick={handleDownload}>⬇ Download PDF</button>}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
          <div>
            {/* Invoice preview */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><div className="card-title">Invoice file</div></div>
              <div className="card-body">
                <a href={`/api/vouchers/${id}/invoice`} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                  className="btn">
                  📎 View / Download Invoice
                </a>
              </div>
            </div>

            {/* Voucher fields */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><div className="card-title">Voucher details</div></div>
              <div className="card-body">
                {editing ? (
                  <>
                    <div className="form-row">
                      <div className="form-group"><label>Invoice No.</label><input value={form.invoice_no || ''} onChange={e => setForm(f => ({ ...f, invoice_no: e.target.value }))} /></div>
                      <div className="form-group"><label>Supplier Name</label><input value={form.supplier_name || ''} onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))} /></div>
                    </div>
                    <div className="form-row">
                      <div className="form-group"><label>Supplier GSTIN</label><input value={form.supplier_gstin || ''} onChange={e => setForm(f => ({ ...f, supplier_gstin: e.target.value }))} /></div>
                      <div className="form-group"><label>Payment Terms</label><input value={form.payment_terms || ''} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))} /></div>
                    </div>
                    <div className="form-row">
                      <div className="form-group"><label>Invoice Date</label><input type="date" value={form.invoice_date ? form.invoice_date.slice(0, 10) : ''} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} /></div>
                      <div className="form-group"><label>Due Date</label><input type="date" value={form.due_date ? form.due_date.slice(0, 10) : ''} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
                    </div>
                    <div className="form-row">
                      <div className="form-group"><label>Payment Status</label>
                        <select value={form.payment_status || 'unpaid'} onChange={e => setForm(f => ({ ...f, payment_status: e.target.value }))}>
                          <option value="unpaid">Unpaid</option>
                          <option value="paid">Paid</option>
                          <option value="partial">Partial</option>
                        </select>
                      </div>
                      <div className="form-group"><label>Payment Reference</label><input value={form.payment_reference || ''} onChange={e => setForm(f => ({ ...f, payment_reference: e.target.value }))} placeholder="UTR / Cheque No." /></div>
                    </div>
                    <div className="form-group"><label>Narration</label><textarea rows={2} value={form.narration || ''} onChange={e => setForm(f => ({ ...f, narration: e.target.value }))} /></div>
                  </>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {[
                      ['Invoice No.', voucher.invoice_no],
                      ['Supplier', voucher.supplier_name],
                      ['GSTIN', voucher.supplier_gstin],
                      ['Payment Terms', voucher.payment_terms],
                      ['Invoice Date', fmtDate(voucher.invoice_date)],
                      ['Due Date', fmtDate(voucher.due_date)],
                    ].map(([l, v]) => (
                      <div key={l}>
                        <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>{l}</div>
                        <div style={{ fontWeight: 500 }}>{v || '—'}</div>
                      </div>
                    ))}
                    {voucher.narration && (
                      <div style={{ gridColumn: '1/-1' }}>
                        <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>Narration</div>
                        <div>{voucher.narration}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Line items */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <div className="card-title">Line items</div>
                {editing && <button className="btn btn-sm" onClick={addLineItem}>+ Add line</button>}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Description</th><th>HSN</th><th>Qty</th><th>Rate</th>
                      <th>Taxable</th><th>CGST%</th><th>SGST%</th><th>Total</th>
                      {editing && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((li, i) => editing ? (
                      <tr key={i}>
                        <td><input value={li.description || ''} onChange={e => updateLineItem(i, 'description', e.target.value)} style={{ width: 160, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6 }} /></td>
                        <td><input value={li.hsn_code || ''} onChange={e => updateLineItem(i, 'hsn_code', e.target.value)} style={{ width: 70, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6 }} /></td>
                        <td><input type="number" value={li.qty} onChange={e => updateLineItem(i, 'qty', e.target.value)} style={{ width: 60, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6 }} /></td>
                        <td><input type="number" value={li.rate} onChange={e => updateLineItem(i, 'rate', e.target.value)} style={{ width: 80, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6 }} /></td>
                        <td className="mono">{fmt(li.taxable_amount)}</td>
                        <td><input type="number" value={li.cgst_rate} onChange={e => updateLineItem(i, 'cgst_rate', e.target.value)} style={{ width: 50, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6 }} /></td>
                        <td><input type="number" value={li.sgst_rate} onChange={e => updateLineItem(i, 'sgst_rate', e.target.value)} style={{ width: 50, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6 }} /></td>
                        <td className="mono" style={{ fontWeight: 600 }}>{fmt(li.total)}</td>
                        <td><button onClick={() => removeLineItem(i)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16 }}>×</button></td>
                      </tr>
                    ) : (
                      <tr key={i}>
                        <td>{li.description}</td>
                        <td className="mono">{li.hsn_code || '—'}</td>
                        <td>{li.qty}</td>
                        <td className="mono">{fmt(li.rate)}</td>
                        <td className="mono">{fmt(li.taxable_amount)}</td>
                        <td>{li.cgst_rate}%</td>
                        <td>{li.sgst_rate}%</td>
                        <td className="mono" style={{ fontWeight: 600 }}>{fmt(li.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ minWidth: 240 }}>
                  {[['Taxable', form.taxable_amount], ['CGST', form.cgst], ['SGST', form.sgst], form.igst > 0 && ['IGST', form.igst]].filter(Boolean).map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--text3)' }}>{l}</span><span className="mono">{fmt(v)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 15, fontWeight: 600 }}>
                    <span>Total</span><span className="mono">{fmt(form.total_amount)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right panel */}
          <div>
            {/* Assign (admin) */}
            {canAssign && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><div className="card-title">Assign to manager</div></div>
                <div className="card-body">
                  <div className="form-group">
                    <label>Manager</label>
                    <select value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                      <option value="">Select manager…</option>
                      {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleAssign}>
                    Assign
                  </button>
                </div>
              </div>
            )}

            {/* Manager action */}
            {canManagerAct && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><div className="card-title">Review decision</div></div>
                <div className="card-body">
                  {!showReject ? (
                    <>
                      <div className="form-group">
                        <label>Comment (optional)</label>
                        <textarea rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="Add review notes…" />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-green" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleManagerAction('approve')}>✓ Approve</button>
                        <button className="btn btn-red" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowReject(true)}>✕ Reject</button>
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

            {/* Final approval (admin) */}
            {canFinalApprove && (
              <div className="card" style={{ marginBottom: 16, borderColor: '#B8AEED' }}>
                <div className="card-head" style={{ background: 'var(--purple-l)' }}>
                  <div className="card-title" style={{ color: 'var(--purple)' }}>Final approval</div>
                </div>
                <div className="card-body">
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
                    Manager has approved this voucher. Give your final authorization.
                  </div>
                  {voucher.manager_comment && (
                    <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Manager's comment</div>
                      {voucher.manager_comment}
                    </div>
                  )}
                  <div className="form-group">
                    <label>Comment (optional)</label>
                    <textarea rows={2} value={comment} onChange={e => setComment(e.target.value)} placeholder="Authorization notes…" />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-green" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleFinalApproval('approve')}>✓ Final Approve</button>
                    <button className="btn btn-red" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleFinalApproval('reject')}>✕ Reject</button>
                  </div>
                </div>
              </div>
            )}

            {/* Rejection info */}
            {voucher.status === 'rejected' && voucher.rejected_reason && (
              <div className="card" style={{ marginBottom: 16, borderColor: '#f09595' }}>
                <div className="card-head" style={{ background: 'var(--red-l)' }}>
                  <div className="card-title" style={{ color: 'var(--red)' }}>Rejected</div>
                </div>
                <div className="card-body" style={{ fontSize: 13, color: 'var(--red)' }}>
                  {voucher.rejected_reason}
                </div>
              </div>
            )}

            {/* Comments */}
            <div className="card">
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
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', outline: 'none' }} />
                  <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={handleAddComment}>Post comment</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
