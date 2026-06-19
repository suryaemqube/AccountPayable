/**
 * salesproProxy.js
 * Thin proxy from the AP backend → SalesPro .NET API
 * All endpoints are read-only and admin-only.
 *
 * Set SALESPRO_API_URL in .env (e.g. http://192.168.1.10:5050)
 */

const axios = require('axios');

const BASE = (process.env.SALESPRO_API_URL || '').replace(/\/$/, '');

// Internal helper — POST to SalesPro API and forward result
async function callSalesPro(res, path, body) {
  if (!BASE) {
    return res.status(500).json({ error: 'SALESPRO_API_URL is not configured in .env' });
  }
  try {
    const r = await axios.post(`${BASE}${path}`, body, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });
    return res.json(r.data);
  } catch (err) {
    const status  = err.response?.status  || 500;
    const message = err.response?.data?.Status?.MessageText
                 || err.response?.data?.Status?.Message
                 || err.message
                 || 'SalesPro API error';
    return res.status(status).json({ error: message });
  }
}

// ── Flow 1: lookup by payment_reference (ExtRef)
// POST /salespro/payment-by-ref  { extRef: "2026/05/1487" }
async function getByRef(req, res) {
  const { extRef } = req.body;
  if (!extRef || !extRef.trim()) {
    return res.status(400).json({ error: 'extRef is required' });
  }
  return callSalesPro(res, '/api/Appayment/GetByRef', { ExtRef: extRef.trim() });
}

// ── Flow 2a: search accounts by name (min 3 chars, DB enforces 6-char spirit)
// POST /salespro/search-accounts  { searchTerm: "Upgrad" }
async function searchAccounts(req, res) {
  const { searchTerm } = req.body;
  if (!searchTerm || searchTerm.trim().length < 3) {
    return res.status(400).json({ error: 'searchTerm must be at least 3 characters' });
  }
  return callSalesPro(res, '/api/Appayment/SearchAccounts', { SearchTerm: searchTerm.trim() });
}

// ── Flow 2b: get all orders + invoices + payments for an account
// POST /salespro/payment-by-account  { actId: 20906 }
async function getByAccount(req, res) {
  const { actId } = req.body;
  if (!actId || isNaN(actId) || Number(actId) <= 0) {
    return res.status(400).json({ error: 'Valid actId is required' });
  }
  return callSalesPro(res, '/api/Appayment/GetByAccount', { ActId: Number(actId) });
}

// ── Installation status: lookup by OrderNo (queries PMS_Swan_live cross-DB)
// POST /salespro/installation  { orderNo: "ORD03202529525" }
async function getInstallation(req, res) {
  const { orderNo } = req.body;
  if (!orderNo || !orderNo.trim()) {
    return res.status(400).json({ error: 'orderNo is required' });
  }
  return callSalesPro(res, '/api/Appayment/GetInstallation', { OrderNo: orderNo.trim() });
}

module.exports = { getByRef, searchAccounts, getByAccount, getInstallation };
