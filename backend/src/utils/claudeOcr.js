const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACTION_PROMPT = `Extract all fields from this invoice and return ONLY a valid JSON object with no preamble, no markdown, no code fences.

Return exactly this structure:
{
  "invoice_no": "",
  "supplier_name": "",
  "supplier_gstin": "",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "payment_terms": "",
  "narration": "",
  "taxable_amount": 0,
  "cgst": 0,
  "sgst": 0,
  "igst": 0,
  "total_amount": 0,
  "line_items": [
    {
      "description": "",
      "hsn_code": "",
      "qty": 1,
      "rate": 0,
      "taxable_amount": 0,
      "cgst_rate": 0,
      "cgst_amount": 0,
      "sgst_rate": 0,
      "sgst_amount": 0,
      "igst_rate": 0,
      "igst_amount": 0,
      "total": 0
    }
  ]
}

Rules:
- All monetary values must be numbers (not strings).
- Dates must be YYYY-MM-DD format or null if not found.
- If a field is not present in the invoice, use empty string or 0 or null.
- Do not add any extra fields.
- Return ONLY the JSON object.`;

async function extractInvoiceData(filePath, mimeType) {
  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');

  let contentBlock;
  if (mimeType === 'application/pdf') {
    contentBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64Data },
    };
  } else {
    const imageType = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
    contentBlock = {
      type: 'image',
      source: { type: 'base64', media_type: imageType, data: base64Data },
    };
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [contentBlock, { type: 'text', text: EXTRACTION_PROMPT }],
      },
    ],
  });

  const rawText = response.content[0].text.trim();
  const jsonText = rawText.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(jsonText);
}

module.exports = { extractInvoiceData };


// const Tesseract = require('tesseract.js');
// const { fromPath } = require('pdf2pic');
// const fs = require('fs');
// const path = require('path');

// // ── Convert first page of PDF to PNG using pdf2pic (pure JS, no system deps)
// async function pdfToImagePath(pdfPath) {
//   const outputDir = path.dirname(pdfPath);
//   const baseName = path.basename(pdfPath, path.extname(pdfPath));

//   const converter = fromPath(pdfPath, {
//     density: 200,          // DPI — higher = better OCR accuracy, slower
//     saveFilename: baseName,
//     savePath: outputDir,
//     format: 'png',
//     width: 1654,           // A4 at 200dpi
//     height: 2339,
//   });

//   const result = await converter(1); // convert page 1 only
//   if (!result || !result.path) throw new Error('pdf2pic failed to convert PDF');
//   return result.path;
// }

// // ── Run Tesseract OCR
// async function runOcr(imagePath) {
//   console.log('Running Tesseract OCR on:', imagePath);
//   const { data: { text } } = await Tesseract.recognize(imagePath, 'eng', {
//     logger: m => {
//       if (m.status === 'recognizing text') {
//         process.stdout.write(`\r  OCR progress: ${Math.round(m.progress * 100)}%`);
//       }
//     },
//   });
//   console.log('\n  OCR complete.');
//   return text;
// }

// // ── Helpers
// function cleanNum(str) {
//   if (!str) return 0;
//   const n = parseFloat(String(str).replace(/[^\d.]/g, ''));
//   return isNaN(n) ? 0 : n;
// }

// function findAmount(text, ...patterns) {
//   for (const pattern of patterns) {
//     const m = text.match(pattern);
//     if (m) return cleanNum(m[1]);
//   }
//   return 0;
// }

// function findText(text, ...patterns) {
//   for (const pattern of patterns) {
//     const m = text.match(pattern);
//     if (m) return (m[1] || '').trim();
//   }
//   return '';
// }

// // ── Date parser — handles DD/MM/YYYY, DD-MM-YYYY, DD MMM YYYY
// function parseDate(str) {
//   if (!str) return null;
//   str = str.trim();

//   // DD/MM/YYYY or DD-MM-YYYY
//   let m = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
//   if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

//   // DD MMM YYYY  e.g. 26 May 2026
//   const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
//   m = str.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
//   if (m) {
//     const mon = months[m[2].toLowerCase().slice(0, 3)];
//     if (mon) return `${m[3]}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
//   }

//   return null;
// }

// // ── Main text parser — raw OCR text → structured invoice fields
// function parseInvoiceText(text) {
//   console.log('\n── Raw OCR (first 600 chars) ──\n', text.slice(0, 600), '\n───────────────────────────────\n');

//   const invoice_no = findText(text,
//     /invoice\s*no[.:#]?\s*([A-Z0-9\-\/]+)/i,
//     /inv[.\s#:]*([A-Z0-9\-\/]+)/i,
//     /bill\s*no[.:#]?\s*([A-Z0-9\-\/]+)/i,
//   );

//   const supplierMatch =
//     text.match(/(?:from|supplier|sold\s*by)[:\s]+([^\n]+)/i) ||
//     text.match(/^([A-Z][A-Z\s&.,()Pvt.Ltd]+(?:pvt\.?\s*ltd|private\s*limited|llp|llc)?)/im);
//   const supplier_name = supplierMatch ? supplierMatch[1].trim().replace(/\s+/g, ' ') : '';

//   const gstinMatch = text.match(/\b(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1})\b/);
//   const supplier_gstin = gstinMatch ? gstinMatch[1] : '';

//   const dateMatch = text.match(
//     /(?:invoice\s*date|date\s*of\s*invoice|bill\s*date|dated?)[:\s]+([0-9]{1,2}[\-\/\s][A-Za-z0-9]{2,3}[\-\/\s][0-9]{2,4})/i
//   );
//   const invoice_date = parseDate(dateMatch ? dateMatch[1] : '');

//   const dueDateMatch = text.match(
//     /(?:due\s*date|payment\s*due|pay\s*by)[:\s]+([0-9]{1,2}[\-\/\s][A-Za-z0-9]{2,3}[\-\/\s][0-9]{2,4})/i
//   );
//   const due_date = parseDate(dueDateMatch ? dueDateMatch[1] : '');

//   const payment_terms = findText(text,
//     /payment\s*terms?[:\s]+([^\n]+)/i,
//     /(net\s*\d+\s*days?)/i,
//   );

//   const taxable_amount = findAmount(text,
//     /taxable\s*(?:value|amount)[^\d]*([0-9,]+\.?\d*)/i,
//     /(?:sub\s*total|subtotal)[^\d]*([0-9,]+\.?\d*)/i,
//     /total\s*(?:before\s*tax|excl\.?\s*tax)[^\d]*([0-9,]+\.?\d*)/i,
//   );

//   const cgst = findAmount(text,
//     /cgst[^\d]*([0-9,]+\.?\d*)/i,
//     /central\s*gst[^\d]*([0-9,]+\.?\d*)/i,
//   );

//   const sgst = findAmount(text,
//     /sgst[^\d]*([0-9,]+\.?\d*)/i,
//     /state\s*gst[^\d]*([0-9,]+\.?\d*)/i,
//   );

//   const igst = findAmount(text,
//     /igst[^\d]*([0-9,]+\.?\d*)/i,
//     /integrated\s*gst[^\d]*([0-9,]+\.?\d*)/i,
//   );

//   let total_amount = findAmount(text,
//     /total\s*(?:receivable|payable|amount|due)[^\d]*([0-9,]+\.?\d*)/i,
//     /grand\s*total[^\d]*([0-9,]+\.?\d*)/i,
//     /(?:net\s*amount|amount\s*payable)[^\d]*([0-9,]+\.?\d*)/i,
//     /total[^\d\n]*([0-9,]+\.?\d*)\s*$/im,
//   );
//   if (!total_amount) total_amount = taxable_amount + cgst + sgst + igst;

//   const narration = findText(text,
//     /(?:being|narration|description|particulars)[:\s]+([^\n]+)/i,
//   );

//   const line_items = extractLineItems(text);

//   return {
//     invoice_no, supplier_name, supplier_gstin,
//     invoice_date, due_date, payment_terms, narration,
//     taxable_amount, cgst, sgst, igst, total_amount,
//     line_items,
//   };
// }

// // ── Line item extractor
// function extractLineItems(text) {
//   const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
//   const items = [];

//   for (const line of lines) {
//     if (/^(sr|no|description|hsn|qty|rate|amount|total|taxable|gst|cgst|sgst|igst|discount|#)/i.test(line)) continue;
//     if (/^(sub.?total|grand.?total|taxable|cgst|sgst|igst|total\s*gst|net\s*amount)/i.test(line)) continue;

//     const nums = line.match(/[\d,]+\.?\d*/g);
//     if (!nums || nums.length < 2) continue;

//     const amounts = nums.map(cleanNum).filter(n => n > 0);
//     if (amounts.length < 2) continue;

//     const total = amounts[amounts.length - 1];
//     const rate = amounts[amounts.length - 2] || 0;
//     const qty = amounts.length >= 3 ? amounts[amounts.length - 3] : 1;
//     const desc = line.replace(/[\d,\.]+.*$/, '').trim();
//     if (!desc || desc.length < 2) continue;

//     const hsnMatch = line.match(/\b(\d{4,8})\b/);

//     items.push({
//       description: desc,
//       hsn_code: hsnMatch ? hsnMatch[1] : '',
//       qty, rate,
//       taxable_amount: qty * rate,
//       cgst_rate: 9, cgst_amount: 0,
//       sgst_rate: 9, sgst_amount: 0,
//       igst_rate: 0, igst_amount: 0,
//       total,
//     });
//   }

//   return items.slice(0, 20);
// }

// // ── Main exported function
// async function extractInvoiceData(filePath, mimeType) {
//   let imagePath = filePath;
//   let tempCreated = false;

//   try {
//     if (mimeType === 'application/pdf') {
//       console.log('Converting PDF → image using pdf2pic...');
//       imagePath = await pdfToImagePath(filePath);
//       tempCreated = true;
//     }

//     const rawText = await runOcr(imagePath);
//     const result = parseInvoiceText(rawText);

//     console.log('Extracted fields:', {
//       invoice_no: result.invoice_no,
//       supplier_name: result.supplier_name,
//       total_amount: result.total_amount,
//       line_items_count: result.line_items.length,
//     });

//     return result;
//   } finally {
//     if (tempCreated && imagePath && fs.existsSync(imagePath)) {
//       fs.unlinkSync(imagePath);
//     }
//   }
// }

// module.exports = { extractInvoiceData };