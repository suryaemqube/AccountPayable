const pool = require('../config/db');

// Fire-and-forget: a failed notification insert should never break the
// business flow that triggered it (voucher/bill/supplier creation, etc.)
async function notify({ type, message, entity_type = null, entity_id = null, created_by = null }) {
  try {
    await pool.query(
      `INSERT INTO notifications (type, message, entity_type, entity_id, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [type, message, entity_type, entity_id, created_by]
    );
  } catch (err) {
    console.error('[Notify] Failed to create notification:', err.message);
  }
}

module.exports = { notify };
