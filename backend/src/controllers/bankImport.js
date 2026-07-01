const XLSX = require('xlsx');
const pool = require('../config/db');

// â”€â”€â”€ Column indices in the bank Excel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const COL_BENE_NAME    = 4;   // Beneficiary Name
const COL_REMARK       = 12;  // Remark  â†’ matches vouchers.bill_ref_no
const COL_CUST_REF     = 27;  // Customer Ref No
const COL_UTR          = 28;  // UTR NO

// â”€â”€â”€ Parse the bank UTR Excel file â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function parseBankExcel(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (!rows.length) return [];

  // First row is always the header â€” skip it
  const dataRows = rows.slice(1).filter(r => r.some(c => c !== '' && c != null));

  return dataRows.map(r => ({
    beneficiary_name: String(r[COL_BENE_NAME] || '').trim(),
    remark:           String(r[COL_REMARK]    || '').trim(),
    customer_ref_no:  String(r[COL_CUST_REF]  || '').trim(),
    utr_no:           String(r[COL_UTR]        || '').trim(),
  })).filter(r => r.remark || r.utr_no); // skip blank rows
}

// POST /import/bank-parse
// Returns all proceed vouchers, each annotated with matching bank row (if any).
// Match key: voucher.bill_ref_no === bank_row.remark
async function parseBankFile(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const bankRows = parseBankExcel(req.file.buffer);
    if (!bankRows.length) return res.status(400).json({ error: 'No data rows found in file' });

    // Build remark â†’ bank row map (first match wins)
    const bankMap = {};
    for (const r of bankRows) {
      if (r.remark && !bankMap[r.remark]) bankMap[r.remark] = r;
    }

    // Fetch all proceed vouchers (with supplier name via JOIN)
    const vRes = await pool.query(
      `SELECT v.id, v.voucher_no, v.bill_ref_no, v.supplier_id,
              v.total_amount, v.utr_no, v.tally_vch_no,
              s.supplier_name,
              pds.code AS status
       FROM vouchers v
       LEFT JOIN parameter_details pds ON pds.parameterdetid = v.status_det_id
       LEFT JOIN suppliers s ON s.id = v.supplier_id
       WHERE pds.code IN ('exported', 'reviewed')
       ORDER BY v.created_at DESC`
    );

    // Annotate each proceed voucher with its bank row match,
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
    await client.query('BEGIN');
    let updated = 0;
    for (const v of toUpdate) {
      await client.query(
        'UPDATE vouchers SET utr_no=$1, updated_at=NOW() WHERE id=$2',
        [v.utr_no.trim(), v.id]
      );
      updated++;
    }
    await client.query('COMMIT');
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

