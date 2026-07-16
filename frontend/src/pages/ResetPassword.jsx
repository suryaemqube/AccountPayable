import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../api/client';
import toast from 'react-hot-toast';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const nav = useNavigate();

  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!token) return toast.error('Missing or invalid reset link');
    if (form.newPassword.length < 6) return toast.error('New password must be at least 6 characters');
    if (form.newPassword !== form.confirmPassword) return toast.error('Passwords do not match');

    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: form.newPassword });
      toast.success('Password reset — you can now sign in');
      nav('/login');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 26, fontWeight: 700, letterSpacing: '-0.5px', marginBottom: 4 }}>
            PayPro
          </div>
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>Accounts Payable Management</div>
        </div>

        <div className="card">
          <div className="card-body">
            {!token ? (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Invalid reset link</div>
                <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.6, marginBottom: 16 }}>
                  This link is missing its reset token. Please request a new one.
                </div>
                <Link to="/forgot-password" className="btn btn-primary" style={{ justifyContent: 'center' }}>
                  Request new link
                </Link>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Reset your password</div>
                <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 18 }}>
                  Choose a new password for your account.
                </div>
                <form onSubmit={handleSubmit}>
                  <div className="form-group">
                    <label>New Password</label>
                    <input
                      type="password" required autoFocus
                      value={form.newPassword}
                      onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="form-group">
                    <label>Confirm New Password</label>
                    <input
                      type="password" required
                      value={form.confirmPassword}
                      onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                      placeholder="••••••••"
                    />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={loading}
                    style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
                    {loading ? 'Resetting…' : 'Reset Password'}
                  </button>
                </form>
              </>
            )}
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Link to="/login" style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none' }}>
                ← Back to sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
