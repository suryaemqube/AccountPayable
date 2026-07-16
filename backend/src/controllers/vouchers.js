const pool = require('../config/db');
const { extractInvoiceData } = require('../utils/claudeOcr');
const { generateAndSaveVoucherPDF } = require('../utils/pdfGenerator');
const { buildPaymentAdviceHTML, buildDueReminderHTML, sendMail } = require('../utils/emailService');
const paramCache = require('../utils/parameterCache');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const VOUCHERS_DIR = path.join(__dirname, '../../vouchers');
const { logActivity } = require('../utils/activityLog');
const { notify } = require('../utils/notify');
const VS = require('../constants/voucherStatus');

// ── Common SELECT fragment ─────────────────────────────────────────────────
const VOUCHER_SELECT = `
  SELECT v.*,
    u1.name  AS created_by_name,
    u2.name  AS assigned_to_name,
    pds.code AS status,
    pdp.code AS payment_status,
    bs.supplier_name,
    bs.gstin AS supplier_gstin,
    CASE
      WHEN v.assigned_at IS NOT NULL AND COALESCE(v.due_days, b.due_days) IS NOT NULL
      THEN (v.assigned_at::date + COALESCE(v.due_days, b.due_days))
      ELSE NULL
    END AS due_date,
    b.bill_no,
    b.bill_ref_no,
    b.bill_date,
    b.bill_status,
    b.invoice_date      AS bill_invoice_date,
    b.taxable_amount    AS bill_taxable_amount,
    b.cgst              AS bill_cgst,
    b.sgst              AS bill_sgst,
    b.igst              AS bill_igst,
    b.tds_amount        AS bill_tds_amount,
    b.credit_note_amount AS bill_credit_note_amount,
    b.total_amount      AS bill_total_amount,
    b.narration         AS bill_narration,
    b.payment_reference AS bill_payment_reference,
    b.supplier_id       AS bill_supplier_id,
    b.company_bank_id   AS bill_company_bank_id,
    b.due_days          AS bill_due_days,
    pt.parametervalues  AS bill_purchase_type_label,
    pt.code             AS bill_purchase_type_code,
    b.salespro_act_name AS bill_salespro_act_name,
    COALESCE((SELECT SUM(v2.amount) FROM vouchers v2 WHERE v2.bill_id = b.id), 0) AS bill_allocated_amount
  FROM vouchers v
  LEFT JOIN users u1      ON v.created_by  = u1.id
  LEFT JOIN users u2      ON v.assigned_to = u2.id
  LEFT JOIN parameter_details pds ON pds.parameterdetid = v.status_det_id
  LEFT JOIN parameter_details pdp ON pdp.parameterdetid = v.payment_status_det_id
  LEFT JOIN bills b       ON b.id = v.bill_id
  LEFT JOIN suppliers bs  ON bs.id = b.supplier_id
  LEFT JOIN parameter_details pt ON pt.parameterdetid = b.purchase_type_det_id
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

async function createBalanceVoucher(req, res) { // deprecated — balance handled at bill level
  return res.status(410).json({ error: 'Balance vouchers are no longer supported. Create a new voucher from the bill.' });
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

    const [statusId, payStatusId] = await Promise.all([sid(VS.DRAFT), psid('pending_verification')]);

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
      sid(VS.DRAFT), psid('pending_verification'),
    ]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const vResult = await client.query(
        `INSERT INTO vouchers (narration, status_det_id, payment_status_det_id, created_by)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [extracted.narration || null, statusId, payStatusId, req.user.id]
      );
      const voucher = vResult.rows[0];


      await client.query('COMMIT');
      await logActivity(voucher.id, req.user.id, 'created', 'Voucher created via invoice upload');
      notify({
        type: 'voucher_created',
        message: `New voucher created via invoice upload by ${req.user.name}`,
        entity_type: 'voucher', entity_id: voucher.id, created_by: req.user.id,
      });
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

    // Supplier info comes via bill join (bill_supplier_id in VOUCHER_SELECT)
    let supplierInfo = null;
    if (voucher.bill_supplier_id) {
      const sResult = await pool.query(
        `SELECT s.id, s.supplier_name, s.gstin, s.owned_by, u.name AS manager_name
         FROM suppliers s LEFT JOIN users u ON s.owned_by = u.id
         WHERE s.id = $1`,
        [voucher.bill_supplier_id]
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
  // Direct voucher creation (non-bill) — only narration kept
  const { narration } = req.body;
  try {
    const draft_id  = await sid(VS.DRAFT);
    const unpaid_id = await psid('pending_verification');
    const seq = await pool.query("SELECT nextval('voucher_no_seq') AS n");
    const voucher_no = String(seq.rows[0].n).padStart(5, '0');
    const result = await pool.query(
      `INSERT INTO vouchers (voucher_no, narration, status_det_id, payment_status_det_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [voucher_no, narration || null, draft_id, unpaid_id, req.user.id]
    );
    const newId = result.rows[0].id;
    await logActivity(newId, req.user.id, 'created', `Voucher ${voucher_no} created`);
    notify({
      type: 'voucher_created',
      message: `New voucher #${voucher_no} created by ${req.user.name}`,
      entity_type: 'voucher', entity_id: newId, created_by: req.user.id,
    });
    res.status(201).json({ id: newId, voucher_no });
  } catch (err) {
    console.error('createVoucher error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateVoucher(req, res) {
  const { id } = req.params;
  const { narration, amount, payment_mode, due_days } = req.body;

  try {
    const existing = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    if (req.user.role === 'manager') return res.status(403).json({ error: 'Managers cannot edit voucher fields. Use approve/reject action instead.' });

    const v = existing.rows[0];
    if (![VS.DRAFT, VS.ASSIGNED].includes(v.status)) {
      return res.status(400).json({ error: 'Cannot edit voucher in status: ' + v.status });
    }

    await pool.query(
      `UPDATE vouchers SET
        narration    = COALESCE($1, narration),
        amount       = COALESCE($2, amount),
        payment_mode = COALESCE($3, payment_mode),
        due_days     = COALESCE($4, due_days),
        updated_at   = NOW()
       WHERE id = $5`,
      [narration ?? null, amount != null ? Number(amount) : null, payment_mode ?? null,
       due_days != null ? Number(due_days) : null, id]
    );

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
    const managerIds = await paramCache.allDetIds('User Role', ['manager', 'executive', 'approver']);
    const mgr = await pool.query(
      'SELECT id, name FROM users WHERE id=$1 AND role_det_id=ANY($2) AND is_active=true',
      [manager_id, managerIds]
    );
    if (!mgr.rows.length) return res.status(404).json({ error: 'Manager or approver not found' });

    const statusId = await sid(VS.ASSIGNED);
    const updated = await pool.query(
      'UPDATE vouchers SET assigned_to=$1, status_det_id=$2, assigned_at=NOW(), updated_at=NOW() WHERE id=$3 RETURNING voucher_no',
      [manager_id, statusId, id]
    );
    const mgrName = mgr.rows[0]?.name || manager_id;
    const voucherLabel = updated.rows[0]?.voucher_no ? `Voucher #${updated.rows[0].voucher_no}` : 'Voucher';
    await logActivity(id, req.user.id, 'assigned', `Assigned to ${mgrName}`,
      { manager_id, manager_name: mgrName });
    notify({
      type: 'voucher_assigned',
      message: `${voucherLabel} assigned to ${mgrName} by ${req.user.name}`,
      entity_type: 'voucher', entity_id: id, created_by: req.user.id,
    });

    // Immediate "due today" notification — invoice date is today AND credit days is
    // 0 or not set at all (treated the same as 0 — pay right away), so this can't
    // wait for the next 8 AM due-reminder run.
    // due_today_mail on the response / activity log tells the caller what happened,
    // since this send is otherwise silent (fire-and-forget so a mail issue never
    // blocks the assignment itself).
    let due_today_mail = 'not_applicable';
    try {
      const dueRes = await pool.query(
        `SELECT v.id, v.voucher_no, v.amount, v.assigned_at,
                COALESCE(v.due_days, b.due_days, 0) AS due_days,
                b.bill_ref_no, b.payment_reference,
                s.supplier_name,
                u.email AS assignee_email, u.name AS assignee_name,
                pdrole.code AS assignee_role
         FROM vouchers v
         LEFT JOIN bills     b ON b.id = v.bill_id
         LEFT JOIN suppliers s ON s.id = b.supplier_id
         JOIN users u ON u.id = v.assigned_to
         LEFT JOIN parameter_details pdrole ON pdrole.parameterdetid = u.role_det_id
         WHERE v.id = $1
           AND b.invoice_date = CURRENT_DATE
           AND COALESCE(v.due_days, b.due_days, 0) = 0`,
        [id]
      );
      const row = dueRes.rows[0];
      if (row) {
        if (!row.assignee_email) {
          due_today_mail = 'failed';
          await logActivity(id, req.user.id, 'notification', `Due-today email NOT sent — ${mgrName} has no email on file`);
        } else {
          const html = buildDueReminderHTML(
            {
              id:                row.id,
              voucher_no:        row.voucher_no,
              supplier_name:     row.supplier_name,
              bill_ref_no:       row.bill_ref_no,
              payment_reference: row.payment_reference,
              amount:            row.amount,
              assigned_at:       row.assigned_at,
              due_days:          row.due_days,
            },
            { name: row.assignee_name, email: row.assignee_email, role: row.assignee_role },
            0
          );
          const fmtSubAmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const voucherLabel = row.voucher_no ? `Voucher #${row.voucher_no}` : 'Voucher';
          const subject = `🔴 Due TODAY: ${voucherLabel} from ${row.supplier_name || 'Supplier'} — ₹${fmtSubAmt(row.amount)}`;
          try {
            await sendMail({ to: row.assignee_email, subject, html });
            due_today_mail = 'sent';
            await logActivity(id, req.user.id, 'notification', `Due-today email sent to ${row.assignee_email}`);
            console.log(`[AssignVoucher] Due-today mail sent for voucher ${id} to ${row.assignee_email}`);
          } catch (mailErr) {
            due_today_mail = 'failed';
            await logActivity(id, req.user.id, 'notification', `Due-today email FAILED to send to ${row.assignee_email}: ${mailErr.message}`);
            console.error(`[AssignVoucher] Immediate due-today mail failed for voucher ${id}:`, mailErr.message);
          }
        }
      }
    } catch (mailErr) {
      console.error(`[AssignVoucher] Due-today mail check failed for voucher ${id}:`, mailErr.message);
    }

    res.json({ message: 'Voucher assigned', due_today_mail });
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
    if (v.status !== VS.ASSIGNED) return res.status(400).json({ error: 'Voucher is not in assigned state' });

    const newCode   = action === 'approve' ? VS.APPROVED : VS.REJECTED;
    const newStatusId = await sid(newCode);

    await pool.query(
      'UPDATE vouchers SET status_det_id=$1, rejected_reason=$2, updated_at=NOW() WHERE id=$3',
      [newStatusId, action === 'reject' ? (rejected_reason || comment) : null, id]
    );
    await logActivity(id, req.user.id, 'status_changed',
      action === 'approve' ? `Approved by ${req.user.role}` : `Rejected: ${rejected_reason || comment || ''}`,
      { from: VS.ASSIGNED, to: newCode });
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
    if (vrow.status !== VS.APPROVED) return res.status(400).json({ error: 'Voucher must be in approved status' });

    const newCode     = action === 'approve' ? VS.REVIEWED : VS.REJECTED;
    const newStatusId = await sid(newCode);

    await pool.query(
      'UPDATE vouchers SET status_det_id=$1, rejected_reason=$2, updated_at=NOW() WHERE id=$3',
      [newStatusId, action === 'reject' ? rejected_reason.trim() : null, id]
    );
    await logActivity(id, req.user.id, 'status_changed',
      action === 'approve' ? 'Reviewed by approver' : `Rejected at review: ${rejected_reason.trim()}`,
      { from: VS.APPROVED, to: newCode });
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
    if (vrow.status !== VS.EXPORTED) return res.status(400).json({ error: 'Voucher must be exported before final approval' });

    const newCode     = action === 'approve' ? VS.READY_TO_REMIT : VS.REJECTED;
    const newStatusId = await sid(newCode);

    await pool.query(
      'UPDATE vouchers SET status_det_id=$1, rejected_reason=$2, updated_at=NOW() WHERE id=$3',
      [newStatusId, action === 'reject' ? rejected_reason.trim() : null, id]
    );
    await logActivity(id, req.user.id, 'status_changed',
      action === 'approve' ? 'Ready to remit' : `Rejected at final approval: ${rejected_reason.trim()}`,
      { from: VS.EXPORTED, to: newCode });
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
      `SELECT v.id, v.bill_id, pd.code AS status FROM vouchers v
       LEFT JOIN parameter_details pd ON pd.parameterdetid = v.status_det_id
       WHERE v.id=$1`, [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    if (vResult.rows[0].status !== VS.READY_TO_REMIT) return res.status(400).json({ error: 'Voucher must be in Ready to Remit status to enter UTR' });

    // Match the bank-file import behavior: entering a UTR marks the voucher Paid.
    const paidId = await sid(VS.PAID);
    await pool.query('UPDATE vouchers SET utr_no=$1, status_det_id=$2, paid_at=NOW(), updated_at=NOW() WHERE id=$3', [utr_no.trim(), paidId, id]);
    await logActivity(id, req.user.id, 'status_changed', 'Marked as Paid — UTR entered manually',
      { from: VS.READY_TO_REMIT, to: VS.PAID });

    // The bill's own status (Open/Partially Paid/Fully Paid) is derived from
    // its vouchers' paid amounts — recompute it now that this one is Paid.
    if (vResult.rows[0].bill_id) {
      const { refreshBillStatus } = require('./bills');
      await refreshBillStatus(vResult.rows[0].bill_id);
    }

    res.json({ message: 'UTR saved', utr_no: utr_no.trim(), status: VS.PAID });
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
    if (vResult.rows[0].status !== VS.REJECTED) return res.status(400).json({ error: 'Only rejected vouchers can be reopened' });

    const draftId = await sid(VS.DRAFT);
    await pool.query(
      `UPDATE vouchers SET status_det_id=$1, rejected_reason=NULL, assigned_to=NULL, updated_at=NOW() WHERE id=$2`,
      [draftId, id]
    );
    await logActivity(id, req.user.id, 'status_changed', 'Voucher reopened and reset to draft',
      { from: VS.REJECTED, to: VS.DRAFT });
    res.json({ message: 'Voucher reopened', status: VS.DRAFT });
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
    if (![VS.READY_TO_REMIT, VS.PAID].includes(voucher.status)) {
      return res.status(400).json({ error: 'Voucher must be Ready to Remit before generating' });
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
    const bankId = voucher.bill_company_bank_id || voucher.company_bank_id;
    if (bankId) {
      const bk = await pool.query('SELECT * FROM company_bank_accounts WHERE id=$1', [bankId]);
      companyBank = bk.rows[0] || null;
    }
    if (!companyBank) {
      const bk = await pool.query('SELECT * FROM company_bank_accounts WHERE is_primary=true LIMIT 1');
      companyBank = bk.rows[0] || null;
      console.log('Generating voucher PDF for voucher:', companyBank);
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
    if (![VS.READY_TO_REMIT, VS.PAID].includes(voucher.status)) {
      return res.status(400).json({ error: 'Only Ready to Remit vouchers can be downloaded' });
    }

    const comments  = await pool.query(
      `SELECT vc.*, u.name AS user_name, pd.code AS role
       FROM voucher_comments vc JOIN users u ON vc.user_id=u.id
       LEFT JOIN parameter_details pd ON pd.parameterdetid=u.role_det_id
       WHERE vc.voucher_id=$1 ORDER BY vc.created_at`, [id]);
    let companyBank = null;
    const bankId = voucher.bill_company_bank_id || voucher.company_bank_id;
    if (bankId) {
      const bk = await pool.query('SELECT * FROM company_bank_accounts WHERE id=$1', [bankId]);
      companyBank = bk.rows[0] || null;
    }
    if (!companyBank) {
      const bk = await pool.query('SELECT * FROM company_bank_accounts WHERE is_primary=true LIMIT 1');
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

    // Mark paid
    const paidId          = await sid(VS.PAID);
    const readyToRemitId  = await sid(VS.READY_TO_REMIT);
    await pool.query(
      'UPDATE vouchers SET status_det_id=$1, updated_at=NOW() WHERE id=$2 AND status_det_id=$3',
      [paidId, id, readyToRemitId]
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
    const r = await pool.query('SELECT id, voucher_pdf_path, bill_id FROM vouchers WHERE id=$1', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Voucher not found' });

    const { voucher_pdf_path, bill_id } = r.rows[0];

    // Delete generated voucher PDF if it exists
    if (voucher_pdf_path) {
      const pdfPath = path.join(VOUCHERS_DIR, voucher_pdf_path);
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    }

    // Delete all attachment files
    const attachments = await pool.query('SELECT file_path FROM voucher_attachments WHERE voucher_id=$1', [id]);
    for (const att of attachments.rows) {
      const attPath = path.join(__dirname, '../../uploads', att.file_path);
      if (fs.existsSync(attPath)) fs.unlinkSync(attPath);
    }

    await pool.query('DELETE FROM vouchers WHERE id=$1', [id]);

    // Refresh bill status if this voucher was linked to a bill
    if (bill_id) {
      const { refreshBillStatus } = require('./bills');
      await refreshBillStatus(bill_id);
    }

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

    // Allow exporting vouchers that are Reviewed or already Exported (re-export).
    const [reviewedId, exportedStatusId] = await Promise.all([sid(VS.REVIEWED), sid(VS.EXPORTED)]);
    const allowedStatusIds = [reviewedId, exportedStatusId];
    let query, params;
    if (ids && ids.length) {
      query  = `${VOUCHER_SELECT} WHERE v.id=ANY($1) AND v.status_det_id=ANY($2)`;
      params = [ids, allowedStatusIds];
    } else {
      query  = `${VOUCHER_SELECT} WHERE v.status_det_id=ANY($1)`;
      params = [allowedStatusIds];
    }
    const vRes = await pool.query(query, params);
    if (!vRes.rows.length) return res.status(400).json({ error: 'No exportable vouchers found for export' });

    const XLSX = require('xlsx');
    const today = new Date();
    const pymt_date = `${String(today.getDate()).padStart(2,'0')}-${String(today.getMonth()+1).padStart(2,'0')}-${today.getFullYear()}`;

    const rows = [];
    const exportedIds = [];

    for (const v of vRes.rows) {
      let bene_acc = '', bene_ifsc = '', bnf_name = v.supplier_name || '';
      let suppMobile = '', suppEmail = '', nameForBank = '';

      const supplierId = v.bill_supplier_id || v.supplier_id;
      if (supplierId) {
        const [sbRes, scRes, sRes] = await Promise.all([
          pool.query(
            'SELECT account_holder_name, account_number, ifsc_code FROM supplier_bank_details WHERE supplier_id=$1 AND is_primary=true LIMIT 1',
            [supplierId]
          ),
          pool.query(
            'SELECT mobile, email FROM supplier_contacts WHERE supplier_id=$1 AND is_primary=true LIMIT 1',
            [supplierId]
          ),
          pool.query('SELECT name_for_bank FROM suppliers WHERE id=$1', [supplierId]),
        ]);
        if (sbRes.rows.length) {
          bene_acc  = sbRes.rows[0].account_number || '';
          bene_ifsc = sbRes.rows[0].ifsc_code || '';
          bnf_name  = sbRes.rows[0].account_holder_name || '';
        }
        if (scRes.rows.length) {
          suppMobile = scRes.rows[0].mobile || '';
          suppEmail  = scRes.rows[0].email  || '';
        }
        nameForBank = sRes.rows[0]?.name_for_bank || v.supplier_name?.trim().split(/\s+/)[0] || '';
      }

      // Use voucher payment_mode → bill payment_mode → default NEFT
      const pymtMode = v.payment_mode || 'NEFT';

      // Use bill's company bank if set, else primary
      let debitAcc = debitAccNo;
      if (v.bill_company_bank_id) {
        const bkRes = await pool.query('SELECT account_number FROM company_bank_accounts WHERE id=$1', [v.bill_company_bank_id]);
        if (bkRes.rows.length) debitAcc = bkRes.rows[0].account_number || debitAccNo;
      }

      // REMARK: strip special chars, keep only alphanumeric
      const rawRemark = v.bill_ref_no || v.bill_payment_reference || v.voucher_no || '';
      const remark = rawRemark.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

      rows.push({
        PYMT_PROD_TYPE_CODE: 'PAB_VENDOR',
        PYMT_MODE:   pymtMode,
        DEBIT_ACC_NO: debitAcc,
        BNF_NAME:    bnf_name,
        BENE_ACC_NO: bene_acc,
        BENE_IFSC:   bene_ifsc,
        AMOUNT:      Number(v.amount) || Number(v.bill_total_amount) || 0,
        DEBIT_NARR:  nameForBank,
        CREDIT_NARR: nameForBank,
        MOBILE_NUM:  suppMobile,
        EMAIL_ID:    suppEmail,
        REMARK:      remark,
        PYMT_DATE:   pymt_date,
        REFNO: 'Na', ADDL_INFO1: '', ADDL_INFO2: '', ADDL_INFO3: '', ADDL_INFO4: '', ADDL_INFO5: '',
      });
      exportedIds.push(v.id);
    }

    const exportedId = await sid(VS.EXPORTED);
    await pool.query('UPDATE vouchers SET status_det_id=$1, updated_at=NOW() WHERE id=ANY($2)',
      [exportedId, exportedIds]);

    for (const vid of exportedIds) {
      await logActivity(vid, req.user.id, 'status_changed', 'Exported for bank upload',
        { from: VS.REVIEWED, to: VS.EXPORTED });
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BankUpload');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const hhmm = `${String(today.getHours()).padStart(2,'0')}${String(today.getMinutes()).padStart(2,'0')}${String(today.getSeconds()).padStart(2,'0')}`;
    const filename = `bank-upload-${today.toISOString().slice(0,10)}-${hhmm}.xlsx`;
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
    const vResult = await pool.query(
      `SELECT b.payment_reference AS bill_payment_reference
       FROM vouchers v LEFT JOIN bills b ON b.id = v.bill_id WHERE v.id=$1`, [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    const payment_reference = vResult.rows[0].bill_payment_reference?.trim();
    if (!payment_reference) return res.status(400).json({ error: 'Voucher has no payment_reference to look up' });

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

    let newCode = spRows.length === 0 ? 'pending_verification' : 'unpaid';
    if (spRows.length > 0 && totalPaid > 0 && totalOutstanding <= 0) newCode = 'paid';
    else if (spRows.length > 0 && totalPaid > 0 && totalOutstanding > 0) newCode = 'partial';

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
    const supplierId = voucher.bill_supplier_id;
    if (supplierId) {
      const cr = await pool.query(
        'SELECT email FROM supplier_contacts WHERE supplier_id=$1 AND is_primary=true AND email IS NOT NULL LIMIT 1',
        [supplierId]);
      if (cr.rows.length) toEmails = [cr.rows[0].email];
      else {
        const ar = await pool.query(
          'SELECT email FROM supplier_contacts WHERE supplier_id=$1 AND email IS NOT NULL LIMIT 1',
          [supplierId]);
        if (ar.rows.length) toEmails = [ar.rows[0].email];
      }
    }

    const html = buildPaymentAdviceHTML(voucher, company, companyBank, '');
    const companyName = company?.company_name || 'Accounts Payable';
    const amountToPay = Number(voucher.amount) || 0;
    const subject = `Payment Advice — ${companyName} — ₹${amountToPay.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
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
    if (![VS.EXPORTED, VS.READY_TO_REMIT, VS.PAID].includes(voucher.status)) return res.status(400).json({ error: 'Voucher must be exported before sending payment advice' });

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

    const toList = Array.isArray(to) ? to.join(', ') : to;
    await logActivity(id, req.user.id, 'email_sent', `Payment advice sent`,
      { to, cc: cc || [], bcc: bcc || [] });

    if (comment) {
      await pool.query('INSERT INTO voucher_comments (voucher_id, user_id, comment) VALUES ($1,$2,$3)',
        [id, req.user.id, comment]);
    }

    res.json({ message: 'Payment advice sent' });
  } catch (err) {
    console.error('sendAdviceEmail error:', err);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
}

async function previewHtml(req, res) {
  const { id } = req.params;
  const { buildVoucherHtml } = require('../utils/pdfGenerator');
  try {
    const vResult = await pool.query(`${VOUCHER_SELECT} WHERE v.id=$1`, [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });
    const voucher = vResult.rows[0];

    const comments = await pool.query(
      `SELECT vc.*, u.name AS user_name, pd.code AS role
       FROM voucher_comments vc JOIN users u ON vc.user_id=u.id
       LEFT JOIN parameter_details pd ON pd.parameterdetid=u.role_det_id
       WHERE vc.voucher_id=$1 ORDER BY vc.created_at`, [id]);

    let companyBank = null;
    const bankId = voucher.bill_company_bank_id || voucher.company_bank_id;
    if (bankId) {
      const bk = await pool.query('SELECT * FROM company_bank_accounts WHERE id=$1', [bankId]);
      companyBank = bk.rows[0] || null;
    }
    if (!companyBank) {
      const bk = await pool.query('SELECT * FROM company_bank_accounts WHERE is_primary=true LIMIT 1');
      companyBank = bk.rows[0] || null;
    }

    const voucherNo = voucher.voucher_no || 'PREVIEW';
    const html = buildVoucherHtml(voucher, [], comments.rows, voucherNo, companyBank);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('previewHtml error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  uploadAndScan, createVoucher, listVouchers, getVoucher, updateVoucher, deleteVoucher,
  assignVoucher, managerAction, approverVerify, adminFinalApproval, reopenVoucher,
  addComment, generateVoucher, downloadVoucher, getInvoiceFile,
  uploadAttachments, getAttachmentFile, deleteAttachment,
  exportVouchers, syncPaymentStatus, emailPreview, sendAdviceEmail, updateUtr,
  previewHtml,
};
