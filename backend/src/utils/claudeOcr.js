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
