const path = require('path');
const fs   = require('fs');
const pool = require('../config/db');
const paramCache = require('../utils/parameterCache');

async function listSuppliers(req, res) {
  try {
    // approved_only=true → used by voucher dropdowns; omit pending/rejected suppliers
    const approvedOnly = req.query.approved_only === 'true';
    const result = await pool.query(`
      SELECT s.id, s.supplier_name, s.trade_name, s.vendor_code, s.gstin, s.pan_number,
             s.owned_by, s.is_active, s.created_at, s.updated_at,
             s.approval_status, s.last_approved_at, s.approval_notes,
             pd.code            AS supplier_type,
             pd.parametervalues AS supplier_type_label,
             u.name             AS owned_by_name,
             au.name            AS approved_by_name
      FROM   suppliers s
      LEFT JOIN parameter_details pd ON pd.parameterdetid = s.supplier_type_det_id
      LEFT JOIN users u  ON s.owned_by   = u.id
      LEFT JOIN users au ON s.approved_by = au.id
      ${approvedOnly ? "WHERE s.approval_status = 'approved'" : ''}
      ORDER BY s.supplier_name ASC
    `);
    res.json({ suppliers: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getSupplier(req, res) {
  const { id } = req.params;
  try {
    const full = await getSupplierData(id);
    if (!full.supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(full);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function createSupplier(req, res) {
  const {
    supplier_name, trade_name, supplier_type, gstin, pan_number,
    cin_number, msme_reg_number, udyam_reg_number, pf_registration, esic_registration,
    tds_applicable, gst_certificate, lower_deduction_cert, msme_declaration,
    products_services, territory,
    owned_by, is_active,
    banks = [], contacts = [], addresses = [],
  } = req.body;

  if (!supplier_name) return res.status(400).json({ error: 'supplier_name is required' });

  const supplier_type_det_id = supplier_type
    ? await paramCache.detId('Supplier Type', supplier_type)
    : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Auto vendor code
    const vcRes = await client.query("SELECT 'VEN-' || LPAD(nextval('supplier_vendor_code_seq')::text, 4, '0') AS vc");
    const vendor_code = vcRes.rows[0].vc;

    const sResult = await client.query(
      `INSERT INTO suppliers (
         supplier_name, trade_name, vendor_code, supplier_type_det_id,
         gstin, pan_number, cin_number, msme_reg_number, udyam_reg_number,
         pf_registration, esic_registration, tds_applicable,
         gst_certificate, lower_deduction_cert, msme_declaration,
         products_services, territory, owned_by, is_active, created_by, approval_status, approval_notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id`,
      [
        supplier_name, trade_name || null, vendor_code, supplier_type_det_id,
        gstin || null, pan_number || null, cin_number || null, msme_reg_number || null,
        udyam_reg_number || null, pf_registration || null, esic_registration || null,
        tds_applicable || false,
        gst_certificate || null, lower_deduction_cert || null, msme_declaration || null,
        products_services || null, territory || null,
        owned_by || null, is_active !== false, req.user.id, 'pending',
        approval_notes || 'New',
      ]
    );
    const suppId = sResult.rows[0].id;

    for (const b of banks) {
      await client.query(
        `INSERT INTO supplier_bank_details
           (supplier_id, bank_name, account_holder_name, ifsc_code, branch_name, account_number, swift_code, is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [suppId, b.bank_name || '', b.account_holder_name || '', b.ifsc_code || '',
         b.branch_name || '', b.account_number || '', b.swift_code || null, b.is_primary || false]
      );
    }

    for (const c of contacts) {
      await client.query(
        `INSERT INTO supplier_contacts
           (supplier_id, primary_contact_name, name, email, designation, mobile, alternate_contact, website, is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [suppId, c.primary_contact_name || '', c.name || '', c.email || '',
         c.designation || null, c.mobile || null, c.alternate_contact || null, c.website || null, c.is_primary || false]
      );
    }

    for (const a of addresses) {
      if (!a.address_type) continue;
      await client.query(
        `INSERT INTO supplier_addresses (supplier_id, address_type, address_line, city, state, country, pincode)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (supplier_id, address_type) DO UPDATE
           SET address_line=$3, city=$4, state=$5, country=$6, pincode=$7`,
        [suppId, a.address_type, a.address_line || null, a.city || null,
         a.state || null, a.country || 'India', a.pincode || null]
      );
    }

    await client.query('COMMIT');
    const full = await getSupplierData(suppId);
    res.status(201).json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

async function updateSupplier(req, res) {
  const { id } = req.params;
  const {
    supplier_name, trade_name, supplier_type, gstin, pan_number,
    cin_number, msme_reg_number, udyam_reg_number, pf_registration, esic_registration,
    tds_applicable, gst_certificate, lower_deduction_cert, msme_declaration,
    products_services, territory,
    owned_by, is_active, approval_notes,
    banks, contacts, addresses,
  } = req.body;

  const supplier_type_det_id = supplier_type !== undefined
    ? (supplier_type ? await paramCache.detId('Supplier Type', supplier_type) : null)
    : undefined;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE suppliers SET
         supplier_name        = COALESCE($1,  supplier_name),
         trade_name           = COALESCE($2,  trade_name),
         supplier_type_det_id = COALESCE($3,  supplier_type_det_id),
         gstin                = COALESCE($4,  gstin),
         pan_number           = COALESCE($5,  pan_number),
         cin_number           = COALESCE($6,  cin_number),
         msme_reg_number      = COALESCE($7,  msme_reg_number),
         udyam_reg_number     = COALESCE($8,  udyam_reg_number),
         pf_registration      = COALESCE($9,  pf_registration),
         esic_registration    = COALESCE($10, esic_registration),
         tds_applicable       = COALESCE($11, tds_applicable),
         gst_certificate      = COALESCE($12, gst_certificate),
         lower_deduction_cert = COALESCE($13, lower_deduction_cert),
         msme_declaration     = COALESCE($14, msme_declaration),
         products_services    = COALESCE($15, products_services),
         territory            = COALESCE($16, territory),
         owned_by             = COALESCE($17, owned_by),
         is_active            = COALESCE($18, is_active),
         approval_status      = CASE WHEN $21 THEN approval_status ELSE 'pending' END,
         approved_by          = CASE WHEN $21 THEN approved_by    ELSE NULL      END,
         last_approved_at     = CASE WHEN $21 THEN last_approved_at ELSE NULL    END,
         approval_notes       = COALESCE($19, approval_notes),
         updated_at           = NOW()
       WHERE id = $20`,
      [
        supplier_name, trade_name, supplier_type_det_id ?? null,
        gstin, pan_number, cin_number, msme_reg_number, udyam_reg_number,
        pf_registration, esic_registration, tds_applicable,
        gst_certificate, lower_deduction_cert, msme_declaration,
        products_services, territory, owned_by, is_active, approval_notes || null, id,
        req.user.role === 'admin',  // $21: skip approval reset for admin
      ]
    );

    if (banks !== undefined) {
      await client.query('DELETE FROM supplier_bank_details WHERE supplier_id=$1', [id]);
      for (const b of banks) {
        await client.query(
          `INSERT INTO supplier_bank_details
             (supplier_id, bank_name, account_holder_name, ifsc_code, branch_name, account_number, swift_code, is_primary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, b.bank_name || '', b.account_holder_name || '', b.ifsc_code || '',
           b.branch_name || '', b.account_number || '', b.swift_code || null, b.is_primary || false]
        );
      }
    }

    if (contacts !== undefined) {
      await client.query('DELETE FROM supplier_contacts WHERE supplier_id=$1', [id]);
      for (const c of contacts) {
        await client.query(
          `INSERT INTO supplier_contacts
             (supplier_id, primary_contact_name, name, email, designation, mobile, alternate_contact, website, is_primary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, c.primary_contact_name || '', c.name || '', c.email || '',
           c.designation || null, c.mobile || null, c.alternate_contact || null, c.website || null, c.is_primary || false]
        );
      }
    }

    if (addresses !== undefined) {
      for (const a of addresses) {
        if (!a.address_type) continue;
        await client.query(
          `INSERT INTO supplier_addresses (supplier_id, address_type, address_line, city, state, country, pincode)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (supplier_id, address_type) DO UPDATE
             SET address_line=$3, city=$4, state=$5, country=$6, pincode=$7`,
          [id, a.address_type, a.address_line || null, a.city || null,
           a.state || null, a.country || 'India', a.pincode || null]
        );
      }
    }

    await client.query('COMMIT');
    const full = await getSupplierData(id);
    res.json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

async function deleteSupplier(req, res) {
  const { id } = req.params;
  try {
    const r = await pool.query('DELETE FROM suppliers WHERE id=$1 RETURNING supplier_name', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ message: 'Supplier deleted' });
  } catch (err) {
    console.error(err);
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Cannot delete: supplier is linked to existing vouchers' });
    }
    res.status(500).json({ error: 'Server error' });
  }
}

async function getSupplierData(id) {
  const s = await pool.query(`
    SELECT s.id, s.supplier_name, s.trade_name, s.vendor_code,
           s.gstin, s.pan_number, s.cin_number, s.msme_reg_number, s.udyam_reg_number,
           s.pf_registration, s.esic_registration, s.tds_applicable,
           s.gst_certificate, s.lower_deduction_cert, s.msme_declaration,
           s.products_services, s.territory,
           s.owned_by, s.is_active, s.created_at, s.updated_at, s.created_by,
           s.approval_status, s.approved_by, s.last_approved_at, s.approval_notes,
           pd.code            AS supplier_type,
           pd.parametervalues AS supplier_type_label,
           u.name             AS owned_by_name,
           cu.name            AS created_by_name,
           au.name            AS approved_by_name
    FROM   suppliers s
    LEFT JOIN parameter_details pd ON pd.parameterdetid = s.supplier_type_det_id
    LEFT JOIN users u  ON s.owned_by   = u.id
    LEFT JOIN users cu ON s.created_by = cu.id
    LEFT JOIN users au ON s.approved_by = au.id
    WHERE  s.id = $1
  `, [id]);

  const [banks, contacts, addresses, documents] = await Promise.all([
    pool.query('SELECT * FROM supplier_bank_details WHERE supplier_id=$1 ORDER BY is_primary DESC, created_at', [id]),
    pool.query('SELECT * FROM supplier_contacts    WHERE supplier_id=$1 ORDER BY is_primary DESC, created_at', [id]),
    pool.query('SELECT * FROM supplier_addresses   WHERE supplier_id=$1 ORDER BY address_type',               [id]),
    pool.query('SELECT * FROM supplier_documents   WHERE supplier_id=$1 ORDER BY document_type, created_at', [id]),
  ]);

  return {
    supplier:  s.rows[0] || null,
    banks:     banks.rows,
    contacts:  contacts.rows,
    addresses: addresses.rows,
    documents: documents.rows,
  };
}

// ── Document upload
async function uploadDocument(req, res) {
  const { id } = req.params;
  const { document_type } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!document_type) return res.status(400).json({ error: 'document_type required' });

  try {
    const r = await pool.query(
      `INSERT INTO supplier_documents (supplier_id, document_type, original_name, file_path, mime_type, file_size, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, document_type, req.file.originalname, req.file.path, req.file.mimetype, req.file.size, req.user.id]
    );
    res.status(201).json({ document: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
}

// ── Document delete
async function deleteDocument(req, res) {
  const { did } = req.params;
  try {
    const r = await pool.query('DELETE FROM supplier_documents WHERE id=$1 RETURNING file_path', [did]);
    if (!r.rows.length) return res.status(404).json({ error: 'Document not found' });
    // Delete physical file if it exists
    const filePath = r.rows[0].file_path;
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
    res.json({ message: 'Document deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Delete failed' });
  }
}

// ── Serve document file
async function getDocumentFile(req, res) {
  const { did } = req.params;
  try {
    const r = await pool.query('SELECT * FROM supplier_documents WHERE id=$1', [did]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const doc = r.rows[0];
    if (!doc.file_path || !fs.existsSync(doc.file_path)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }
    res.setHeader('Content-Disposition', `inline; filename="${doc.original_name}"`);
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.sendFile(path.resolve(doc.file_path));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// ── Approve / reject supplier
async function approveSupplier(req, res) {
  const { id } = req.params;
  const { action, notes } = req.body; // action: 'approve' | 'reject'
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be approve or reject' });
  }
  const status = action === 'approve' ? 'approved' : 'rejected';
  try {
    await pool.query(
      `UPDATE suppliers SET
         approval_status  = $1,
         approved_by      = $2,
         last_approved_at = NOW(),
         approval_notes   = $3,
         updated_at       = NOW()
       WHERE id = $4`,
      [status, req.user.id, notes || null, id]
    );
    const full = await getSupplierData(id);
    res.json(full);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier,
  approveSupplier, uploadDocument, deleteDocument, getDocumentFile,
};
