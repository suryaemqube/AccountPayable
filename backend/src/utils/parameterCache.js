/**
 * In-memory cache for parameter_details.
 * Loaded on first use. Call invalidate() after any parameter_details change.
 */
const pool = require('../config/db');

let _cache = null;

async function _load() {
  const res = await pool.query(`
    SELECT pd.parameterdetid, pd.code, p.parametertext
    FROM   parameter_details pd
    JOIN   parameters p ON pd.parameterid = p.parameterid
    WHERE  pd.is_active = true
  `);
  _cache = { idToCode: new Map(), textCodeToId: new Map() };
  for (const r of res.rows) {
    _cache.idToCode.set(r.parameterdetid, r.code);
    _cache.textCodeToId.set(`${r.parametertext}::${r.code}`, r.parameterdetid);
  }
}

async function _ensure() {
  if (!_cache) await _load();
}

/** Return parameterdetid (INT) for a given parameter group + code string. */
async function detId(parametertext, code) {
  await _ensure();
  return _cache.textCodeToId.get(`${parametertext}::${code}`) ?? null;
}

/** Return the code string for a given parameterdetid. */
async function codeOf(parameterdetid) {
  await _ensure();
  return _cache.idToCode.get(parameterdetid) ?? null;
}

/** Return all det_ids for a parameter group as an array. */
async function allDetIds(parametertext, codes) {
  await _ensure();
  return codes
    .map(c => _cache.textCodeToId.get(`${parametertext}::${c}`))
    .filter(Boolean);
}

/** Clear cache (call after modifying parameter_details). */
function invalidate() { _cache = null; }

module.exports = { detId, codeOf, allDetIds, invalidate };
