import { useEffect, useState } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import toast from 'react-hot-toast';

const emptyBank = { bank_name: '', account_name: '', account_number: '', ifsc_code: '', branch_name: '', is_primary: false };
const emptyForm = { company_name: '', address: '', tel: '', banks: [{ ...emptyBank, is_primary: true }] };

export default function CompanyDetails() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState(null);
  const [form, setForm]           = useState(emptyForm);
  const [saving, setSaving]       = useState(false);

  useEffect(() => { fetchCompanies(); }, []);

  async function fetchCompanies() {
    try {
      const r = await api.get('/company');
      setCompanies(r.data.companies);
    } catch { toast.error('Failed to load company details'); }
    finally { setLoading(false); }
  }

  function openNew() {
    setEditId(null);
    setForm({ ...emptyForm, banks: [{ ...emptyBank, is_primary: true }] });
    setShowForm(true);
  }

  function openEdit(c) {
    setEditId(c.id);
    setForm({
      company_name: c.company_name,
      address: c.address || '',
      tel: c.tel || '',
      banks: c.banks?.length ? c.banks.map(b => ({ ...b })) : [{ ...emptyBank, is_primary: true }],
    });
    setShowForm(true);
  }

  // ── Bank helpers ──
  function setBank(i, field, val) {
    setForm(f => {
      const banks = f.banks.map((b, idx) => idx === i ? { ...b, [field]: val } : b);
      return { ...f, banks };
    });
  }

  function addBank() {
    setForm(f => ({ ...f, banks: [...f.banks, { ...emptyBank }] }));
  }

  function removeBank(i) {
    setForm(f => ({ ...f, banks: f.banks.filter((_, idx) => idx !== i) }));
  }

  function setPrimary(i) {
    setForm(f => ({
      ...f,
      banks: f.banks.map((b, idx) => ({ ...b, is_primary: idx === i })),
    }));
  }

  async function handleSave() {
    if (!form.company_name.trim()) return toast.error('Company name required');
    setSaving(true);
    try {
      if (editId) {
        await api.put(`/company/${editId}`, form);
        toast.success('Company updated');
      } else {
        await api.post('/company', form);
        toast.success('Company created');
      }
      setShowForm(false);
      setEditId(null);
      fetchCompanies();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(id) {
    if (!window.confirm('Deactivate this company?')) return;
    try {
      await api.delete(`/company/${id}`);
      toast.success('Company deactivated');
      fetchCompanies();
    } catch { toast.error('Failed'); }
  }

  return (
    <Layout>
      <div style={{ padding: 28, maxWidth: 860 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>Our Company Details</h1>
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>Manage company info &amp; bank accounts printed on vouchers</div>
          </div>
          <button className="btn btn-primary" onClick={openNew}>+ Add Company</button>
        </div>

        {/* Form */}
        {showForm && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-head">
              <div className="card-title">{editId ? 'Edit Company' : 'New Company'}</div>
            </div>
            <div className="card-body">
              {/* Company header fields */}
              <div className="form-row">
                <div className="form-group">
                  <label>Company Name *</label>
                  <input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Swan Solutions & Services Pvt. Ltd." />
                </div>
                <div className="form-group">
                  <label>Telephone</label>
                  <input value={form.tel} onChange={e => setForm(f => ({ ...f, tel: e.target.value }))} placeholder="022-2803 4070" />
                </div>
              </div>
              <div className="form-group">
                <label>Address</label>
                <textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} rows={2}
                  placeholder="404-405, T Square, Chandivali Junction..." style={{ resize: 'vertical' }} />
              </div>

              {/* Bank accounts */}
              <div style={{ marginTop: 20, marginBottom: 8, fontWeight: 600, fontSize: 13, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                Bank Accounts
              </div>

              {form.banks.map((b, i) => (
                <div key={i} className="card" style={{ marginBottom: 12, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                  <div className="card-body" style={{ paddingTop: 12, paddingBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontWeight: 500, fontSize: 13 }}>Bank #{i + 1}</span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                          <input type="radio" checked={b.is_primary} onChange={() => setPrimary(i)} />
                          Primary
                        </label>
                        {form.banks.length > 1 && (
                          <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeBank(i)}>Remove</button>
                        )}
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Bank Name</label>
                        <input value={b.bank_name} onChange={e => setBank(i, 'bank_name', e.target.value)} placeholder="HDFC Bank" />
                      </div>
                      <div className="form-group">
                        <label>Account Holder Name</label>
                        <input value={b.account_name} onChange={e => setBank(i, 'account_name', e.target.value)} placeholder="Swan Solutions & Services Pvt. Ltd." />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Account Number</label>
                        <input value={b.account_number} onChange={e => setBank(i, 'account_number', e.target.value)} placeholder="XXXXXXXXXXXX" />
                      </div>
                      <div className="form-group">
                        <label>IFSC Code</label>
                        <input value={b.ifsc_code} onChange={e => setBank(i, 'ifsc_code', e.target.value)} placeholder="HDFC0001234" />
                      </div>
                      <div className="form-group">
                        <label>Branch</label>
                        <input value={b.branch_name} onChange={e => setBank(i, 'branch_name', e.target.value)} placeholder="Andheri East" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <button className="btn btn-sm" onClick={addBank} style={{ marginBottom: 16 }}>+ Add Bank Account</button>

              <div style={{ display: 'flex', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : (editId ? 'Update' : 'Create')}</button>
                <button className="btn" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Loading…</div>
        ) : companies.length === 0 && !showForm ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
            No companies yet. Add one to get started.
          </div>
        ) : (
          companies.map(c => (
            <div className="card" key={c.id} style={{ marginBottom: 16 }}>
              <div className="card-head">
                <div>
                  <div className="card-title">{c.company_name}</div>
                  {c.tel && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Tel: {c.tel}</div>}
                  {c.address && <div style={{ fontSize: 12, color: 'var(--text3)' }}>{c.address}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm" onClick={() => openEdit(c)}>Edit</button>
                  <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => handleDeactivate(c.id)}>Deactivate</button>
                </div>
              </div>

              {c.banks?.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Bank</th><th>Account Holder</th><th>Account No.</th><th>IFSC</th><th>Branch</th><th></th></tr>
                    </thead>
                    <tbody>
                      {c.banks.map(b => (
                        <tr key={b.id}>
                          <td style={{ fontWeight: 500 }}>{b.bank_name}</td>
                          <td style={{ color: 'var(--text3)' }}>{b.account_name}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{b.account_number}</td>
                          <td style={{ color: 'var(--text3)', fontSize: 12 }}>{b.ifsc_code}</td>
                          <td style={{ color: 'var(--text3)' }}>{b.branch_name}</td>
                          <td>
                            {b.is_primary && <span className="badge badge-approved">Primary</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(!c.banks || c.banks.length === 0) && (
                <div style={{ padding: '12px 20px', color: 'var(--text3)', fontSize: 13 }}>No bank accounts added.</div>
              )}
            </div>
          ))
        )}
      </div>
    </Layout>
  );
}
