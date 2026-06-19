import { useEffect, useState } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';
import toast from 'react-hot-toast';

// Which parameters are "system" (code-bound) — labels only, no delete allowed
const SYSTEM_PARAMETER_IDS = [1, 2, 3, 4];

export default function ParameterMaster() {
  const [parameters, setParameters] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [openId, setOpenId]         = useState(null);  // expanded parameter
  const [addingTo, setAddingTo]     = useState(null);  // parameterid being added to
  const [newVal, setNewVal]         = useState('');
  const [newCode, setNewCode]       = useState('');
  const [saving, setSaving]         = useState(false);
  const [editDetail, setEditDetail] = useState(null);  // { parameterdetid, parametervalues, code, displayorder }

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const r = await api.get('/parameters');
      setParameters(r.data.parameters);
    } catch { toast.error('Failed to load parameters'); }
    finally { setLoading(false); }
  }

  async function handleAddDetail(parameterid) {
    if (!newVal.trim()) return toast.error('Value is required');
    setSaving(true);
    try {
      await api.post(`/parameters/${parameterid}/details`, {
        parametervalues: newVal.trim(),
        code: newCode.trim() || null,
      });
      toast.success('Added');
      setAddingTo(null); setNewVal(''); setNewCode('');
      fetchAll();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  }

  async function handleSaveEdit() {
    if (!editDetail?.parametervalues?.trim()) return toast.error('Value required');
    setSaving(true);
    try {
      await api.put(`/parameters/details/${editDetail.parameterdetid}`, {
        parametervalues: editDetail.parametervalues,
        code: editDetail.code,
        displayorder: editDetail.displayorder,
      });
      toast.success('Updated');
      setEditDetail(null);
      fetchAll();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  }

  async function handleToggle(d) {
    try {
      await api.put(`/parameters/details/${d.parameterdetid}`, { is_active: !d.is_active });
      toast.success(d.is_active ? 'Deactivated' : 'Activated');
      fetchAll();
    } catch { toast.error('Failed'); }
  }

  const inp = {
    border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px',
    fontSize: 13, background: 'var(--bg)', color: 'var(--text)', outline: 'none',
    width: '100%', fontFamily: 'inherit',
  };

  return (
    <Layout>
      <div style={{ padding: 28, maxWidth: 860 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>Parameter Master</h1>
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>
            Manage dropdown values used across the application
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {parameters.map(p => {
              const isOpen   = openId === p.parameterid;
              const isSystem = SYSTEM_PARAMETER_IDS.includes(p.parameterid);

              return (
                <div key={p.parameterid} className="card">
                  {/* ── Parameter header ── */}
                  <div
                    className="card-head"
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setOpenId(isOpen ? null : p.parameterid)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                      <span style={{
                        background: 'var(--surface2)', color: 'var(--text3)',
                        borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700, minWidth: 24, textAlign: 'center',
                      }}>{p.parameterid}</span>
                      <div className="card-title">{p.parametertext}</div>
                      {isSystem && (
                        <span style={{ fontSize: 10, color: '#6d28d9', background: '#ede9fe', padding: '1px 7px', borderRadius: 99, fontWeight: 600 }}>
                          SYSTEM
                        </span>
                      )}
                      <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 4 }}>
                        {p.details.filter(d => d.is_active).length} active values
                      </span>
                    </div>
                    <span style={{ color: 'var(--text3)', fontSize: 14 }}>{isOpen ? '▲' : '▼'}</span>
                  </div>

                  {isOpen && (
                    <div className="card-body" style={{ paddingTop: 10 }}>
                      {/* ── Detail rows ── */}
                      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', width: 40 }}>#</th>
                            <th style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Display Value</th>
                            <th style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Code</th>
                            <th style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', width: 60 }}>Order</th>
                            <th style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', width: 80 }}>Status</th>
                            <th style={{ width: 100, borderBottom: '1px solid var(--border)' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.details.length === 0 && (
                            <tr><td colSpan={6} style={{ padding: '16px 8px', color: 'var(--text3)', fontSize: 13, textAlign: 'center' }}>No values yet</td></tr>
                          )}
                          {p.details.map(d => (
                            editDetail?.parameterdetid === d.parameterdetid ? (
                              /* ── inline edit row ── */
                              <tr key={d.parameterdetid} style={{ background: 'var(--surface2)' }}>
                                <td style={{ padding: '6px 8px', fontSize: 13, color: 'var(--text3)' }}>{d.parameterdetid}</td>
                                <td style={{ padding: '4px 8px' }}>
                                  <input style={{ ...inp, width: '100%' }}
                                    value={editDetail.parametervalues}
                                    onChange={e => setEditDetail(x => ({ ...x, parametervalues: e.target.value }))} />
                                </td>
                                <td style={{ padding: '4px 8px' }}>
                                  <input style={{ ...inp, width: '100%' }}
                                    value={editDetail.code || ''}
                                    onChange={e => setEditDetail(x => ({ ...x, code: e.target.value }))}
                                    disabled={isSystem}
                                    title={isSystem ? 'System codes cannot be changed' : ''} />
                                </td>
                                <td style={{ padding: '4px 8px' }}>
                                  <input type="number" style={{ ...inp, width: 60 }}
                                    value={editDetail.displayorder}
                                    onChange={e => setEditDetail(x => ({ ...x, displayorder: parseInt(e.target.value) || 1 }))} />
                                </td>
                                <td style={{ padding: '6px 8px' }}></td>
                                <td style={{ padding: '4px 8px' }}>
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    <button className="btn btn-sm btn-green" onClick={handleSaveEdit} disabled={saving}>✓</button>
                                    <button className="btn btn-sm" onClick={() => setEditDetail(null)}>✕</button>
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              /* ── display row ── */
                              <tr key={d.parameterdetid} style={{ opacity: d.is_active ? 1 : 0.45 }}>
                                <td style={{ padding: '8px 8px', fontSize: 12, color: 'var(--text3)' }}>{d.parameterdetid}</td>
                                <td style={{ padding: '8px 8px', fontSize: 13, fontWeight: 500 }}>{d.parametervalues}</td>
                                <td style={{ padding: '8px 8px', fontSize: 12, fontFamily: 'monospace', color: 'var(--text3)' }}>
                                  {d.code || <span style={{ color: 'var(--border)' }}>—</span>}
                                </td>
                                <td style={{ padding: '8px 8px', fontSize: 13, textAlign: 'center' }}>{d.displayorder}</td>
                                <td style={{ padding: '8px 8px' }}>
                                  <span className={`badge ${d.is_active ? 'badge-approved' : 'badge-rejected'}`} style={{ fontSize: 10 }}>
                                    {d.is_active ? 'Active' : 'Inactive'}
                                  </span>
                                </td>
                                <td style={{ padding: '8px 8px' }}>
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    <button className="btn btn-sm" onClick={() => setEditDetail({ ...d })}>Edit</button>
                                    <button
                                      className="btn btn-sm"
                                      style={{ color: d.is_active ? 'var(--red)' : 'var(--green)' }}
                                      onClick={() => handleToggle(d)}
                                      disabled={isSystem && d.is_active}
                                      title={isSystem && d.is_active ? 'System values cannot be deactivated' : ''}
                                    >
                                      {d.is_active ? 'Deactivate' : 'Activate'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          ))}
                        </tbody>
                      </table>

                      {/* ── Add new value ── */}
                      {addingTo === p.parameterid ? (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px' }}>
                          <div style={{ flex: 2 }}>
                            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Display Value *</div>
                            <input style={inp} value={newVal} onChange={e => setNewVal(e.target.value)} placeholder="e.g. On Hold" autoFocus />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Code</div>
                            <input style={inp} value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="on_hold" />
                          </div>
                          <button className="btn btn-primary" onClick={() => handleAddDetail(p.parameterid)} disabled={saving}>Add</button>
                          <button className="btn" onClick={() => { setAddingTo(null); setNewVal(''); setNewCode(''); }}>Cancel</button>
                        </div>
                      ) : (
                        <button className="btn btn-sm" onClick={() => { setAddingTo(p.parameterid); setNewVal(''); setNewCode(''); }}>
                          + Add Value
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
