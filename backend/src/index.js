require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');
const { startDueDateReminderJob } = require('./utils/dueDateReminder');

// Safety net: a single failed request (e.g. a PDF-generation crash) must never
// take down the whole API for every other user. Log it and keep serving.
process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED REJECTION]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: true,
  // (origin, cb) => {
  //  if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
  //  cb(new Error(`CORS blocked: ${origin}`));
  // },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', routes);

// Catch multer/upload errors (fileFilter rejections, size limit, etc.)
app.use((err, req, res, next) => {
  console.error('[UPLOAD ERROR]', err.message);
  res.status(400).json({ error: err.message });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 5002;
app.listen(PORT, () => {
  console.log(`AP System API running on port ${PORT}`);
  startDueDateReminderJob();
});
