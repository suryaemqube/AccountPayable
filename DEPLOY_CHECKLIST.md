# AccountPayable Deployment Checklist

## Phase 1: Local PC Build (Windows)

- [ ] **Node version check**
  ```powershell
  node -v  # Must be 20 or higher
  nvm use 24.19.0  # If using nvm-windows
  ```

- [ ] **Navigate to project**
  ```powershell
  cd D:\NodeJs\Swan\AccountPayable
  git pull origin main
  ```

- [ ] **Build Frontend**
  ```powershell
  cd frontend
  npm ci
  npm run build
  cd ..
  ```

- [ ] **Verify Frontend API URL**
  - Check `frontend/src/` for where API calls are made
  - Ensure it points to production: `https://paypro.swansol.net/api`
  - NOT `http://localhost:5002/api`

- [ ] **Backend dependencies ready**
  ```powershell
  cd backend
  npm ci
  cd ..
  ```

- [ ] **Create release tarballs**
  ```powershell
  mkdir release -Force
  tar -czf release\ap-backend.tar.gz -C backend src package.json package-lock.json
  tar -czf release\ap-frontend.tar.gz -C frontend\dist .
  ```

- [ ] **Verify tarballs created**
  ```powershell
  ls -la release\
  # Should show: ap-backend.tar.gz and ap-frontend.tar.gz
  ```

---

## Phase 2: Upload to Server

- [ ] **Upload tarballs**
  ```powershell
  scp D:\NodeJs\Swan\AccountPayable\release\*.tar.gz swn-appsrv2@<SERVER_IP>:/tmp/
  ```

- [ ] **Verify upload**
  ```bash
  # On server:
  ls -la /tmp/ap-*.tar.gz
  ```

---

## Phase 3: Server Setup (SSH into swn-appsrv2)

### Database Setup

- [ ] **Create PostgreSQL role**
  ```bash
  sudo -u postgres psql -c "CREATE ROLE ap_app WITH LOGIN PASSWORD '<secure-password>';"
  ```

- [ ] **Create database**
  ```bash
  sudo -u postgres psql -c 'CREATE DATABASE "Account_payable" OWNER ap_app;'
  ```

- [ ] **Verify database**
  ```bash
  psql -h localhost -U ap_app -d Account_payable -c "\dt"
  ```

- [ ] **Restore backup (if available)**
  ```bash
  # If you have a database backup:
  pg_restore -h localhost -U ap_app -d Account_payable \
    --no-owner --role=ap_app -v /path/to/backup.dump
  ```

### Backend Setup

- [ ] **Create directories**
  ```bash
  sudo mkdir -p /var/www/accountpayable/frontend
  sudo chown $USER:$USER /var/www/accountpayable
  cd /var/www/accountpayable
  ```

- [ ] **Extract backend**
  ```bash
  tar -xzf /tmp/ap-backend.tar.gz
  cd backend
  npm ci --omit=dev
  ```

- [ ] **Create `.env` file**
  ```bash
  # Create /var/www/accountpayable/backend/.env with production values:
  # Copy template below and edit with actual credentials
  ```

  **Template** (save as `.env`):
  ```
  NODE_ENV=production
  PORT=5002
  DATABASE_URL=postgresql://ap_app:<PASSWORD>@localhost:5432/Account_payable
  JWT_SECRET=<generate-with-openssl-rand-hex-32>
  FRONTEND_URL=http://192.168.0.93
  SALESPRO_API_URL=https://salespro.swansol.net/api/
  CHROME_PATH=/usr/bin/chromium-browser
  MAIL_HOST=smtp.office365.com
  MAIL_PORT=587
  MAIL_USER=<email>
  MAIL_PASS=<app-password>
  MAIL_FROM="PayPro <email>"
  ANTHROPIC_API_KEY=<key-if-needed>
  DUE_REMINDER_ENABLED=true
  DEV_MAIL=<admin-email>
  ```

- [ ] **Register with PM2**
  ```bash
  cd /var/www/accountpayable/backend
  pm2 start src/index.js --name ap-backend
  pm2 save
  ```

- [ ] **Verify backend is running**
  ```bash
  pm2 list
  pm2 logs ap-backend --lines 20
  ```

### Frontend Setup

- [ ] **Extract frontend**
  ```bash
  cd /var/www/accountpayable
  tar -xzf /tmp/ap-frontend.tar.gz -C frontend
  ```

- [ ] **Verify files are there**
  ```bash
  ls -la frontend/
  # Should show index.html, assets/, etc.
  ```

### Nginx Configuration

- [ ] **Create nginx site file**
  ```bash
  sudo tee /etc/nginx/sites-available/accountpayable > /dev/null <<'EOF'
  server {
      listen 80;
      server_name paypro.swansol.net;
  
      client_max_body_size 15M;
  
      root /var/www/accountpayable/frontend;
      index index.html;
  
      location /api/ {
          proxy_pass http://127.0.0.1:5002;
          proxy_http_version 1.1;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
      }
  
      location / {
          try_files $uri /index.html;
      }
  }
  EOF
  ```

- [ ] **Enable site**
  ```bash
  sudo ln -sf /etc/nginx/sites-available/accountpayable /etc/nginx/sites-enabled/accountpayable
  sudo nginx -t
  sudo systemctl reload nginx
  ```

### SSL Certificate

- [ ] **Install Certbot (if not already done)**
  ```bash
  sudo apt install -y certbot python3-certbot-nginx
  ```

- [ ] **Issue certificate**
  ```bash
  sudo certbot --nginx -d paypro.swansol.net
  # Accept terms, provide email, choose to redirect HTTP → HTTPS
  ```

- [ ] **Verify auto-renewal**
  ```bash
  sudo systemctl list-timers | grep certbot
  ```

---

## Phase 4: Verification

- [ ] **Backend health**
  ```bash
  pm2 status
  pm2 logs ap-backend --lines 10
  # No errors should appear
  ```

- [ ] **Database connectivity**
  ```bash
  psql -h localhost -U ap_app -d Account_payable -c "SELECT NOW();"
  # Should return current timestamp
  ```

- [ ] **Nginx working**
  ```bash
  curl -I https://paypro.swansol.net/
  # Should return 200 OK
  ```

- [ ] **Frontend loads in browser**
  ```
  https://paypro.swansol.net
  # Should load login page
  ```

- [ ] **API accessible**
  ```bash
  curl https://paypro.swansol.net/api/health
  # Should return appropriate response
  ```

- [ ] **Test login**
  - Navigate to https://paypro.swansol.net
  - Enter valid credentials
  - Confirm you can log in and see the dashboard

- [ ] **Reboot test (to verify PM2 auto-start)**
  ```bash
  sudo reboot
  # Wait for server to come back up (2-3 minutes)
  # Verify backend is running: pm2 status
  # Verify frontend loads: https://paypro.swansol.net
  ```

---

## Phase 5: Post-Deployment

- [ ] **Clean up upload files**
  ```bash
  rm /tmp/ap-*.tar.gz
  ```

- [ ] **Set up database backups (optional but recommended)**
  ```bash
  mkdir -p ~/backups
  # Add crontab entry (crontab -e):
  # 0 2 * * * pg_dump -h localhost -U ap_app -Fc Account_payable \
  #   > ~/backups/account_payable_$(date +\%F).dump 2>> ~/backups/pg_dump.log
  ```

- [ ] **Document credentials securely**
  - Save JWT_SECRET, Database password, and other secrets to your password manager
  - Update deployment runbook with any custom values (domain, ports, etc.)

- [ ] **Notify team**
  - Share deployment completion
  - Provide access URL: https://paypro.swansol.net
  - Share any temporary credentials if needed

---

## Troubleshooting Quick Fixes

**Backend not starting:**
```bash
pm2 logs ap-backend
# Read error message, fix in .env or src/index.js
pm2 restart ap-backend
```

**"502 Bad Gateway" on API calls:**
```bash
sudo ss -ltnp | grep 5002
# Backend should be listening on 5002. If not:
pm2 restart ap-backend
```

**Port 5002 already in use:**
```bash
sudo lsof -i :5002
kill -9 <PID>
pm2 restart ap-backend
```

**Chromium not found (PDF fails):**
```bash
sudo apt install chromium-browser
# Update CHROME_PATH in backend/.env if needed
pm2 restart ap-backend
```

**Frontend shows "Cannot GET /":**
```bash
ls -la /var/www/accountpayable/frontend/
# Should have index.html and assets/. If not, re-extract from tarball
```

**Email not sending:**
```bash
# Test SMTP connectivity:
telnet smtp.office365.com 587
# Should connect. If not, check firewall/network egress
```

---

## Quick Command Reference

```bash
# Monitor backend logs
pm2 logs ap-backend --follow

# Restart backend after .env changes
pm2 restart ap-backend

# Check what PM2 processes are running
pm2 list

# Save PM2 config (run after any pm2 start/restart)
pm2 save

# Check if port 5002 is in use
sudo ss -ltnp | grep 5002

# Reload nginx after config changes
sudo nginx -t && sudo systemctl reload nginx

# Check SSL certificate expiry
sudo certbot certificates

# View nginx error log
sudo tail -f /var/log/nginx/error.log

# SSH into server
ssh swn-appsrv2@<SERVER_IP>
```

---

**Last updated:** 2026-10-05  
**Environment:** Ubuntu 24.04.4 LTS on swn-appsrv2  
**Stack:** Node.js 24, PostgreSQL 18.6, Nginx, PM2
