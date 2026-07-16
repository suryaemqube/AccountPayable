import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { fmtDateTime } from './Helpers';

const POLL_MS = 25000;

const TYPE_ICON = {
  voucher_created:  '🧾',
  voucher_assigned: '📌',
  bill_created:     '📄',
  supplier_pending: '🏢',
};

export default function NotificationBell() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [open, setOpen]           = useState(false);
  const [unread, setUnread]       = useState(0);
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [tab, setTab]             = useState('all'); // 'all' | 'unread' | 'read'
  const boxRef = useRef(null);

  const basePath = user?.role === 'admin' ? '/admin' : '/approver';

  async function fetchUnread() {
    try {
      const r = await api.get('/notifications/unread-count');
      setUnread(r.data.count || 0);
    } catch { /* silent — don't nag the user about polling failures */ }
  }

  async function fetchList() {
    setLoading(true);
    try {
      const r = await api.get('/notifications');
      setItems(r.data.notifications || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    fetchUnread();
    const t = setInterval(fetchUnread, POLL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    if (open) {
      fetchList();
      document.addEventListener('mousedown', onOutside);
    }
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  async function markRead(id) {
    try {
      await api.post(`/notifications/${id}/read`);
      setItems(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnread(c => Math.max(0, c - 1));
    } catch { /* silent */ }
  }

  async function markAllRead() {
    try {
      await api.post('/notifications/read-all');
      setItems(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnread(0);
    } catch { /* silent */ }
  }

  function goToEntity(n) {
    if (!n.is_read) markRead(n.id);
    setOpen(false);
    if (!n.entity_id) {
      if (n.entity_type === 'bill') nav(`${basePath}/bills`);
      else if (n.entity_type === 'voucher') nav(`${basePath}/vouchers`);
      return;
    }
    if (n.entity_type === 'voucher') nav(`${basePath}/vouchers/${n.entity_id}`);
    else if (n.entity_type === 'bill') nav(`${basePath}/bills/${n.entity_id}`);
    else if (n.entity_type === 'supplier') {
      const path = user?.role === 'admin' ? '/admin/suppliers' : '/approver/supplier-master';
      nav(path, { state: { openSupplierId: n.entity_id } });
    }
  }

  const filteredItems = items.filter(n =>
    tab === 'unread' ? !n.is_read : tab === 'read' ? n.is_read : true
  );

  return (
    <div ref={boxRef} style={{ position: 'fixed', top: 16, right: 24, zIndex: 100 }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        style={{
          position: 'relative', width: 38, height: 38, borderRadius: '50%',
          border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer',
          fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, padding: '0 3px',
            borderRadius: 99, background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 46, right: 0, width: 360, maxHeight: 440,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 8px 30px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: 12, cursor: 'pointer' }}>
                Mark all read
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 4, padding: '8px 14px 0' }}>
            {[
              { key: 'all',    label: 'All' },
              { key: 'unread', label: 'Unread' },
              { key: 'read',   label: 'Read' },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{
                  border: 'none', cursor: 'pointer', fontSize: 12, padding: '5px 12px',
                  borderRadius: 99, fontWeight: tab === t.key ? 600 : 400,
                  background: tab === t.key ? 'var(--primary)' : 'var(--surface2)',
                  color: tab === t.key ? '#fff' : 'var(--text3)',
                }}>
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ overflowY: 'auto', flex: 1, marginTop: 8 }}>
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
            ) : filteredItems.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                {tab === 'unread' ? 'No unread notifications.' : tab === 'read' ? 'No read notifications.' : 'No notifications yet.'}
              </div>
            ) : (
              filteredItems.map(n => (
                <div
                  key={n.id}
                  onClick={() => goToEntity(n)}
                  style={{
                    display: 'flex', gap: 10, padding: '10px 14px', cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    background: n.is_read ? 'transparent' : 'var(--surface2)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                  onMouseLeave={e => e.currentTarget.style.background = n.is_read ? 'transparent' : 'var(--surface2)'}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{TYPE_ICON[n.type] || '🔔'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: n.is_read ? 400 : 600, lineHeight: 1.4 }}>
                      {n.message}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{fmtDateTime(n.created_at)}</div>
                  </div>
                  {!n.is_read && (
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0, marginTop: 5 }} />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
