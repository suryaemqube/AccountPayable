const pool = require('../config/db');
const paramCache = require('../utils/parameterCache');

// GET /parameters — list all parameters with their details
async function listParameters(req, res) {
  try {
    const params = await pool.query(
      'SELECT * FROM parameters ORDER BY parameterid'
    );
    const details = await pool.query(
      'SELECT * FROM parameter_details WHERE is_active=true ORDER BY parameterid, displayorder, parameterno'
    );

    // Group details under each parameter
    const result = params.rows.map(p => ({
      ...p,
      details: details.rows.filter(d => d.parameterid === p.parameterid),
    }));

    res.json({ parameters: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// GET /parameters/:parameterid — get one parameter with details
async function getParameter(req, res) {
  const { parameterid } = req.params;
  try {
    const pRes = await pool.query(
      'SELECT * FROM parameters WHERE parameterid = $1', [parameterid]
    );
    if (!pRes.rows.length) return res.status(404).json({ error: 'Parameter not found' });

    const dRes = await pool.query(
      'SELECT * FROM parameter_details WHERE parameterid=$1 AND is_active=true ORDER BY displayorder, parameterno',
      [parameterid]
    );
    res.json({ parameter: pRes.rows[0], details: dRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// POST /parameters — create new parameter
async function createParameter(req, res) {
  const { parametertext } = req.body;
  if (!parametertext) return res.status(400).json({ error: 'parametertext required' });
  try {
    const r = await pool.query(
      'INSERT INTO parameters (parametertext) VALUES ($1) RETURNING *',
      [parametertext]
    );
    res.status(201).json({ parameter: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Parameter already exists' });
    res.status(500).json({ error: 'Server error' });
  }
}

// POST /parameters/:parameterid/details — add a detail row
async function addDetail(req, res) {
  const { parameterid } = req.params;
  const { parametervalues, code, displayorder } = req.body;
  if (!parametervalues) return res.status(400).json({ error: 'parametervalues required' });
  try {
    // Get next parameterno
    const maxRes = await pool.query(
      'SELECT COALESCE(MAX(parameterno),0)+1 AS next FROM parameter_details WHERE parameterid=$1',
      [parameterid]
    );
    const parameterno = maxRes.rows[0].next;
    const r = await pool.query(
      `INSERT INTO parameter_details (parameterid, parameterno, parametervalues, code, displayorder)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [parameterid, parameterno, parametervalues, code || null, displayorder || parameterno]
    );
    paramCache.invalidate();
    res.status(201).json({ detail: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// PUT /parameters/details/:detailid — update a detail row
async function updateDetail(req, res) {
  const { detailid } = req.params;
  const { parametervalues, code, displayorder, is_active } = req.body;
  try {
    const r = await pool.query(
      `UPDATE parameter_details SET
        parametervalues = COALESCE($1, parametervalues),
        code            = COALESCE($2, code),
        displayorder    = COALESCE($3, displayorder),
        is_active       = COALESCE($4, is_active)
       WHERE parameterdetid=$5 RETURNING *`,
      [parametervalues, code, displayorder, is_active, detailid]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Detail not found' });
    paramCache.invalidate();
    res.json({ detail: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// DELETE /parameters/details/:detailid — soft-delete (set is_active=false)
async function deleteDetail(req, res) {
  const { detailid } = req.params;
  try {
    await pool.query(
      'UPDATE parameter_details SET is_active=false WHERE parameterdetid=$1', [detailid]
    );
    paramCache.invalidate();
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { listParameters, getParameter, createParameter, addDetail, updateDetail, deleteDetail };
