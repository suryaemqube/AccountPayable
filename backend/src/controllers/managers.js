const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function listManagers(req, res) {
  try {
    const result = await pool.query(
      "SELECT id, name, email, role, is_active, created_at FROM users WHERE role = 'manager' ORDER BY created_at DESC"
    );
    res.json({ managers: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function createManager(req, res) {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email already in use' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'manager') RETURNING id, name, email, role, is_active, created_at`,
      [name, email.toLowerCase(), hash]
    );
    res.status(201).json({ manager: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateManager(req, res) {
  const { id } = req.params;
  const { name, email, password, is_active } = req.body;

  try {
    const existing = await pool.query("SELECT * FROM users WHERE id = $1 AND role = 'manager'", [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Manager not found' });

    let hash = existing.rows[0].password_hash;
    if (password) hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `UPDATE users SET name=$1, email=$2, password_hash=$3, is_active=$4, updated_at=NOW()
       WHERE id=$5 RETURNING id, name, email, role, is_active, created_at`,
      [name || existing.rows[0].name, email || existing.rows[0].email, hash,
       is_active != null ? is_active : existing.rows[0].is_active, id]
    );
    res.json({ manager: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteManager(req, res) {
  const { id } = req.params;
  try {
    await pool.query("UPDATE users SET is_active=false WHERE id=$1 AND role='manager'", [id]);
    res.json({ message: 'Manager deactivated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { listManagers, createManager, updateManager, deleteManager };
