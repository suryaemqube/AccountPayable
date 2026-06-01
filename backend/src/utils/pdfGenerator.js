const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function fmt(n) {
  if (n == null || n === '') return '';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function amountInWords(amount) {
  const num = Math.round(Number(amount) || 0);
  if (num === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function convert(n) {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  }
  return convert(num) + ' Rupees Only';
}

function buildVoucherHtml(voucher, lineItems, comments, voucherNo) {
  // Build narration from voucher data
  const narration = voucher.narration ||
    `Being payment for Invoice No. ${voucher.invoice_no || ''}` +
    (voucher.payment_reference ? ` vide Ref: ${voucher.payment_reference}` : '');

  const approvalTrail = [
    `Prepared by: ${voucher.created_by_name || 'Admin'}`,
    voucher.assigned_to_name ? `Reviewed by: ${voucher.assigned_to_name} (Manager)` : '',
    voucher.status === 'approved' ? `Approved: ${fmtDate(voucher.updated_at)}` : '',
  ].filter(Boolean).join('   |   ');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { size: A5 landscape; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    color: #000;
    background: #fff;
    width: 210mm;
    min-height: 148mm;
    padding: 8mm 10mm 6mm 10mm;
  }

  /* ── HEADER ── */
  .header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-bottom: 4px;
  }

  .logo-circle {
    width: 42px; height: 42px;
    border: 3px solid #000;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
  }

  .logo-check {
    font-size: 22px;
    font-weight: 900;
    font-style: italic;
    line-height: 1;
    transform: rotate(-10deg);
    display: block;
  }

  .company-block { text-align: center; }

  .company-name {
    font-size: 18px;
    font-weight: 900;
    letter-spacing: 0.5px;
    line-height: 1.1;
  }

  .company-addr {
    font-size: 10px;
    color: #222;
    margin-top: 2px;
    line-height: 1.5;
  }

  /* ── TITLE BAR ── */
  .voucher-title-bar {
    text-align: center;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    border-top: 1.5px solid #000;
    border-bottom: 1.5px solid #000;
    padding: 3px 0;
    margin: 6px 0 8px 0;
  }

  /* ── FIELD ROWS ── */
  .field-row {
    display: flex;
    align-items: flex-end;
    gap: 0;
    margin-bottom: 7px;
    width: 100%;
  }

  .field-label {
    font-weight: 700;
    white-space: nowrap;
    font-size: 11px;
    padding-right: 4px;
    flex-shrink: 0;
  }

  .field-line {
    border-bottom: 1px solid #000;
    flex: 1;
    min-width: 0;
    padding-bottom: 1px;
    font-size: 11px;
    padding-left: 4px;
  }

  .field-line.value {
    font-size: 12px;
  }

  .spacer { width: 16px; flex-shrink: 0; }

  /* ── MULTILINE FIELD ── */
  .multiline-field {
    margin-bottom: 5px;
  }

  .multiline-field .field-row { margin-bottom: 3px; }

  .extra-line {
    border-bottom: 1px solid #000;
    width: 100%;
    height: 16px;
    margin-bottom: 4px;
  }

  /* ── DIVIDER ── */
  .divider { border-top: 1px solid #000; margin: 6px 0; }

  /* ── BOTTOM SECTION ── */
  .bottom-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 6px;
  }

  /* ── SIGN ROW ── */
  .sign-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    border-top: 1.5px solid #000;
    margin-top: 8px;
  }

  .sign-cell {
    padding: 6px 0 3px 0;
    text-align: center;
    font-size: 10px;
    font-weight: 700;
    border-right: 1px solid #000;
  }

  .sign-cell:last-child { border-right: none; }
  .sign-space { height: 28px; }

  /* ── APPROVAL TRAIL ── */
  .trail {
    font-size: 8.5px;
    color: #555;
    text-align: center;
    margin-top: 4px;
    border-top: 1px dashed #ccc;
    padding-top: 3px;
  }

  /* ── STAMP ── */
  .approved-stamp {
    display: inline-block;
    border: 2px solid #1a7a1a;
    color: #1a7a1a;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 2px 7px;
    border-radius: 3px;
    transform: rotate(-8deg);
    text-transform: uppercase;
    vertical-align: middle;
    margin-left: 8px;
  }
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="logo-circle">
    <span class="logo-check">✓</span>
  </div>
  <div class="company-block">
    <div class="company-name">SWAN SOLUTIONS &amp; SERVICES PVT. LTD.</div>
    <div class="company-addr">
      404-405, T Square, Chandivali Junction, Saki Vihar Road, Andheri (E), Mumbai 400 072.<br>
      Tel. : 022-2803 4070 (30 Lines)
    </div>
  </div>
</div>

<!-- TITLE -->
<div class="voucher-title-bar">Payment Voucher</div>

<!-- ROW 1: Voucher No + Date -->
<div class="field-row">
  <span class="field-label">Voucher No.</span>
  <span class="field-line value">${voucherNo || ''}</span>
  <span class="spacer"></span>
  <span class="field-label">Date :</span>
  <span class="field-line value" style="max-width:120px;">${fmtDate(voucher.invoice_date) || fmtDate(new Date())}</span>
</div>

<!-- ROW 2: Pay + Amount -->
<div class="field-row">
  <span class="field-label">Pay</span>
  <span class="field-line value">${voucher.supplier_name || ''}</span>
  <span class="spacer"></span>
  <span class="field-label">Amount</span>
  <span class="field-line value" style="max-width:140px; font-weight:700;">&#8377; ${fmt(voucher.total_amount)}</span>
</div>

<!-- ROW 3: Amount in words -->
<div class="field-row">
  <span class="field-label">Amount in words</span>
  <span class="field-line value">${amountInWords(voucher.total_amount)}</span>
</div>

<!-- BLANK LINE under amount in words -->
<div class="extra-line"></div>

<!-- ROW 4: Bill No + Dated + Narration -->
<div class="field-row" style="margin-top:2px;">
  <span class="field-label">Bill No.</span>
  <span class="field-line value" style="max-width:160px;">${voucher.invoice_no || ''}</span>
  <span class="spacer"></span>
  <span class="field-label">Dated</span>
  <span class="field-line value" style="max-width:100px;">${fmtDate(voucher.invoice_date)}</span>
  <span class="spacer"></span>
  <span class="field-label">Narration</span>
  <span class="field-line value">${narration}</span>
</div>

<!-- EXTRA NARRATION LINES -->
<div class="extra-line"></div>
<div class="extra-line"></div>

<!-- DIVIDER -->
<div class="divider"></div>

<!-- ROW 5: Debit -->
<div class="field-row">
  <span class="field-label">Debit</span>
  <span class="field-line value">${voucher.supplier_name ? voucher.supplier_name + ' — Creditor Ledger' : ''}</span>
</div>

<!-- ROW 6: Cheque / Bank / A/c -->
<div class="field-row">
  <span class="field-label">Cheque No. / Cash</span>
  <span class="field-line value" style="max-width:130px;">${voucher.payment_reference || ''}</span>
  <span class="spacer"></span>
  <span class="field-label">Bank</span>
  <span class="field-line value"></span>
  <span class="spacer"></span>
  <span class="field-label">A/c No.</span>
  <span class="field-line value" style="max-width:110px;"></span>
</div>

<!-- SIGN ROW -->
<div class="sign-row">
  <div class="sign-cell">
    <div class="sign-space"></div>
    Prepared by
  </div>
  <div class="sign-cell">
    <div class="sign-space"></div>
    Sanctioned by
  </div>
  <div class="sign-cell">
    <div class="sign-space"></div>
    Receiver's Signature
  </div>
</div>

<!-- APPROVAL TRAIL -->
<div class="trail">
  ${approvalTrail}
  ${voucher.status === 'approved' ? '<span class="approved-stamp">Approved</span>' : ''}
</div>

</body>
</html>`;
}

// ── Generate PDF buffer (for direct download)
async function generateVoucherPDF(voucher, lineItems, comments) {
  const voucherNo = `PV/${new Date().getFullYear()}/${String(voucher.id).slice(0, 6).toUpperCase()}`;
  const html = buildVoucherHtml(voucher, lineItems, comments, voucherNo);
  return await renderPDF(html);
}

// ── Generate PDF and SAVE to disk, return file path
async function generateAndSaveVoucherPDF(voucher, lineItems, comments) {
  const year = new Date().getFullYear();
  const shortId = String(voucher.id).slice(0, 6).toUpperCase();
  const voucherNo = `PV/${year}/${shortId}`;
  const fileName = `voucher_${voucher.id}.pdf`;
  const savePath = path.join(__dirname, '../../vouchers', fileName);

  const html = buildVoucherHtml(voucher, lineItems, comments, voucherNo);
  const pdfBuffer = await renderPDF(html);

  fs.writeFileSync(savePath, pdfBuffer);
  console.log('Voucher saved to:', savePath);

  return { filePath: savePath, fileName, voucherNo };
}

// ── Shared Puppeteer render
async function renderPDF(html) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({
    format: 'A5',
    landscape: true,
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await browser.close();
  return pdfBuffer;
}

module.exports = { generateVoucherPDF, generateAndSaveVoucherPDF };
