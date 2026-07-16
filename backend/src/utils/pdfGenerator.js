const puppeteer = require('puppeteer-core');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');

// Edge only — Chrome deliberately excluded so it can never be picked, even
// if Chrome is also installed on the server. Override with CHROME_PATH in
// .env if Edge lives somewhere else.
const WINDOWS_EDGE_PATHS = [
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findBrowserExecutable() {
  for (const p of WINDOWS_EDGE_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Edge not found. Install Microsoft Edge on the server or set CHROME_PATH in .env to its location.');
}

const CHROME_EXECUTABLE = process.env.CHROME_PATH || findBrowserExecutable();

const VOUCHERS_DIR = path.join(__dirname, '../../vouchers');

// ── Helpers ────────────────────────────────────────────────────────────────
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
    if (n < 20)       return ones[n];
    if (n < 100)      return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000)     return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '');
    if (n < 100000)   return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  }
  return convert(num) + ' Rupees Only';
}

// ── Logo as base64 (embed directly so Puppeteer can render it) ─────────────
function getLogoBase64() {
  const logoPath = path.join(__dirname, '../assets/logo.png');
  if (fs.existsSync(logoPath)) {
    return 'data:image/png;base64,' + fs.readFileSync(logoPath).toString('base64');
  }
  return '';
}

// ── HTML template ──────────────────────────────────────────────────────────
function buildVoucherHtml(voucher, lineItems, comments, voucherNo, companyBank = null) {
  const payAmount   = Number(voucher.amount) || Number(voucher.bill_total_amount) || Number(voucher.total_amount) || 0;
  const narration   = voucher.narration ||
    (voucher.bill_payment_reference ? `Being payment vide Ref: ${voucher.bill_payment_reference}` : 'Being payment as per details above');
  const bankName    = companyBank?.bank_name     || '';
  const accountNo   = companyBank?.account_number || '';
  const accountName = companyBank?.account_name   || '';
  const isApproved  = ['ready_to_remit', 'paid'].includes(voucher.status);
  const logoBase64  = getLogoBase64();
  const approvalTrail = [
    `Prepared by: ${voucher.created_by_name || 'Admin'}`,
    voucher.assigned_to_name ? `Reviewed by: ${voucher.assigned_to_name} (Manager)` : '',
    isApproved ? `Approved: ${fmtDate(voucher.updated_at)}` : '',
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
<div style="display:flex; align-items:center; margin-bottom:4px;">
  <!-- Logo: circle icon (left) + SWAN wordmark -->
  <div style="display:flex; align-items:center; gap:6px; flex-shrink:0; margin-right:12px;">
    <!-- Circle icon only (paths 2 = swan symbol) -->
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="21.93 19.07 48.419 55.772">
      <path d="M70.706,40.158A60.969,60.969,0,0,1,50.018,60.4c-6.8,4.894-17.443,7.6-21.036,3.947s-4-8.7-.556-14.593c3-5.149,3.7-5.2,6.9-11.592,1.04-6.7-7.7-1.2-8.394,2.148l-4.2,2.247c1.753-12.793,12.045-22.882,24.385-22.882,11.192,0,22.035,9.444,23.585,20.49M21.93,46.456c0,14.094,10.245,27.386,25.186,27.386,13.891,0,25.233-12.294,25.233-27.386S61.012,19.07,47.116,19.07,21.93,31.364,21.93,46.456M65.053,34.464A64.18,64.18,0,0,1,48.931,46.425c-2.08.9-6.9,4.1-7.848,1.248-.452-3.349,2-4.649,3.349-5.4a6.675,6.675,0,0,0-5.6,2.351c-6.048,5.045-6.995,16.59,3.5,9.881,8.446-4.894,17.937-12.939,22.737-20.038" fill="#0d4689"/>
    </svg>
    <!-- SWAN wordmark -->
    <svg xmlns="http://www.w3.org/2000/svg" width="90" height="22" viewBox="137 27 180 60">
      <path d="M159.067,32.83c-.1.832-.146,1.472-.244,1.955a4.246,4.246,0,0,0-.1.884,6.542,6.542,0,0,0,.931,3.526,64.994,64.994,0,0,0,5.294,6.469,87.938,87.938,0,0,1,6.906,8.721,15.958,15.958,0,0,1,2.548,9.262,16.755,16.755,0,0,1-1.227,6.371,16.039,16.039,0,0,1-3.64,5.487,14.166,14.166,0,0,1-5.877,3.427,26.653,26.653,0,0,1-7.645,1.077H142.95V68.693h11.514a8.664,8.664,0,0,0,4.634-1.238,4.41,4.41,0,0,0,1.862-3.869,6.537,6.537,0,0,0-.733-2.944,16.507,16.507,0,0,0-1.961-2.99l-5.814-6.839a51.964,51.964,0,0,1-5.315-7.109,12.965,12.965,0,0,1-1.862-6.714,14.411,14.411,0,0,1,.2-2.4q.224-1.248.3-1.763h13.277Zm71.581,0L211.2,80.794,196.4,46.008l8.087-13.818,6.709,19.5,6.074-18.862h13.376Zm-44.34,0H172.3l20.527,47.965,7.692-13.033Zm69.818,0H242.213l12.736,35.884H242.827l3.354-13.22L239.519,38.54,226.58,79.988h44.33Zm17.391,0H293.9a33.9,33.9,0,0,1,7.057.686,12.481,12.481,0,0,1,5.44,2.736,11.482,11.482,0,0,1,3.334,5.2,23.2,23.2,0,0,1,.931,6.958v31.6H297.625V49.045c0-1.862-.343-3.12-1.123-3.822a5.805,5.805,0,0,0-3.921-1.077h-6.126V80.03H273.51Z" fill="#0d4689"/>
    </svg>
  </div>
  <!-- Company name + address (centered in remaining space) -->
  <div style="flex:1; text-align:center;">
    <div style="font-size:17px; font-weight:900; letter-spacing:0.5px; line-height:1.1;">SWAN SOLUTIONS &amp; SERVICES PVT. LTD.</div>
    <div style="font-size:10px; color:#222; margin-top:2px; line-height:1.5;">
      404-405, T Square, Chandivali Junction, Saki Vihar Road, Andheri (E), Mumbai 400 072.<br>
      Tel. : 022-2803 4070 (30 Lines)
    </div>
  </div>
</div>

<!-- TITLE -->
<div class="voucher-title-bar">Payment Voucher</div>

<!-- ROW 1: Voucher No + Date (date the voucher was marked Paid, falling back to today if unset) -->
<div class="field-row">
  <span class="field-label">Voucher No.</span>
  <span class="field-line value">${voucherNo}</span>
  <span class="spacer"></span>
  <span class="field-label">Date :</span>
  <span class="field-line value" style="max-width:90px;">${fmtDate(voucher.paid_at || new Date())}</span>
  <span class="field-line value" style="max-width:120px;"></span>
</div>

<!-- ROW 2: Pay + Amount -->
<div class="field-row">
  <span class="field-label">Pay</span>
  <span class="field-line value">${voucher.supplier_name || ''}</span>
  <span class="spacer"></span>
  <span class="field-label">Amount</span>
  <span class="field-line value" style="max-width:140px; font-weight:700;">&#8377; ${fmt(payAmount)}</span>
</div>

<!-- ROW 3: Amount in words -->
<div class="field-row">
  <span class="field-label">Amount in words</span>
  <span class="field-line value">${amountInWords(payAmount)}</span>
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
  <span class="field-line value" style="max-width:130px;">${voucher.payment_mode || ''}</span>
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

// ── Puppeteer render using @sparticuz/chromium ─────────────────────────────
// Each call gets its own fresh, unique userDataDir instead of relying on
// puppeteer's default temp-dir handling — this is what previously caused
// "The browser is already running for <dir>" crashes when a prior launch
// left an orphaned Edge/Chrome process holding that profile's lockfile.
async function renderPDF(html) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voucher-pdf-'));
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_EXECUTABLE,
      headless: 'new',
      userDataDir,
      // Communicate over stdio instead of a local WebSocket — the WebSocket
      // handshake is what's failing when this runs under a non-interactive
      // Windows Service account (no desktop session), even though the same
      // Edge binary launches fine when run interactively.
      pipe: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
      ],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format:          'A5',
      landscape:       true,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
    fs.rm(userDataDir, { recursive: true, force: true }, () => {});
  }
}

// ── Public API ─────────────────────────────────────────────────────────────
async function generateAndSaveVoucherPDF(voucher, comments, companyBank = null) {
  if (!fs.existsSync(VOUCHERS_DIR)) fs.mkdirSync(VOUCHERS_DIR, { recursive: true });
  const voucherNo = voucher.voucher_no || 'draft';
  const fileName  = `voucher_${voucherNo}.pdf`;
  const savePath  = path.join(VOUCHERS_DIR, fileName);

  const html = buildVoucherHtml(voucher, [], comments, voucherNo, companyBank);
  const pdfBuffer = await renderPDF(html);
  fs.writeFileSync(savePath, pdfBuffer);

  return { filePath: savePath, fileName, voucherNo };
}

async function generateVoucherPDF(voucher, comments, companyBank = null) {
  const html = buildVoucherHtml(voucher, [], comments, voucher.voucher_no || 'draft', companyBank);
  return renderPDF(html);
}

module.exports = { generateVoucherPDF, generateAndSaveVoucherPDF, buildVoucherHtml };
