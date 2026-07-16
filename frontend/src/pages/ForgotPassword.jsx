import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import toast from 'react-hot-toast';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Something went wrong');
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
            {sent ? (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📧</div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Check your email</div>
                <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.6 }}>
                  If an account exists for <strong>{email}</strong>, we've sent a password reset link. It expires in 1 hour.
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Forgot your password?</div>
                <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 18 }}>
                  Enter your email and we'll send you a link to reset it.
                </div>
                <form onSubmit={handleSubmit}>
                  <div className="form-group">
                    <label>Email</label>
                    <input
                      type="email" required autoFocus
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com"
                    />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={loading}
                    style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
                    {loading ? 'Sending…' : 'Send Reset Link'}
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
