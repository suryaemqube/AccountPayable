const pool = require('../config/db');

async function logActivity(voucher_id, user_id, activity_type, description, meta = null, client = null) {
  try {
    const db = client || pool;
    await db.query(
      `INSERT INTO voucher_activity_log (voucher_id, user_id, activity_type, description, meta)
       VALUES ($1,$2,$3,$4,$5)`,
      [voucher_id, user_id, activity_type, description, meta ? JSON.stringify(meta) : null]
    );
  } catch (e) {
    console.error('logActivity error:', e.message);
  }
}

module.exports = { logActivity };
