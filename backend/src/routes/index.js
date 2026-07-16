const express = require('express');
const { auth, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { uploadXl } = require('../middleware/upload');
const authCtrl = require('../controllers/auth');
const voucherCtrl = require('../controllers/vouchers');
const managerCtrl = require('../controllers/managers');
const supplierCtrl = require('../controllers/suppliers');
const companyCtrl = require('../controllers/company');
const xlImportCtrl       = require('../controllers/xlImport');
const bankImportCtrl     = require('../controllers/bankImport');
const supplierImportCtrl = require('../controllers/supplierImport');
const salesproProxy = require('../controllers/salesproProxy');
const paramCtrl          = require('../controllers/parameters');
const billCtrl           = require('../controllers/bills');
const notificationCtrl   = require('../controllers/notifications');
const { sendDueReminders } = require('../utils/dueDateReminder');

const router = express.Router();

// Auth
router.post('/auth/login', authCtrl.login);
router.get('/auth/me', auth, authCtrl.me);
router.post('/auth/change-password', auth, authCtrl.changePassword);
router.post('/auth/forgot-password', authCtrl.forgotPassword);
router.post('/auth/reset-password', authCtrl.resetPassword);

// Managers list — admin + executive (executive needs it to assign vouchers)
router.get('/managers', auth, requireRole('admin', 'executive'), managerCtrl.listManagers);
router.post('/managers', auth, requireRole('admin'), managerCtrl.createManager);
router.put('/managers/:id', auth, requireRole('admin'), managerCtrl.updateManager);
router.delete('/managers/:id', auth, requireRole('admin'), managerCtrl.deleteManager);

// Suppliers — admin + executive (executive needs supplier list when editing/uploading vouchers)
router.get('/suppliers', auth, requireRole('admin', 'executive', 'approver', 'manager'), supplierCtrl.listSuppliers);
router.post('/suppliers', auth, requireRole('admin', 'executive'), supplierCtrl.createSupplier);
router.get('/suppliers/:id', auth, requireRole('admin', 'executive', 'approver', 'manager'), supplierCtrl.getSupplier);
router.put('/suppliers/:id', auth, requireRole('admin', 'executive', 'approver'), supplierCtrl.updateSupplier);
router.delete('/suppliers/:id', auth, requireRole('admin'), supplierCtrl.deleteSupplier);
// Supplier approval
router.post('/suppliers/:id/approve', auth, requireRole('admin', 'approver'), supplierCtrl.approveSupplier);
// Supplier documents
router.post('/suppliers/:id/documents', auth, requireRole('admin', 'executive', 'approver'), upload.single('file'), supplierCtrl.uploadDocument);
router.get('/suppliers/:id/documents/:did', auth, requireRole('admin', 'executive', 'approver', 'manager'), supplierCtrl.getDocumentFile);
router.delete('/suppliers/:id/documents/:did', auth, requireRole('admin', 'executive', 'approver'), supplierCtrl.deleteDocument);

// Vouchers
router.post('/vouchers/upload', auth, requireRole('admin', 'executive'), upload.single('invoice'), voucherCtrl.uploadAndScan);
router.post('/vouchers', auth, requireRole('admin', 'executive'), voucherCtrl.createVoucher);
router.get('/vouchers', auth, voucherCtrl.listVouchers);
router.get('/vouchers/:id', auth, voucherCtrl.getVoucher);
router.put('/vouchers/:id', auth, requireRole('admin', 'executive', 'approver'), voucherCtrl.updateVoucher);
router.delete('/vouchers/:id', auth, requireRole('admin'), voucherCtrl.deleteVoucher);
router.post('/vouchers/:id/assign', auth, requireRole('admin', 'executive'), voucherCtrl.assignVoucher);
router.post('/vouchers/:id/manager-action', auth, requireRole('manager', 'approver'), voucherCtrl.managerAction);
router.post('/vouchers/:id/verify',         auth, requireRole('approver'), voucherCtrl.approverVerify);
router.post('/vouchers/:id/final-approval', auth, requireRole('approver'), voucherCtrl.adminFinalApproval);
router.post('/vouchers/:id/reopen',         auth, requireRole('admin'), voucherCtrl.reopenVoucher);
router.post('/vouchers/:id/comments', auth, voucherCtrl.addComment);
router.post('/vouchers/:id/generate', auth, requireRole('admin', 'executive', 'approver'), voucherCtrl.generateVoucher);
router.post('/vouchers/:id/utr',      auth, requireRole('admin', 'executive'), voucherCtrl.updateUtr);
router.post('/vouchers/:id/sync-payment-status', auth, requireRole('admin', 'executive', 'approver', 'manager'), voucherCtrl.syncPaymentStatus);
router.post('/vouchers/export', auth, requireRole('admin', 'executive'), voucherCtrl.exportVouchers);
router.get('/vouchers/:id/email-preview', auth, requireRole('admin', 'executive'), voucherCtrl.emailPreview);
router.post('/vouchers/:id/send-payment-advice', auth, requireRole('admin', 'executive'), voucherCtrl.sendAdviceEmail);
router.get('/vouchers/:id/download', auth, voucherCtrl.downloadVoucher);
router.get('/vouchers/:id/preview-html', auth, voucherCtrl.previewHtml);
router.get('/vouchers/:id/invoice', auth, voucherCtrl.getInvoiceFile);
// Attachments
router.post('/vouchers/:id/attachments', auth, upload.array('files', 10), voucherCtrl.uploadAttachments);
router.get('/vouchers/:id/attachments/:aid', auth, voucherCtrl.getAttachmentFile);
router.delete('/vouchers/:id/attachments/:aid', auth, requireRole('admin'), voucherCtrl.deleteAttachment);

// Bills
router.get('/bills',              auth, requireRole('admin', 'executive', 'approver'), billCtrl.listBills);
router.get('/bills/export',       auth, requireRole('admin', 'executive'), billCtrl.exportBills);
router.post('/bills',             auth, requireRole('admin', 'executive'), billCtrl.createBill);
router.get('/bills/:id',          auth, requireRole('admin', 'executive', 'approver'), billCtrl.getBill);
router.put('/bills/:id',          auth, requireRole('admin', 'executive', 'approver'), billCtrl.updateBill);
router.delete('/bills/:id',       auth, requireRole('admin'), billCtrl.deleteBill);
router.post('/bills/:id/voucher',      auth, requireRole('admin', 'executive'), billCtrl.createVoucherFromBill);
router.post('/bills/:id/attachments',      auth, requireRole('admin', 'executive'), upload.array('files', 10), billCtrl.uploadBillAttachments);
router.get('/bills/:id/attachments',         auth, requireRole('admin', 'executive', 'approver', 'manager'), billCtrl.getBillAttachments);
router.get('/bills/:id/attachments/:aid',    auth, requireRole('admin', 'executive', 'approver', 'manager'), billCtrl.getBillAttachmentFile);
router.delete('/bills/:id/attachments/:aid', auth, requireRole('admin', 'executive'), billCtrl.deleteBillAttachment);

// Company details
router.get('/company', auth, requireRole('admin', 'executive'), companyCtrl.listCompanies);
router.post('/company', auth, requireRole('admin'), companyCtrl.createCompany);
router.get('/company/:id', auth, requireRole('admin', 'executive'), companyCtrl.getCompany);
router.put('/company/:id', auth, requireRole('admin'), companyCtrl.updateCompany);
router.delete('/company/:id', auth, requireRole('admin'), companyCtrl.deleteCompany);

// Template downloads
const _path = require('path');
router.get('/import/template/bills', auth, (req, res) => {
  res.download(_path.join(__dirname, '../../template/Invoice_Data_To_Upload.xlsx'), 'Invoice_Data_To_Upload.xlsx');
});
router.get('/import/template/suppliers', auth, (req, res) => {
  res.download(_path.join(__dirname, '../../template/Supplier_Master_Template_Upload.xlsx'), 'Supplier_Master_Template_Upload.xlsx');
});

// XL Master Upload (admin + executive)
router.post('/import/xl-parse',        auth, requireRole('admin', 'executive'), uploadXl.single('xlfile'), xlImportCtrl.parseXl);
router.post('/import/xl-confirm',      auth, requireRole('admin', 'executive'), xlImportCtrl.confirmImport);
// Bank UTR Upload (admin + executive)
router.post('/import/bank-parse',      auth, requireRole('admin', 'executive'), uploadXl.single('bankfile'), bankImportCtrl.parseBankFile);
router.post('/import/bank-confirm',    auth, requireRole('admin', 'executive'), bankImportCtrl.confirmBankImport);
// Supplier Master Import (admin + executive)
router.post('/import/supplier-parse',   auth, requireRole('admin', 'executive'), uploadXl.single('xlfile'), supplierImportCtrl.parseSupplierXl);
router.post('/import/supplier-confirm', auth, requireRole('admin', 'executive'), supplierImportCtrl.confirmSupplierImport);

// Parameters (master data)
router.get('/parameters',                         auth, paramCtrl.listParameters);
router.get('/parameters/:parameterid',            auth, paramCtrl.getParameter);
router.post('/parameters',                        auth, requireRole('admin'), paramCtrl.createParameter);
router.post('/parameters/:parameterid/details',   auth, requireRole('admin'), paramCtrl.addDetail);
router.put('/parameters/details/:detailid',       auth, requireRole('admin'), paramCtrl.updateDetail);
router.delete('/parameters/details/:detailid',    auth, requireRole('admin'), paramCtrl.deleteDetail);

// SalesPro proxy
router.post('/salespro/payment-by-ref',     auth, salesproProxy.getByRef);
router.post('/salespro/search-accounts',    auth, salesproProxy.searchAccounts);
router.post('/salespro/payment-by-account', auth,  salesproProxy.getByAccount);
router.post('/salespro/installation',       auth, salesproProxy.getInstallation);

router.post('/admin/send-due-reminders', auth, requireRole('admin'), async (req, res) => {

  await sendDueReminders();
  res.json({ message: 'Due reminders sent' });
});

// Notifications (admin/approver bell)
router.get('/notifications',              auth, requireRole('admin', 'approver'), notificationCtrl.listNotifications);
router.get('/notifications/unread-count', auth, requireRole('admin', 'approver'), notificationCtrl.unreadCount);
router.post('/notifications/read-all',    auth, requireRole('admin', 'approver'), notificationCtrl.markAllRead);
router.post('/notifications/:id/read',    auth, requireRole('admin', 'approver'), notificationCtrl.markRead);

module.exports = router;
