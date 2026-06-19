const pool = require('../config/db');
const { extractInvoiceData } = require('../utils/claudeOcr');
const { generateVoucherPDF, generateAndSaveVoucherPDF } = require('../utils/pdfGenerator');
const { buildPaymentAdviceHTML, sendMail } = require('../utils/emailService');
const paramCache = require('../utils/parameterCache');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const VOUCHERS_DIR = path.join(__dirname, '../../vouchers');
const { logActivity } = require('../utils/activityLog');

// ── Common SELECT fragment ─────────────────────────────────────────────────
const VOUCHER_SELECT = `
  SELECT v.*,
    u1.name  AS created_by_name,
    u2.name  AS assigned_to_name,
    pds.code AS status,
    pdp.code AS payment_status,
    s.supplier_name,
    s.gstin  AS supplier_gstin,
    CASE
      WHEN v.assigned_at IS NOT NULL AND v.due_days IS NOT NULL
      THEN (v.assigned_at::date + v.due_days)
      ELSE NULL
    END AS due_date,
    -- linked balance vouchers (children)
    (SELECT COALESCE(json_agg(json_build_object(
        'id',             bv.id,
        'voucher_no',     bv.voucher_no,
        'total_amount',   bv.total_amount,
        'utr_no',         bv.utr_no,
        'status',         bvs.code,
        'has_further_split', EXISTS(SELECT 1 FROM vouchers c WHERE c.source_voucher_id = bv.id)
      ) ORDER BY bv.created_at), '[]'::json)
     FROM vouchers bv
     LEFT JOIN parameter_details bvs ON bvs.parameterdetid = bv.status_det_id
     WHERE bv.source_voucher_id = v.id
    ) AS balance_vouchers
  FROM vouchers v
  LEFT JOIN users u1      ON v.created_by   = u1.id
  LEFT JOIN users u2      ON v.assigned_to  = u2.id
  LEFT JOIN parameter_details pds ON pds.parameterdetid = v.status_det_id
  LEFT JOIN parameter_details pdp ON pdp.parameterdetid = v.payment_status_det_id
  LEFT JOIN suppliers s   ON s.id = v.supplier_id
`;

// ── Short helpers ──────────────────────────────────────────────────────────
async function sid(code)  { return paramCache.detId('Voucher Status',  code); }
async function psid(code) { return paramCache.detId('Payment Status',  code); }

async function ensureVoucherNo(voucherId, existingNo) {
  if (existingNo) return existingNo;
  const seq = await pool.query("SELECT nextval('voucher_no_seq') AS n");
  const no  = `${String(seq.rows[0].n).padStart(5, '0')}`;
  await pool.query('UPDATE vouchers SET voucher_no=$1 WHERE id=$2', [no, voucherId]);
  return no;
}

async function createBalanceVoucher(req, res) {
  const { source_id } = req.body;
  if (!source_id) return res.status(400).json({ error: 'source_id required' });

  try {
    const srcRes = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [source_id]);
    if (!srcRes.rows.length) return res.status(404).json({ error: 'Source voucher not found' });
    const src = srcRes.rows[0];

    if (!['approved', 'downloaded'].includes(src.status)) {
      return res.status(400).json({ error: 'Balance voucher can only be created from an approved voucher' });
    }
    if (!(Number(src.balance_amount) > 0)) {
      return res.status(400).json({ error: 'Source voucher has no balance amount' });
    }

    // Block if a non-rejected balance voucher already exists for this source
    const existingBal = await pool.query(
      `SELECT v.id FROM vouchers v
       JOIN parameter_details pd ON pd.parameterdetid = v.status_det_id
       JOIN parameters p ON p.parameterid = pd.parameterid
       WHERE v.source_voucher_id = $1
         AND p.parametertext = 'Voucher Status'
         AND LOWER(pd.code) != 'rejected'
       LIMIT 1`,
      [source_id]
    );
    if (existingBal.rows.length) {
      return res.status(400).json({ error: 'A balance voucher has already been created from this voucher. Only one balance voucher is allowed per source.' });
    }

    const [statusId, payStatusId] = await Promise.all([sid('draft'), psid('unpaid')]);

    const seqRes  = await pool.query("SELECT nextval('voucher_no_seq') AS n");
    const newVoucherNo = `${String(seqRes.rows[0].n).padStart(5, '0')}`;

    const result = await pool.query(
      `INSERT INTO vouchers
         (supplier_id, narration, total_amount, taxable_amount,
          status_det_id, payment_status_det_id, created_by,
          payment_reference, due_days, source_voucher_id, voucher_no)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        src.supplier_id,
        src.narration || '',
        src.balance_amount,
        statusId, payStatusId, req.user.id,
        src.payment_reference || null,
        src.due_days || null,
        source_id,
        newVoucherNo,
      ]
    );

    // Balance remains on source until this new voucher reaches approved status

    // Log on the new balance voucher
    await logActivity(result.rows[0].id, req.user.id, 'balance_voucher_created',
      `Balance voucher created from voucher ${src.voucher_no || src.id.slice(0,8)}`,
      { source_voucher_id: source_id, source_voucher_no: src.voucher_no, amount: src.balance_amount });
    // Log on the source voucher as well
    await logActivity(source_id, req.user.id, 'balance_voucher_created',
      `Balance voucher ${newVoucherNo} created for ₹${Number(src.balance_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      { balance_voucher_id: result.rows[0].id, balance_voucher_no: newVoucherNo, amount: src.balance_amount });

    // Clear balance on source — total stays intact so full original amount is traceable
    await pool.query(
      `UPDATE vouchers SET balance_amount = 0, updated_at = NOW() WHERE id = $1`,
      [source_id]
    );

    const full = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [result.rows[0].id]);
    res.status(201).json({ voucher: full.rows[0] });
  } catch (err) {
    console.error('createBalanceVoucher error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
}

async function uploadAndScan(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const mimeType = req.file.mimetype;
    const extracted = await extractInvoiceData(req.file.path, mimeType);

    const [statusId, payStatusId] = await Promise.all([
      sid('draft'), psid('unpaid'),
    ]);

    // Try to match supplier by OCR-extracted name
    let supplierId = null;
    if (extracted.supplier_name) {
      const sRes = await pool.query(
        'SELECT id FROM suppliers WHERE LOWER(TRIM(supplier_name))=LOWER(TRIM($1)) AND is_active=true LIMIT 1',
        [extracted.supplier_name]
      );
      supplierId = sRes.rows[0]?.id || null;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const vResult = await client.query(
        `INSERT INTO vouchers (
          supplier_id,
          invoice_date, narration,
          taxable_amount, cgst, sgst, igst, total_amount,
          status_det_id, payment_status_det_id, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING *`,
        [
          req.file.filename, req.file.originalname,
          supplierId,
          extracted.invoice_date || null, extracted.narration || '',
          extracted.taxable_amount || 0, extracted.cgst || 0,
          extracted.sgst || 0, extracted.igst || 0, extracted.total_amount || 0,
          statusId, payStatusId, req.user.id,
        ]
      );
      const voucher = vResult.rows[0];


      await client.query('COMMIT');
      await logActivity(voucher.id, req.user.id, 'created', 'Voucher created via invoice upload');
      // Re-fetch with JOINs so response includes status/payment_status strings
      const full = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [voucher.id]);
      res.status(201).json({ voucher: full.rows[0], line_items: extracted.line_items || [] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: 'Failed to scan invoice: ' + err.message });
  }
}

async function listVouchers(req, res) {
  try {
    const { status, payment_status } = req.query;
    let baseQuery = VOUCHER_SELECT;
    const params = [];
    const conditions = [];

    // Manager only sees vouchers assigned to them
    // Executive sees all vouchers (they upload & assign, so need full visibility)
    if (req.user.role === 'manager') {
      conditions.push(`v.assigned_to = $${params.length + 1}`);
      params.push(req.user.id);
    }
    if (status) {
      const id = await sid(status);
      if (id) { conditions.push(`v.status_det_id = $${params.length + 1}`); params.push(id); }
    }
    if (payment_status) {
      const id = await psid(payment_status);
      if (id) { conditions.push(`v.payment_status_det_id = $${params.length + 1}`); params.push(id); }
    }

    if (conditions.length) baseQuery += ' WHERE ' + conditions.join(' AND ');
    baseQuery += ' ORDER BY v.created_at DESC';

    const result = await pool.query(baseQuery, params);
    res.json({ vouchers: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getVoucher(req, res) {
  const { id } = req.params;
  try {
    const vResult = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });

    const voucher = vResult.rows[0];
    // Manager can only see vouchers assigned to them; executive can see all
    if (req.user.role === 'manager' && voucher.assigned_to !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let supplierInfo = null;
    if (voucher.supplier_id) {
      const sResult = await pool.query(
        `SELECT s.id, s.supplier_name, s.gstin, s.owned_by, u.name AS manager_name
         FROM suppliers s LEFT JOIN users u ON s.owned_by = u.id
         WHERE s.id = $1`,
        [voucher.supplier_id]
      );
      if (sResult.rows.length) supplierInfo = sResult.rows[0];
    }

    const comments   = await pool.query(
      `SELECT vc.*, u.name AS user_name, pd.parametervalues AS user_role_code,
              pd.code AS role
       FROM voucher_comments vc
       JOIN users u ON vc.user_id = u.id
       LEFT JOIN parameter_details pd ON pd.parameterdetid = u.role_det_id
       WHERE vc.voucher_id=$1 ORDER BY vc.created_at ASC`, [id]
    );
    const attachments = await pool.query(
      `SELECT va.*, u.name AS uploaded_by_name
       FROM voucher_attachments va LEFT JOIN users u ON va.uploaded_by=u.id
       WHERE va.voucher_id=$1 ORDER BY va.created_at ASC`, [id]
    );
    const activityLog = await pool.query(
      `SELECT val.*, u.name AS user_name
       FROM voucher_activity_log val
       LEFT JOIN users u ON u.id = val.user_id
       WHERE val.voucher_id=$1 ORDER BY val.created_at ASC`, [id]
    );

    res.json({ voucher, comments: comments.rows,
               activity_log: activityLog.rows,
               attachments: attachments.rows, supplier_info: supplierInfo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function createVoucher(req, res) {
  const {
    supplier_id, invoice_date, narration, taxable_amount, cgst, sgst, igst, tds_amount, total_amount,
    due_days, balance_amount,
  } = req.body;

  try {
    const draft_id = await sid('draft');
    const unpaid_id = await psid('unpaid');

    const seq = await pool.query("SELECT nextval('voucher_no_seq') AS n");
    const voucher_no = String(seq.rows[0].n).padStart(5, '0');

    const result = await pool.query(
      `INSERT INTO vouchers
         (voucher_no, supplier_id, invoice_date, narration,
          taxable_amount, cgst, sgst, igst, tds_amount, total_amount,
          due_days, balance_amount, status_det_id, payment_status_det_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        voucher_no, supplier_id || null, invoice_date || null, narration || null,
        taxable_amount || 0, cgst || 0, sgst || 0, igst || 0, tds_amount || 0,
        total_amount || 0, due_days || null, balance_amount || 0,
        draft_id, unpaid_id, req.user.id,
      ]
    );

    const newId = result.rows[0].id;
    await logActivity(newId, req.user.id, 'created', `Voucher ${voucher_no} created manually`);
    res.status(201).json({ id: newId, voucher_no });
  } catch (err) {
    console.error('createVoucher error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateVoucher(req, res) {
  const { id } = req.params;
  const {
    supplier_id, invoice_date, narration, taxable_amount, cgst, sgst, igst, tds_amount, total_amount,
    payment_status, payment_reference, line_items, due_days, balance_amount,
  } = req.body;

  try {
    const existing = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    if (req.user.role === 'manager') return res.status(403).json({ error: 'Managers cannot edit voucher fields. Use approve/reject action instead.' });

    const v = existing.rows[0];
    if (!['draft', 'assigned'].includes(v.status)) {
      return res.status(400).json({ error: 'Cannot edit voucher in status: ' + v.status });
    }

    const payment_status_det_id = payment_status
      ? await psid(payment_status)
      : null;



    await pool.query(
      `UPDATE vouchers SET
        supplier_id=COALESCE($1,supplier_id),
        invoice_date=COALESCE($2,invoice_date), narration=COALESCE($3,narration),
        taxable_amount=COALESCE($4,taxable_amount), cgst=COALESCE($5,cgst),
        sgst=COALESCE($6,sgst), igst=COALESCE($7,igst), tds_amount=COALESCE($8,tds_amount),
        total_amount=COALESCE($9,total_amount),
        payment_status_det_id=COALESCE($10,payment_status_det_id),
        payment_reference=COALESCE($11,payment_reference),
        due_days=$12,
        balance_amount=$13,
        updated_at=NOW()
       WHERE id=$14`,
      [supplier_id, invoice_date, narration, taxable_amount, cgst, sgst, igst, tds_amount, total_amount,
       payment_status_det_id, payment_reference,
       due_days !== undefined ? due_days : v.due_days,
       balance_amount !== undefined ? (parseFloat(balance_amount) || 0) : (v.balance_amount || 0),
       id]
    );

    // Auto-comment when balance_amount is set or changed
    const oldBalance = parseFloat(v.balance_amount) || 0;
    const newBalance = balance_amount !== undefined ? (parseFloat(balance_amount) || 0) : oldBalance;
    if (newBalance !== oldBalance) {
      const balanceComment = newBalance > 0
        ? `Balance of ₹${newBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} held back`
        : `Balance cleared (previously ₹${oldBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })})`;
      await logActivity(id, req.user.id, 'balance_changed', balanceComment,
        { old_balance: oldBalance, new_balance: newBalance });
    }

    res.json({ message: 'Voucher updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function assignVoucher(req, res) {
  const { id } = req.params;
  const { manager_id } = req.body;
  if (!manager_id) return res.status(400).json({ error: 'manager_id required' });

  try {
    const managerIds = await paramCache.allDetIds('User Role', ['manager', 'executive']);
    const mgr = await pool.query(
      'SELECT id, name FROM users WHERE id=$1 AND role_det_id=ANY($2) AND is_active=true',
      [manager_id, managerIds]
    );
    if (!mgr.rows.length) return res.status(404).json({ error: 'Manager not found' });

    const statusId = await sid('assigned');
    await pool.query(
      'UPDATE vouchers SET assigned_to=$1, status_det_id=$2, assigned_at=NOW(), updated_at=NOW() WHERE id=$3',
      [manager_id, statusId, id]
    );
    const mgrName = mgr.rows[0]?.name || manager_id;
    await logActivity(id, req.user.id, 'assigned', `Assigned to ${mgrName}`,
      { manager_id, manager_name: mgrName });
    res.json({ message: 'Voucher assigned' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function managerAction(req, res) {
  const { id } = req.params;
  const { action, comment, rejected_reason } = req.body;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject' });

  try {
    const vResult = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });

    const v = vResult.rows[0];
    if (v.assigned_to !== req.user.id) return res.status(403).json({ error: 'Not assigned to you' });
    if (v.status !== 'assigned') return res.status(400).json({ error: 'Voucher is not in assigned state' });

    const newCode   = action === 'approve' ? 'verification' : 'rejected';
    const newStatusId = await sid(newCode);

    await pool.query(
      'UPDATE vouchers SET status_det_id=$1, rejected_reason=$2, updated_at=NOW() WHERE id=$3',
      [newStatusId, action === 'reject' ? (rejected_reason || comment) : null, id]
    );
    await logActivity(id, req.user.id, 'status_changed',
      action === 'approve' ? 'Sent for verification' : `Rejected: ${rejected_reason || comment || ''}`,
      { from: 'assigned', to: newCode });
    if (comment && action === 'approve') {
      await pool.query('INSERT INTO voucher_comments (voucher_id, user_id, comment) VALUES ($1,$2,$3)',
        [id, req.user.id, comment]);
    }
    res.json({ message: `Voucher ${action}d`, status: newCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function approverVerify(req, res) {
  const { id } = req.params;
  const { action, comment, rejected_reason } = req.body;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject' });
  if (action === 'reject' && !rejected_reason?.trim()) return res.status(400).json({ error: 'rejected_reason is required when rejecting' });

  try {
    const vResult = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    const vrow = vResult.rows[0];
    if (vrow.status !== 'verification') return res.status(400).json({ error: 'Voucher must be in verification status' });

    const newCode     = action === 'approve' ? 'ready_for_bank' : 'rejected';
    const newStatusId = await sid(newCode);

    await pool.query(
      'UPDATE vouchers SET status_det_id=$1, rejected_reason=$2, updated_at=NOW() WHERE id=$3',
      [newStatusId, action === 'reject' ? rejected_reason.trim() : null, id]
    );
    await logActivity(id, req.user.id, 'status_changed',
      action === 'approve' ? 'Verified — ready for bank' : `Rejected at verification: ${rejected_reason.trim()}`,
      { from: 'verification', to: newCode });
    if (comment) {
      await pool.query('INSERT INTO voucher_comments (voucher_id, user_id, comment) VALUES ($1,$2,$3)',
        [id, req.user.id, comment]);
    }
    res.json({ message: `Voucher ${action}d`, status: newCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function adminFinalApproval(req, res) {
  const { id } = req.params;
  const { action, comment, rejected_reason } = req.body;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject' });
  if (action === 'reject' && !rejected_reason?.trim()) return res.status(400).json({ error: 'rejected_reason is required when rejecting' });

  try {
    const vResult = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    const vrow = vResult.rows[0];
    if (vrow.status !== 'proceed') return res.status(400).json({ error: 'Voucher must be proceed before approval' });

    const newCode     = action === 'approve' ? 'approved' : 'rejected';
    const newStatusId = await sid(newCode);

    await pool.query(
      'UPDATE vouchers SET status_det_id=$1, rejected_reason=$2, updated_at=NOW() WHERE id=$3',
      [newStatusId, action === 'reject' ? rejected_reason.trim() : null, id]
    );

    // Source voucher total is already reduced at balance-voucher creation time

    await logActivity(id, req.user.id, 'status_changed',
      action === 'approve' ? 'Approved for payment' : `Rejected at final approval: ${rejected_reason.trim()}`,
      { from: 'proceed', to: newCode });
    if (comment) {
      await pool.query('INSERT INTO voucher_comments (voucher_id, user_id, comment) VALUES ($1,$2,$3)',
        [id, req.user.id, comment]);
    }
    res.json({ message: `Voucher ${action}d`, status: newCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateUtr(req, res) {
  const { id } = req.params;
  const { utr_no } = req.body;
  if (!utr_no?.trim()) return res.status(400).json({ error: 'UTR number is required' });
  try {
    const vResult = await pool.query(
      `SELECT v.id, pd.code AS status FROM vouchers v
       LEFT JOIN parameter_details pd ON pd.parameterdetid = v.status_det_id
       WHERE v.id=$1`, [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    if (vResult.rows[0].status !== 'approved') return res.status(400).json({ error: 'Voucher must be in approved status to enter UTR' });
    await pool.query('UPDATE vouchers SET utr_no=$1, updated_at=NOW() WHERE id=$2', [utr_no.trim(), id]);
    res.json({ message: 'UTR saved', utr_no: utr_no.trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function reopenVoucher(req, res) {
  const { id } = req.params;
  try {
    const vResult = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    if (vResult.rows[0].status !== 'rejected') return res.status(400).json({ error: 'Only rejected vouchers can be reopened' });

    const draftId = await sid('draft');
    await pool.query(
      `UPDATE vouchers SET status_det_id=$1, rejected_reason=NULL, assigned_to=NULL, updated_at=NOW() WHERE id=$2`,
      [draftId, id]
    );
    await logActivity(id, req.user.id, 'status_changed', 'Voucher reopened and reset to draft',
      { from: 'rejected', to: 'draft' });
    res.json({ message: 'Voucher reopened', status: 'draft' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function addComment(req, res) {
  const { id } = req.params;
  const { comment } = req.body;
  if (!comment) return res.status(400).json({ error: 'comment required' });
  try {
    await pool.query('INSERT INTO voucher_comments (voucher_id, user_id, comment) VALUES ($1,$2,$3)',
      [id, req.user.id, comment]);
    res.json({ message: 'Comment added' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function generateVoucher(req, res) {
  const { id } = req.params;
  try {
    const vResult = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    const voucher = vResult.rows[0];
    if (!['approved', 'downloaded'].includes(voucher.status)) {
      return res.status(400).json({ error: 'Voucher must be approved before generating' });
    }
    if (!voucher.utr_no?.trim()) {
      return res.status(400).json({ error: 'UTR number is required before generating PDF' });
    }
    const comments  = await pool.query(
      `SELECT vc.*, u.name AS user_name, pd.code AS role
       FROM voucher_comments vc JOIN users u ON vc.user_id=u.id
       LEFT JOIN parameter_details pd ON pd.parameterdetid=u.role_det_id
       WHERE vc.voucher_id=$1 ORDER BY vc.created_at`, [id]);
    let companyBank = null;
    if (voucher.company_bank_id) {
      const bk = await pool.query('SELECT * FROM company_bank_accounts WHERE id=$1', [voucher.company_bank_id]);
      companyBank = bk.rows[0] || null;
    }
    voucher.voucher_no = await ensureVoucherNo(id, voucher.voucher_no);
    const { fileName, voucherNo } = await generateAndSaveVoucherPDF(voucher, comments.rows, companyBank);
    await pool.query('UPDATE vouchers SET voucher_pdf_path=$1, voucher_no=$2, updated_at=NOW() WHERE id=$3',
      [fileName, voucherNo, id]);
    res.json({ message: 'Voucher PDF generated and saved', fileName, voucherNo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate voucher: ' + err.message });
  }
}

async function downloadVoucher(req, res) {
  const { id } = req.params;
  try {
    const vResult = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    const voucher = vResult.rows[0];
    if (!['approved', 'downloaded'].includes(voucher.status)) {
      return res.status(400).json({ error: 'Only approved vouchers can be downloaded' });
    }

    const comments  = await pool.query(
      `SELECT vc.*, u.name AS user_name, pd.code AS role
       FROM voucher_comments vc JOIN users u ON vc.user_id=u.id
       LEFT JOIN parameter_details pd ON pd.parameterdetid=u.role_det_id
       WHERE vc.voucher_id=$1 ORDER BY vc.created_at`, [id]);
    let companyBank = null;
    if (voucher.company_bank_id) {
      const bk = await pool.query('SELECT * FROM company_bank_accounts WHERE id=$1', [voucher.company_bank_id]);
      companyBank = bk.rows[0] || null;
    }

    voucher.voucher_no = await ensureVoucherNo(id, voucher.voucher_no);
    let pdfBuffer;
    const savedPath = voucher.voucher_pdf_path ? path.join(VOUCHERS_DIR, voucher.voucher_pdf_path) : null;
    if (savedPath && fs.existsSync(savedPath)) {
      pdfBuffer = fs.readFileSync(savedPath);
    } else {
      const { fileName, voucherNo } = await generateAndSaveVoucherPDF(voucher, comments.rows, companyBank);
      await pool.query('UPDATE vouchers SET voucher_pdf_path=$1, voucher_no=$2, updated_at=NOW() WHERE id=$3',
        [fileName, voucherNo, id]);
      pdfBuffer = fs.readFileSync(path.join(VOUCHERS_DIR, fileName));
    }

    // Mark downloaded
    const downloadedId = await sid('downloaded');
    const approvedId   = await sid('approved');
    await pool.query(
      'UPDATE vouchers SET status_det_id=$1, updated_at=NOW() WHERE id=$2 AND status_det_id=$3',
      [downloadedId, id, approvedId]
    );

    const outName = voucher.voucher_no
      ? `voucher-${voucher.voucher_no.replace(/\//g, '-')}.pdf`
      : `voucher-${id.slice(0, 8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to download voucher: ' + err.message });
  }
}

async function getInvoiceFile(req, res) {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM vouchers WHERE id=$1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    const { invoice_path, invoice_original_name } = result.rows[0];
    if (!invoice_path) return res.status(404).json({ error: 'No invoice file' });
    if (req.user.role === 'manager') {
      const assigned = await pool.query('SELECT assigned_to FROM vouchers WHERE id=$1', [id]);
      if (assigned.rows[0]?.assigned_to !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    }
    const filePath = path.join(__dirname, '../../uploads', invoice_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
    res.sendFile(filePath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteVoucher(req, res) {
  const { id } = req.params;
  try {
    const r = await pool.query('SELECT id, voucher_pdf_path FROM vouchers WHERE id=$1', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Voucher not found' });

    // Delete generated voucher PDF if it exists
    if (r.rows[0].voucher_pdf_path) {
      const pdfPath = path.join(VOUCHERS_DIR, r.rows[0].voucher_pdf_path);
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    }

    // Delete all attachment files
    const attachments = await pool.query('SELECT file_path FROM voucher_attachments WHERE voucher_id=$1', [id]);
    for (const att of attachments.rows) {
      const attPath = path.join(__dirname, '../../uploads', att.file_path);
      if (fs.existsSync(attPath)) fs.unlinkSync(attPath);
    }

    await pool.query('DELETE FROM vouchers WHERE id=$1', [id]);
    res.json({ message: 'Voucher deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function uploadAttachments(req, res) {
  const { id } = req.params;
  console.log('[ATTACH] voucher:', id, 'files:', req.files?.length, req.files?.map(f => f.originalname + ' ' + f.mimetype));
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });
  try {
    const voucher = await pool.query('SELECT id FROM vouchers WHERE id=$1', [id]);
    if (!voucher.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    const inserted = [];
    for (const file of req.files) {
      const r = await pool.query(
        `INSERT INTO voucher_attachments (voucher_id, file_path, original_name, mime_type, file_size, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [id, file.filename, file.originalname, file.mimetype, file.size, req.user.id]
      );
      inserted.push(r.rows[0]);
    }
    res.status(201).json({ attachments: inserted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getAttachmentFile(req, res) {
  const { id, aid } = req.params;
  try {
    const r = await pool.query('SELECT * FROM voucher_attachments WHERE id=$1 AND voucher_id=$2', [aid, id]);
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

async function deleteAttachment(req, res) {
  const { id, aid } = req.params;
  try {
    const r = await pool.query('SELECT * FROM voucher_attachments WHERE id=$1 AND voucher_id=$2', [aid, id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Attachment not found' });
    const filePath = path.join(__dirname, '../../uploads', r.rows[0].file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await pool.query('DELETE FROM voucher_attachments WHERE id=$1', [aid]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function exportVouchers(req, res) {
  const { ids } = req.body;
  try {
    const adminUser = await pool.query('SELECT email, mobile_no FROM users WHERE id=$1', [req.user.id]);
    const admin = adminUser.rows[0] || {};

    const companyBankRes = await pool.query(
      `SELECT cba.account_number FROM company_bank_accounts cba
       JOIN company_details cd ON cd.id = cba.company_id
       WHERE cba.is_primary=true AND cd.is_active=true LIMIT 1`
    );
    const debitAccNo = companyBankRes.rows[0]?.account_number || '';

    const readyId = await sid('ready_for_bank');
    let query, params;
    if (ids && ids.length) {
      query  = `${VOUCHER_SELECT} WHERE v.id=ANY($1) AND v.status_det_id=$2`;
      params = [ids, readyId];
    } else {
      query  = `${VOUCHER_SELECT} WHERE v.status_det_id=$1`;
      params = [readyId];
    }
    const vRes = await pool.query(query, params);
    if (!vRes.rows.length) return res.status(400).json({ error: 'No ready_for_bank vouchers found' });

    const XLSX = require('xlsx');
    const today = new Date();
    const pymt_date = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`;

    const rows = [];
    const exportedIds = [];

    for (const v of vRes.rows) {
      let bene_acc = '', bene_ifsc = '', bnf_name = v.supplier_name || '';
      if (v.supplier_id) {
        const sbRes = await pool.query(
          'SELECT account_holder_name, account_number, ifsc_code FROM supplier_bank_details WHERE supplier_id=$1 AND is_primary=true LIMIT 1',
          [v.supplier_id]
        );
        if (sbRes.rows.length) {
          bene_acc  = sbRes.rows[0].account_number || '';
          bene_ifsc = sbRes.rows[0].ifsc_code || '';
          bnf_name  = sbRes.rows[0].account_holder_name || v.supplier_name || '';
        }
      }
      rows.push({
        PYMT_PROD_TYPE_CODE: 'PAB_VENDOR', PYMT_MODE: 'NEFT',
        DEBIT_ACC_NO: debitAccNo, BNF_NAME: bnf_name,
        BENE_ACC_NO: bene_acc, BENE_IFSC: bene_ifsc,
        AMOUNT: Number(v.total_amount) || 0,
        DEBIT_NARR: v.supplier_name || '', CREDIT_NARR: v.supplier_name || '',
        MOBILE_NUM: admin.mobile_no || '', EMAIL_ID: admin.email || '',
        REMARK: v.bill_ref_no || v.payment_reference || '', PYMT_DATE: pymt_date,
        REF_NO: 'Na', ADDL_INFO1: '', ADDL_INFO2: '', ADDL_INFO3: '', ADDL_INFO4: '', ADDL_INFO5: '',
      });
      exportedIds.push(v.id);
    }

    const exportedId = await sid('proceed');
    await pool.query('UPDATE vouchers SET status_det_id=$1, updated_at=NOW() WHERE id=ANY($2)',
      [exportedId, exportedIds]);

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BankUpload');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `bank-upload-${today.toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error('exportVouchers error:', err);
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
}

async function syncPaymentStatus(req, res) {
  const { id } = req.params;
  try {
    const vResult = await pool.query('SELECT payment_reference FROM vouchers WHERE id=$1', [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    const { payment_reference } = vResult.rows[0];
    if (!payment_reference?.trim()) return res.status(400).json({ error: 'Voucher has no payment_reference to look up' });

    const BASE = (process.env.SALESPRO_API_URL || '').replace(/\/$/, '');
    if (!BASE) return res.status(500).json({ error: 'SALESPRO_API_URL not configured' });

    const spRes = await axios.post(`${BASE}/api/appayment/GetByRef`,
      { ExtRef: payment_reference.trim() },
      { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
    );
    const spRows = spRes.data?.Data || [];

    let totalPaid = 0, totalOutstanding = 0;
    for (const r of spRows) {
      totalPaid        += Number(r.PaidAmount  ?? r.paidAmount  ?? 0);
      totalOutstanding += Number(r.Outstanding ?? r.outstanding ?? 0);
    }

    let newCode = 'unpaid';
    if (spRows.length > 0 && totalPaid > 0 && totalOutstanding <= 0) newCode = 'paid';
    else if (totalPaid > 0 && totalOutstanding > 0) newCode = 'partial';

    const newPayId = await psid(newCode);
    await pool.query('UPDATE vouchers SET payment_status_det_id=$1, updated_at=NOW() WHERE id=$2', [newPayId, id]);

    res.json({ message: 'Payment status synced', payment_status: newCode, totalPaid, totalOutstanding, rowCount: spRows.length });
  } catch (err) {
    console.error('syncPaymentStatus error:', err.message);
    res.status(err.response?.status || 500).json({ error: err.response?.data?.Status?.MessageText || err.message || 'Sync failed' });
  }
}

async function emailPreview(req, res) {
  const { id } = req.params;
  try {
    const vResult = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    const voucher = vResult.rows[0];

    const companyRes = await pool.query('SELECT * FROM company_details WHERE is_active=true LIMIT 1');
    const company = companyRes.rows[0] || null;
    let companyBank = null;
    if (company) {
      const bkRes = await pool.query('SELECT * FROM company_bank_accounts WHERE company_id=$1 AND is_primary=true LIMIT 1', [company.id]);
      companyBank = bkRes.rows[0] || null;
    }

    let toEmails = [];
    if (voucher.supplier_id) {
      const cr = await pool.query(
        'SELECT email FROM supplier_contacts WHERE supplier_id=$1 AND is_primary=true AND email IS NOT NULL LIMIT 1',
        [voucher.supplier_id]);
      if (cr.rows.length) toEmails = [cr.rows[0].email];
      else {
        const ar = await pool.query(
          'SELECT email FROM supplier_contacts WHERE supplier_id=$1 AND email IS NOT NULL LIMIT 1',
          [voucher.supplier_id]);
        if (ar.rows.length) toEmails = [ar.rows[0].email];
      }
    }

    const html = buildPaymentAdviceHTML(voucher, company, companyBank, '');
    const companyName = company?.company_name || 'Accounts Payable';
    const subject = `Payment Advice — ${companyName} — ₹${Number(voucher.total_amount||0).toLocaleString('en-IN')}`;
    res.json({ html, subject, to: toEmails, cc: [], bcc: [] });
  } catch (err) {
    console.error('emailPreview error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
}

async function sendAdviceEmail(req, res) {
  const { id } = req.params;
  const { to, cc, bcc, subject, html, personal_note, comment } = req.body;
  if (!to || !to.length) return res.status(400).json({ error: 'At least one To address is required' });

  try {
    const vResult = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    const voucher = vResult.rows[0];
    if (voucher.status !== 'proceed') return res.status(400).json({ error: 'Voucher must be proceed before final approval' });

    let finalHtml = html;
    if (!finalHtml) {
      const companyRes = await pool.query('SELECT * FROM company_details WHERE is_active=true LIMIT 1');
      const company = companyRes.rows[0] || null;
      let companyBank = null;
      if (company) {
        const bkRes = await pool.query('SELECT * FROM company_bank_accounts WHERE company_id=$1 AND is_primary=true LIMIT 1', [company.id]);
        companyBank = bkRes.rows[0] || null;
      }
      finalHtml = buildPaymentAdviceHTML(voucher, company, companyBank, personal_note || '');
    }

    await sendMail({ to, cc: cc || [], bcc: bcc || [], subject, html: finalHtml });

    const approvedId = await sid('approved');
    await pool.query('UPDATE vouchers SET status_det_id=$1, updated_at=NOW() WHERE id=$2',
      [approvedId, id]);
    if (comment) {
      await pool.query('INSERT INTO voucher_comments (voucher_id, user_id, comment) VALUES ($1,$2,$3)',
        [id, req.user.id, comment]);
    }

    res.json({ message: 'Payment advice sent and voucher approved', status: 'approved' });
  } catch (err) {
    console.error('sendAdviceEmail error:', err);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
}

module.exports = {
  createBalanceVoucher,
  uploadAndScan, createVoucher, listVouchers, getVoucher, updateVoucher, deleteVoucher,
  assignVoucher, managerAction, approverVerify, adminFinalApproval, reopenVoucher,
  addComment, generateVoucher, downloadVoucher, getInvoiceFile,
  uploadAttachments, getAttachmentFile, deleteAttachment,
  exportVouchers, syncPaymentStatus, emailPreview, sendAdviceEmail, updateUtr,
};
