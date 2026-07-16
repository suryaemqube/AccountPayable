export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export default function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

  if (total === 0) return null;

  const btn = (disabled) => ({
    border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)',
    padding: '5px 10px', fontSize: 13, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, padding: '12px 4px' }}>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>
        Showing {from}–{to} of {total}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            style={{ border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', padding: '5px 8px', fontSize: 12, marginRight: 8 }}
          >
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
        <button style={btn(page <= 1)} disabled={page <= 1} onClick={() => onPageChange(1)}>«</button>
        <button style={btn(page <= 1)} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>‹ Prev</button>
        <span style={{ fontSize: 12, color: 'var(--text3)', padding: '0 6px' }}>Page {page} of {totalPages}</span>
        <button style={btn(page >= totalPages)} disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next ›</button>
        <button style={btn(page >= totalPages)} disabled={page >= totalPages} onClick={() => onPageChange(totalPages)}>»</button>
      </div>
    </div>
  );
}
