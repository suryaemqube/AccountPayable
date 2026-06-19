const bcrypt = require('bcryptjs');
const pool   = require('../config/db');
const paramCache = require('../utils/parameterCache');

// Common SELECT fragment: resolves role code via JOIN
const USER_SELECT = `
  SELECT u.id, u.name, u.email, u.mobile_no, u.is_active, u.created_at,
         pd.code AS role
  FROM   users u
  LEFT JOIN parameter_details pd ON pd.parameterdetid = u.role_det_id
`;

async function listManagers(req, res) {
  try {
    // Get det_ids for manager + executive
    const ids = await paramCache.allDetIds('User Role', ['manager', 'executive', 'approver']);
    const result = await pool.query(
      `${USER_SELECT}
       WHERE u.role_det_id = ANY($1)
       ORDER BY u.created_at DESC`,
      [ids]
    );
    res.json({ managers: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function createManager(req, res) {
  const { name, email, password, role = 'manager', mobile_no } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });

  const role_det_id = await paramCache.detId('User Role', role);
  if (!role_det_id || role === 'admin') {
    return res.status(400).json({ error: 'role must be manager or executive' });
  }

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email already in use' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role_det_id, mobile_no)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, email, mobile_no, is_active, created_at`,
      [name, email.toLowerCase(), hash, role_det_id, mobile_no || null]
    );
    // Return with role code
    res.status(201).json({ manager: { ...result.rows[0], role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateManager(req, res) {
  const { id } = req.params;
  const { name, email, password, is_active, role, mobile_no } = req.body;

  // Validate role if provided
  let role_det_id;
  if (role) {
    role_det_id = await paramCache.detId('User Role', role);
    if (!role_det_id || role === 'admin') {
      return res.status(400).json({ error: 'role must be manager or executive' });
    }
  }

  try {
    const managerIds = await paramCache.allDetIds('User Role', ['manager', 'executive', 'approver']);
    const existing = await pool.query(
      `${USER_SELECT} WHERE u.id=$1 AND u.role_det_id = ANY($2)`,
      [id, managerIds]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Manager not found' });

    const cur = existing.rows[0];
    let hash = cur.password_hash;
    // Need the actual hash — fetch it
    const fullRow = await pool.query('SELECT password_hash FROM users WHERE id=$1', [id]);
    hash = fullRow.rows[0].password_hash;
    if (password) hash = await bcrypt.hash(password, 12);

    const effectiveRoleDetId = role_det_id || (await paramCache.detId('User Role', cur.role));

    const result = await pool.query(
      `UPDATE users SET name=$1, email=$2, password_hash=$3, is_active=$4,
              role_det_id=$5, mobile_no=$6, updated_at=NOW()
       WHERE  id=$7
       RETURNING id, name, email, mobile_no, is_active, created_at`,
      [
        name      || cur.name,
        email     || cur.email,
        hash,
        is_active != null ? is_active : cur.is_active,
        effectiveRoleDetId,
        mobile_no !== undefined ? mobile_no : cur.mobile_no,
        id,
      ]
    );
    const effectiveRoleCode = role || cur.role;
    res.json({ manager: { ...result.rows[0], role: effectiveRoleCode } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteManager(req, res) {
  const { id } = req.params;
  try {
    const adminDetId = await paramCache.detId('User Role', 'admin');
    // Only deactivate non-admins
    await pool.query(
      'UPDATE users SET is_active=false WHERE id=$1 AND role_det_id != $2',
      [id, adminDetId]
    );
    res.json({ message: 'Manager deactivated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { listManagers, createManager, updateManager, deleteManager };
