import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const adminLinks = [
  { to: '/admin', label: 'Dashboard', icon: '⬛' },
  { to: '/admin/vouchers', label: 'Vouchers', icon: '🧾' },
  { to: '/admin/managers', label: 'Managers', icon: '👥' },
];

const managerLinks = [
  { to: '/manager', label: 'My Queue', icon: '📋' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const links = user?.role === 'admin' ? adminLinks : managerLinks;

  function handleLogout() { logout(); nav('/login'); }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{
        width: 'var(--sidebar)', flexShrink: 0,
        background: 'var(--text)', display: 'flex',
        flexDirection: 'column', position: 'fixed',
        top: 0, left: 0, bottom: 0, zIndex: 10,
      }}>
        <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, color: '#fff', fontWeight: 700 }}>PayFlow AP</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 }}>
            {user?.role}
          </div>
        </div>

        <nav style={{ flex: 1, padding: '12px 10px' }}>
          {links.map(l => (
            <NavLink key={l.to} to={l.to} end={l.to.split('/').length <= 2}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 8, margin: '2px 0',
                color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
                background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                fontSize: 13, transition: 'all 0.15s',
              })}>
              <span style={{ fontSize: 14 }}>{l.icon}</span> {l.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: '14px 18px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{user?.name}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 10 }}>{user?.email}</div>
          <button onClick={handleLogout}
            style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: 'rgba(255,255,255,0.6)',
              padding: '6px 12px', borderRadius: 6, fontSize: 12, width: '100%', cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, marginLeft: 'var(--sidebar)', minHeight: '100vh' }}>
        {children}
      </main>
    </div>
  );
}
