const XLSX       = require('xlsx');
const pool       = require('../config/db');
const paramCache = require('../utils/parameterCache');

// ── Value normalizers ─────────────────────────────────────────────────────────

function str(v) { return v != null ? String(v).trim() : ''; }

function normCode(val, allowedCodes) {
  if (!val) return null;
  const u = str(val).toUpperCase();
  return allowedCodes.find(c => c === u) || null;
}

function toTitleCase(s) {
  if (!s) return s;
  return str(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function normBool(val) {
  const s = str(val).toLowerCase();
  return s === 'yes' || s === 'true' || s === '1' || s === 'y';
}

// ── Parse supplier XL buffer → array of row objects ──────────────────────────
// Uses header:1 (array mode) to handle duplicate column names (City/State/Country/PIN
// appear 3× for Registered/Billing/Shipping). Column indices are fixed by template.
// A=0  B=1  C=2  D=3  E=4  F=5  G=6  H=7  I=8  J=9  K=10 L=11
// M=12 N=13 O=14 P=15 Q=16 R=17 S=18 T=19 U=20 V=21 W=22 X=23
// Y=24 Z=25 AA=26 AB=27 AC=28 AD=29 AE=30 AF=31 AG=32 AH=33 AI=34
// AJ=35 AK=36 AL=37 AM=38 AN=39 AO=40 AP=41 AQ=42
function parseBuffer(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  // header:1 returns arrays; row[0] is the header row, skip it
  const all  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const dataRows = all.slice(1); // skip header row

  return dataRows
    .map((r, i) => {
      const c = idx => str(r[idx]);
      const supplierName = c(0);
      if (!supplierName) return null;
      return {
        _rowIdx:              i + 2,
        supplier_name:        supplierName,
        trade_name:           c(1),
        name_for_bank:        c(2),
        supplier_type:        normCode(c(3), ['RESELLER','DISTRIBUTOR','OEM','OTHER']),
        gstin:                c(4).toUpperCase() === 'NA' ? '' : c(4).toUpperCase(),
        cin_number:           c(5).toUpperCase(),
        // Contact
        contact_name:         c(6),
        designation:          c(7),
        mobile:               c(8),
        email:                c(9),
        alternate_contact:    c(10),
        website:              c(11),
        // Registered address
        reg_address:          c(12),
        reg_city:             c(13),
        reg_state:            toTitleCase(c(14)),
        reg_country:          c(15),
        reg_pincode:          c(16),
        // Billing address
        bill_address:         c(17),
        bill_city:            c(18),
        bill_state:           toTitleCase(c(19)),
        bill_country:         c(20),
        bill_pincode:         c(21),
        // Shipping address
        ship_address:         c(22),
        ship_city:            c(23),
        ship_state:           toTitleCase(c(24)),
        ship_country:         c(25),
        ship_pincode:         c(26),
        // Bank
        bank_name:            c(27),
        branch_name:          c(28),
        account_holder_name:  c(29),
        account_number:       c(30),
        ifsc_code:            c(31).toUpperCase(),
        swift_code:           c(32).toUpperCase(),
        // Tax & Compliance
        pan_number:           c(33).toUpperCase(),
        gst_certificate:      c(34),
        tds_applicable:       normBool(c(35)),
        lower_deduction_cert: c(36),
        udyam_reg_number:     c(37),
        pf_registration:      c(38),
        esic_registration:    c(39),
        // Operational
        products_services_raw: c(40),
        territory_raw:         c(41),
      };
    })
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PARSE ENDPOINT  →  preview only, no DB writes
// ─────────────────────────────────────────────────────────────────────────────
async function parseSupplierXl(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const rows = parseBuffer(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'No supplier rows found in file' });

    // Load all existing suppliers for duplicate check (by GSTIN first, then name)
    const existing = await pool.query(
      `SELECT id, supplier_name, gstin FROM suppliers ORDER BY supplier_name`
    );
    const byGstin = new Map(existing.rows.filter(s => s.gstin).map(s => [s.gstin.toUpperCase(), s]));
    const byName  = new Map(existing.rows.map(s => [s.supplier_name.toLowerCase().trim(), s]));

    // Track GSTINs already seen within the file itself (intra-file dedup)
    const seenGstin = new Map(); // gstin → rowIdx that claimed it first
    const seenName  = new Map();

    const result = rows.map(r => {
      const rawGstin = r.gstin?.toUpperCase();
      const gstinKey = (rawGstin && rawGstin !== 'NA') ? rawGstin : null;
      const nameKey  = r.supplier_name?.toLowerCase().trim();

      // Check intra-file duplicate first
      if (gstinKey && seenGstin.has(gstinKey)) {
        return { ...r, status: 'duplicate', duplicate_reason: `GST Number already in this file (row ${seenGstin.get(gstinKey)})`, existing_id: null };
      }
      if (!gstinKey && nameKey && seenName.has(nameKey)) {
        return { ...r, status: 'duplicate', duplicate_reason: `Supplier Name already in this file (row ${seenName.get(nameKey)})`, existing_id: null };
      }

      // Track seen
      if (gstinKey) seenGstin.set(gstinKey, r._rowIdx);
      else if (nameKey) seenName.set(nameKey, r._rowIdx);

      // Check DB
      const dbMatch = gstinKey
        ? byGstin.get(gstinKey)
        : byName.get(nameKey);

      if (dbMatch) {
        return { ...r, status: 'update', existing_id: dbMatch.id, existing_name: dbMatch.supplier_name };
      }
      return { ...r, status: 'new', existing_id: null };
    });

    const counts = result.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
    res.json({ suppliers: result, counts });

  } catch (err) {
    console.error('Supplier XL parse error:', err);
    res.status(500).json({ error: 'Failed to parse file: ' + err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIRM ENDPOINT  →  create / update, skip duplicates
// ─────────────────────────────────────────────────────────────────────────────
async function confirmSupplierImport(req, res) {
  const { suppliers } = req.body;
  if (!Array.isArray(suppliers) || !suppliers.length) {
    return res.status(400).json({ error: 'suppliers array required' });
  }

  // Resolve parameter det_ids for supplier types
  const typeCache = new Map();
  async function getTypeDetId(code) {
    if (!code) return null;
    if (!typeCache.has(code)) {
      typeCache.set(code, await paramCache.detId('Supplier Type', code));
    }
    return typeCache.get(code);
  }

  // Normalise products_services and territory to stored codes
  const psMap  = { PRODUCT:'PRODUCT', PRODUCTS:'PRODUCT', SERVICES:'SERVICES', SERVICE:'SERVICES' };
  const terMap = { TERRITORY:'TERRITORY', REGION:'REGION' };

  function resolvePs(v)  { return v ? (psMap[v.toUpperCase().trim()]  || null) : null; }
  function resolveTer(v) { return v ? (terMap[v.toUpperCase().trim()] || null) : null; }

  const client = await pool.connect();
  const created = [], updated = [], skipped = [];

  try {
    await client.query('BEGIN');

    for (const r of suppliers) {
      if (r.status === 'duplicate') { skipped.push(r.supplier_name); continue; }

      const typeDetId = await getTypeDetId(r.supplier_type);
      const isNew     = r.status === 'new';
      const notes     = isNew ? 'New' : 'Import';

      const vals = [
        r.supplier_name        || null,
        r.trade_name           || null,
        r.name_for_bank        || null,
        typeDetId,
        r.gstin                || null,
        r.pan_number           || null,
        r.cin_number           || null,
        r.udyam_reg_number     || null,
        r.pf_registration      || null,
        r.esic_registration    || null,
        r.tds_applicable       || false,
        r.gst_certificate      || null,
        r.lower_deduction_cert || null,
        resolvePs(r.products_services_raw),
        resolveTer(r.territory_raw),
      ];

      let suppId;

      if (isNew) {
        // Auto vendor code
        const vcRes = await client.query(
          "SELECT 'VEN-' || LPAD(nextval('supplier_vendor_code_seq')::text, 4, '0') AS vc"
        );
        const vendor_code = vcRes.rows[0].vc;

        // vals = [name,trade,name_for_bank,typeDetId,gstin,pan,cin,udyam,pf,esic,tds,gst_cert,lower,ps,ter]
        const ins = await client.query(
          `INSERT INTO suppliers (
             supplier_name, trade_name, name_for_bank, supplier_type_det_id,
             gstin, pan_number, cin_number, udyam_reg_number,
             pf_registration, esic_registration, tds_applicable,
             gst_certificate, lower_deduction_cert,
             products_services, territory,
             vendor_code, is_active, created_by, approval_status, approval_notes
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,$17,'pending',$18)
           RETURNING id`,
          [...vals, vendor_code, req.user.id, notes]
        );
        suppId = ins.rows[0].id;
        created.push(r.supplier_name);
      } else {
        // Update existing supplier — reset approval to pending
        await client.query(
          `UPDATE suppliers SET
             supplier_name        = COALESCE($1,  supplier_name),
             trade_name           = COALESCE($2,  trade_name),
             name_for_bank        = COALESCE($3,  name_for_bank),
             supplier_type_det_id = COALESCE($4,  supplier_type_det_id),
             gstin                = COALESCE($5,  gstin),
             pan_number           = COALESCE($6,  pan_number),
             cin_number           = COALESCE($7,  cin_number),
             udyam_reg_number     = COALESCE($8,  udyam_reg_number),
             pf_registration      = COALESCE($9,  pf_registration),
             esic_registration    = COALESCE($10, esic_registration),
             tds_applicable       = $11,
             gst_certificate      = COALESCE($12, gst_certificate),
             lower_deduction_cert = COALESCE($13, lower_deduction_cert),
             products_services    = COALESCE($14, products_services),
             territory            = COALESCE($15, territory),
             approval_status      = 'pending',
             approved_by          = NULL,
             last_approved_at     = NULL,
             approval_notes       = $16,
             updated_at           = NOW()
           WHERE id = $17`,
          [...vals, notes, r.existing_id]
        );
        suppId = r.existing_id;
        updated.push(r.supplier_name);
      }

      // Upsert primary contact — delete old primary then insert fresh
      if (r.contact_name) {
        await client.query(
          'DELETE FROM supplier_contacts WHERE supplier_id=$1 AND is_primary=true', [suppId]
        );
        await client.query(
          `INSERT INTO supplier_contacts
             (supplier_id, primary_contact_name, name, email, designation, mobile, alternate_contact, website, is_primary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
          [suppId, r.contact_name, r.contact_name, r.email||null, r.designation||null,
           r.mobile||null, r.alternate_contact||null, r.website||null]
        );
      }

      // Upsert addresses
      const addrRows = [
        { type:'registered', line:r.reg_address,  city:r.reg_city,  state:r.reg_state,  country:r.reg_country,  pincode:r.reg_pincode  },
        { type:'billing',    line:r.bill_address, city:r.bill_city, state:r.bill_state, country:r.bill_country, pincode:r.bill_pincode },
        { type:'shipping',   line:r.ship_address, city:r.ship_city, state:r.ship_state, country:r.ship_country, pincode:r.ship_pincode },
      ];
      for (const a of addrRows) {
        if (!a.line && !a.city) continue;
        await client.query(
          `INSERT INTO supplier_addresses (supplier_id, address_type, address_line, city, state, country, pincode)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (supplier_id, address_type) DO UPDATE
             SET address_line=$3, city=$4, state=$5, country=$6, pincode=$7`,
          [suppId, a.type, a.line||null, a.city||null, a.state||null, a.country||'India', a.pincode||null]
        );
      }

      // Upsert primary bank (only if account number provided)
      if (r.account_number) {
        // For update: delete existing banks and re-insert primary (keeps import clean)
        if (!isNew) {
          await client.query(
            'DELETE FROM supplier_bank_details WHERE supplier_id=$1 AND is_primary=true', [suppId]
          );
        }
        await client.query(
          `INSERT INTO supplier_bank_details
             (supplier_id, bank_name, branch_name, account_holder_name, account_number, ifsc_code, swift_code, is_primary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
          [suppId, r.bank_name||null, r.branch_name||null, r.account_holder_name||null,
           r.account_number, r.ifsc_code||null, r.swift_code||null]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      created_count: created.length,
      updated_count: updated.length,
      skipped_count: skipped.length,
      created, updated, skipped,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Supplier import error:', err);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  } finally {
    client.release();
  }
}

module.exports = { parseSupplierXl, confirmSupplierImport };
