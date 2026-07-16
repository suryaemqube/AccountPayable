const XLSX = require('xlsx');
const pool = require('../config/db');
const { logActivity } = require('../utils/activityLog');

// ─── Parse the bank UTR Excel file ───────────────────────────────────────────
function parseBankExcel(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (!rows.length) return [];

  // Build header→index map from first row (case-insensitive, trimmed)
  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const col = name => headers.indexOf(name.toLowerCase());

  const idxBeneName = col('beneficiary name');
  const idxRemark   = col('remark');
  const idxCustRef  = col('customer ref no');
  const idxUtr      = col('utr no');
  const idxStatus   = col('status');

  const dataRows = rows.slice(1).filter(r => r.some(c => c !== '' && c != null));

  return dataRows.map(r => ({
    beneficiary_name: String(r[idxBeneName] || '').trim(),
    remark:           String(r[idxRemark]   || '').trim(),
    customer_ref_no:  String(r[idxCustRef]  || '').trim(),
    utr_no:           String(r[idxUtr]      || '').trim(),
    status:           String(r[idxStatus]   || '').trim(),
  })).filter(r => r.remark || r.utr_no);
}

// POST /import/bank-parse
// Returns all proceed vouchers, each annotated with matching bank row (if any).
// Match key: voucher.bill_ref_no === bank_row.remark
async function parseBankFile(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const bankRows = parseBankExcel(req.file.buffer);
    if (!bankRows.length) return res.status(400).json({ error: 'No data rows found in file' });

    // Build remark → bank row map (first match wins)
    const bankMap = {};
    for (const r of bankRows) {
      if (r.remark && !bankMap[r.remark]) bankMap[r.remark] = r;
    }

    // Fetch all proceed vouchers (with supplier name via bills JOIN)
    const vRes = await pool.query(
      `SELECT v.id, v.voucher_no, v.amount, v.utr_no,
              b.bill_ref_no, b.tally_vch_no,
              s.supplier_name,
              pds.code AS status
       FROM vouchers v
       LEFT JOIN bills b ON b.id = v.bill_id
       LEFT JOIN suppliers s ON s.id = b.supplier_id
       LEFT JOIN parameter_details pds ON pds.parameterdetid = v.status_det_id
       WHERE pds.code IN ('exported', 'reviewed', 'ready_to_remit')
       ORDER BY v.created_at DESC`
    );

    // Annotate each voucher with its bank row match,
    // and auto-fill utr_no directly from the bank file data
    const vouchers = vRes.rows.map(v => {
      const bank_row = (v.bill_ref_no && bankMap[v.bill_ref_no]) ? bankMap[v.bill_ref_no] : null;
      return {
        ...v,
        bank_row,
        utr_no: bank_row?.utr_no?.trim() || v.utr_no || null,
      };
    });

    const matchedCount = vouchers.filter(v => v.bank_row).length;
    res.json({ vouchers, total_bank_rows: bankRows.length, matched: matchedCount });
  } catch (err) {
    console.error('Bank parse error:', err);
    res.status(500).json({ error: 'Failed to parse file: ' + err.message });
  }
}

// POST /import/bank-confirm
// Updates matched proceed vouchers with utr_no
async function confirmBankImport(req, res) {
  const { vouchers } = req.body;
  if (!Array.isArray(vouchers) || !vouchers.length) {
    return res.status(400).json({ error: 'vouchers array required' });
  }

  // Only save rows that have a voucher id and a UTR number
  const toUpdate = vouchers.filter(v => v.id && v.utr_no?.trim());
  if (!toUpdate.length) return res.status(400).json({ error: 'No vouchers with UTR numbers to save' });

  const client = await pool.connect();
  try {
    const paidRes = await client.query(`SELECT parameterdetid FROM parameter_details WHERE code='paid' LIMIT 1`);
    const paidDetId = paidRes.rows[0]?.parameterdetid;

    await client.query('BEGIN');
    let updated = 0;
    const touchedBillIds = new Set();
    for (const v of toUpdate) {
      const cur = await client.query(
        `SELECT v.bill_id, pd.code AS status FROM vouchers v
         LEFT JOIN parameter_details pd ON pd.parameterdetid = v.status_det_id
         WHERE v.id=$1`, [v.id]
      );
      const currentStatus = cur.rows[0]?.status;
      if (cur.rows[0]?.bill_id) touchedBillIds.add(cur.rows[0].bill_id);

      await client.query(
        'UPDATE vouchers SET utr_no=$1, status_det_id=$2, paid_at=NOW(), updated_at=NOW() WHERE id=$3',
        [v.utr_no.trim(), paidDetId, v.id]
      );

      await logActivity(v.id, req.user.id, 'utr_updated', `UTR updated via bank import: ${v.utr_no.trim()}`);
      await logActivity(v.id, req.user.id, 'status_changed', 'Marked as Paid via bank import', { from: currentStatus, to: 'paid' });
      updated++;
    }
    await client.query('COMMIT');

    // Bill status (Open/Partially Paid/Fully Paid) is derived from its vouchers'
    // paid amounts — recompute for every bill touched by this import.
    const { refreshBillStatus } = require('./bills');
    for (const billId of touchedBillIds) {
      await refreshBillStatus(billId);
    }

    res.json({ updated, message: `${updated} voucher(s) updated with UTR numbers` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bank confirm error:', err);
    res.status(500).json({ error: 'Update failed: ' + err.message });
  } finally {
    client.release();
  }
}

module.exports = { parseBankFile, confirmBankImport };
