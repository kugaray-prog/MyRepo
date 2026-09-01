const pool = require('../config/db');

/**
 * Records an entry in audit_logs. Never throws — logging failures
 * should never break the primary request.
 */
async function logAction({ adminId = null, action, module, details = null, ip = null }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (admin_id, action, module, details, ip_address) VALUES (?, ?, ?, ?, ?)`,
      [adminId, action, module, details ? JSON.stringify(details) : null, ip]
    );
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

module.exports = { logAction };
