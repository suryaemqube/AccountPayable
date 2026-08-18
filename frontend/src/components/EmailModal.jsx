import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';

/* ── tiny tag-input for To/CC/BCC ── */
function TagInput({ label, tags, onChange, placeholder }) {
  const [input, setInput] = useState('');
  const ref = useRef();

  function commit() {
    const val = input.trim().toLowerCase();
    if (!val) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      toast.error(`"${val}" is not a valid email`);
      return;
    }
    if (!tags.includes(val)) onChange([...tags, val]);
    setInput('');
  }

  function onKey(e) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') { e.preventDefault(); commit(); }
    if (e.key === 'Backspace' && !input && tags.length) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>
        {label}
      </label>
      <div
        onClick={() => ref.current?.focus()}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
          border: '1px solid var(--border)', borderRadius: 7, padding: '6px 10px',
          background: 'var(--surface)', minHeight: 38, cursor: 'text',
        }}
      >
        {tags.map(t => (
          <span key={t} style={{
            background: '#dbeafe', color: '#1d4ed8', borderRadius: 4,
            padding: '2px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {t}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(tags.filter(x => x !== t)); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: '#1d4ed8', fontWeight: 700 }}
            >×</button>
          </span>
        ))}
        <input
          ref={ref}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          placeholder={tags.length ? '' : placeholder}
          style={{
            border: 'none', outline: 'none', background: 'transparent',
            fontSize: 13, flex: 1, minWidth: 140,
          }}
        />
      </div>
    </div>
  );
}

/* ── Main Modal ── */
export default function EmailModal({ voucherId, onClose, onSent }) {
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);

  const [to,      setTo]      = useState([]);
  const [cc,      setCc]      = useState([]);
  const [bcc,     setBcc]     = useState([]);
  const [subject, setSubject] = useState('');
  const [html,    setHtml]    = useState('');
  const [comment, setComment] = useState('');

  useEffect(() => {
    api.get(`/vouchers/${voucherId}/email-preview`)
      .then(r => {
        setTo(r.data.to || []);
        setCc(r.data.cc || []);
        setBcc(r.data.bcc || []);
        setSubject(r.data.subject || '');
        setHtml(r.data.html || '');
      })
      .catch(() => toast.error('Failed to load email preview'))
      .finally(() => setLoading(false));
  }, [voucherId]);

  async function handleSend() {
    if (!to.length) return toast.error('Add at least one To address');
    setSending(true);
    try {
      await api.post(`/vouchers/${voucherId}/send-payment-advice`, {
        to, cc, bcc, subject, html, comment,
      });
      toast.success('Payment advice sent');
      onSent();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: 20,
    }}>
      <div style={{
        background: 'var(--bg)', borderRadius: 14, width: '100%', maxWidth: 700,
        maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
      }}>

        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Send Payment Advice</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3)' }}>
              Sends the payment advice email to the supplier.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text3)', lineHeight: 1 }}>×</button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>Loading preview…</div>
        ) : (
          <>
            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}>

              <TagInput label="To *" tags={to} onChange={setTo} placeholder="supplier@example.com" />
              <TagInput label="CC"   tags={cc} onChange={setCc} placeholder="cc@example.com" />
              <TagInput label="BCC"  tags={bcc} onChange={setBcc} placeholder="bcc@example.com" />

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>Subject</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>Internal comment (optional)</label>
                <input
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="e.g. Payment processed via NEFT"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
                <div style={{
                  border: '1px solid var(--border)', borderRadius: 8,
                  overflow: 'hidden', background: '#f3f4f6',
                }}>
                  <iframe
                    srcDoc={html}
                    title="Email Preview"
                    style={{ width: '100%', height: 480, border: 'none', display: 'block' }}
                    sandbox="allow-same-origin"
                  />
                </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={onClose} disabled={sending}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSend}
                disabled={sending || !to.length}
                style={{ background: '#16a34a', minWidth: 140 }}
              >
                {sending ? 'Sending…' : '✉ Send & Approve'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
