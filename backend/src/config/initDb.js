const pool = require('./db');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const schema = `
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

CREATE TABLE IF NOT EXISTS vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_path VARCHAR(500),
  invoice_original_name VARCHAR(255),
  invoice_no VARCHAR(100),
  supplier_name VARCHAR(255),
  supplier_gstin VARCHAR(20),
  invoice_date DATE,
  due_date DATE,
  payment_terms VARCHAR(100),
  taxable_amount NUMERIC(14,2) DEFAULT 0,
  cgst NUMERIC(14,2) DEFAULT 0,
  sgst NUMERIC(14,2) DEFAULT 0,
  igst NUMERIC(14,2) DEFAULT 0,
  total_amount NUMERIC(14,2) DEFAULT 0,
  narration TEXT,
  payment_status VARCHAR(30) DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','partial')),
  payment_reference VARCHAR(255),
  status VARCHAR(30) DEFAULT 'draft' CHECK (status IN ('draft','assigned','pending_approval','approved','rejected','downloaded')),
  assigned_to UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  manager_comment TEXT,
  admin_final_comment TEXT,
  rejected_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voucher_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  description VARCHAR(500),
  hsn_code VARCHAR(50),
  qty NUMERIC(10,3) DEFAULT 1,
  rate NUMERIC(14,2) DEFAULT 0,
  taxable_amount NUMERIC(14,2) DEFAULT 0,
  cgst_rate NUMERIC(5,2) DEFAULT 0,
  cgst_amount NUMERIC(14,2) DEFAULT 0,
  sgst_rate NUMERIC(5,2) DEFAULT 0,
  sgst_amount NUMERIC(14,2) DEFAULT 0,
  igst_rate NUMERIC(5,2) DEFAULT 0,
  igst_amount NUMERIC(14,2) DEFAULT 0,
  total NUMERIC(14,2) DEFAULT 0,
  sort_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS voucher_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
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
`;

async function initDb() {
  const client = await pool.connect();
  try {
    console.log('Creating tables...');
    await client.query(schema);

    const existing = await client.query(
      "SELECT id FROM users WHERE email = 'payable@swansol.com'"
    );
    if (existing.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 12);
      await client.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ('System Admin', 'payable@swansol.com', $1, 'admin')`,
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
