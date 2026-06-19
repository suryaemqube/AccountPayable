import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import Layout from '../components/Layout';
import toast from 'react-hot-toast';

export default function UploadInvoice() {
  const nav = useNavigate();
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [preview, setPreview] = useState(null);

  function handleFile(f) {
    if (!f) return;
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];
    if (!allowed.includes(f.type)) { toast.error('Only images and PDFs allowed'); return; }
    setFile(f);
    if (f.type !== 'application/pdf') setPreview(URL.createObjectURL(f));
    else setPreview('pdf');
  }

  async function handleUpload() {
    if (!file) return;
    setScanning(true);
    const formData = new FormData();
    formData.append('invoice', file);
    try {
      const r = await api.post('/vouchers/upload', formData);
      toast.success('Invoice scanned! Voucher created.');
      nav(`/admin/vouchers/${r.data.voucher.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Scan failed');
    } finally {
      setScanning(false);
    }
  }

  return (
    <Layout>
      <div style={{ padding: 28, maxWidth: 700 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Upload Invoice</h1>
          <p style={{ color: 'var(--text3)', fontSize: 13 }}>
            Upload an invoice image or PDF. Claude AI will extract all fields automatically.
          </p>
        </div>

        {!file ? (
          <div
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => document.getElementById('file-input').click()}
            style={{
              border: `2px dashed ${drag ? 'var(--text)' : 'var(--border2)'}`,
              borderRadius: 12, padding: '60px 40px', textAlign: 'center',
              cursor: 'pointer', transition: 'all 0.15s',
              background: drag ? 'var(--surface2)' : 'var(--surface)',
            }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
            <div style={{ fontWeight: 500, marginBottom: 6 }}>Drop invoice here or click to browse</div>
            <div style={{ color: 'var(--text3)', fontSize: 12 }}>Supports JPEG, PNG, WEBP, PDF · Max 20MB</div>
            <input id="file-input" type="file" accept="image/*,.pdf" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])} />
          </div>
        ) : (
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <div className="card-title">Selected file</div>
                <button className="btn btn-sm" onClick={() => { setFile(null); setPreview(null); }}>
                  Remove
                </button>
              </div>
              <div className="card-body">
                {preview && preview !== 'pdf' ? (
                  <img src={preview} alt="invoice preview"
                    style={{ maxWidth: '100%', maxHeight: 500, borderRadius: 8, border: '1px solid var(--border)' }} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                    <span style={{ fontSize: 32 }}>📑</span>
                    <div>
                      <div style={{ fontWeight: 500 }}>{file.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                        {(file.size / 1024).toFixed(1)} KB · PDF
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {scanning ? (
              <div style={{ textAlign: 'center', padding: '32px', background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🤖</div>
                <div style={{ fontWeight: 500, marginBottom: 6 }}>Claude AI is scanning the invoice…</div>
                <div style={{ color: 'var(--text3)', fontSize: 13 }}>Extracting supplier, amounts, line items, GST details</div>
                <div style={{ marginTop: 20, height: 4, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--green-m)', width: '60%', borderRadius: 99,
                    animation: 'pulse 1.5s ease-in-out infinite' }} />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-primary" onClick={handleUpload}>
                  🤖 Scan & Create Voucher
                </button>
                <button className="btn" onClick={() => nav(-1)}>Cancel</button>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
