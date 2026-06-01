const express = require('express');
const { auth, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const authCtrl = require('../controllers/auth');
const voucherCtrl = require('../controllers/vouchers');
const managerCtrl = require('../controllers/managers');

const router = express.Router();

// Auth
router.post('/auth/login', authCtrl.login);
router.get('/auth/me', auth, authCtrl.me);

// Managers (admin only)
router.get('/managers', auth, requireRole('admin'), managerCtrl.listManagers);
router.post('/managers', auth, requireRole('admin'), managerCtrl.createManager);
router.put('/managers/:id', auth, requireRole('admin'), managerCtrl.updateManager);
router.delete('/managers/:id', auth, requireRole('admin'), managerCtrl.deleteManager);

// Vouchers
router.post('/vouchers/upload', auth, requireRole('admin'), upload.single('invoice'), voucherCtrl.uploadAndScan);
router.get('/vouchers', auth, voucherCtrl.listVouchers);
router.get('/vouchers/:id', auth, voucherCtrl.getVoucher);
router.put('/vouchers/:id', auth, requireRole('admin'), voucherCtrl.updateVoucher);
router.post('/vouchers/:id/assign', auth, requireRole('admin'), voucherCtrl.assignVoucher);
router.post('/vouchers/:id/manager-action', auth, requireRole('manager'), voucherCtrl.managerAction);
router.post('/vouchers/:id/final-approval', auth, requireRole('admin'), voucherCtrl.adminFinalApproval);
router.post('/vouchers/:id/comments', auth, voucherCtrl.addComment);
router.post('/vouchers/:id/generate', auth, requireRole('admin'), voucherCtrl.generateVoucher);
router.get('/vouchers/:id/download', auth, voucherCtrl.downloadVoucher);
router.get('/vouchers/:id/invoice', auth, voucherCtrl.getInvoiceFile);

module.exports = router;
