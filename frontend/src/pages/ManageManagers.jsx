import { useEffect, useState } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import toast from 'react-hot-toast';
import { fmtDate } from '../components/Helpers';

export default function ManageManagers() {
  const [managers, setManagers] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [roles, setRoles]       = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]     = useState(null);
  const [form, setForm]         = useState({ name: '', email: '', password: '', role: 'manager', mobile_no: '' });
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    fetchManagers();
    api.get('/parameters/3')
      .then(r => setRoles(r.data.details.filter(d => d.code !== 'admin')))
      .catch(() => {});
  }, []);

  async function fetchManagers() {
    try {
      const r = await api.get('/managers');
      setManagers(r.data.managers);
    } catch { toast.error('Failed to load managers'); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    if (!form.name || !form.email) return toast.error('Name and email required');
    if (!editId && !form.password) return toast.error('Password required for new manager');
    setSaving(true);
    try {
      if (editId) {
        await api.put(`/managers/${editId}`, form);
        toast.success('Manager updated');
      } else {
        await api.post('/managers', form);
        toast.success('Manager created');
      }
      setShowForm(false); setEditId(null); setForm({ name: '', email: '', password: '', role: 'manager', mobile_no: '' });
      fetchManagers();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleToggle(m) {
    try {
      await api.put(`/managers/${m.id}`, { is_active: !m.is_active });
      toast.success(m.is_active ? 'Manager deactivated' : 'Manager activated');
      fetchManagers();
    } catch { toast.error('Failed to update'); }
  }

  function openEdit(m) {
    setEditId(m.id); setForm({ name: m.name, email: m.email, password: '', role: m.role, mobile_no: m.mobile_no || '' });
    setShowForm(true);
  }

  return (
    <Layout>
      <div style={{ padding: 28, maxWidth: 800 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>Users</h1>
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>{managers.filter(m => m.is_active).length} active</div>
          </div>
          <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', email: '', password: '', role: 'manager', mobile_no: '' }); }}>
            + Add Manager
          </button>
        </div>

        {showForm && (
          <div className="card" style={{ marginBottom: 20, borderColor: 'var(--border2)' }}>
            <div className="card-head">
              <div className="card-title">{editId ? 'Edit Manager' : 'New Manager'}</div>
            </div>
            <div className="card-body">
              <div className="form-row">
                <div className="form-group"><label>Full Name *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Jon Sharma" /></div>
                <div className="form-group"><label>Email *</label><input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Jon@swansol.com" /></div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{editId ? 'New Password (leave blank to keep)' : 'Password *'}</label>
                  <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" />
                </div>
                <div className="form-group">
                  <label>Role *</label>
                  <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                    {roles.length === 0 ? (
                      <>
                        <option value="manager">Manager</option>
                        <option value="executive">Executive</option>
                      </>
                    ) : roles.map(r => (
                      <option key={r.parameterdetid} value={r.code || r.parametervalues}>{r.parametervalues}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Mobile No.</label>
                  <input value={form.mobile_no} onChange={e => setForm(f => ({ ...f, mobile_no: e.target.value }))} placeholder="9876543210" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : (editId ? 'Update' : 'Create')}</button>
                <button className="btn" onClick={() => { setShowForm(false); setEditId(null); setForm({ name: '', email: '', password: '', role: 'manager', mobile_no: '' }); }}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div className="card">
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Loading…</div>
          ) : managers.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>No managers yet. Add one to get started.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Added</th><th></th></tr>
                </thead>
                <tbody>
                  {managers.map(m => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 500 }}>{m.name}</td>
                      <td style={{ color: 'var(--text3)' }}>{m.email}</td>
                      <td>
                        <span className={`badge ${m.role === 'executive' ? 'badge-pending' : 'badge-info'}`} style={{ textTransform: 'capitalize' }}>
                          {m.role}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${m.is_active ? 'badge-approved' : 'badge-rejected'}`}>
                          {m.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text3)' }}>{fmtDate(m.created_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm" onClick={() => openEdit(m)}>Edit</button>
                          <button className="btn btn-sm" style={{ color: m.is_active ? 'var(--red)' : 'var(--green)' }}
                            onClick={() => handleToggle(m)}>
                            {m.is_active ? 'Deactivate' : 'Activate'}
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
