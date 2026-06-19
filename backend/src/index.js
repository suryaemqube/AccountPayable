require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');
const { startDueDateReminderJob } = require('./utils/dueDateReminder');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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
