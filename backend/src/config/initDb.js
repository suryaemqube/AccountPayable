const pool = require('./db');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const schema = `

-- ── Sequences ────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS supplier_vendor_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS voucher_no_seq START 1;
CREATE SEQUENCE IF NOT EXISTS bill_no_seq START 1;

-- ── Company ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_details (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  address      TEXT,
  tel          VARCHAR(100),
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_bank_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES company_details(id) ON DELETE CASCADE,
  bank_name      VARCHAR(255),
  account_name   VARCHAR(255),
  account_number VARCHAR(50),
  ifsc_code      VARCHAR(20),
  branch_name    VARCHAR(255),
  is_primary     BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Parameter master ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parameters (
  parameterid   SERIAL PRIMARY KEY,
  parametertext VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS parameter_details (
  parameterdetid  SERIAL PRIMARY KEY,
  parameterid     INT NOT NULL REFERENCES parameters(parameterid) ON DELETE CASCADE,
  parameterno     INT,
  parametervalues VARCHAR(100) NOT NULL,
  code            VARCHAR(50),
  displayorder    INT DEFAULT 1,
  is_active       BOOLEAN DEFAULT true,
  UNIQUE (parameterid, code),
  UNIQUE (parameterid, parameterno)
);

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_det_id   INT REFERENCES parameter_details(parameterdetid),
  mobile_no     VARCHAR(20),
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Suppliers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name        VARCHAR(255) NOT NULL,
  trade_name           VARCHAR(255),
  name_for_bank        VARCHAR(255),
  vendor_code          VARCHAR(50),
  gstin                VARCHAR(50),
  cin_number           VARCHAR(21),
  pan_number           VARCHAR(10),
  udyam_reg_number     VARCHAR(50),
  pf_registration      VARCHAR(50),
  esic_registration    VARCHAR(50),
  tds_applicable       BOOLEAN DEFAULT false,
  website              VARCHAR(255),
  products_services    TEXT,
  territory            VARCHAR(255),
  supplier_type_det_id INT REFERENCES parameter_details(parameterdetid),
  owned_by             UUID REFERENCES users(id),
  created_by           UUID REFERENCES users(id),
  approval_status      VARCHAR(20) DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  approved_by          UUID REFERENCES users(id),
  last_approved_at     TIMESTAMPTZ,
  approval_notes       TEXT,
  gst_certificate      VARCHAR(100),
  lower_deduction_cert VARCHAR(100),
  is_active            BOOLEAN DEFAULT true,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_bank_details (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  bank_name           VARCHAR(255),
  account_holder_name VARCHAR(255),
  ifsc_code           VARCHAR(50),
  branch_name         VARCHAR(255),
  account_number      VARCHAR(50),
  swift_code          VARCHAR(50),
  is_primary          BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id           UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  primary_contact_name  VARCHAR(255),
  name                  VARCHAR(255),
  designation           VARCHAR(100),
  email                 VARCHAR(255),
  mobile                VARCHAR(50),
  alternate_contact     VARCHAR(50),
  website               VARCHAR(255),
  is_primary            BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_addresses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  address_type VARCHAR(20) NOT NULL CHECK (address_type IN ('registered','billing','shipping')),
  address_line TEXT,
  city         VARCHAR(100),
  state        VARCHAR(100),
  country      VARCHAR(100) DEFAULT 'India',
  pincode      VARCHAR(10),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (supplier_id, address_type)
);

CREATE TABLE IF NOT EXISTS supplier_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  document_type VARCHAR(100) NOT NULL,
  original_name VARCHAR(255),
  file_path     VARCHAR(500),
  mime_type     VARCHAR(100),
  file_size     INT,
  uploaded_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Bills ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bills (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no              VARCHAR(50),
  supplier_id          UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  invoice_date         DATE,
  bill_ref_no          VARCHAR(255),
  bill_date            DATE,
  taxable_amount       NUMERIC(14,2) DEFAULT 0,
  cgst                 NUMERIC(14,2) DEFAULT 0,
  sgst                 NUMERIC(14,2) DEFAULT 0,
  igst                 NUMERIC(14,2) DEFAULT 0,
  tds_amount           NUMERIC(14,2) DEFAULT 0,
  total_amount         NUMERIC(14,2) DEFAULT 0,
  narration            TEXT,
  payment_mode         VARCHAR(10) DEFAULT 'NEFT',
  payment_reference    VARCHAR(255),
  tally_vch_no         VARCHAR(100),
  due_days             INT,
  purchase_type_det_id INT REFERENCES parameter_details(parameterdetid),
  company_bank_id      UUID REFERENCES company_bank_accounts(id),
  bill_status          VARCHAR(30) DEFAULT 'open' CHECK (bill_status IN ('open','partially_paid','fully_paid')),
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── Vouchers ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vouchers (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id                UUID REFERENCES bills(id) ON DELETE SET NULL,
  voucher_no             VARCHAR(50),
  amount                 NUMERIC(14,2) DEFAULT 0,
  narration              TEXT,
  payment_mode           VARCHAR(10),
  supplier_bank_id       UUID REFERENCES supplier_bank_details(id) ON DELETE SET NULL,
  due_days               INT,
  utr_no                 VARCHAR(100),
  voucher_pdf_path       VARCHAR(255),
  assigned_to            UUID REFERENCES users(id),
  assigned_at            TIMESTAMPTZ,
  created_by             UUID REFERENCES users(id),
  rejected_reason        TEXT,
  status_det_id          INT REFERENCES parameter_details(parameterdetid),
  payment_status_det_id  INT REFERENCES parameter_details(parameterdetid),
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voucher_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id),
  comment    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voucher_activity_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id    UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id),
  activity_type VARCHAR(50) NOT NULL,
  description   TEXT NOT NULL,
  meta          JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voucher_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id    UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  file_path     VARCHAR(500) NOT NULL,
  original_name VARCHAR(255),
  mime_type     VARCHAR(100),
  file_size     INT,
  uploaded_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bill_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id       UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  file_path     VARCHAR(500) NOT NULL,
  original_name VARCHAR(255),
  mime_type     VARCHAR(100),
  file_size     INT,
  uploaded_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Audit ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50),
  entity_id   UUID,
  action      VARCHAR(50),
  old_values  JSONB,
  new_values  JSONB,
  user_id     UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Notifications (admin/approver bell) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(50) NOT NULL,
  message     TEXT NOT NULL,
  entity_type VARCHAR(30),
  entity_id   UUID,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at          TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);

-- ── Password reset ────────────────────────────────────────────────────────────
-- token_hash stores SHA-256 of the raw token — the raw token only ever exists in
-- the emailed link, never in the database, so a DB leak alone can't be used to
-- reset accounts.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

-- ── Migrations for existing tables ───────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='payment_mode') THEN
    ALTER TABLE vouchers ADD COLUMN payment_mode VARCHAR(10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vouchers' AND column_name='paid_at') THEN
    ALTER TABLE vouchers ADD COLUMN paid_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='name_for_bank') THEN
    ALTER TABLE suppliers ADD COLUMN name_for_bank VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bills' AND column_name='payment_mode') THEN
    ALTER TABLE bills ADD COLUMN payment_mode VARCHAR(10) DEFAULT 'NEFT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bills' AND column_name='salespro_act_id') THEN
    ALTER TABLE bills ADD COLUMN salespro_act_id VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bills' AND column_name='salespro_act_name') THEN
    ALTER TABLE bills ADD COLUMN salespro_act_name VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bills' AND column_name='credit_note_amount') THEN
    ALTER TABLE bills ADD COLUMN credit_note_amount NUMERIC(14,2) DEFAULT 0;
  END IF;
END $$;

-- ── Seed parameter master data ────────────────────────────────────────────────
DO $$ BEGIN

  INSERT INTO parameters (parameterid, parametertext) VALUES
    (1,'Voucher Status'),(2,'Payment Status'),(3,'User Role'),(4,'Supplier Type'),
    (5,'Products & Services'),(6,'Regions Served'),(7,'Country'),(8,'State/UT'),
    (9,'Purchase Type')
  ON CONFLICT (parametertext) DO NOTHING;

  PERFORM setval('parameters_parameterid_seq', (SELECT MAX(parameterid) FROM parameters));

  INSERT INTO parameter_details (parameterid, parameterno, parametervalues, code, displayorder) VALUES
    -- Voucher Status (1)
    (1,1,'Draft',          'draft',          1),
    (1,2,'Assigned',       'assigned',       2),
    (1,3,'Approved',       'approved',       3),
    (1,4,'Reviewed',       'reviewed',       4),
    (1,5,'Exported',       'exported',       5),
    (1,6,'Ready to Remit', 'ready_to_remit', 6),
    (1,7,'Rejected',       'rejected',       7),
    (1,8,'Paid',           'paid',           8),
    -- Payment Status (2)
    (2,1,'Pending Verification','pending_verification',1),
    (2,2,'Unpaid',  'unpaid',  2),
    (2,3,'Paid',    'paid',    3),
    (2,4,'Partial', 'partial', 4),
    -- User Role (3)
    (3,1,'Admin',     'admin',     1),
    (3,2,'Manager',   'manager',   2),
    (3,3,'Executive', 'executive', 3),
    (3,4,'Approver',  'approver',  4),
    -- Supplier Type (4)
    (4,1,'Reseller',    'RESELLER',    1),
    (4,2,'Distributor', 'DISTRIBUTOR', 2),
    (4,3,'OEM',         'OEM',         3),
    (4,4,'Other',       'OTHER',       4),
    -- Products & Services (5)
    (5,1,'Product',  'PRODUCT',  1),
    (5,2,'Services', 'SERVICES', 2),
    -- Regions Served (6)
    (6,1,'Territory', 'TERRITORY', 1),
    (6,2,'Region',    'REGION',    2),
    -- Country (7)
    (7,1,'India','INDIA',1),
    -- State/UT (8)
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
    (8,36,'Puducherry',                              'IN_PY', 36),
    -- Purchase Type (9)
    (9,1,'Sale',           'SALE',          1),
    (9,2,'Consume',        'CONSUME',       2),
    (9,3,'Project',        'PROJECT',       3),
    (9,4,'Sale - Multiple','SALE_MULTIPLE', 4)
  ON CONFLICT (parameterid, parameterno) DO UPDATE
    SET parametervalues = EXCLUDED.parametervalues,
        code            = EXCLUDED.code,
        displayorder    = EXCLUDED.displayorder;

END $$;
`;

async function initDb() {
  const client = await pool.connect();
  try {
    console.log('Creating tables…');
    await client.query(schema);

    // Seed admin user
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
