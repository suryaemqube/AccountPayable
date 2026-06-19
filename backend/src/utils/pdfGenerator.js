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

function buildVoucherHtml(voucher, lineItems, comments, voucherNo, companyBank = null) {
  // Build narration from voucher data
  const narration = voucher.narration ||
    (voucher.payment_reference ? `Being payment vide Ref: ${voucher.payment_reference}` : 'Being payment as per details above');

  // Use tally vch no if available, otherwise fall back to generated
  const displayVoucherNo = voucher.tally_vch_no || voucherNo || '';
  // Company bank details (from master)
  const bankName    = companyBank?.bank_name     || '';
  const accountNo   = companyBank?.account_number || '';
  const accountName = companyBank?.account_name   || '';

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
    <span class="logo-check"><svg xmlns="http://www.w3.org/2000/svg" width="246.413" height="55.428" viewBox="0 0 246.413 55.428">
  <g transform="translate(-21.93 -19.07)">
    <path d="M159.067,32.83c-.1.832-.146,1.472-.244,1.955a4.246,4.246,0,0,0-.1.884,6.542,6.542,0,0,0,.931,3.526,64.994,64.994,0,0,0,5.294,6.469,87.938,87.938,0,0,1,6.906,8.721,15.958,15.958,0,0,1,2.548,9.262,16.755,16.755,0,0,1-1.227,6.371,16.039,16.039,0,0,1-3.64,5.487,14.166,14.166,0,0,1-5.877,3.427,26.653,26.653,0,0,1-7.645,1.077H142.95V68.693h11.514a8.664,8.664,0,0,0,4.634-1.238,4.41,4.41,0,0,0,1.862-3.869,6.537,6.537,0,0,0-.733-2.944,16.507,16.507,0,0,0-1.961-2.99l-5.814-6.839a51.964,51.964,0,0,1-5.315-7.109,12.965,12.965,0,0,1-1.862-6.714,14.411,14.411,0,0,1,.2-2.4q.224-1.248.3-1.763h13.277Zm71.581,0L211.2,80.794,196.4,46.008l8.087-13.818,6.709,19.5,6.074-18.862h13.376Zm-44.34,0H172.3l20.527,47.965,7.692-13.033Zm69.818,0H242.213l12.736,35.884H242.827l3.354-13.22L239.519,38.54,226.58,79.988h44.33Zm17.391,0H293.9a33.9,33.9,0,0,1,7.057.686,12.481,12.481,0,0,1,5.44,2.736,11.482,11.482,0,0,1,3.334,5.2,23.2,23.2,0,0,1,.931,6.958v31.6H297.625V49.045c0-1.862-.343-3.12-1.123-3.822a5.805,5.805,0,0,0-3.921-1.077h-6.126V80.03H273.51Z" transform="translate(-58.083 -6.297)" fill="#0d4689"/>
    <path d="M70.706,40.158A60.969,60.969,0,0,1,50.018,60.4c-6.8,4.894-17.443,7.6-21.036,3.947s-4-8.7-.556-14.593c3-5.149,3.7-5.2,6.9-11.592,1.04-6.7-7.7-1.2-8.394,2.148l-4.2,2.247c1.753-12.793,12.045-22.882,24.385-22.882,11.192,0,22.035,9.444,23.585,20.49M21.93,46.456c0,14.094,10.245,27.386,25.186,27.386,13.891,0,25.233-12.294,25.233-27.386S61.012,19.07,47.116,19.07,21.93,31.364,21.93,46.456M65.053,34.464A64.18,64.18,0,0,1,48.931,46.425c-2.08.9-6.9,4.1-7.848,1.248-.452-3.349,2-4.649,3.349-5.4a6.675,6.675,0,0,0-5.6,2.351c-6.048,5.045-6.995,16.59,3.5,9.881,8.446-4.894,17.937-12.939,22.737-20.038" transform="translate(0 0)" fill="#0d4689"/>
    <path d="M476.77,42.079V36.966h-1.95V36.28h4.587v.686h-1.893v5.107Zm3.443,0v-5.8h1.144l1.357,4.129c.114.343.229.629.286.863a7.33,7.33,0,0,1,.286-.978l1.378-4.015h1.04v5.8h-.749V37.258l-1.664,4.816H482.6l-1.659-4.935v4.935Z" transform="translate(-217.362 -8.26)" fill="#0d4689"/>
  </g>
</svg></span>
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

<!-- ROW 1: Voucher No + Date (date intentionally blank) -->
<div class="field-row">
  <span class="field-label">Voucher No.</span>
  <span class="field-line value">${displayVoucherNo}</span>
  <span class="spacer"></span>
  <span class="field-label">Date :</span>
  <span class="field-line value" style="max-width:90px;">${fmtDate(voucher.bill_date)}</span>
  <span class="field-line value" style="max-width:120px;"></span>
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
  <span class="field-line value" style="max-width:140px;">${voucher.bill_ref_no || ''}</span>
  <span class="spacer"></span>
  <span class="field-label">Dated</span>
  <span class="field-line value" style="max-width:90px;">${fmtDate(voucher.bill_date)}</span>
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
  <span class="field-line value">${bankName}${accountName ? ' — ' + accountName : ''}</span>
  <span class="spacer"></span>
  <span class="field-label">A/c No.</span>
  <span class="field-line value" style="max-width:130px;">${accountNo}</span>
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
async function generateVoucherPDF(voucher, lineItems, comments, companyBank = null) {
  const voucherNo = voucher.voucher_no
  const html = buildVoucherHtml(voucher, lineItems, comments, voucherNo, companyBank);
  return await renderPDF(html);
}

// ── Generate PDF and SAVE to disk, return file path
async function generateAndSaveVoucherPDF(voucher, lineItems, comments, companyBank = null) {
  const voucherNo = voucher.voucher_no
  const fileName = `voucher_${voucherNo}.pdf`;
  const savePath = path.join(__dirname, '../../vouchers', fileName);

  const html = buildVoucherHtml(voucher, lineItems, comments, voucherNo, companyBank);
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
