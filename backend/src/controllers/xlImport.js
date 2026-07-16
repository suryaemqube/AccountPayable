const XLSX       = require('xlsx');
const pool       = require('../config/db');
const paramCache = require('../utils/parameterCache');
const { logActivity } = require('../utils/activityLog');
const { notify } = require('../utils/notify');

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function parseAmount(val) {
  if (!val && val !== 0) return 0;
  const n = parseFloat(String(val).replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : Math.abs(n);
}

// Pass-through: parseDate now always returns "YYYY-MM-DD" strings or null
function toISO(val) {
  if (!val) return null;
  if (typeof val === 'string') return val.slice(0, 10);
  // fallback for Date objects
  if (val instanceof Date && !isNaN(val)) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function parseDate(val) {
  if (!val && val !== 0) return null;
  // Excel serial number — parse directly to avoid timezone shifts
  if (typeof val === 'number') {
    try {
      const p = XLSX.SSF.parse_date_code(val);
      if (!p) return null;
      return `${p.y}-${String(p.m).padStart(2,'0')}-${String(p.d).padStart(2,'0')}`;
    } catch { return null; }
  }
  // Date object from cellDates:true — xlsx stores as local midnight, use local methods
  if (val instanceof Date) {
    if (isNaN(val)) return null;
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  // "DD-Mon-YY" format e.g. "1-Jun-26"
  const dmy = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (dmy) {
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const mo = months[dmy[2].toLowerCase()];
    if (!mo) return null;
    const yr = parseInt(dmy[3]);
    const year = yr < 100 ? (yr >= 50 ? 1900 + yr : 2000 + yr) : yr;
    return `${year}-${String(mo).padStart(2,'0')}-${String(parseInt(dmy[1])).padStart(2,'0')}`;
  }
  // ISO string
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function col(row, ...names) {
  for (const n of names) {
    // trim trailing spaces on both the key we search and the row keys
    const found = Object.keys(row).find(k => k.trim().toLowerCase() === n.toLowerCase());
    if (found !== undefined && row[found] !== '' && row[found] != null) return row[found];
  }
  return '';
}

// ─────────────────────────────────────────────
//  Core parser — Purchase Register flat format
//  Columns: Date | Supplier Name | Type |
//   Purchase Invoice No. | Basic Amount |
//   CGST | SGST | IGST | Total Invoice Value |
//   TDS | Net Payable | Credit Days | Cos Centre
// ─────────────────────────────────────────────

function parseExcelBuffer(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const vouchers = [];

  for (const row of rows) {
    const dateVal = col(row, 'date');
    if (!dateVal) continue; // skip blank rows

    const parsedDate = parseDate(dateVal);
    if (!parsedDate) continue;

    const creditDays  = parseInt(String(col(row, 'credit days') || '0').trim()) || 0;
    const totalAmt    = parseAmount(col(row, 'total invoice value'));
    const taxable     = parseAmount(col(row, 'basic amount'));
    const cgst        = parseAmount(col(row, 'cgst'));
    const sgst        = parseAmount(col(row, 'sgst'));
    const igst        = parseAmount(col(row, 'igst'));
    const tds         = parseAmount(col(row, 'tds'));
    const netPayable  = parseAmount(col(row, 'net payable'));
    const invoiceNo   = String(col(row, 'purchase invoice no.', 'purchase invoice no') || '').trim();
    const supplierRaw = String(col(row, 'supplier name') || '').trim();
    const typeRaw     = String(col(row, 'type') || '').trim();
    const cosCentre   = String(col(row, 'cos centre', 'cost centre', 'cost center') || '').trim();
    const pymtModeRaw = String(col(row, 'payment mode', 'pymt_mode', 'payment_mode') || '').trim().toUpperCase();
    const pymtMode    = ['NEFT','RTGS','FT', 'CHEQUE'].includes(pymtModeRaw) ? pymtModeRaw : 'NEFT';

    // Normalise type → SALE / SALE_MULTIPLE / CONSUME / PROJECT code
    // (checked before the plain "sale" pattern so it isn't swallowed by it)
    const typeCode = /sale.*multiple|multiple.*sale/i.test(typeRaw) ? 'SALE_MULTIPLE'
                   : /salable|sale/i.test(typeRaw)       ? 'SALE'
                   : /consumption|consume/i.test(typeRaw) ? 'CONSUME'
                   : /project/i.test(typeRaw)             ? 'PROJECT'
                   : null;

    vouchers.push({
        date:              toISO(parsedDate),
        party_name:        supplierRaw,
        vch_type:          typeRaw,
        purchase_type_code: typeCode,
        bill_ref_no:       invoiceNo,
        bill_date:         toISO(parsedDate),
        taxable_amount:    taxable,
        cgst,
        sgst,
        igst,
        tds_amount:        tds,
        total_amount:      totalAmt || (taxable + cgst + sgst + igst),
        net_payable:       netPayable || (totalAmt - tds),
        due_days:          creditDays || null,
        payment_reference: cosCentre,
        payment_mode:      pymtMode,
        narration:         '',
      });
  }

  return vouchers;
}

// ─────────────────────────────────────────────
//  Supplier fuzzy match
// ─────────────────────────────────────────────

function findSupplier(partyName, suppliers) {
  if (!partyName) return null;
  const n = partyName.toLowerCase().trim();

  let hit = suppliers.find(s => s.supplier_name.toLowerCase().trim() === n);
  if (hit) return hit;

  hit = suppliers.find(s => {
    const sn = s.supplier_name.toLowerCase().trim();
    return sn.includes(n) || n.includes(sn);
  });
  if (hit) return hit;

  const words = n.split(/\s+/).filter(w => w.length > 2).slice(0, 3).join(' ');
  hit = suppliers.find(s => s.supplier_name.toLowerCase().includes(words));
  return hit || null;
}

// ─────────────────────────────────────────────
//  Uniqueness — Invoice Ref No must be globally unique across bills.
//  Cost Centre must also be globally unique, EXCEPT for the types in
//  COST_CENTRE_NOT_UNIQUE_TYPES — for Consume, Cost Centre is a State
//  (expected to repeat); for Sale - Multiple, one Cost Centre can
//  legitimately cover several bills. Checked against existing bills AND
//  across rows within the same import batch. Mutates each voucher with
//  `duplicate_ref_reason` / `duplicate_centre_reason` (shown under their
//  own columns) plus an overall `duplicate` / `duplicate_reason` for the
//  summary banner and skip logic. Used identically at preview and at
//  confirm time so the two stay in sync.
// ─────────────────────────────────────────────

const COST_CENTRE_NOT_UNIQUE_TYPES = ['CONSUME', 'SALE_MULTIPLE'];

async function markDuplicates(vouchers) {
  const refs    = [...new Set(vouchers.map(v => v.bill_ref_no).filter(Boolean))];
  const centres = [...new Set(
    vouchers.filter(v => !COST_CENTRE_NOT_UNIQUE_TYPES.includes(v.purchase_type_code)).map(v => v.payment_reference).filter(Boolean)
  )];

  const [refRes, centreRes] = await Promise.all([
    refs.length    ? pool.query(`SELECT bill_ref_no FROM bills WHERE bill_ref_no = ANY($1::text[])`, [refs])
                   : Promise.resolve({ rows: [] }),
    centres.length ? pool.query(`SELECT payment_reference FROM bills WHERE payment_reference = ANY($1::text[])`, [centres])
                   : Promise.resolve({ rows: [] }),
  ]);
  const existingRefs    = new Set(refRes.rows.map(r => r.bill_ref_no));
  const existingCentres = new Set(centreRes.rows.map(r => r.payment_reference));

  const seenRefs    = new Set();
  const seenCentres = new Set();

  vouchers.forEach(v => {
    let refReason = null;
    if (v.bill_ref_no) {
      if (existingRefs.has(v.bill_ref_no))     refReason = 'Invoice Ref No already exists';
      else if (seenRefs.has(v.bill_ref_no))    refReason = 'Invoice Ref No duplicated in this file';
      seenRefs.add(v.bill_ref_no);
    }
    let centreReason = null;
    if (!COST_CENTRE_NOT_UNIQUE_TYPES.includes(v.purchase_type_code) && v.payment_reference) {
      if (existingCentres.has(v.payment_reference))  centreReason = 'Cost Centre already exists';
      else if (seenCentres.has(v.payment_reference))  centreReason = 'Cost Centre duplicated in this file';
      seenCentres.add(v.payment_reference);
    }
    v.duplicate_ref_reason    = refReason;
    v.duplicate_centre_reason = centreReason;
    v.duplicate        = !!(refReason || centreReason);
    v.duplicate_reason = [refReason, centreReason].filter(Boolean).join(' & ') || null;
  });

  return vouchers;
}

// ─────────────────────────────────────────────
//  Endpoints
// ─────────────────────────────────────────────

async function parseXl(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const parsed = parseExcelBuffer(req.file.buffer);
    if (!parsed.length) return res.status(400).json({ error: 'No voucher rows found in file' });

    const suppRes = await pool.query(
      "SELECT id, supplier_name, approval_status FROM suppliers WHERE is_active = true ORDER BY supplier_name"
    );
    const bankRes = await pool.query(`
      SELECT cb.*, cd.company_name,
             pd.code AS purchase_type_code
      FROM company_bank_accounts cb
      JOIN company_details cd ON cb.company_id = cd.id
      LEFT JOIN parameter_details pd ON pd.parameterdetid = cb.purchase_type_det_id
      WHERE cd.is_active = true
      ORDER BY cd.company_name, cb.is_primary DESC, cb.created_at
    `);
    const stateRes = await pool.query(`
      SELECT pd.parameterdetid, pd.parametervalues
      FROM parameter_details pd
      JOIN parameters p ON p.parameterid = pd.parameterid
      WHERE p.parametertext = 'State/UT' AND pd.is_active = true
      ORDER BY pd.displayorder
    `);

    const vouchers = parsed.map(v => {
      const matched = findSupplier(v.party_name, suppRes.rows);
      return {
        ...v,
        supplier_id:   matched?.id || null,
        supplier_name: matched?.supplier_name || v.party_name,
        matched:       !!matched,
      };
    });

    // Consume type: Cost Centre must be a State — normalise the raw Excel text
    // (case/whitespace variations) to the canonical state name where it matches.
    const stateByLower = new Map(stateRes.rows.map(s => [s.parametervalues.toLowerCase(), s.parametervalues]));
    vouchers.forEach(v => {
      if (v.purchase_type_code === 'CONSUME' && v.payment_reference) {
        const canonical = stateByLower.get(v.payment_reference.trim().toLowerCase());
        if (canonical) v.payment_reference = canonical;
      }
    });

    // Invoice Ref No and Cost Centre must each be globally unique
    await markDuplicates(vouchers);

    res.json({ vouchers, suppliers: suppRes.rows, banks: bankRes.rows, states: stateRes.rows });
  } catch (err) {
    console.error('XL parse error:', err);
    res.status(500).json({ error: 'Failed to parse file: ' + err.message });
  }
}

async function confirmImport(req, res) {
  const { vouchers } = req.body;
  if (!Array.isArray(vouchers) || !vouchers.length) {
    return res.status(400).json({ error: 'vouchers array required' });
  }

  const [saleId, consumeId, projectId, saleMultipleId] = await Promise.all([
    paramCache.detId('Purchase Type', 'SALE'),
    paramCache.detId('Purchase Type', 'CONSUME'),
    paramCache.detId('Purchase Type', 'PROJECT'),
    paramCache.detId('Purchase Type', 'SALE_MULTIPLE'),
  ]);

  function purchaseTypeId(code) {
    if (code === 'SALE')          return saleId;
    if (code === 'CONSUME')       return consumeId;
    if (code === 'PROJECT')       return projectId;
    if (code === 'SALE_MULTIPLE') return saleMultipleId;
    return null;
  }

  // Re-check uniqueness at confirm time (Invoice Ref No / Cost Centre, globally unique)
  await markDuplicates(vouchers);

  // Pre-check: all matched suppliers must be approved
  const supplierIds = [...new Set(vouchers.filter(v => v.supplier_id).map(v => v.supplier_id))];
  if (supplierIds.length) {
    const suppRes = await pool.query(
      `SELECT id, supplier_name, approval_status FROM suppliers WHERE id = ANY($1::uuid[])`,
      [supplierIds]
    );
    const unapproved = suppRes.rows.filter(s => s.approval_status !== 'approved');
    if (unapproved.length) {
      const names = unapproved.map(s => s.supplier_name).join(', ');
      return res.status(400).json({ error: `Cannot import — supplier approval pending: ${names}` });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    const skipped = [];

    for (const v of vouchers) {
      if (v.duplicate) {
        skipped.push({ bill_ref_no: v.bill_ref_no, payment_reference: v.payment_reference, reason: v.duplicate_reason });
        continue;
      }

      const grossTotal = (v.taxable_amount || 0) + (v.cgst || 0) + (v.sgst || 0) + (v.igst || 0);

      const r = await client.query(
        `INSERT INTO bills (
           bill_no, supplier_id, invoice_date,
           taxable_amount, cgst, sgst, igst, tds_amount, total_amount,
           payment_reference, payment_mode, narration,
           tally_vch_no, bill_ref_no, bill_date,
           due_days, purchase_type_det_id, company_bank_id, created_by
         ) VALUES (
           'BILL-' || LPAD(nextval('bill_no_seq')::text, 5, '0'),
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          v.supplier_id                        || null,
          v.date                               || null,
          v.taxable_amount                     || 0,
          v.cgst                               || 0,
          v.sgst                               || 0,
          v.igst                               || 0,
          v.tds_amount                         || 0,
          grossTotal,
          v.payment_reference                  || '',
          v.payment_mode                       || 'NEFT',
          v.narration                          || '',
          v.vch_no                             || '',
          v.bill_ref_no                        || '',
          v.bill_date || v.date               || null,
          v.due_days                           || null,
          purchaseTypeId(v.purchase_type_code) || null,
          v.company_bank_id                    || null,
          req.user.id,
        ]
      );
      created.push(r.rows[0]);
    }

    await client.query('COMMIT');

    if (created.length) {
      notify({
        type: 'bill_created',
        message: `${created.length} bill(s) imported via Tally by ${req.user.name}`,
        entity_type: 'bill', entity_id: null, created_by: req.user.id,
      });
    }

    res.status(201).json({ created, count: created.length, skipped, skipped_count: skipped.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('XL import error:', err);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  } finally {
    client.release();
  }
}

module.exports = { parseXl, confirmImport };
