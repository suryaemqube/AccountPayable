const pool = require('../config/db');
const { extractInvoiceData } = require('../utils/claudeOcr');
const { generateVoucherPDF, generateAndSaveVoucherPDF } = require('../utils/pdfGenerator');
const VOUCHERS_DIR = path.join(__dirname, '../../vouchers');
const path = require('path');
const fs = require('fs');

async function uploadAndScan(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const mimeType = req.file.mimetype;
    const extracted = await extractInvoiceData(req.file.path, mimeType);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const vResult = await client.query(
        `INSERT INTO vouchers (
          invoice_path, invoice_original_name, invoice_no, supplier_name, supplier_gstin,
          invoice_date, due_date, payment_terms, narration,
          taxable_amount, cgst, sgst, igst, total_amount,
          status, payment_status, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft','unpaid',$15)
        RETURNING *`,
        [
          req.file.filename,
          req.file.originalname,
          extracted.invoice_no || '',
          extracted.supplier_name || '',
          extracted.supplier_gstin || '',
          extracted.invoice_date || null,
          extracted.due_date || null,
          extracted.payment_terms || '',
          extracted.narration || '',
          extracted.taxable_amount || 0,
          extracted.cgst || 0,
          extracted.sgst || 0,
          extracted.igst || 0,
          extracted.total_amount || 0,
          req.user.id,
        ]
      );
      const voucher = vResult.rows[0];

      if (extracted.line_items && extracted.line_items.length) {
        for (let i = 0; i < extracted.line_items.length; i++) {
          const li = extracted.line_items[i];
          await client.query(
            `INSERT INTO voucher_line_items
             (voucher_id, description, hsn_code, qty, rate, taxable_amount,
              cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              voucher.id, li.description || '', li.hsn_code || '',
              li.qty || 1, li.rate || 0, li.taxable_amount || 0,
              li.cgst_rate || 0, li.cgst_amount || 0,
              li.sgst_rate || 0, li.sgst_amount || 0,
              li.igst_rate || 0, li.igst_amount || 0,
              li.total || 0, i,
            ]
          );
        }
      }

      await client.query('COMMIT');
      res.status(201).json({ voucher, line_items: extracted.line_items || [] });
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
    let baseQuery = `
      SELECT v.*, 
        u1.name AS created_by_name,
        u2.name AS assigned_to_name
      FROM vouchers v
      LEFT JOIN users u1 ON v.created_by = u1.id
      LEFT JOIN users u2 ON v.assigned_to = u2.id
    `;
    const params = [];
    const conditions = [];

    if (req.user.role === 'manager') {
      conditions.push(`v.assigned_to = $${params.length + 1}`);
      params.push(req.user.id);
    }
    if (status) {
      conditions.push(`v.status = $${params.length + 1}`);
      params.push(status);
    }
    if (payment_status) {
      conditions.push(`v.payment_status = $${params.length + 1}`);
      params.push(payment_status);
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
    const vResult = await pool.query(
      `SELECT v.*, 
        u1.name AS created_by_name,
        u2.name AS assigned_to_name
       FROM vouchers v
       LEFT JOIN users u1 ON v.created_by = u1.id
       LEFT JOIN users u2 ON v.assigned_to = u2.id
       WHERE v.id = $1`,
      [id]
    );
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });

    const voucher = vResult.rows[0];
    if (req.user.role === 'manager' && voucher.assigned_to !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const lineItems = await pool.query(
      'SELECT * FROM voucher_line_items WHERE voucher_id = $1 ORDER BY sort_order',
      [id]
    );
    const comments = await pool.query(
      `SELECT vc.*, u.name AS user_name, u.role FROM voucher_comments vc
       JOIN users u ON vc.user_id = u.id
       WHERE vc.voucher_id = $1 ORDER BY vc.created_at ASC`,
      [id]
    );

    res.json({ voucher, line_items: lineItems.rows, comments: comments.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateVoucher(req, res) {
  const { id } = req.params;
  const {
    invoice_no, supplier_name, supplier_gstin, invoice_date, due_date,
    payment_terms, narration, taxable_amount, cgst, sgst, igst, total_amount,
    payment_status, payment_reference, line_items,
  } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM vouchers WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Voucher not found' });

    if (req.user.role === 'manager') return res.status(403).json({ error: 'Managers cannot edit voucher fields' });

    const v = existing.rows[0];
    if (!['draft', 'assigned'].includes(v.status)) {
      return res.status(400).json({ error: 'Cannot edit voucher in status: ' + v.status });
    }

    await pool.query(
      `UPDATE vouchers SET
        invoice_no=COALESCE($1,invoice_no), supplier_name=COALESCE($2,supplier_name),
        supplier_gstin=COALESCE($3,supplier_gstin), invoice_date=COALESCE($4,invoice_date),
        due_date=COALESCE($5,due_date), payment_terms=COALESCE($6,payment_terms),
        narration=COALESCE($7,narration), taxable_amount=COALESCE($8,taxable_amount),
        cgst=COALESCE($9,cgst), sgst=COALESCE($10,sgst), igst=COALESCE($11,igst),
        total_amount=COALESCE($12,total_amount),
        payment_status=COALESCE($13,payment_status),
        payment_reference=COALESCE($14,payment_reference),
        updated_at=NOW()
       WHERE id=$15`,
      [invoice_no, supplier_name, supplier_gstin, invoice_date, due_date,
        payment_terms, narration, taxable_amount, cgst, sgst, igst, total_amount,
        payment_status, payment_reference, id]
    );

    if (line_items && Array.isArray(line_items)) {
      await pool.query('DELETE FROM voucher_line_items WHERE voucher_id = $1', [id]);
      for (let i = 0; i < line_items.length; i++) {
        const li = line_items[i];
        await pool.query(
          `INSERT INTO voucher_line_items
           (voucher_id, description, hsn_code, qty, rate, taxable_amount,
            cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [id, li.description || '', li.hsn_code || '', li.qty || 1, li.rate || 0,
            li.taxable_amount || 0, li.cgst_rate || 0, li.cgst_amount || 0,
            li.sgst_rate || 0, li.sgst_amount || 0, li.igst_rate || 0, li.igst_amount || 0,
            li.total || 0, i]
        );
      }
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
    const mgr = await pool.query("SELECT id FROM users WHERE id=$1 AND role='manager' AND is_active=true", [manager_id]);
    if (!mgr.rows.length) return res.status(404).json({ error: 'Manager not found' });

    await pool.query(
      "UPDATE vouchers SET assigned_to=$1, status='assigned', updated_at=NOW() WHERE id=$2",
      [manager_id, id]
    );
    res.json({ message: 'Voucher assigned' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function managerAction(req, res) {
  const { id } = req.params;
  const { action, comment, rejected_reason } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be approve or reject' });
  }

  try {
    const vResult = await pool.query('SELECT * FROM vouchers WHERE id=$1', [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });

    const v = vResult.rows[0];
    if (v.assigned_to !== req.user.id) return res.status(403).json({ error: 'Not assigned to you' });
    if (v.status !== 'assigned') return res.status(400).json({ error: 'Voucher is not in assigned state' });

    const newStatus = action === 'approve' ? 'pending_approval' : 'rejected';

    await pool.query(
      `UPDATE vouchers SET status=$1, manager_comment=$2, rejected_reason=$3, updated_at=NOW() WHERE id=$4`,
      [newStatus, comment || null, action === 'reject' ? (rejected_reason || comment) : null, id]
    );

    if (comment) {
      await pool.query(
        'INSERT INTO voucher_comments (voucher_id, user_id, comment) VALUES ($1,$2,$3)',
        [id, req.user.id, comment]
      );
    }

    res.json({ message: `Voucher ${action}d`, status: newStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function adminFinalApproval(req, res) {
  const { id } = req.params;
  const { action, comment } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be approve or reject' });
  }

  try {
    const vResult = await pool.query('SELECT * FROM vouchers WHERE id=$1', [id]);
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });

    if (vResult.rows[0].status !== 'pending_approval') {
      return res.status(400).json({ error: 'Voucher must be in pending_approval state' });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    await pool.query(
      `UPDATE vouchers SET status=$1, admin_final_comment=$2,
       rejected_reason=$3, updated_at=NOW() WHERE id=$4`,
      [newStatus, comment || null, action === 'reject' ? comment : null, id]
    );

    if (comment) {
      await pool.query(
        'INSERT INTO voucher_comments (voucher_id, user_id, comment) VALUES ($1,$2,$3)',
        [id, req.user.id, comment]
      );
    }

    res.json({ message: `Voucher final ${action}d`, status: newStatus });
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
    await pool.query(
      'INSERT INTO voucher_comments (voucher_id, user_id, comment) VALUES ($1,$2,$3)',
      [id, req.user.id, comment]
    );
    res.json({ message: 'Comment added' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// ── Generate voucher PDF and SAVE to server (called on final approval)
async function generateVoucher(req, res) {
  const { id } = req.params;
  try {
    const vResult = await pool.query(
      `SELECT v.*, u1.name AS created_by_name, u2.name AS assigned_to_name
       FROM vouchers v
       LEFT JOIN users u1 ON v.created_by = u1.id
       LEFT JOIN users u2 ON v.assigned_to = u2.id
       WHERE v.id = $1`,
      [id]
    );
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });

    const voucher = vResult.rows[0];
    if (!['approved', 'downloaded'].includes(voucher.status)) {
      return res.status(400).json({ error: 'Voucher must be approved before generating' });
    }

    const lineItems = await pool.query(
      'SELECT * FROM voucher_line_items WHERE voucher_id=$1 ORDER BY sort_order', [id]
    );
    const comments = await pool.query(
      `SELECT vc.*, u.name AS user_name, u.role FROM voucher_comments vc
       JOIN users u ON vc.user_id = u.id WHERE vc.voucher_id=$1 ORDER BY vc.created_at`, [id]
    );

    const { fileName, voucherNo } = await generateAndSaveVoucherPDF(
      voucher, lineItems.rows, comments.rows
    );

    // Store file reference in DB
    await pool.query(
      `UPDATE vouchers SET voucher_pdf_path=$1, voucher_no=$2, updated_at=NOW() WHERE id=$3`,
      [fileName, voucherNo, id]
    );

    res.json({ message: 'Voucher PDF generated and saved', fileName, voucherNo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate voucher: ' + err.message });
  }
}

// ── Download voucher — serves saved file if exists, else generates on-the-fly
async function downloadVoucher(req, res) {
  const { id } = req.params;
  try {
    const vResult = await pool.query(
      `SELECT v.*, u1.name AS created_by_name, u2.name AS assigned_to_name
       FROM vouchers v
       LEFT JOIN users u1 ON v.created_by = u1.id
       LEFT JOIN users u2 ON v.assigned_to = u2.id
       WHERE v.id = $1`,
      [id]
    );
    if (!vResult.rows.length) return res.status(404).json({ error: 'Voucher not found' });

    const voucher = vResult.rows[0];
    if (!['approved', 'downloaded'].includes(voucher.status)) {
      return res.status(400).json({ error: 'Only approved vouchers can be downloaded' });
    }

    const lineItems = await pool.query(
      'SELECT * FROM voucher_line_items WHERE voucher_id=$1 ORDER BY sort_order', [id]
    );
    const comments = await pool.query(
      `SELECT vc.*, u.name AS user_name, u.role FROM voucher_comments vc
       JOIN users u ON vc.user_id = u.id WHERE vc.voucher_id=$1 ORDER BY vc.created_at`, [id]
    );

    let pdfBuffer;
    const savedPath = voucher.voucher_pdf_path
      ? path.join(VOUCHERS_DIR, voucher.voucher_pdf_path)
      : null;

    if (savedPath && fs.existsSync(savedPath)) {
      // Serve the already-saved file
      pdfBuffer = fs.readFileSync(savedPath);
    } else {
      // Generate fresh, save it, then serve
      const { fileName, voucherNo } = await generateAndSaveVoucherPDF(
        voucher, lineItems.rows, comments.rows
      );
      await pool.query(
        `UPDATE vouchers SET voucher_pdf_path=$1, voucher_no=$2, updated_at=NOW() WHERE id=$3`,
        [fileName, voucherNo, id]
      );
      pdfBuffer = fs.readFileSync(path.join(VOUCHERS_DIR, fileName));
    }

    // Mark as downloaded
    await pool.query(
      `UPDATE vouchers SET status='downloaded', updated_at=NOW() WHERE id=$1 AND status='approved'`,
      [id]
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
    const result = await pool.query('SELECT invoice_path, invoice_original_name FROM vouchers WHERE id=$1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

    const { invoice_path, invoice_original_name } = result.rows[0];
    if (!invoice_path) return res.status(404).json({ error: 'No invoice file' });

    if (req.user.role === 'manager') {
      const assigned = await pool.query('SELECT assigned_to FROM vouchers WHERE id=$1', [id]);
      if (assigned.rows[0]?.assigned_to !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const filePath = path.join(__dirname, '../../uploads', invoice_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
    res.sendFile(filePath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  uploadAndScan, listVouchers, getVoucher, updateVoucher,
  assignVoucher, managerAction, adminFinalApproval,
  addComment, generateVoucher, downloadVoucher, getInvoiceFile,
};
