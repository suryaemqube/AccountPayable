# AP Management System

Full-stack Accounts Payable application.
**Stack:** React + Vite · Node.js + Express · PostgreSQL · Claude AI (OCR)

---

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Anthropic API key

---

## Setup

### 1. Database

```bash
# Create the database
psql -U postgres -c "CREATE DATABASE ap_system;"
```

### 2. Backend

```bash
cd backend
npm install

# Copy and fill in your values
cp .env.example .env
# Edit .env:
#   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/ap_system
#   JWT_SECRET=any_long_random_string
#   ANTHROPIC_API_KEY=sk-ant-...

# Create tables + seed admin user
npm run db:init

# Start server
npm run dev
```

Backend runs at **http://localhost:5000**
Default admin: `payable@swansol.com` / `admin123`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at **http://localhost:5173**

---

## Usage

### Admin workflow
1. Log in as admin
2. **Managers** → Add manager accounts
3. **Upload Invoice** → Upload image or PDF → Claude AI scans it
4. Review and edit the auto-filled voucher fields
5. Set payment status (Unpaid / Paid / Partial)
6. Add comments
7. **Assign** voucher to a manager
8. After manager approves → **Final Approve** the voucher
9. **Download PDF** voucher

### Manager workflow
1. Log in as manager
2. See your queue of assigned vouchers
3. View voucher details + original invoice
4. **Approve** (sends for admin final approval) or **Reject** with reason

---

## API Reference

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | /api/auth/login | Public | Login |
| GET | /api/auth/me | Any | Current user |
| GET | /api/managers | Admin | List managers |
| POST | /api/managers | Admin | Create manager |
| PUT | /api/managers/:id | Admin | Update manager |
| DELETE | /api/managers/:id | Admin | Deactivate manager |
| POST | /api/vouchers/upload | Admin | Upload invoice + OCR scan |
| GET | /api/vouchers | Any | List vouchers |
| GET | /api/vouchers/:id | Any | Get voucher detail |
| PUT | /api/vouchers/:id | Admin | Update voucher fields |
| POST | /api/vouchers/:id/assign | Admin | Assign to manager |
| POST | /api/vouchers/:id/manager-action | Manager | Approve or reject |
| POST | /api/vouchers/:id/final-approval | Admin | Final approve or reject |
| POST | /api/vouchers/:id/comments | Any | Add comment |
| GET | /api/vouchers/:id/download | Any | Download PDF (approved only) |
| GET | /api/vouchers/:id/invoice | Any | View original invoice file |

---

## Voucher status flow

```
DRAFT → ASSIGNED → PENDING_APPROVAL → APPROVED → DOWNLOADED
                         ↓                  ↓
                      REJECTED           REJECTED
```

---

## Project structure

```
ap-system/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js           PostgreSQL pool
│   │   │   └── initDb.js       Schema + seed
│   │   ├── middleware/
│   │   │   ├── auth.js         JWT auth + role guard
│   │   │   └── upload.js       Multer file upload
│   │   ├── controllers/
│   │   │   ├── auth.js         Login, me
│   │   │   ├── vouchers.js     Full voucher lifecycle
│   │   │   └── managers.js     Manager CRUD
│   │   ├── routes/
│   │   │   └── index.js        All routes
│   │   └── utils/
│   │       ├── claudeOcr.js    Invoice extraction via Claude API
│   │       └── pdfGenerator.js Voucher PDF via Puppeteer
│   └── uploads/                Invoice files stored here
└── frontend/
    └── src/
        ├── api/client.js       Axios instance
        ├── context/            Auth context + provider
        ├── pages/
        │   ├── Login.jsx
        │   ├── AdminDashboard.jsx
        │   ├── ManagerDashboard.jsx
        │   ├── UploadInvoice.jsx
        │   ├── VoucherDetail.jsx
        │   └── ManageManagers.jsx
        └── components/
            ├── Layout.jsx      Sidebar navigation
            └── Helpers.jsx     Badges, formatters
```
