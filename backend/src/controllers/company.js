const pool = require('../config/db');

// ── List all companies with their bank accounts
async function listCompanies(req, res) {
  try {
    const companies = await pool.query(
      'SELECT * FROM company_details ORDER BY created_at DESC'
    );
    const banks = await pool.query(
      `SELECT cba.*, pd.code AS purchase_type_code, pd.parametervalues AS purchase_type_label
       FROM company_bank_accounts cba
       LEFT JOIN parameter_details pd ON pd.parameterdetid = cba.purchase_type_det_id
       ORDER BY cba.company_id, cba.is_primary DESC, cba.created_at`
    );

    const result = companies.rows.map(c => ({
      ...c,
      banks: banks.rows.filter(b => b.company_id === c.id),
    }));

    res.json({ companies: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// ── Get single company
async function getCompany(req, res) {
  const { id } = req.params;
  try {
    const c = await pool.query('SELECT * FROM company_details WHERE id = $1', [id]);
    if (!c.rows.length) return res.status(404).json({ error: 'Company not found' });

    const banks = await pool.query(
      `SELECT cba.*, pd.code AS purchase_type_code, pd.parametervalues AS purchase_type_label
       FROM company_bank_accounts cba
       LEFT JOIN parameter_details pd ON pd.parameterdetid = cba.purchase_type_det_id
       WHERE cba.company_id = $1 ORDER BY cba.is_primary DESC, cba.created_at`,
      [id]
    );
    res.json({ company: c.rows[0], banks: banks.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// ── Create company with banks
async function createCompany(req, res) {
  const { company_name, address, tel, banks = [] } = req.body;
  if (!company_name) return res.status(400).json({ error: 'company_name required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cResult = await client.query(
      `INSERT INTO company_details (company_name, address, tel)
       VALUES ($1,$2,$3) RETURNING *`,
      [company_name, address || '', tel || '']
    );
    const company = cResult.rows[0];

    for (let i = 0; i < banks.length; i++) {
      const b = banks[i];
      await client.query(
        `INSERT INTO company_bank_accounts
           (company_id, bank_name, account_name, account_number, ifsc_code, branch_name, is_primary, purchase_type_det_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [company.id, b.bank_name || '', b.account_name || '', b.account_number || '',
         b.ifsc_code || '', b.branch_name || '', i === 0, b.purchase_type_det_id ? parseInt(b.purchase_type_det_id) : null]
      );
    }

    await client.query('COMMIT');
    const banksResult = await pool.query(
      `SELECT cba.*, pd.code AS purchase_type_code, pd.parametervalues AS purchase_type_label
       FROM company_bank_accounts cba
       LEFT JOIN parameter_details pd ON pd.parameterdetid = cba.purchase_type_det_id
       WHERE cba.company_id=$1 ORDER BY cba.is_primary DESC`, [company.id]
    );
    res.status(201).json({ company, banks: banksResult.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

// ── Update company header + replace banks
async function updateCompany(req, res) {
  const { id } = req.params;
  const { company_name, address, tel, banks } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE company_details SET
         company_name = COALESCE($1, company_name),
         address      = COALESCE($2, address),
         tel          = COALESCE($3, tel),
         updated_at   = NOW()
       WHERE id = $4`,
      [company_name, address, tel, id]
    );

    if (banks !== undefined) {
      const incomingIds = banks.filter(b => b.id).map(b => b.id);

      // Delete only banks not referenced by any bill
      if (incomingIds.length > 0) {
        await client.query(
          `DELETE FROM company_bank_accounts
           WHERE company_id=$1 AND id <> ALL($2::uuid[])
             AND id NOT IN (SELECT company_bank_id FROM bills WHERE company_bank_id IS NOT NULL)`,
          [id, incomingIds]
        );
      } else {
        await client.query(
          `DELETE FROM company_bank_accounts
           WHERE company_id=$1
             AND id NOT IN (SELECT company_bank_id FROM bills WHERE company_bank_id IS NOT NULL)`,
          [id]
        );
      }

      for (let i = 0; i < banks.length; i++) {
        const b = banks[i];
        const ptId = b.purchase_type_det_id ? parseInt(b.purchase_type_det_id) : null;
        if (b.id) {
          // Update existing bank in-place
          await client.query(
            `UPDATE company_bank_accounts SET
               bank_name=$1, account_name=$2, account_number=$3,
               ifsc_code=$4, branch_name=$5, is_primary=$6, purchase_type_det_id=$7
             WHERE id=$8 AND company_id=$9`,
            [b.bank_name || '', b.account_name || '', b.account_number || '',
             b.ifsc_code || '', b.branch_name || '', b.is_primary || false, ptId, b.id, id]
          );
        } else {
          // Insert new bank
          await client.query(
            `INSERT INTO company_bank_accounts
               (company_id, bank_name, account_name, account_number, ifsc_code, branch_name, is_primary, purchase_type_det_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [id, b.bank_name || '', b.account_name || '', b.account_number || '',
             b.ifsc_code || '', b.branch_name || '', b.is_primary || false, ptId]
          );
        }
      }
    }

    await client.query('COMMIT');
    const c = await pool.query('SELECT * FROM company_details WHERE id=$1', [id]);
    const bk = await pool.query(
      `SELECT cba.*, pd.code AS purchase_type_code, pd.parametervalues AS purchase_type_label
       FROM company_bank_accounts cba
       LEFT JOIN parameter_details pd ON pd.parameterdetid = cba.purchase_type_det_id
       WHERE cba.company_id=$1 ORDER BY cba.is_primary DESC`, [id]
    );
    res.json({ company: c.rows[0], banks: bk.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// ── Delete company
async function deleteCompany(req, res) {
  const { id } = req.params;
  try {
    await pool.query('UPDATE company_details SET is_active=false, updated_at=NOW() WHERE id=$1', [id]);
    res.json({ message: 'Company deactivated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { listCompanies, getCompany, createCompany, updateCompany, deleteCompany };
