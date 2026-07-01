const pool = require('../config/db');
const paramCache = require('../utils/parameterCache');
const { logActivity } = require('../utils/activityLog');

const BILL_SELECT = `
  SELECT b.*,
    s.supplier_name,
    s.gstin AS supplier_gstin,
    s.vendor_code,
    s.approval_status AS supplier_approval_status,
    u.name AS created_by_name,
    pt.parametervalues AS purchase_type_label,
    pt.code AS purchase_type_code,
    cb.bank_name AS company_bank_name,
    cb.account_number AS company_bank_account,
    COALESCE(
      (SELECT json_agg(json_build_object(
        'id',             v.id,
        'voucher_no',     v.voucher_no,
        'amount',         v.amount,
        'status',         pds.code,
        'payment_status', pdp.code,
        'utr_no',         v.utr_no,
        'created_at',     v.created_at
      ) ORDER BY v.created_at)
      FROM vouchers v
      LEFT JOIN parameter_details pds ON pds.parameterdetid = v.status_det_id
      LEFT JOIN parameter_details pdp ON pdp.parameterdetid = v.payment_status_det_id
      WHERE v.bill_id = b.id
      ), '[]'::json
    ) AS vouchers
  FROM bills b
  LEFT JOIN suppliers s   ON s.id  = b.supplier_id
  LEFT JOIN users u       ON u.id  = b.created_by
  LEFT JOIN parameter_details pt ON pt.parameterdetid = b.purchase_type_det_id
  LEFT JOIN company_bank_accounts cb ON cb.id = b.company_bank_id
`;

async function listBills(req, res) {
  try {
    const { bill_status } = req.query;
    let q = BILL_SELECT;
    const params = [];
    if (bill_status) {
      q += ` WHERE b.bill_status = $1`;
      params.push(bill_status);
    }
    q += ' ORDER BY b.created_at DESC';
    const result = await pool.query(q, params);
    res.json({ bills: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getBill(req, res) {
  const { id } = req.params;
  try {
    const result = await pool.query(`${BILL_SELECT} WHERE b.id=$1`, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Bill not found' });
    res.json({ bill: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function createBill(req, res) {
  const {
    supplier_id, invoice_date, bill_ref_no, bill_date,
    taxable_amount, cgst, sgst, igst, tds_amount,
    narration, payment_reference, tally_vch_no, due_days,
    purchase_type_code, company_bank_id,
  } = req.body;

  try {
    const purchase_type_det_id = purchase_type_code
      ? await paramCache.detId('Purchase Type', purchase_type_code)
      : null;

    const totalAmount = (Number(taxable_amount)||0) + (Number(cgst)||0) + (Number(sgst)||0) + (Number(igst)||0);

    const seq = await pool.query("SELECT 'BILL-' || LPAD(nextval('bill_no_seq')::text, 5, '0') AS bn");
    const bill_no = seq.rows[0].bn;

    const r = await pool.query(
      `INSERT INTO bills (
        bill_no, supplier_id, invoice_date, bill_ref_no, bill_date,
        taxable_amount, cgst, sgst, igst, tds_amount, total_amount,
        narration, payment_reference, tally_vch_no, due_days,
        purchase_type_det_id, company_bank_id, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING id`,
      [
        bill_no, supplier_id || null, invoice_date || null, bill_ref_no || null,
        bill_date || invoice_date || null,
        taxable_amount || 0, cgst || 0, sgst || 0, igst || 0, tds_amount || 0, totalAmount,
        narration || null, payment_reference || null, tally_vch_no || null, due_days || null,
        purchase_type_det_id, company_bank_id || null, req.user.id,
      ]
    );

    const full = await pool.query(`${BILL_SELECT} WHERE b.id=$1`, [r.rows[0].id]);
    res.status(201).json({ bill: full.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateBill(req, res) {
  const { id } = req.params;
  const {
    supplier_id, invoice_date, bill_ref_no, bill_date,
    taxable_amount, cgst, sgst, igst, tds_amount,
    narration, payment_reference, tally_vch_no, due_days,
    purchase_type_code, company_bank_id,
  } = req.body;

  try {
    const purchase_type_det_id = purchase_type_code !== undefined
      ? (purchase_type_code ? await paramCache.detId('Purchase Type', purchase_type_code) : null)
      : undefined;

    const totalAmount = (Number(taxable_amount)||0) + (Number(cgst)||0) + (Number(sgst)||0) + (Number(igst)||0);

    await pool.query(
      `UPDATE bills SET
        supplier_id          = COALESCE($1, supplier_id),
        invoice_date         = COALESCE($2, invoice_date),
        bill_ref_no          = COALESCE($3, bill_ref_no),
        bill_date            = COALESCE($4, bill_date),
        taxable_amount       = COALESCE($5, taxable_amount),
        cgst                 = COALESCE($6, cgst),
        sgst                 = COALESCE($7, sgst),
        igst                 = COALESCE($8, igst),
        tds_amount           = COALESCE($9, tds_amount),
        total_amount         = CASE WHEN $5 IS NOT NULL THEN $10 ELSE total_amount END,
        narration            = COALESCE($11, narration),
        payment_reference    = COALESCE($12, payment_reference),
        tally_vch_no         = COALESCE($13, tally_vch_no),
        due_days             = COALESCE($14, due_days),
        purchase_type_det_id = COALESCE($15, purchase_type_det_id),
        company_bank_id      = COALESCE($16, company_bank_id),
        updated_at           = NOW()
      WHERE id = $17`,
      [
        supplier_id, invoice_date, bill_ref_no, bill_date || invoice_date,
        taxable_amount, cgst, sgst, igst, tds_amount, totalAmount,
        narration, payment_reference, tally_vch_no, due_days,
        purchase_type_det_id ?? null, company_bank_id, id,
      ]
    );

    const full = await pool.query(`${BILL_SELECT} WHERE b.id=$1`, [id]);
    res.json({ bill: full.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteBill(req, res) {
  const { id } = req.params;
  try {
    const r = await pool.query('DELETE FROM bills WHERE id=$1 RETURNING bill_no', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Bill not found' });
    res.json({ message: `Bill ${r.rows[0].bill_no} deleted` });
  } catch (err) {
    console.error(err);
    if (err.code === '23503') return res.status(400).json({ error: 'Cannot delete: bill has linked vouchers' });
    res.status(500).json({ error: 'Server error' });
  }
}

async function createVoucherFromBill(req, res) {
  const { id } = req.params;
  const { amount, narration, supplier_bank_id, due_days } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'amount is required and must be positive' });
  }

  try {
    const billRes = await pool.query(`${BILL_SELECT} WHERE b.id=$1`, [id]);
    if (!billRes.rows.length) return res.status(404).json({ error: 'Bill not found' });
    const bill = billRes.rows[0];

    if (bill.supplier_id) {
      const suppRes = await pool.query('SELECT approval_status FROM suppliers WHERE id=$1', [bill.supplier_id]);
      const suppStatus = suppRes.rows[0]?.approval_status;
      if (suppStatus && suppStatus !== 'approved') {
        return res.status(400).json({ error: 'Cannot create voucher — supplier approval is pending. Please get the supplier approved first.' });
      }
    }

    const vouchersArr = Array.isArray(bill.vouchers) ? bill.vouchers : [];
    const alreadyAllocated = vouchersArr.reduce((s, v) => s + (Number(v.amount) || 0), 0);
    const grossTotal  = Number(bill.total_amount) || 0;
    const tds         = Number(bill.tds_amount) || 0;
    const netPayable  = grossTotal - tds;
    const remaining   = netPayable - alreadyAllocated;

    if (Number(amount) > remaining + 0.01) {
      return res.status(400).json({
        error: `Amount exceeds remaining balance. Remaining: ₹${remaining.toFixed(2)}`,
      });
    }

    const [statusId, payStatusId] = await Promise.all([
      paramCache.detId('Voucher Status', 'draft'),
      paramCache.detId('Payment Status', 'pending_verification'),
    ]);

    const seq = await pool.query("SELECT nextval('voucher_no_seq') AS n");
    const voucher_no = String(seq.rows[0].n).padStart(5, '0');

    const vRes = await pool.query(
      `INSERT INTO vouchers (
        bill_id, voucher_no, amount, narration,
        supplier_bank_id, due_days,
        status_det_id, payment_status_det_id, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        id, voucher_no, Number(amount), narration || bill.narration || null,
        supplier_bank_id || null,
        due_days !== undefined ? due_days : (bill.due_days || null),
        statusId, payStatusId, req.user.id,
      ]
    );
    const newId = vRes.rows[0].id;

    await logActivity(newId, req.user.id, 'created',
      `Voucher ${voucher_no} created from bill ${bill.bill_no}`,
      { bill_id: id, bill_no: bill.bill_no, amount: Number(amount) });

    await refreshBillStatus(id);

    res.status(201).json({ id: newId, voucher_no });
  } catch (err) {
    console.error('createVoucherFromBill error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
}

async function refreshBillStatus(billId) {
  const r = await pool.query(
    `SELECT b.total_amount, b.tds_amount,
       COALESCE(SUM(v.amount) FILTER (WHERE v.utr_no IS NOT NULL AND v.utr_no <> ''), 0) AS paid_amount,
       COALESCE(SUM(v.amount), 0) AS allocated_amount
     FROM bills b
     LEFT JOIN vouchers v ON v.bill_id = b.id
     WHERE b.id = $1
     GROUP BY b.id, b.total_amount, b.tds_amount`,
    [billId]
  );
  if (!r.rows.length) return;
  const { total_amount, tds_amount, paid_amount, allocated_amount } = r.rows[0];
  const netPayable  = Number(total_amount) - Number(tds_amount);
  const paid        = Number(paid_amount);
  const allocated   = Number(allocated_amount);

  let status = 'open';
  if (paid > 0 && paid >= netPayable - 0.01) status = 'fully_paid';
  else if (paid > 0) status = 'partially_paid';
  else if (allocated > 0) status = 'partially_paid';

  await pool.query('UPDATE bills SET bill_status=$1, updated_at=NOW() WHERE id=$2', [status, billId]);
}

async function getBillAttachmentFile(req, res) {
  const { id, aid } = req.params;
  const fs   = require('fs');
  const path = require('path');
  try {
    const r = await pool.query('SELECT * FROM bill_attachments WHERE id=$1 AND bill_id=$2', [aid, id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Attachment not found' });
    const filePath = path.join(__dirname, '../../uploads', r.rows[0].file_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
    res.setHeader('Content-Type', r.rows[0].mime_type || 'application/octet-stream');
    res.sendFile(filePath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getBillAttachments(req, res) {
  const { id } = req.params;
  try {
    const r = await pool.query(
      `SELECT ba.*, u.name AS uploaded_by_name
       FROM bill_attachments ba
       LEFT JOIN users u ON u.id = ba.uploaded_by
       WHERE ba.bill_id = $1 ORDER BY ba.created_at ASC`,
      [id]
    );
    res.json({ attachments: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteBillAttachment(req, res) {
  const { id, aid } = req.params;
  const fs   = require('fs');
  const path = require('path');
  try {
    const r = await pool.query('SELECT * FROM bill_attachments WHERE id=$1 AND bill_id=$2', [aid, id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Attachment not found' });
    const filePath = path.join(__dirname, '../../uploads', r.rows[0].file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await pool.query('DELETE FROM bill_attachments WHERE id=$1', [aid]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function uploadBillAttachments(req, res) {
  const { id } = req.params;
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });
  try {
    const check = await pool.query('SELECT id FROM bills WHERE id=$1', [id]);
    if (!check.rows.length) return res.status(404).json({ error: 'Bill not found' });
    const inserted = [];
    for (const file of req.files) {
      const r = await pool.query(
        `INSERT INTO bill_attachments (bill_id, file_path, original_name, mime_type, file_size, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [id, file.filename, file.originalname, file.mimetype, file.size, req.user.id]
      );
      inserted.push(r.rows[0]);
    }
    res.json({ attachments: inserted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
}

module.exports = { listBills, getBill, createBill, updateBill, deleteBill, createVoucherFromBill, refreshBillStatus, uploadBillAttachments, getBillAttachments, getBillAttachmentFile, deleteBillAttachment };
