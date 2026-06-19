/**
 * Due-date reminder job
 * Runs daily at 8:00 AM.
 * Finds all assigned vouchers whose due_date is exactly 5 days away
 * (or overdue/today — anything from today up to 5 days out that hasn't
 * been reminded yet), and sends an email to the assigned user.
 *
 * We send reminders when: 0 <= (due_date - today) <= 5
 */

const cron       = require('node-cron');
const pool       = require('../config/db');
const { buildDueReminderHTML, sendMail } = require('./emailService');

async function sendDueReminders() {
  console.log('[DueReminder] Running due-date check…');
  try {
    // Find assigned vouchers with due_date between today and 5 days from now
    const result = await pool.query(`
      SELECT
        v.id,
        v.total_amount,
        v.bill_ref_no,
        v.payment_reference,
        v.due_days,
        v.assigned_at,
        (v.assigned_at::date + v.due_days) AS due_date,
        s.supplier_name,
        u.id    AS assignee_id,
        u.name  AS assignee_name,
        u.email AS assignee_email,
        ((v.assigned_at::date + v.due_days) - CURRENT_DATE) AS days_left
      FROM vouchers v
      LEFT JOIN suppliers s ON s.id = v.supplier_id
      JOIN users u ON u.id = v.assigned_to
      JOIN parameter_details pd ON pd.parameterdetid = v.status_det_id
      WHERE pd.code = 'assigned'
        AND v.assigned_at IS NOT NULL
        AND v.due_days IS NOT NULL
        AND v.assigned_to IS NOT NULL
        AND ((v.assigned_at::date + v.due_days) - CURRENT_DATE) BETWEEN 0 AND 5
      ORDER BY (v.assigned_at::date + v.due_days) ASC
    `);

    if (!result.rows.length) {
      console.log('[DueReminder] No upcoming due vouchers found.');
      return;
    }

    console.log(`[DueReminder] Found ${result.rows.length} voucher(s) due within 5 days.`);

    for (const row of result.rows) {
      if (!row.assignee_email) {
        console.warn(`[DueReminder] Voucher ${row.id} — assignee has no email, skipping.`);
        continue;
      }

      const daysLeft = parseInt(row.days_left);
      const html     = buildDueReminderHTML(
        {
          supplier_name:     row.supplier_name,
          bill_ref_no:       row.bill_ref_no,
          payment_reference: row.payment_reference,
          total_amount:      row.total_amount,
          assigned_at:       row.assigned_at,
          due_days:          row.due_days,
        },
        { name: row.assignee_name, email: row.assignee_email },
        daysLeft
      );

      const subject =
        daysLeft === 0
          ? `🔴 Due TODAY: Voucher from ${row.supplier_name || 'Supplier'} — ₹${Number(row.total_amount).toLocaleString('en-IN')}`
          : daysLeft === 1
          ? `🟠 Due TOMORROW: Voucher from ${row.supplier_name || 'Supplier'} — ₹${Number(row.total_amount).toLocaleString('en-IN')}`
          : `🟡 Due in ${daysLeft} days: Voucher from ${row.supplier_name || 'Supplier'} — ₹${Number(row.total_amount).toLocaleString('en-IN')}`;

      try {
        await sendMail({ to: row.assignee_email, subject, html });
        console.log(`[DueReminder] Sent reminder to ${row.assignee_email} — voucher ${row.id} due in ${daysLeft} day(s)`);
      } catch (mailErr) {
        console.error(`[DueReminder] Failed to send to ${row.assignee_email}:`, mailErr.message);
      }
    }
  } catch (err) {
    console.error('[DueReminder] Error:', err);
  }
}

function startDueDateReminderJob() {
  // Controlled by DUE_REMINDER_ENABLED env var (default: true)
  if (process.env.DUE_REMINDER_ENABLED === 'false') {
    console.log('[DueReminder] Disabled via DUE_REMINDER_ENABLED=false — skipping job.');
    return;
  }
  // Run every day at 8:00 AM
  cron.schedule('0 8 * * *', () => {
    sendDueReminders();
  });
  console.log('[DueReminder] Daily reminder job scheduled at 08:00 AM.');
}

module.exports = { startDueDateReminderJob, sendDueReminders };
