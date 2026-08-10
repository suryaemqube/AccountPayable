/**
 * Due-date reminder job
 * Runs daily at 8:00 AM.
 * Finds all assigned vouchers whose due_date (bill invoice_date + due_days)
 * is exactly 5 days away (or overdue/today — anything from today up to 5
 * days out that hasn't been reminded yet), and sends an email to the
 * assigned user.
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
        v.voucher_no,
        v.amount,
        b.bill_ref_no,
        b.payment_reference,
        b.invoice_date,
        COALESCE(v.due_days, b.due_days) AS due_days,
        v.assigned_at,
        (b.invoice_date + COALESCE(v.due_days, b.due_days)) AS due_date,
        s.supplier_name,
        u.id    AS assignee_id,
        u.name  AS assignee_name,
        u.email AS assignee_email,
        pdrole.code AS assignee_role,
        ((b.invoice_date + COALESCE(v.due_days, b.due_days)) - CURRENT_DATE) AS days_left
      FROM vouchers v
      LEFT JOIN bills     b ON b.id = v.bill_id
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      JOIN users u ON u.id = v.assigned_to
      LEFT JOIN parameter_details pdrole ON pdrole.parameterdetid = u.role_det_id
      JOIN parameter_details pd ON pd.parameterdetid = v.status_det_id
      WHERE pd.code = 'assigned'
        AND v.assigned_at IS NOT NULL
        AND b.invoice_date IS NOT NULL
        AND COALESCE(v.due_days, b.due_days) IS NOT NULL
        AND v.assigned_to IS NOT NULL
        AND ((b.invoice_date + COALESCE(v.due_days, b.due_days)) - CURRENT_DATE) BETWEEN 0 AND 5
      ORDER BY (b.invoice_date + COALESCE(v.due_days, b.due_days)) ASC
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
          id:                row.id,
          voucher_no:        row.voucher_no,
          supplier_name:     row.supplier_name,
          bill_ref_no:       row.bill_ref_no,
          payment_reference: row.payment_reference,
          amount:            row.amount,
          invoice_date:      row.invoice_date,
          due_days:          row.due_days,
        },
        { name: row.assignee_name, email: row.assignee_email, role: row.assignee_role },
        daysLeft
      );

      const voucherLabel = row.voucher_no ? `Voucher #${row.voucher_no}` : 'Voucher';
      const subject = buildReminderSubject(daysLeft, voucherLabel, row.supplier_name, row.amount);

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

function buildReminderSubject(daysLeft, voucherLabel, supplierName, amount) {
  const fmtSubAmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const supplier = supplierName || 'Supplier';
  if (daysLeft < 0)  return `🔴 OVERDUE by ${Math.abs(daysLeft)} day(s): ${voucherLabel} from ${supplier} — ₹${fmtSubAmt(amount)}`;
  if (daysLeft === 0) return `🔴 Due TODAY: ${voucherLabel} from ${supplier} — ₹${fmtSubAmt(amount)}`;
  if (daysLeft === 1) return `🟠 Due TOMORROW: ${voucherLabel} from ${supplier} — ₹${fmtSubAmt(amount)}`;
  return `🟡 Due in ${daysLeft} days: ${voucherLabel} from ${supplier} — ₹${fmtSubAmt(amount)}`;
}

/**
 * Manually trigger due-date reminder emails, with optional filters — used by the
 * admin-only /admin/send-due-reminders-manual endpoint so an admin can (re)send
 * reminders outside the normal 0-5-day window the daily cron job sticks to
 * (e.g. for vouchers that are already overdue).
 *
 * filters:
 *   voucherNo    (string)  — match voucher_no (partial, case-insensitive)
 *   overdueOnly  (bool)    — only vouchers past their due_date
 *   dueDateFrom  (string)  — due_date >= this (YYYY-MM-DD)
 *   dueDateTo    (string)  — due_date <= this (YYYY-MM-DD)
 * No filters → sends to every currently-assigned voucher that has a due date,
 * regardless of how far away/overdue it is.
 */
async function sendManualReminders(filters = {}) {
  const { voucherNo, overdueOnly, dueDateFrom, dueDateTo } = filters;

  const conditions = [
    `pd.code = 'assigned'`,
    `v.assigned_at IS NOT NULL`,
    `b.invoice_date IS NOT NULL`,
    `COALESCE(v.due_days, b.due_days) IS NOT NULL`,
    `v.assigned_to IS NOT NULL`,
  ];
  const params = [];

  if (voucherNo && voucherNo.trim()) {
    params.push(`%${voucherNo.trim()}%`);
    conditions.push(`v.voucher_no ILIKE $${params.length}`);
  }
  if (overdueOnly) {
    conditions.push(`((b.invoice_date + COALESCE(v.due_days, b.due_days)) - CURRENT_DATE) < 0`);
  }
  if (dueDateFrom) {
    params.push(dueDateFrom);
    conditions.push(`(b.invoice_date + COALESCE(v.due_days, b.due_days)) >= $${params.length}`);
  }
  if (dueDateTo) {
    params.push(dueDateTo);
    conditions.push(`(b.invoice_date + COALESCE(v.due_days, b.due_days)) <= $${params.length}`);
  }

  const result = await pool.query(`
    SELECT
      v.id,
      v.voucher_no,
      v.amount,
      b.bill_ref_no,
      b.payment_reference,
      b.invoice_date,
      COALESCE(v.due_days, b.due_days) AS due_days,
      (b.invoice_date + COALESCE(v.due_days, b.due_days)) AS due_date,
      s.supplier_name,
      u.id    AS assignee_id,
      u.name  AS assignee_name,
      u.email AS assignee_email,
      pdrole.code AS assignee_role,
      ((b.invoice_date + COALESCE(v.due_days, b.due_days)) - CURRENT_DATE) AS days_left
    FROM vouchers v
    LEFT JOIN bills     b ON b.id = v.bill_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    JOIN users u ON u.id = v.assigned_to
    LEFT JOIN parameter_details pdrole ON pdrole.parameterdetid = u.role_det_id
    JOIN parameter_details pd ON pd.parameterdetid = v.status_det_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY (b.invoice_date + COALESCE(v.due_days, b.due_days)) ASC
  `, params);

  const sent = [];
  const skipped = [];

  for (const row of result.rows) {
    if (!row.assignee_email) {
      skipped.push({ voucher_id: row.id, voucher_no: row.voucher_no, reason: 'assignee has no email on file' });
      continue;
    }

    const daysLeft = parseInt(row.days_left);
    const html = buildDueReminderHTML(
      {
        id:                row.id,
        voucher_no:        row.voucher_no,
        supplier_name:     row.supplier_name,
        bill_ref_no:       row.bill_ref_no,
        payment_reference: row.payment_reference,
        amount:            row.amount,
        invoice_date:      row.invoice_date,
        due_days:          row.due_days,
      },
      { name: row.assignee_name, email: row.assignee_email, role: row.assignee_role },
      daysLeft
    );

    const voucherLabel = row.voucher_no ? `Voucher #${row.voucher_no}` : 'Voucher';
    const subject = buildReminderSubject(daysLeft, voucherLabel, row.supplier_name, row.amount);

    try {
      await sendMail({ to: row.assignee_email, subject, html });
      sent.push({ voucher_id: row.id, voucher_no: row.voucher_no, email: row.assignee_email, days_left: daysLeft });
    } catch (mailErr) {
      skipped.push({ voucher_id: row.id, voucher_no: row.voucher_no, reason: `mail failed: ${mailErr.message}` });
    }
  }

  return { matched: result.rows.length, sentCount: sent.length, sent, skipped };
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

module.exports = { startDueDateReminderJob, sendDueReminders, sendManualReminders };
