import { useEffect, useState } from 'react';
import { NavLink, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import NotificationBell from './NotificationBell';

const QUEUE_POLL_MS = 25000;
const SIDEBAR_EXPANDED  = 240;
const SIDEBAR_COLLAPSED = 64;

const adminLinks = [
  { to: '/admin', label: 'Dashboard', icon: '⬛' },
  { to: '/admin/bills', label: 'Bills', icon: '📄' },
  { to: '/admin/vouchers', label: 'Vouchers', icon: '🧾' },
  { to: '/admin/suppliers', label: 'Suppliers', icon: '🏢' },
  { to: '/admin/managers', label: 'Users', icon: '👥' },
  { to: '/admin/master-upload', label: 'Master Upload', icon: '📊' },
  { to: '/admin/company', label: 'Company Details', icon: '🏦' },
  // { to: '/admin/parameters', label: 'Parameter Master', icon: '⚙️' }
];

const managerLinks = [
  { to: '/manager', label: 'My Queue', icon: '📋', queueBadge: true },
];

const executiveLinks = [
  { to: '/executive/bills',           label: 'Bills',         icon: '📄' },
  { to: '/executive/vouchers',        label: 'Vouchers',      icon: '🧾' },
  { to: '/executive/supplier-master', label: 'Suppliers',     icon: '🏢' },
  { to: '/executive/master-upload',   label: 'Master Upload', icon: '📊' },
];

const approverLinks = [
  { to: '/approver/my-queue',        label: 'My Queue',  icon: '📋', queueBadge: true },
  { to: '/approver/bills',           label: 'Bills',     icon: '📄' },
  { to: '/approver/vouchers',        label: 'Vouchers',  icon: '🧾' },
  { to: '/approver/supplier-master', label: 'Suppliers', icon: '🏢' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const links = user?.role === 'admin'    ? adminLinks
              : user?.role === 'executive' ? executiveLinks
              : user?.role === 'approver'  ? approverLinks : managerLinks;
  const [queueCount, setQueueCount] = useState(0);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === 'true');
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  function toggleSidebar() {
    setCollapsed(c => {
      localStorage.setItem('sidebar_collapsed', String(!c));
      return !c;
    });
  }

  function handleLogout() { logout(); nav('/login'); }

  useEffect(() => {
    if (!['manager', 'approver'].includes(user?.role)) return;
    let cancelled = false;
    async function fetchQueueCount() {
      try {
        const r = await api.get('/vouchers', { params: { status: 'assigned' } });
        const mine = (r.data.vouchers || []).filter(v => v.assigned_to === user.id);
        if (!cancelled) setQueueCount(mine.length);
      } catch { /* silent — don't nag about polling failures */ }
    }
    fetchQueueCount();
    const t = setInterval(fetchQueueCount, QUEUE_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [user?.role, user?.id]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{
        width: sidebarWidth, flexShrink: 0,
        background: 'var(--text)', display: 'flex',
        flexDirection: 'column', position: 'fixed',
        top: 0, left: 0, bottom: 0, zIndex: 10,
        transition: 'width 0.18s ease', overflow: 'hidden',
      }}>
        

        <div style={{ padding: collapsed ? '20px 0 16px' : '20px 18px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', textAlign: collapsed ? 'center' : 'left' }}>
          <div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, color: '#fff', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {collapsed ? 'P' : 'PayPro'}
            </div>
            {!collapsed && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 }}>
                {user?.role}
              </div>
            )}
          </div>
          <button onClick={toggleSidebar} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            position: 'absolute', top: 22, right: 12, zIndex: 11,
            width: 24, height: 24, borderRadius: '50%',
            background: 'var(--text)', border: '1px solid rgba(255,255,255,0.2)',
            color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
          }}>
          {collapsed ? '›' : '‹'}
        </button>
        </div>

        <nav style={{ flex: 1, padding: '12px 10px' }}>
          {links.map(l => (
            <NavLink key={l.to} to={l.to} end={l.to.split('/').length <= 2} title={collapsed ? l.label : undefined}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? '10px 0' : '9px 12px', borderRadius: 8, margin: '2px 0',
                color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
                background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                fontSize: 13, transition: 'all 0.15s', position: 'relative',
              })}>
              <span style={{ fontSize: 14 }}>{l.icon}</span>
              {!collapsed && l.label}
              {l.queueBadge && queueCount > 0 && (collapsed ? (
                <span style={{
                  position: 'absolute', top: 4, right: 14,
                  width: 8, height: 8, borderRadius: '50%', background: '#dc2626',
                }} />
              ) : (
                <span style={{
                  marginLeft: 'auto', background: '#dc2626', color: '#fff',
                  fontSize: 11, fontWeight: 700, borderRadius: 99, padding: '1px 7px',
                  minWidth: 18, textAlign: 'center', lineHeight: '16px',
                }}>
                  {queueCount > 99 ? '99+' : queueCount}
                </span>
              ))}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: collapsed ? '14px 0' : '14px 18px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {!collapsed && (
            <>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
            </>
          )}
          <Link to={`/${user?.role === 'approver' ? 'approver' : user?.role}/change-password`}
            title={collapsed ? 'Change Password' : undefined}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: 'none',
              color: 'rgba(255,255,255,0.5)', padding: '6px 12px', borderRadius: 6,
              fontSize: 12, width: '100%', cursor: 'pointer', textAlign: 'center',
              marginBottom: 6, textDecoration: 'none' }}>
            {collapsed ? '🔑' : '🔑 Change Password'}
          </Link>
          <button onClick={handleLogout} title={collapsed ? 'Sign out' : undefined}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.08)', border: 'none', color: 'rgba(255,255,255,0.6)',
              padding: '6px 12px', borderRadius: 6, fontSize: 12, width: '100%', cursor: 'pointer' }}>
            {collapsed ? '⏻' : 'Sign out'}
          </button>
        </div>
      </aside>

      {['admin', 'approver'].includes(user?.role) && <NotificationBell />}

      <main style={{ flex: 1, marginLeft: sidebarWidth, minHeight: '100vh', transition: 'margin-left 0.18s ease' }}>
        {children}
      </main>
    </div>
  );
}
