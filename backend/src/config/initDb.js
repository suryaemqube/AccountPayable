const pool = require('./db');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const schema = `
-- ── Fix role constraint (safe even after column is dropped) ─────────────
DO $$ BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','manager','executive'));
EXCEPTION WHEN others THEN NULL; END $$;

-- ── Core tables ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  address TEXT,
  tel VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company_details(id) ON DELETE CASCADE,
  bank_name VARCHAR(255),
  account_name VARCHAR(255),
  account_number VARCHAR(50),
  ifsc_code VARCHAR(20),
  branch_name VARCHAR(255),
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name VARCHAR(255) NOT NULL,
  supplier_type VARCHAR(50) CHECK (supplier_type IN ('RESELLER','DISTRIBUTOR','OEM')),
  gstin VARCHAR(50),
  owned_by UUID REFERENCES users(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_bank_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  bank_name VARCHAR(255),
  account_holder_name VARCHAR(255),
  ifsc_code VARCHAR(50),
  branch_name VARCHAR(255),
  account_number VARCHAR(50),
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  primary_contact_name VARCHAR(255),
  name VARCHAR(255),
  designation VARCHAR(100),
  email VARCHAR(255),
  mobile VARCHAR(50),
  alternate_contact VARCHAR(50),
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  address_type VARCHAR(20) NOT NULL CHECK (address_type IN ('registered','billing','shipping')),
  address_line TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  country VARCHAR(100) DEFAULT 'India',
  pincode VARCHAR(10),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (supplier_id, address_type)
);

CREATE TABLE IF NOT EXISTS supplier_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  document_type VARCHAR(100) NOT NULL,
  original_name VARCHAR(255),
  file_path VARCHAR(500),
  mime_type VARCHAR(100),
  file_size INT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID REFERENCES bills(id) ON DELETE SET NULL,
  voucher_no VARCHAR(50),
  amount NUMERIC(14,2) DEFAULT 0,
  narration TEXT,
  supplier_bank_id UUID REFERENCES supplier_bank_details(id) ON DELETE SET NULL,
  due_days INT,
  utr_no VARCHAR(100),
  tally_vch_no VARCHAR(100),
  bill_ref_no VARCHAR(255),
  bill_date DATE,
  tds_amount NUMERIC(14,2) DEFAULT 0,
  -- legacy columns kept for old rows
  invoice_date DATE,
  taxable_amount NUMERIC(14,2) DEFAULT 0,
  cgst NUMERIC(14,2) DEFAULT 0,
  sgst NUMERIC(14,2) DEFAULT 0,
  igst NUMERIC(14,2) DEFAULT 0,
  total_amount NUMERIC(14,2) DEFAULT 0,
  payment_reference VARCHAR(255),
  voucher_pdf_path VARCHAR(255),
  assigned_to UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  rejected_reason TEXT,
  status_det_id INT REFERENCES parameter_details(parameterdetid),
  payment_status_det_id INT REFERENCES parameter_details(parameterdetid),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS voucher_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voucher_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  activity_type VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voucher_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  file_path VARCHAR(500) NOT NULL,
  original_name VARCHAR(255),
  mime_type VARCHAR(100),
  file_size INT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bill_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  file_path VARCHAR(500) NOT NULL,
  original_name VARCHAR(255),
  mime_type VARCHAR(100),
  file_size INT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Parameter master tables ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parameters (
  parameterid   SERIAL PRIMARY KEY,
  parametertext VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS parameter_details (
  parameterdetid  SERIAL PRIMARY KEY,
  parameterid     INT  NOT NULL REFERENCES parameters(parameterid) ON DELETE CASCADE,
  parameterno     INT,
  parametervalues VARCHAR(100) NOT NULL,
  code            VARCHAR(50),
  displayorder    INT DEFAULT 1,
  is_active       BOOLEAN DEFAULT true,
  UNIQUE (parameterid, code)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50),
  entity_id UUID,
  action VARCHAR(50),
  old_values JSONB,
  new_values JSONB,
  user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS bill_no_seq START 1;

CREATE TABLE IF NOT EXISTS bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no VARCHAR(50),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  invoice_date DATE,
  bill_ref_no VARCHAR(255),
  bill_date DATE,
  taxable_amount NUMERIC(14,2) DEFAULT 0,
  cgst NUMERIC(14,2) DEFAULT 0,
  sgst NUMERIC(14,2) DEFAULT 0,
  igst NUMERIC(14,2) DEFAULT 0,
  tds_amount NUMERIC(14,2) DEFAULT 0,
  total_amount NUMERIC(14,2) DEFAULT 0,
  narration TEXT,
  payment_reference VARCHAR(255),
  tally_vch_no VARCHAR(100),
  due_days INT,
  purchase_type_det_id INT REFERENCES parameter_details(parameterdetid),
  company_bank_id UUID REFERENCES company_bank_accounts(id),
  bill_status VARCHAR(30) DEFAULT 'open' CHECK (bill_status IN ('open','partially_paid','fully_paid')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── All migrations in one idempotent block ───────────────────────────────
DO $$ BEGIN

  -- ── 1. Legacy column additions ───────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='bill_id') THEN
    ALTER TABLE vouchers ADD COLUMN bill_id UUID REFERENCES bills(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='amount') THEN
    ALTER TABLE vouchers ADD COLUMN amount NUMERIC(14,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='supplier_bank_id') THEN
    ALTER TABLE vouchers ADD COLUMN supplier_bank_id UUID REFERENCES supplier_bank_details(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='tally_vch_no') THEN
    ALTER TABLE vouchers ADD COLUMN tally_vch_no VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='bill_ref_no') THEN
    ALTER TABLE vouchers ADD COLUMN bill_ref_no VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='bill_date') THEN
    ALTER TABLE vouchers ADD COLUMN bill_date DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='company_bank_id') THEN
    ALTER TABLE vouchers ADD COLUMN company_bank_id UUID REFERENCES company_bank_accounts(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='tds_amount') THEN
    ALTER TABLE vouchers ADD COLUMN tds_amount NUMERIC(14,2) DEFAULT 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='invoice_no') THEN
    ALTER TABLE vouchers DROP COLUMN invoice_no;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='mobile_no') THEN
    ALTER TABLE users ADD COLUMN mobile_no VARCHAR(20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='supplier_contacts' AND column_name='is_primary') THEN
    ALTER TABLE supplier_contacts ADD COLUMN is_primary BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='utr_no') THEN
    ALTER TABLE vouchers ADD COLUMN utr_no VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='supplier_id') THEN
    ALTER TABLE vouchers ADD COLUMN supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
  END IF;
  -- Fix existing constraint to allow supplier deletion (SET NULL instead of RESTRICT)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'vouchers' AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.column_name = 'supplier_id'
  ) THEN
    ALTER TABLE vouchers DROP CONSTRAINT IF EXISTS vouchers_supplier_id_fkey;
    ALTER TABLE vouchers ADD CONSTRAINT vouchers_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='due_days') THEN
    ALTER TABLE vouchers ADD COLUMN due_days INT;
  END IF;
  -- Drop due_reminder_enabled if it was previously added (replaced by env var DUE_REMINDER_ENABLED)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='due_reminder_enabled') THEN
    ALTER TABLE vouchers DROP COLUMN due_reminder_enabled;
  END IF;

  -- ── Supplier extended fields ──────────────────────────────────────────
  -- Vendor auto-code sequence
  CREATE SEQUENCE IF NOT EXISTS supplier_vendor_code_seq START 1;
  -- Voucher number sequence
  CREATE SEQUENCE IF NOT EXISTS voucher_no_seq START 1;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='vendor_code') THEN
    ALTER TABLE suppliers ADD COLUMN vendor_code VARCHAR(50);
    -- Backfill existing rows
    UPDATE suppliers SET vendor_code = 'VEN-' || LPAD(nextval('supplier_vendor_code_seq')::text, 4, '0') WHERE vendor_code IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='trade_name') THEN
    ALTER TABLE suppliers ADD COLUMN trade_name VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='cin_number') THEN
    ALTER TABLE suppliers ADD COLUMN cin_number VARCHAR(21);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='pan_number') THEN
    ALTER TABLE suppliers ADD COLUMN pan_number VARCHAR(10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='msme_reg_number') THEN
    ALTER TABLE suppliers ADD COLUMN msme_reg_number VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='udyam_reg_number') THEN
    ALTER TABLE suppliers ADD COLUMN udyam_reg_number VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='pf_registration') THEN
    ALTER TABLE suppliers ADD COLUMN pf_registration VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='esic_registration') THEN
    ALTER TABLE suppliers ADD COLUMN esic_registration VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='tds_applicable') THEN
    ALTER TABLE suppliers ADD COLUMN tds_applicable BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='website') THEN
    ALTER TABLE suppliers ADD COLUMN website VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='products_services') THEN
    ALTER TABLE suppliers ADD COLUMN products_services TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='territory') THEN
    ALTER TABLE suppliers ADD COLUMN territory VARCHAR(255);
  END IF;

  -- Supplier contacts new fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='supplier_contacts' AND column_name='designation') THEN
    ALTER TABLE supplier_contacts ADD COLUMN designation VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='supplier_contacts' AND column_name='mobile') THEN
    ALTER TABLE supplier_contacts ADD COLUMN mobile VARCHAR(20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='supplier_contacts' AND column_name='alternate_contact') THEN
    ALTER TABLE supplier_contacts ADD COLUMN alternate_contact VARCHAR(20);
  END IF;

  -- Contact: website per contact
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='supplier_contacts' AND column_name='website') THEN
    ALTER TABLE supplier_contacts ADD COLUMN website VARCHAR(255);
  END IF;

  -- Bank details new field
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='supplier_bank_details' AND column_name='swift_code') THEN
    ALTER TABLE supplier_bank_details ADD COLUMN swift_code VARCHAR(20);
  END IF;

  -- Tax & Compliance text fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='gst_certificate') THEN
    ALTER TABLE suppliers ADD COLUMN gst_certificate VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='lower_deduction_cert') THEN
    ALTER TABLE suppliers ADD COLUMN lower_deduction_cert VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='msme_declaration') THEN
    ALTER TABLE suppliers ADD COLUMN msme_declaration VARCHAR(100);
  END IF;

  -- Suppliers: created_by tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='created_by') THEN
    ALTER TABLE suppliers ADD COLUMN created_by UUID REFERENCES users(id);
  END IF;

  -- Widen VARCHAR(20) columns that are too narrow for real-world data
  ALTER TABLE supplier_contacts     ALTER COLUMN mobile            TYPE VARCHAR(50);
  ALTER TABLE supplier_contacts     ALTER COLUMN alternate_contact TYPE VARCHAR(50);
  ALTER TABLE supplier_bank_details ALTER COLUMN swift_code        TYPE VARCHAR(50);
  ALTER TABLE supplier_bank_details ALTER COLUMN ifsc_code         TYPE VARCHAR(50);
  ALTER TABLE suppliers             ALTER COLUMN gstin             TYPE VARCHAR(50);

  -- Supplier approval workflow
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='approval_status') THEN
    ALTER TABLE suppliers ADD COLUMN approval_status VARCHAR(20) DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='approved_by') THEN
    ALTER TABLE suppliers ADD COLUMN approved_by UUID REFERENCES users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='last_approved_at') THEN
    ALTER TABLE suppliers ADD COLUMN last_approved_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='approval_notes') THEN
    ALTER TABLE suppliers ADD COLUMN approval_notes TEXT;
  END IF;

  -- Backfill supplier_id by name match (only while supplier_name still exists)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='supplier_name') THEN
    UPDATE vouchers v SET supplier_id = s.id
    FROM suppliers s
    WHERE LOWER(TRIM(s.supplier_name)) = LOWER(TRIM(v.supplier_name))
      AND s.is_active = true
      AND v.supplier_id IS NULL
      AND v.supplier_name IS NOT NULL;

    ALTER TABLE vouchers DROP COLUMN supplier_name;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='supplier_gstin') THEN
    ALTER TABLE vouchers DROP COLUMN supplier_gstin;
  END IF;

  -- ── 2. Status constraint update (only while column still exists) ─────
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='status') THEN
    ALTER TABLE vouchers DROP CONSTRAINT IF EXISTS vouchers_status_check;
    ALTER TABLE vouchers ADD CONSTRAINT vouchers_status_check
      CHECK (status IN ('draft','assigned','pending_approval','ready_for_bank','proceed','approved','rejected','downloaded'));
  END IF;

  -- ── 3. Add parameter FK columns ──────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='status_det_id') THEN
    ALTER TABLE vouchers ADD COLUMN status_det_id INT REFERENCES parameter_details(parameterdetid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='payment_status_det_id') THEN
    ALTER TABLE vouchers ADD COLUMN payment_status_det_id INT REFERENCES parameter_details(parameterdetid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='role_det_id') THEN
    ALTER TABLE users ADD COLUMN role_det_id INT REFERENCES parameter_details(parameterdetid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='supplier_type_det_id') THEN
    ALTER TABLE suppliers ADD COLUMN supplier_type_det_id INT REFERENCES parameter_details(parameterdetid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='purchase_type_det_id') THEN
    ALTER TABLE vouchers ADD COLUMN purchase_type_det_id INT REFERENCES parameter_details(parameterdetid);
  END IF;

  -- ── 4. Seed parameter master data (inline, idempotent) ───────────────
  -- Ensure unique constraints exist on parameter_details
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parameter_details_parameterid_code_key'
  ) THEN
    ALTER TABLE parameter_details ADD CONSTRAINT parameter_details_parameterid_code_key UNIQUE (parameterid, code);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parameter_details_parameterid_parameterno_key'
  ) THEN
    -- Remove duplicate (parameterid, parameterno) rows before adding unique constraint,
    -- keeping the row with the highest parameterdetid (most recently inserted).
    DELETE FROM parameter_details
    WHERE parameterdetid NOT IN (
      SELECT MAX(parameterdetid) FROM parameter_details GROUP BY parameterid, parameterno
    );
    ALTER TABLE parameter_details ADD CONSTRAINT parameter_details_parameterid_parameterno_key UNIQUE (parameterid, parameterno);
  END IF;

  INSERT INTO parameters (parameterid, parametertext) VALUES
    (1,'Voucher Status'),(2,'Payment Status'),(3,'User Role'),(4,'Supplier Type'),
    (5,'Products & Services'),(6,'Regions Served'),(7,'Country'),(8,'State/UT'),
    (9,'Purchase Type')
  ON CONFLICT (parametertext) DO NOTHING;

  -- Also fix old names if they were seeded with old text
  UPDATE parameters SET parametertext='Products & Services' WHERE parameterid=5 AND parametertext != 'Products & Services';
  UPDATE parameters SET parametertext='Regions Served'      WHERE parameterid=6 AND parametertext != 'Regions Served';

  -- Remove any stale voucher status rows whose codes no longer exist in the current seed.
  -- These orphan rows cause unique-code constraint violations during the upsert below.
  DELETE FROM parameter_details
  WHERE parameterid = 1
    AND code NOT IN ('draft','assigned','approved','reviewed','exported','ready_to_remit','rejected','paid');

  -- Sync sequences after manual id inserts
  PERFORM setval('parameters_parameterid_seq', (SELECT MAX(parameterid) FROM parameters));

  INSERT INTO parameter_details (parameterid, parameterno, parametervalues, code, displayorder) VALUES
    -- Voucher Status (1)
    (1,1,'Draft',           'draft',           1),
    (1,2,'Assigned',        'assigned',         2),
    (1,3,'Approved',        'approved',         3),
    (1,4,'Reviewed',        'reviewed',         4),
    (1,5,'Exported',        'exported',         5),
    (1,6,'Ready to Remit',  'ready_to_remit',   6),
    (1,7,'Rejected',        'rejected',         7),
    (1,8,'Paid',            'paid',             8),
    -- Payment Status (2)
    (2,1,'Pending Verification', 'pending_verification', 1),
    (2,2,'Unpaid',  'unpaid',   2),
    (2,3,'Paid',    'paid',     3),
    (2,4,'Partial', 'partial',  4),
    -- User Role (3)
    (3,1,'Admin',     'admin',     1),
    (3,2,'Manager',   'manager',   2),
    (3,3,'Executive', 'executive', 3),
    (3,4,'Approver',  'approver',  4),
    -- Supplier Type (4)
    (4,1,'Reseller',    'RESELLER',    1),
    (4,2,'Distributor', 'DISTRIBUTOR', 2),
    (4,3,'OEM',         'OEM',         3),
    -- Products & Services (5) — simple 2-option
    (5,1,'Product',  'PRODUCT',  1),
    (5,2,'Services', 'SERVICES', 2),
    -- Regions Served (6) — simple 2-option
    (6,1,'Territory', 'TERRITORY', 1),
    (6,2,'Region',    'REGION',    2),
    -- Purchase Type (9)
    (9,1,'Salable',     'SALABLE',     1),
    (9,2,'Consumption', 'CONSUMPTION', 2),
    -- Country (7)
    (7,1,'India', 'INDIA', 1),
    -- State/UT (8) — India states, country_code stored in code prefix
    (8, 1,'Andhra Pradesh',                          'IN_AP',  1),
    (8, 2,'Arunachal Pradesh',                       'IN_AR',  2),
    (8, 3,'Assam',                                   'IN_AS',  3),
    (8, 4,'Bihar',                                   'IN_BR',  4),
    (8, 5,'Chhattisgarh',                            'IN_CG',  5),
    (8, 6,'Goa',                                     'IN_GA',  6),
    (8, 7,'Gujarat',                                 'IN_GJ',  7),
    (8, 8,'Haryana',                                 'IN_HR',  8),
    (8, 9,'Himachal Pradesh',                        'IN_HP',  9),
    (8,10,'Jharkhand',                               'IN_JH', 10),
    (8,11,'Karnataka',                               'IN_KA', 11),
    (8,12,'Kerala',                                  'IN_KL', 12),
    (8,13,'Madhya Pradesh',                          'IN_MP', 13),
    (8,14,'Maharashtra',                             'IN_MH', 14),
    (8,15,'Manipur',                                 'IN_MN', 15),
    (8,16,'Meghalaya',                               'IN_ML', 16),
    (8,17,'Mizoram',                                 'IN_MZ', 17),
    (8,18,'Nagaland',                                'IN_NL', 18),
    (8,19,'Odisha',                                  'IN_OR', 19),
    (8,20,'Punjab',                                  'IN_PB', 20),
    (8,21,'Rajasthan',                               'IN_RJ', 21),
    (8,22,'Sikkim',                                  'IN_SK', 22),
    (8,23,'Tamil Nadu',                              'IN_TN', 23),
    (8,24,'Telangana',                               'IN_TS', 24),
    (8,25,'Tripura',                                 'IN_TR', 25),
    (8,26,'Uttar Pradesh',                           'IN_UP', 26),
    (8,27,'Uttarakhand',                             'IN_UK', 27),
    (8,28,'West Bengal',                             'IN_WB', 28),
    (8,29,'Andaman and Nicobar Islands',             'IN_AN', 29),
    (8,30,'Chandigarh',                              'IN_CH', 30),
    (8,31,'Dadra and Nagar Haveli and Daman and Diu','IN_DD', 31),
    (8,32,'Delhi',                                   'IN_DL', 32),
    (8,33,'Jammu and Kashmir',                       'IN_JK', 33),
    (8,34,'Ladakh',                                  'IN_LA', 34),
    (8,35,'Lakshadweep',                             'IN_LD', 35),
    (8,36,'Puducherry',                              'IN_PY', 36)
  ON CONFLICT (parameterid, parameterno) DO UPDATE
    SET parametervalues = EXCLUDED.parametervalues,
        code            = EXCLUDED.code,
        displayorder    = EXCLUDED.displayorder;

  -- ── 5. Backfill det_id columns from existing string values (guarded) ───
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='status') THEN
    UPDATE vouchers v
    SET status_det_id = pd.parameterdetid
    FROM parameter_details pd
    JOIN parameters p ON pd.parameterid = p.parameterid
    WHERE p.parametertext = 'Voucher Status' AND pd.code = v.status
      AND v.status_det_id IS NULL AND v.status IS NOT NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='payment_status') THEN
    UPDATE vouchers v
    SET payment_status_det_id = pd.parameterdetid
    FROM parameter_details pd
    JOIN parameters p ON pd.parameterid = p.parameterid
    WHERE p.parametertext = 'Payment Status' AND pd.code = v.payment_status
      AND v.payment_status_det_id IS NULL AND v.payment_status IS NOT NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='role') THEN
    UPDATE users u
    SET role_det_id = pd.parameterdetid
    FROM parameter_details pd
    JOIN parameters p ON pd.parameterid = p.parameterid
    WHERE p.parametertext = 'User Role' AND pd.code = u.role
      AND u.role_det_id IS NULL AND u.role IS NOT NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='supplier_type') THEN
    UPDATE suppliers s
    SET supplier_type_det_id = pd.parameterdetid
    FROM parameter_details pd
    JOIN parameters p ON pd.parameterid = p.parameterid
    WHERE p.parametertext = 'Supplier Type' AND pd.code = s.supplier_type
      AND s.supplier_type_det_id IS NULL AND s.supplier_type IS NOT NULL;
  END IF;

  -- ── 6. Drop old string columns ────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='status') THEN
    ALTER TABLE vouchers DROP COLUMN status;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='payment_status') THEN
    ALTER TABLE vouchers DROP COLUMN payment_status;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='role') THEN
    ALTER TABLE users DROP COLUMN role;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='supplier_type') THEN
    ALTER TABLE suppliers DROP COLUMN supplier_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='assigned_at') THEN
    ALTER TABLE vouchers ADD COLUMN assigned_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='balance_amount') THEN
    ALTER TABLE vouchers ADD COLUMN balance_amount NUMERIC(14,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='source_voucher_id') THEN
    ALTER TABLE vouchers ADD COLUMN source_voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL;
  END IF;

  -- ── Bills + Vouchers split migration ─────────────────────────────────
  -- Add new columns if not present
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='bill_id') THEN
    ALTER TABLE vouchers ADD COLUMN bill_id UUID REFERENCES bills(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='amount') THEN
    ALTER TABLE vouchers ADD COLUMN amount NUMERIC(14,2) DEFAULT 0;
  END IF;
  -- Drop invoice-specific columns that moved to the bills table
  -- (safe: all voucher data was deleted before running this)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='invoice_date') THEN
    ALTER TABLE vouchers DROP COLUMN invoice_date;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='taxable_amount') THEN
    ALTER TABLE vouchers DROP COLUMN taxable_amount;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='cgst') THEN
    ALTER TABLE vouchers DROP COLUMN cgst;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='sgst') THEN
    ALTER TABLE vouchers DROP COLUMN sgst;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='igst') THEN
    ALTER TABLE vouchers DROP COLUMN igst;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='tds_amount') THEN
    ALTER TABLE vouchers DROP COLUMN tds_amount;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='total_amount') THEN
    ALTER TABLE vouchers DROP COLUMN total_amount;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='bill_ref_no') THEN
    ALTER TABLE vouchers DROP COLUMN bill_ref_no;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='bill_date') THEN
    ALTER TABLE vouchers DROP COLUMN bill_date;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='tally_vch_no') THEN
    ALTER TABLE vouchers DROP COLUMN tally_vch_no;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='payment_reference') THEN
    ALTER TABLE vouchers DROP COLUMN payment_reference;
  END IF;
  -- due_days stays on vouchers (payment terms per voucher); re-add if previously dropped
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='due_days') THEN
    ALTER TABLE vouchers ADD COLUMN due_days INT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='purchase_type_det_id') THEN
    ALTER TABLE vouchers DROP COLUMN purchase_type_det_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='company_bank_id') THEN
    ALTER TABLE vouchers DROP COLUMN company_bank_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='balance_amount') THEN
    ALTER TABLE vouchers DROP COLUMN balance_amount;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='source_voucher_id') THEN
    ALTER TABLE vouchers DROP COLUMN source_voucher_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='supplier_id') THEN
    ALTER TABLE vouchers DROP COLUMN supplier_id;
  END IF;


END $$;
`;

async function initDb() {
  const client = await pool.connect();
  try {
    console.log('Creating / migrating tables…');
    await client.query(schema);

    // ── Seed admin user (using role_det_id subquery) ─────────────────────
    const existing = await client.query(
      "SELECT id FROM users WHERE email = 'payable@swansol.com'"
    );
    if (existing.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 12);
      await client.query(
        `INSERT INTO users (name, email, password_hash, role_det_id)
         VALUES ('System Admin', 'payable@swansol.com', $1,
           (SELECT pd.parameterdetid FROM parameter_details pd
            JOIN parameters p ON pd.parameterid = p.parameterid
            WHERE p.parametertext = 'User Role' AND pd.code = 'admin'
            LIMIT 1))`,
        [hash]
      );
      console.log('Seed admin created: payable@swansol.com / admin123');
    } else {
      console.log('Admin user already exists.');
    }

    console.log('Database initialised successfully.');
  } catch (err) {
    console.error('DB init error:', err);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

initDb();
