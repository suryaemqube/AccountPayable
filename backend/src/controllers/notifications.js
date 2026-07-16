const pool = require('../config/db');

// Notifications are broadcast (visible to every admin/approver); read state
// is tracked per-user via notification_reads rather than fanning out rows on insert.

async function listNotifications(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const result = await pool.query(
      `SELECT n.id, n.type, n.message, n.entity_type, n.entity_id, n.created_at,
              u.name AS created_by_name,
              (nr.user_id IS NOT NULL) AS is_read
       FROM notifications n
       LEFT JOIN users u ON u.id = n.created_by
       LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2`,
      [req.user.id, limit]
    );
    res.json({ notifications: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function unreadCount(req, res) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS count
       FROM notifications n
       LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = $1
       WHERE nr.user_id IS NULL`,
      [req.user.id]
    );
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function markRead(req, res) {
  const { id } = req.params;
  try {
    await pool.query(
      `INSERT INTO notification_reads (notification_id, user_id) VALUES ($1,$2)
       ON CONFLICT (notification_id, user_id) DO NOTHING`,
      [id, req.user.id]
    );
    res.json({ message: 'Marked as read' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function markAllRead(req, res) {
  try {
    await pool.query(
      `INSERT INTO notification_reads (notification_id, user_id)
       SELECT n.id, $1 FROM notifications n
       LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = $1
       WHERE nr.user_id IS NULL
       ON CONFLICT (notification_id, user_id) DO NOTHING`,
      [req.user.id]
    );
    res.json({ message: 'All marked as read' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { listNotifications, unreadCount, markRead, markAllRead };
