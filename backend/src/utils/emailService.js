const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'smtp.office365.com',
  port: parseInt(process.env.MAIL_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
  tls: { rejectUnauthorized: false },
});


/**
 * Central send function. In development, all mail is redirected to DEV_MAIL.
 * @param {{ to, cc?, bcc?, subject, html }} opts
 */



async function sendMail({ to, cc, bcc, subject, html }) {
  const isDev = (process.env.NODE_ENV || 'development') !== 'production';
  const DEV_MAIL = process.env.DEV_MAIL;
  
  const originalTo = Array.isArray(to) ? to.join(', ') : to;

  let finalTo      = originalTo;
  let finalCc      = cc  ? (Array.isArray(cc)  ? cc.join(', ')  : cc)  : undefined;
  let finalBcc     = bcc ? (Array.isArray(bcc) ? bcc.join(', ') : bcc) : undefined;
  let finalSubject = subject;

  if (isDev) {
    finalTo      = DEV_MAIL;
    finalCc      = undefined;
    finalBcc     = undefined;
    finalSubject = `${subject}`;
  }

  const msg = { from: process.env.MAIL_FROM, to: finalTo, subject: finalSubject, html };
  if (finalCc)  msg.cc  = finalCc;
  if (finalBcc) msg.bcc = finalBcc;

  console.log(`[Mail] ${isDev ? '(DEV) ' : ''}To: ${finalTo} | Subject: ${finalSubject}`);
  return transporter.sendMail(msg);
}

/**
 * Build the payment advice HTML email body.
 * @param {object} voucher
 * @param {object|null} company       – company_details row
 * @param {object|null} companyBank   – company_bank_accounts row (primary)
 * @param {string} personalNote       – optional personal message shown at top
 */
function buildPaymentAdviceHTML(voucher, company, companyBank, personalNote = '') {
  const fmtAmt = (n) =>
    Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // For bill-based vouchers, financial data comes from bill_ prefixed fields
  const taxable    = Number(voucher.bill_taxable_amount ?? voucher.taxable_amount) || 0;
  const cgst       = Number(voucher.bill_cgst           ?? voucher.cgst)           || 0;
  const sgst       = Number(voucher.bill_sgst           ?? voucher.sgst)           || 0;
  const igst       = Number(voucher.bill_igst           ?? voucher.igst)           || 0;
  const tds        = Number(voucher.bill_tds_amount     ?? voucher.tds_amount)     || 0;
  const grossTotal = taxable + cgst + sgst + igst;
  // amountToPay = this voucher's payment amount
  const amountToPay = Number(voucher.amount) || (grossTotal - tds);
  const netPayable  = grossTotal - tds;
  const billAllocated = Number(voucher.bill_allocated_amount) || amountToPay;
  const balanceRemaining = Math.max(netPayable - billAllocated, 0);

  const amount = fmtAmt(amountToPay);

  const bankDisplay = companyBank?.account_number
    ? `${companyBank.bank_name ? companyBank.bank_name + ' ' : ''}A/C xx${String(companyBank.account_number).slice(-4)}`
    : 'Company Bank Account';

  const companyName = company?.company_name || 'Accounts Payable';

  const today = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  const row = (label, value, last = false) =>
    value
      ? `<tr>
          <td style="padding:12px 20px;font-weight:600;font-size:14px;${last ? '' : 'border-bottom:1px solid #f3f4f6;'}">${label}:</td>
          <td style="padding:12px 20px;text-align:right;font-size:14px;color:#374151;${last ? '' : 'border-bottom:1px solid #f3f4f6;'}">${value}</td>
        </tr>`
      : '';

  const billRow = (label, value, bold = false, last = false, color = '') =>
    `<tr${color ? ` style="background:${color}10;"` : ''}>
      <td style="padding:12px 16px;color:${color || '#9ca3af'};font-size:13px;${last ? '' : 'border-bottom:1px solid #e5e7eb;'}">${label}</td>
      <td style="padding:12px 16px;text-align:right;font-size:13px;${bold ? 'font-weight:700;' : ''}${color ? `color:${color};` : ''}${last ? '' : 'border-bottom:1px solid #e5e7eb;'}">${value}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

  ${personalNote ? `
  <div style="background:#f0f9ff;border-bottom:1px solid #bae6fd;padding:16px 32px;font-size:14px;color:#0369a1;line-height:1.6;">
    ${personalNote.replace(/\n/g, '<br>')}
  </div>` : ''}

  <!-- Header -->
  <div style="text-align:center;padding:44px 32px 20px;">
    <p style="margin:0 0 6px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Payment Advice</p>
    <h2 style="margin:0;font-size:24px;font-weight:700;color:#111827;">
      ${companyName} paid you<br>
      <span style="font-size:30px;">₹${amount}</span>
    </h2>
  </div>
  <div style="text-align:center;padding:0 32px 24px;color:#6b7280;font-size:14px;line-height:1.6;">
    Your payment has been successfully processed. Below are your payment details.
  </div>

  <!-- Amount box -->
  <div style="margin:0 32px 24px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <div style="text-align:center;padding:28px 20px;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:38px;font-weight:800;color:#111827;">₹${amount}</div>
      <div style="font-size:11px;color:#9ca3af;letter-spacing:2px;margin-top:8px;text-transform:uppercase;">Amount Paid</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      ${row('Paid From', bankDisplay)}
      ${voucher.utr_no ? row('UTR / RRN', voucher.utr_no) : ''}
      ${row('Transaction Mode', 'NEFT')}
    </table>
  </div>

  <!-- Bill details -->
  <div style="margin:0 32px 32px;">
    <h3 style="font-size:15px;font-weight:700;margin:0 0 12px;color:#111827;">Bill Details</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      ${voucher.bill_ref_no ? billRow('Bill Ref No', voucher.bill_ref_no) : ''}
      ${billRow('Invoice Date', (voucher.bill_invoice_date || voucher.invoice_date) ? new Date(voucher.bill_invoice_date || voucher.invoice_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')}
      ${billRow('Taxable Amount', '₹' + fmtAmt(taxable))}
      ${cgst > 0 ? billRow('CGST', '₹' + fmtAmt(cgst)) : ''}
      ${sgst > 0 ? billRow('SGST', '₹' + fmtAmt(sgst)) : ''}
      ${igst > 0 ? billRow('IGST', '₹' + fmtAmt(igst)) : ''}
      ${billRow('Gross Total', '₹' + fmtAmt(grossTotal), true)}
      ${tds > 0 ? billRow('TDS Deducted', '− ₹' + fmtAmt(tds)) : ''}
      ${tds > 0 ? billRow('Net Payable', '₹' + fmtAmt(netPayable), true) : ''}
      ${billRow('This Payment', '₹' + fmtAmt(amountToPay), true)}
      ${balanceRemaining > 0.01
        ? billRow('Balance Remaining', '₹' + fmtAmt(balanceRemaining), true, true, '#d97706')
        : billRow('Status', '✓ Fully Paid', true, true, '#16a34a')}
    </table>
  </div>

  <!-- Footer -->
  <div style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.8;">
    This is an automated payment advice from <strong>${companyName}</strong>.<br>
    Date: ${today}
  </div>

</div>
</body>
</html>`;
}




/**
 * Build the due-date reminder HTML email body.
 * @param {object} voucher  – voucher row (with id, supplier_name, due_date, total_amount, bill_ref_no)
 * @param {object} assignee – users row (name, email, role)
 * @param {number} daysLeft – how many days until due_date
 */
function buildDueReminderHTML(voucher, assignee, daysLeft) {
  const fmtAmt = (n) =>
    Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let dueDate = null;
  if (voucher.invoice_date && voucher.due_days != null) {
    dueDate = new Date(voucher.invoice_date);
    dueDate.setDate(dueDate.getDate() + Number(voucher.due_days));
  }
  const dueDateStr = dueDate
    ? dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—';

  const isOverdue    = daysLeft < 0;
  const urgencyColor = isOverdue || daysLeft <= 2 ? '#dc2626' : daysLeft <= 3 ? '#d97706' : '#059669';
  const urgencyLabel = isOverdue
    ? `OVERDUE BY ${Math.abs(daysLeft)} DAY${Math.abs(daysLeft) === 1 ? '' : 'S'}`
    : daysLeft === 0 ? 'DUE TODAY' : daysLeft === 1 ? 'DUE TOMORROW' : `DUE IN ${daysLeft} DAYS`;

  const roleBasePath = { admin: '/admin', executive: '/executive', approver: '/approver', manager: '/manager' }[assignee.role] || '/manager';
  const voucherUrl = voucher.id
    ? `${(process.env.FRONTEND_URL || '').replace(/\/$/, '')}${roleBasePath}/vouchers/${voucher.id}`
    : null;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

  <!-- Urgency banner -->
  <div style="background:${urgencyColor};padding:14px 32px;text-align:center;">
    <span style="color:#fff;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">⏰ ${urgencyLabel}</span>
  </div>

  <!-- Header -->
  <div style="padding:32px 32px 20px;text-align:center;">
    <p style="margin:0 0 6px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Payment Due Reminder</p>
    <h2 style="margin:0;font-size:22px;font-weight:700;color:#111827;">Voucher review required</h2>
    <p style="margin:10px 0 0;color:#6b7280;font-size:14px;line-height:1.6;">
      ${isOverdue
        ? `Hi ${assignee.name}, a voucher assigned to you was due on <strong>${dueDateStr}</strong> and is now overdue. Please review and take action as soon as possible.`
        : `Hi ${assignee.name}, a voucher assigned to you is due on <strong>${dueDateStr}</strong>. Please review and take action before the due date.`}
    </p>
  </div>

  <!-- Voucher details -->
  <div style="margin:0 32px 32px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <div style="background:#f9fafb;padding:14px 20px;border-bottom:1px solid #e5e7eb;">
      <span style="font-size:13px;font-weight:600;color:#374151;">Voucher Details</span>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      ${voucher.voucher_no ? `<tr>
        <td style="padding:12px 20px;color:#6b7280;font-size:13px;border-bottom:1px solid #f3f4f6;">Voucher No.</td>
        <td style="padding:12px 20px;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #f3f4f6;">${voucher.voucher_no}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:12px 20px;color:#6b7280;font-size:13px;border-bottom:1px solid #f3f4f6;">Supplier</td>
        <td style="padding:12px 20px;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #f3f4f6;">${voucher.supplier_name || '—'}</td>
      </tr>
      <tr>
        <td style="padding:12px 20px;color:#6b7280;font-size:13px;border-bottom:1px solid #f3f4f6;">Bill Ref No.</td>
        <td style="padding:12px 20px;font-size:13px;text-align:right;border-bottom:1px solid #f3f4f6;">${voucher.bill_ref_no || voucher.bill_payment_reference || '—'}</td>
      </tr>
      <tr>
        <td style="padding:12px 20px;color:#6b7280;font-size:13px;border-bottom:1px solid #f3f4f6;">Amount</td>
        <td style="padding:12px 20px;font-size:13px;font-weight:700;text-align:right;border-bottom:1px solid #f3f4f6;">₹${fmtAmt(voucher.amount)}</td>
      </tr>
      <tr>
        <td style="padding:12px 20px;color:#6b7280;font-size:13px;">Due Date</td>
        <td style="padding:12px 20px;font-size:13px;font-weight:700;color:${urgencyColor};text-align:right;">${dueDateStr}</td>
      </tr>
    </table>
  </div>

  ${voucherUrl ? `
  <!-- Review link -->
  <div style="text-align:center;margin:0 32px 32px;">
    <a href="${voucherUrl}" style="display:inline-block;background:${urgencyColor};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 32px;border-radius:8px;">
      Review Voucher →
    </a>
  </div>` : ''}

  <!-- Footer -->
  <div style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.8;">
    This is an automated reminder from the Accounts Payable system.<br>
    ${voucherUrl ? 'Click the button above to review and process this voucher.' : 'Please log in to review and process this voucher.'}
  </div>

</div>
</body>
</html>`;
}

/**
 * Build the password reset email body.
 * @param {object} user     – users row (name)
 * @param {string} resetUrl – full link to the frontend reset-password page with token
 */
function buildPasswordResetHTML(user, resetUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

  <!-- Header -->
  <div style="padding:36px 32px 20px;text-align:center;">
    <p style="margin:0 0 6px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">PayPro Account Security</p>
    <h2 style="margin:0;font-size:22px;font-weight:700;color:#111827;">Reset your password</h2>
    <p style="margin:10px 0 0;color:#6b7280;font-size:14px;line-height:1.6;">
      Hi ${user.name || ''}, we received a request to reset your password. Click the button below to choose a new one.
      This link expires in 1 hour and can only be used once.
    </p>
  </div>

  <!-- Button -->
  <div style="text-align:center;margin:8px 32px 32px;">
    <a href="${resetUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 32px;border-radius:8px;">
      Reset Password →
    </a>
  </div>

  <!-- Fallback link -->
  <div style="margin:0 32px 32px;padding:14px 18px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
    <p style="margin:0 0 6px;font-size:12px;color:#6b7280;">Button not working? Copy and paste this link into your browser:</p>
    <p style="margin:0;font-size:12px;color:#374151;word-break:break-all;">${resetUrl}</p>
  </div>

  <!-- Footer -->
  <div style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.8;">
    If you didn't request this, you can safely ignore this email — your password won't change.
  </div>

</div>
</body>
</html>`;
}

module.exports = { sendMail, buildPaymentAdviceHTML, buildDueReminderHTML, buildPasswordResetHTML };
