const pool = require('../config/db');
const paramCache = require('../utils/parameterCache');
const { logActivity } = require('../utils/activityLog');
const { notify } = require('../utils/notify');

const BILL_SELECT = `
  SELECT b.*,
    s.supplier_name,
    s.trade_name,
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
    const { bill_status, date_from, date_to } = req.query;
    let q = BILL_SELECT;
    const params = [];
    const wheres = [];
    if (bill_status) { wheres.push(`b.bill_status = $${params.length + 1}`); params.push(bill_status); }
    if (date_from)   { wheres.push(`b.invoice_date >= $${params.length + 1}`); params.push(date_from); }
    if (date_to)     { wheres.push(`b.invoice_date <= $${params.length + 1}`); params.push(date_to); }
    if (wheres.length) q += ' WHERE ' + wheres.join(' AND ');
    q += ' ORDER BY b.created_at DESC';
    const result = await pool.query(q, params);
    res.json({ bills: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function exportBills(req, res) {
  try {
    const { bill_status, date_from, date_to } = req.query;
    let q = BILL_SELECT;
    const params = [];
    const wheres = [];
    if (bill_status) { wheres.push(`b.bill_status = $${params.length + 1}`); params.push(bill_status); }
    if (date_from)   { wheres.push(`b.invoice_date >= $${params.length + 1}`); params.push(date_from); }
    if (date_to)     { wheres.push(`b.invoice_date <= $${params.length + 1}`); params.push(date_to); }
    if (wheres.length) q += ' WHERE ' + wheres.join(' AND ');
    q += ' ORDER BY b.created_at DESC';
    const result = await pool.query(q, params);

    const XLSX = require('xlsx');
    const rows = result.rows.map(b => {
      const vouchersArr = Array.isArray(b.vouchers) ? b.vouchers : [];
      const allocated   = vouchersArr.reduce((s, v) => s + (Number(v.amount) || 0), 0);
      const taxable     = Number(b.taxable_amount) || 0;
      const cgst        = Number(b.cgst) || 0;
      const sgst        = Number(b.sgst) || 0;
      const igst        = Number(b.igst) || 0;
      const tds         = Number(b.tds_amount) || 0;
      const creditNote  = Number(b.credit_note_amount) || 0;
      const gross       = Number(b.total_amount) || (taxable + cgst + sgst + igst);
      const netPayable  = gross - tds - creditNote;
      const remaining   = netPayable - allocated;

      return {
        'Bill No':            b.bill_no || '',
        'Supplier':           b.supplier_name || '',
        'Vendor Code':        b.vendor_code || '',
        'GSTIN':              b.supplier_gstin || '',
        'Invoice Date':       b.invoice_date ? String(b.invoice_date).slice(0, 10) : '',
        'Bill Date':          b.bill_date ? String(b.bill_date).slice(0, 10) : '',
        'Invoice Ref No':     b.bill_ref_no || '',
        'Cost Centre':        b.payment_reference || '',
        'Purchase Type':      b.purchase_type_label || '',
        'Taxable Amount':     taxable,
        'CGST':               cgst,
        'SGST':               sgst,
        'IGST':               igst,
        'Gross Total':        gross,
        'TDS':                tds,
        'Credit Note':        creditNote,
        'Net Payable':        netPayable,
        'Vouchers Allocated': allocated,
        'Remaining Balance':  Math.max(remaining, 0),
        'Status':             b.bill_status || '',
        'Created By':         b.created_by_name || '',
        'Created At':         b.created_at ? String(b.created_at).slice(0, 10) : '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bills');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const today = new Date();
    const filename = `bills-export-${today.toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error('exportBills error:', err);
    res.status(500).json({ error: 'Export failed: ' + err.message });
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

// Purchase types where Cost Centre (payment_reference) is expected to repeat across bills,
// so uniqueness isn't enforced: Consume (it's a State there) and Sale - Multiple (one
// Cost Centre / SalesPro ref can legitimately cover several bills).
const COST_CENTRE_NOT_UNIQUE_TYPES = ['CONSUME', 'SALE_MULTIPLE'];

// Invoice Ref No and Cost Centre (payment_reference) must each be globally unique across bills —
// except Cost Centre isn't checked for the types in COST_CENTRE_NOT_UNIQUE_TYPES above.
// Only checks fields that are actually provided (undefined = not being changed, on update).
async function assertBillFieldsUnique({ bill_ref_no, payment_reference, purchase_type_code, excludeId }) {
  const checks = [];
  if (bill_ref_no !== undefined) {
    const ref = (bill_ref_no || '').trim();
    if (ref) checks.push({ field: 'bill_ref_no', value: ref, label: 'Invoice Ref No' });
  }
  if (payment_reference !== undefined) {
    const centre = (payment_reference || '').trim();
    if (centre) {
      let effectiveType = purchase_type_code;
      if (effectiveType === undefined && excludeId) {
        const cur = await pool.query(
          `SELECT pt.code FROM bills b LEFT JOIN parameter_details pt ON pt.parameterdetid = b.purchase_type_det_id WHERE b.id=$1`,
          [excludeId]
        );
        effectiveType = cur.rows[0]?.code || null;
      }
      if (!COST_CENTRE_NOT_UNIQUE_TYPES.includes(effectiveType)) {
        checks.push({ field: 'payment_reference', value: centre, label: 'Cost Centre' });
      }
    }
  }
  for (const c of checks) {
    const params = [c.value];
    let q = `SELECT id FROM bills WHERE ${c.field} = $1`;
    if (excludeId) { params.push(excludeId); q += ` AND id <> $2`; }
    const r = await pool.query(q, params);
    if (r.rows.length) {
      const err = new Error(`${c.label} "${c.value}" already exists on another bill`);
      err.status = 400;
      throw err;
    }
  }
}

async function createBill(req, res) {
  const {
    supplier_id, invoice_date, bill_ref_no, bill_date,
    taxable_amount, cgst, sgst, igst, tds_amount,
    narration, payment_reference, tally_vch_no, due_days,
    purchase_type_code, company_bank_id,
    salespro_act_id, salespro_act_name,
    credit_note_amount,
  } = req.body;

  try {
    await assertBillFieldsUnique({ bill_ref_no, payment_reference, purchase_type_code });

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
        purchase_type_det_id, company_bank_id, created_by,
        salespro_act_id, salespro_act_name, credit_note_amount
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING id`,
      [
        bill_no, supplier_id || null, invoice_date || null, bill_ref_no || null,
        bill_date || invoice_date || null,
        taxable_amount || 0, cgst || 0, sgst || 0, igst || 0, tds_amount || 0, totalAmount,
        narration || null, payment_reference || null, tally_vch_no || null, due_days != null ? due_days : null,
        purchase_type_det_id, company_bank_id || null, req.user.id,
        salespro_act_id || null, salespro_act_name || null, Number(credit_note_amount) || 0,
      ]
    );

    const full = await pool.query(`${BILL_SELECT} WHERE b.id=$1`, [r.rows[0].id]);
    notify({
      type: 'bill_created',
      message: `New bill ${bill_no} added by ${req.user.name}${full.rows[0].supplier_name ? ' — ' + full.rows[0].supplier_name : ''}`,
      entity_type: 'bill', entity_id: r.rows[0].id, created_by: req.user.id,
    });
    res.status(201).json({ bill: full.rows[0] });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
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
    salespro_act_id, salespro_act_name,
    credit_note_amount,
  } = req.body;

  try {
    await assertBillFieldsUnique({ bill_ref_no, payment_reference, purchase_type_code, excludeId: id });

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
        salespro_act_id      = COALESCE($18, salespro_act_id),
        salespro_act_name    = COALESCE($19, salespro_act_name),
        credit_note_amount   = COALESCE($20, credit_note_amount),
        updated_at           = NOW()
      WHERE id = $17`,
      [
        supplier_id, invoice_date, bill_ref_no, bill_date || invoice_date,
        taxable_amount, cgst, sgst, igst, tds_amount, totalAmount,
        narration, payment_reference, tally_vch_no, due_days,
        purchase_type_det_id ?? null, company_bank_id, id,
        salespro_act_id ?? null, salespro_act_name ?? null,
        credit_note_amount != null ? Number(credit_note_amount) : null,
      ]
    );

    const full = await pool.query(`${BILL_SELECT} WHERE b.id=$1`, [id]);
    res.json({ bill: full.rows[0] });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteBill(req, res) {
  const { id } = req.params;
  try {
    const vCheck = await pool.query('SELECT COUNT(*) FROM vouchers WHERE bill_id=$1', [id]);
    if (parseInt(vCheck.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete this bill — a voucher has already been created against it.' });
    }
    const r = await pool.query('DELETE FROM bills WHERE id=$1 RETURNING bill_no', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Bill not found' });
    res.json({ message: `Bill ${r.rows[0].bill_no} deleted` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function createVoucherFromBill(req, res) {
  const { id } = req.params;
  const { amount, narration, supplier_bank_id, due_days, salespro_account_name } = req.body;

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
    const creditNote  = Number(bill.credit_note_amount) || 0;
    const netPayable  = grossTotal - tds - creditNote;
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
        bill_id, voucher_no, amount, narration, payment_mode,
        supplier_bank_id, due_days,
        status_det_id, payment_status_det_id, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        id, voucher_no, Number(amount), narration || bill.narration || null,
        bill.payment_mode || 'NEFT',
        supplier_bank_id || null,
        due_days !== undefined ? due_days : (bill.due_days ?? null),
        statusId, payStatusId, req.user.id,
      ]
    );
    const newId = vRes.rows[0].id;

    if (salespro_account_name) {
      await pool.query(
        `UPDATE bills SET salespro_act_name=$1, updated_at=NOW() WHERE id=$2`,
        [salespro_account_name, id]
      );
    }

    await logActivity(newId, req.user.id, 'created',
      `Voucher ${voucher_no} created from bill ${bill.bill_no}`,
      { bill_id: id, bill_no: bill.bill_no, amount: Number(amount) });
    if (creditNote > 0) {
      await logActivity(newId, req.user.id, 'credit_note',
        `Credit note of ₹${creditNote.toFixed(2)} on bill ${bill.bill_no} reduced Net Payable accordingly`,
        { bill_id: id, bill_no: bill.bill_no, credit_note_amount: creditNote });
    }
    notify({
      type: 'voucher_created',
      message: `New voucher #${voucher_no} created from bill ${bill.bill_no} by ${req.user.name}`,
      entity_type: 'voucher', entity_id: newId, created_by: req.user.id,
    });

    await refreshBillStatus(id);

    res.status(201).json({ id: newId, voucher_no });
  } catch (err) {
    console.error('createVoucherFromBill error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
}

async function refreshBillStatus(billId) {
  const r = await pool.query(
    `SELECT b.total_amount, b.tds_amount, b.credit_note_amount,
       COALESCE(SUM(v.amount) FILTER (WHERE v.utr_no IS NOT NULL AND v.utr_no <> ''), 0) AS paid_amount,
       COALESCE(SUM(v.amount), 0) AS allocated_amount
     FROM bills b
     LEFT JOIN vouchers v ON v.bill_id = b.id
     WHERE b.id = $1
     GROUP BY b.id, b.total_amount, b.tds_amount, b.credit_note_amount`,
    [billId]
  );
  if (!r.rows.length) return;
  const { total_amount, tds_amount, credit_note_amount, paid_amount, allocated_amount } = r.rows[0];
  const netPayable  = Number(total_amount) - Number(tds_amount) - (Number(credit_note_amount) || 0);
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

module.exports = { listBills, exportBills, getBill, createBill, updateBill, deleteBill, createVoucherFromBill, refreshBillStatus, uploadBillAttachments, getBillAttachments, getBillAttachmentFile, deleteBillAttachment };
