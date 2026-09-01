const jwt = require('jsonwebtoken');
const config = require('../config/config');

/**
 * Verifies the JWT sent in the Authorization header (Bearer token)
 * or in the httpOnly cookie set at login, and attaches the decoded
 * admin payload to req.admin.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const bearerToken = header && header.startsWith('Bearer ') ? header.split(' ')[1] : null;
  const token = bearerToken || (req.cookies && req.cookies.token) || req.query.token;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (decoded.type === 'employee' || decoded.type === 'google_pending') {
      return res.status(403).json({ success: false, message: 'This endpoint requires an admin session.' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session. Please log in again.' });
  }
}

/**
 * Restricts a route to specific admin roles.
 * Usage: requireRole('super_admin', 'admin')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

/**
 * Verifies an employee JWT (issued by /api/employee-auth/login) and attaches
 * the decoded payload to req.employee. Used by mobile-app-facing routes.
 */
function requireEmployeeAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (decoded.type !== 'employee') {
      return res.status(403).json({ success: false, message: 'Invalid token type for this route.' });
    }
    req.employee = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session. Please log in again.' });
  }
}

module.exports = { requireAuth, requireRole, requireEmployeeAuth };
