# AccountPayable — Deployment Guide (Ubuntu server)

AccountPayable is deployed on `swn-appsrv2` (same box as Swan Compliance) with a separated frontend and backend:

| Component | Tech | Build output | Runs as | Port |
|---|---|---|---|---|
| Frontend | React 18 + Vite 5 | `frontend/dist/` (static files) | Served by Nginx | N/A |
| Backend | Express.js + PostgreSQL | `backend/src/` (Node.js) | PM2 process `ap-backend` | 5002 |

## Architecture

```
Browser → Nginx :80/443 (payable.swansol.net)
    ├─ "/" → serves built static files (frontend/dist)
    └─ "/api/*" → proxy_pass to 127.0.0.1:5002 (PM2: ap-backend)
        └─ PostgreSQL db "Account_payable" (localhost)
```

## Server Prerequisites

Ensure the following are installed and running on `swn-appsrv2`:
- Node.js 20+
- PostgreSQL 15+
- Nginx
- PM2 (globally)
- **System Chromium** (`sudo apt install chromium-browser`) — needed for PDF/voucher generation via puppeteer-core
- **Tesseract OCR libraries** (included with system Chromium in most distros)

---

## Local Build (on Windows PC)

### 1. Prepare your local environment

```powershell
# Ensure Node 20+ is active
node -v
# If using nvm-windows, switch to a 20+ version:
nvm use 24.19.0

# Navigate to the project
cd D:\NodeJs\Swan\AccountPayable
```

### 2. Build the frontend

```powershell
cd frontend

# Update dependencies
npm ci

# Build static files — outputs to frontend/dist/
npm run build
```

**Important:** Vite bakes the API URL into the bundle at build time. The frontend must know where to find the API. Check your `frontend/.env` or `vite.config.js` to confirm the proxy/API base URL is correct before building. For production:

```javascript
// In your frontend API client (e.g., src/api.js or similar)
const API_BASE_URL = 'https://paypro.swansol.net/api';
// NOT 'http://localhost:5002/api'
```

### 3. Build the backend

The backend doesn't need a build step — it runs directly from `src/index.js`. Ensure dependencies are installed:

```powershell
cd ..\backend
npm ci
```

### 4. Create release tarballs

```powershell
cd ..\

# Create a release folder
mkdir release -Force

# Backend: include src/, node_modules (or let server do npm ci), and config
tar -czf release\ap-backend.tar.gz -C backend src package.json package-lock.json

# Frontend: just the built dist/
tar -czf release\ap-frontend.tar.gz -C frontend\dist .
```

---

## Deploy to Server

### 1. Upload the tarballs

```powershell
# From Windows PC, upload to server's /tmp/
scp D:\NodeJs\Swan\AccountPayable\release\*.tar.gz swn-appsrv2@<server-ip>:/tmp/
```

### 2. On the server: Set up database and role

```bash
# Create a dedicated PostgreSQL role and database
sudo -u postgres psql -c "CREATE ROLE ap_app WITH LOGIN PASSWORD '<secure-password>';"
sudo -u postgres psql -c 'CREATE DATABASE "Account_payable" OWNER ap_app;'

# Verify
psql -h localhost -U ap_app -d Account_payable -c "\dt"
```

If you have an existing backup to restore (e.g., `backup.sql` or a custom-format dump):

```bash
# For plain SQL dumps:
psql -h localhost -U ap_app -d Account_payable -v ON_ERROR_STOP=1 < /path/to/backup.sql

# For pg_dump custom format:
pg_restore -h localhost -U ap_app -d Account_payable \
  --no-owner --role=ap_app -v /path/to/backup.dump
```

### 3. On the server: Extract and configure backend

```bash
sudo mkdir -p /var/www/accountpayable
sudo chown $USER:$USER /var/www/accountpayable
cd /var/www/accountpayable

# Extract
tar -xzf /tmp/ap-backend.tar.gz
cd backend

# Install production dependencies
npm ci --omit=dev
```

### 4. Create backend `.env` (production)

Edit `/var/www/accountpayable/backend/.env` with production values:

```bash
NODE_ENV=production
PORT=5002

# Database connection
DATABASE_URL=postgresql://ap_app:<password>@localhost:5432/Account_payable

# Security
JWT_SECRET=$(openssl rand -hex 32)  # Generate a random secret

# API configuration
FRONTEND_URL=http://192.168.0.93              # Or actual domain once SSL is live
SALESPRO_API_URL=https://salespro.swansol.net/api/

# Chromium path (Linux — system Chromium, not Windows Edge path)
CHROME_PATH=/usr/bin/chromium-browser

# Email (if enabling notifications)
MAIL_HOST=smtp.office365.com
MAIL_PORT=587
MAIL_USER=<your-email>
MAIL_PASS=<app-password>
MAIL_FROM="PayPro <your-email>"

# Anthropic API
ANTHROPIC_API_KEY=<your-key-if-needed>

# Reminders
DUE_REMINDER_ENABLED=true
DEV_MAIL=<admin-email>
```

**Rules:**
- No quotes around values unless the value itself contains spaces
- URL-encode special characters in the database password: `@` → `%40`, `#` → `%23`, `:` → `%3A`
- Use Unix line endings (the server will reject Windows CRLF)
- `CHROME_PATH` must point to the Linux system Chromium, not Windows Edge

### 5. Extract frontend and place it

```bash
# Create the frontend directory
sudo mkdir -p /var/www/accountpayable/frontend
sudo chown $USER:$USER /var/www/accountpayable/frontend

# Extract the built dist/ into it
tar -xzf /tmp/ap-frontend.tar.gz -C /var/www/accountpayable/frontend
```

### 6. Register backend with PM2

```bash
cd /var/www/accountpayable/backend
pm2 start src/index.js --name ap-backend
pm2 save
```

Verify it started:

```bash
pm2 list
pm2 logs ap-backend --lines 20
```

### 7. Configure Nginx

Create `/etc/nginx/sites-available/accountpayable`:

```bash
sudo tee /etc/nginx/sites-available/accountpayable > /dev/null <<'EOF'
server {
    listen 80;
    server_name paypro.swansol.net;    # Your subdomain

    client_max_body_size 15M;           # Multer upload limit

    root /var/www/accountpayable/frontend;
    index index.html;

    # Proxy API requests to the backend
    location /api/ {
        proxy_pass http://127.0.0.1:5002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Serve frontend static files; fallback to index.html for SPA routing
    location / {
        try_files $uri /index.html;
    }
}
EOF
```

Enable it:

```bash
sudo ln -sf /etc/nginx/sites-available/accountpayable /etc/nginx/sites-enabled/accountpayable
sudo nginx -t
sudo systemctl reload nginx
```

### 8. Set up SSL with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d paypro.swansol.net
```

Answer the prompts (agree to ToS, choose to redirect HTTP → HTTPS). Certbot will auto-renew via systemd timer.

### 9. Verify everything works

```bash
# Check backend is running
pm2 status
pm2 logs ap-backend --lines 10

# Check database connectivity
psql -h localhost -U ap_app -d Account_payable -c "SELECT NOW();"

# Test the site
curl -I https://paypro.swansol.net/          # Should return 200
curl -I https://paypro.swansol.net/api/health  # Check your health endpoint
```

Then open in a browser: **https://paypro.swansol.net**

---

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `502 Bad Gateway` on `/api/...` | Backend not running. `pm2 list`, `pm2 logs ap-backend`, `sudo ss -ltnp \| grep 5002`. |
| Frontend shows `Cannot GET /` | Nginx root path wrong, or dist folder is empty. Check `ls -la /var/www/accountpayable/frontend`. |
| `PDF generation fails` / `puppeteer error` | System Chromium not installed. `sudo apt install chromium-browser`. Or `CHROME_PATH` env var points to wrong location. |
| Emails not sending | Check `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS` in `.env`. Test with `telnet smtp.office365.com 587` (should connect). |
| `EADDRINUSE: address already in use :::5002` | Port 5002 held by a stray process. `sudo lsof -i :5002`, `kill -9 <PID>`, then `pm2 restart ap-backend`. |
| Login fails silently | Frontend built with wrong API URL (hardcoded to `localhost:5002` instead of production domain like `https://paypro.swansol.net/api`). Rebuild with correct `VITE_API_URL` and redeploy. |
| After reboot, backend doesn't restart | `pm2 startup` wasn't run, or `pm2 save` was forgotten after `pm2 start`. Run both, then `sudo reboot` to test. |

---

## Routine Releases (Code updates)

1. **Local build:** Pull latest, `npm ci`, build frontend, package both
2. **Upload:** `scp *.tar.gz` to `/tmp/`
3. **Backend update:**
   ```bash
   cd /var/www/accountpayable/backend
   rm -rf dist node_modules
   tar -xzf /tmp/ap-backend.tar.gz -C /var/www/accountpayable/backend
   npm ci --omit=dev
   pm2 restart ap-backend
   ```
4. **Frontend update:**
   ```bash
   rm -rf /var/www/accountpayable/frontend/*
   tar -xzf /tmp/ap-frontend.tar.gz -C /var/www/accountpayable/frontend
   # No restart needed — nginx serves static files
   ```
5. **Verify:** `pm2 logs ap-backend`, then test in browser

---

## Database Backups

Set up a nightly `pg_dump` (optional but recommended):

```bash
mkdir -p ~/backups

# Add to crontab (crontab -e):
0 2 * * * pg_dump -h localhost -U ap_app -Fc Account_payable \
  > ~/backups/account_payable_$(date +\%F).dump 2>> ~/backups/pg_dump.log

# Create ~/.pgpass to avoid password prompt:
echo "localhost:5432:Account_payable:ap_app:<password>" >> ~/.pgpass
chmod 600 ~/.pgpass
```

---

## Important Notes

- **Frontend built on Windows, deployed on Linux:** The frontend is built as static HTML/JS/CSS once and never rebuilt on the server — it's safe to build on Windows and deploy to Linux.
- **Backend Node.js:** Must have Node.js 20+ on both your local PC (for checking during dev) and the server (for running under PM2).
- **System Chromium on Linux:** Unlike your Windows `.env` with `CHROME_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, the server needs the system Chromium. Set `CHROME_PATH=/usr/bin/chromium-browser` in the server `.env`.
- **Both apps on same server:** Compliance and AccountPayable both run on `swn-appsrv2`, sharing the same Nginx reverse proxy and PostgreSQL instance (different databases, different roles).

---

## Checklist for First Deploy

- [ ] Node.js 20+ on PC and server
- [ ] PostgreSQL role `ap_app` and database `Account_payable` created
- [ ] System Chromium installed on server (`sudo apt install chromium-browser`)
- [ ] Frontend built with correct API URL baked in (`VITE_API_URL` or hardcoded to production domain)
- [ ] Backend tarballs uploaded to server `/tmp/`
- [ ] Backend `.env` created in `/var/www/accountpayable/backend/.env` with all required vars
- [ ] Backend installed, PM2 process started and saved
- [ ] Frontend extracted to `/var/www/accountpayable/frontend`
- [ ] Nginx site file created, tested, and enabled
- [ ] SSL certificate issued (Let's Encrypt)
- [ ] Backend log shows no errors: `pm2 logs ap-backend`
- [ ] Login and basic functionality tested at https://payable.swansol.net
- [ ] Reboot test: `sudo reboot`, then verify both apps come back and work

---

Generated based on proven deployment patterns from TenderPro and Swan Compliance. Adapt server addresses, domains, and credentials to your actual environment.
