const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const config = require('../config/config');
const { logAction } = require('../services/auditService');

let googleClient = null;
function getGoogleClient() {
  if (!process.env.GOOGLE_CLIENT_ID) return null;
  if (!googleClient) {
    const { OAuth2Client } = require('google-auth-library');
    // No single audience is bound here — verifyIdToken() below is called with an
    // array of every accepted client ID (web portal + native Android app), since
    // each platform's Google Sign-In issues tokens audienced to its own client ID.
    googleClient = new OAuth2Client();
  }
  return googleClient;
}

// Every OAuth Client ID this server accepts Google ID tokens from. The web portal
// uses GOOGLE_CLIENT_ID; the native Android dev-client build uses its own separate
// GOOGLE_ANDROID_CLIENT_ID. Falsy/unset entries are filtered out so this still works
// if only one of the two is configured.
function getAcceptedAudiences() {
  return [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_ANDROID_CLIENT_ID].filter(Boolean);
}

function employeePayload(employee) {
  return {
    id: employee.id,
    employee_code: employee.employee_code,
    full_name: employee.full_name,
    surname: employee.surname,
    given_name: employee.given_name,
    middle_name: employee.middle_name,
    suffix: employee.suffix,
    department: employee.department_name,
    position: employee.position,
    photo_path: employee.photo_path
  };
}

// Looks up the most recently registered device for an employee. Only used as a
// fallback when the caller didn't tell us which physical device it's asking
// about (e.g. an older client build).
async function getLatestDeviceStatus(employeeId) {
  const [rows] = await pool.query(
    `SELECT status FROM mobile_devices WHERE employee_id = ? ORDER BY registered_at DESC LIMIT 1`,
    [employeeId]
  );
  return rows[0] ? rows[0].status : null;
}

// Looks up the status of THIS SPECIFIC device for an employee, so login/status
// responses can tell the mobile app whether it should show the "waiting for
// approval" screen instead of the main app content. Since an employee may now
// have several registered devices, we must check the one actually in use
// rather than just "the most recently registered device" — otherwise a
// long-approved device could be blocked just because a different device was
// registered more recently elsewhere.
async function getDeviceStatusFor(employeeId, deviceUid) {
  if (!deviceUid) return getLatestDeviceStatus(employeeId);
  const [rows] = await pool.query(
    `SELECT status FROM mobile_devices WHERE employee_id = ? AND device_uid = ?`,
    [employeeId, deviceUid]
  );
  return rows[0] ? rows[0].status : null;
}

function issueEmployeeToken(employee) {
  return jwt.sign(
    { id: employee.id, employee_code: employee.employee_code, type: 'employee' },
    config.jwt.secret,
    { expiresIn: '30d' }
  );
}

// POST /api/employee-auth/login  { employee_code, password }
async function login(req, res, next) {
  try {
    const { employee_code, password, device_uid } = req.body;
    if (!employee_code || !password) {
      return res.status(400).json({ success: false, message: 'Employee ID and password are required.' });
    }

    const [rows] = await pool.query(
      `SELECT e.*, d.name AS department_name FROM employees e
       JOIN departments d ON e.department_id = d.id WHERE e.employee_code = ?`,
      [employee_code]
    );
    const employee = rows[0];

    if (!employee || !employee.password_hash) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    if (employee.status === 'Inactive') {
      return res.status(403).json({ success: false, message: 'This account is inactive. Contact your administrator.' });
    }

    const match = await bcrypt.compare(password, employee.password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { id: employee.id, employee_code: employee.employee_code, type: 'employee' },
      config.jwt.secret,
      { expiresIn: '30d' }
    );

    const deviceStatus = await getDeviceStatusFor(employee.id, device_uid);

    res.json({
      success: true,
      message: 'Login successful.',
      token,
      employee: employeePayload({ ...employee, department_name: employee.department_name }),
      deviceStatus
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/employee-auth/google  { credential }
// Verifies a real Google ID token (from Google Identity Services on the client).
// If the verified email already belongs to an employee record, logs them straight in.
// If not, issues a short-lived "pending" token so the client can proceed to the
// registration screen — the pending token proves the email was genuinely Google-verified,
// so linkDevice() below never has to trust a client-supplied email directly.
async function googleLogin(req, res, next) {
  try {
    const client = getGoogleClient();
    if (!client) {
      return res.status(501).json({
        success: false,
        message: 'Google Sign-In is not configured on this server. Set GOOGLE_CLIENT_ID in .env to enable it.'
      });
    }

    const { credential, device_uid } = req.body;
    if (!credential) {
      return res.status(400).json({ success: false, message: 'Missing Google credential.' });
    }

    const ticket = await client.verifyIdToken({ idToken: credential, audience: getAcceptedAudiences() });
    const payload = ticket.getPayload();
    const email = payload.email;
    if (!payload.email_verified) {
      return res.status(403).json({ success: false, message: 'Your Google email is not verified.' });
    }

    const [rows] = await pool.query(
      `SELECT e.*, d.name AS department_name FROM employees e
       JOIN departments d ON e.department_id = d.id WHERE e.email = ?`,
      [email]
    );
    const employee = rows[0];

    if (employee) {
      if (employee.status === 'Inactive') {
        return res.status(403).json({ success: false, message: 'This account is inactive. Contact your administrator.' });
      }
      const deviceStatus = await getDeviceStatusFor(employee.id, device_uid);
      return res.json({
        success: true,
        matched: true,
        message: 'Login successful.',
        token: issueEmployeeToken(employee),
        employee: employeePayload(employee),
        deviceStatus
      });
    }

    // Not linked to any employee yet — issue a short-lived pending token proving
    // the email was verified, and let the client proceed to device registration.
    const pendingToken = jwt.sign(
      {
        type: 'google_pending',
        email,
        given_name: payload.given_name || '',
        family_name: payload.family_name || ''
      },
      config.jwt.secret,
      { expiresIn: '10m' }
    );

    res.json({
      success: true,
      matched: false,
      pendingToken,
      google: { email, given_name: payload.given_name, family_name: payload.family_name }
    });
  } catch (err) {
    if (err.message && err.message.includes('Token used too late')) {
      return res.status(401).json({ success: false, message: 'Your Google session expired. Please try again.' });
    }
    // Logged so audience/config mismatches (e.g. a forgotten GOOGLE_ANDROID_CLIENT_ID)
    // are visible in the server console instead of only as a generic 500 to the client.
    console.error('Google token verification failed:', err.message);
    next(err);
  }
}

// Allowed values for the (optional) name suffix dropdown, mirroring the admin dashboard.
const VALID_SUFFIXES = ['', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V'];

// Maps the short codes shown in the mobile app's Department picker to the full
// department names used everywhere else in the system (admin dashboard, reports).
const DEPARTMENT_CODE_MAP = {
  CCS: 'College of Computer Studies',
  COE: 'College of Engineering',
  CBE: 'College of Business and Economics',
  CAS: 'College of Arts and Sciences'
};

// Resolves a department name/code submitted from the mobile registration form to a
// department_id, creating the department record on the fly if it doesn't exist yet
// (e.g. first employee ever to self-register into that department). Falls back to
// a generic "Unassigned" department if nothing usable was submitted.
async function resolveDepartmentId(deptInput) {
  const name = (DEPARTMENT_CODE_MAP[deptInput] || deptInput || '').trim() || 'Unassigned';

  const [existing] = await pool.query('SELECT id FROM departments WHERE name = ?', [name]);
  if (existing[0]) return existing[0].id;

  const [created] = await pool.query('INSERT INTO departments (name) VALUES (?)', [name]);
  return created.insertId;
}

// POST /api/employee-auth/link-device
// { pendingToken, employee_code, surname|last_name, given_name|first_name, middle_name,
//   suffix, department, device_uid, device_model, device_brand, device_os }
//
// First-time flow: if no employee record exists yet for the submitted Employee ID,
// one is automatically created from the details entered here (self-registration) —
// admins no longer need to pre-provision the employee record before someone's first
// mobile registration. If the Employee ID is already on file under a different
// surname, registration is still blocked so one person can't register under
// somebody else's Employee ID.
async function linkDevice(req, res, next) {
  try {
    const {
      pendingToken, employee_code, device_uid, device_model, device_brand, device_os,
      middle_name, suffix, department
    } = req.body;
    // The mobile app's registration form posts first_name/last_name; surname/given_name
    // are also accepted for backward compatibility with older/alternate clients.
    const surname = req.body.surname || req.body.last_name;
    const given_name = req.body.given_name || req.body.first_name;

    if (!pendingToken || !employee_code || !surname || !given_name || !device_uid) {
      return res.status(400).json({ success: false, message: 'Missing required registration details.' });
    }
    if (suffix && !VALID_SUFFIXES.includes(suffix)) {
      return res.status(400).json({ success: false, message: 'Invalid suffix value.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(pendingToken, config.jwt.secret);
    } catch (e) {
      return res.status(401).json({ success: false, message: 'Your Google sign-in has expired. Please sign in again.' });
    }
    if (decoded.type !== 'google_pending') {
      return res.status(400).json({ success: false, message: 'Invalid registration session.' });
    }

    const [rows] = await pool.query(
      `SELECT e.*, d.name AS department_name FROM employees e
       JOIN departments d ON e.department_id = d.id WHERE e.employee_code = ?`,
      [employee_code]
    );
    let employee = rows[0];

    const surnameVal = surname.trim();
    const givenNameVal = given_name.trim();
    const middleNameVal = middle_name ? middle_name.trim() : null;
    const suffixVal = suffix ? suffix.trim() : null;
    const fullName = [givenNameVal, middleNameVal, surnameVal, suffixVal].filter(Boolean).join(' ');

    if (employee) {
      // Match against the existing record's surname (falls back to the tail of full_name
      // for older records that haven't been split into surname/given_name yet), so this
      // Employee ID can't be claimed by someone other than who it already belongs to.
      const employeeSurname = (employee.surname || employee.full_name?.split(' ').pop() || '').trim().toLowerCase();
      if (employeeSurname !== surnameVal.toLowerCase()) {
        return res.status(409).json({
          success: false,
          message: `Employee ID "${employee_code}" is already registered under a different name. Contact your administrator if this isn't you.`
        });
      }
      if (employee.status === 'Inactive') {
        return res.status(403).json({ success: false, message: 'This account is inactive. Contact your administrator.' });
      }

      // Record the name parts the employee entered (must match their Google account
      // name — enforced on the client) and link the verified Google email if this
      // record doesn't already have one on file.
      await pool.query(
        `UPDATE employees SET surname = ?, given_name = ?, middle_name = ?, suffix = ?, full_name = ?, email = COALESCE(email, ?) WHERE id = ?`,
        [surnameVal, givenNameVal, middleNameVal, suffixVal, fullName, decoded.email, employee.id]
      );
      employee.surname = surnameVal;
      employee.given_name = givenNameVal;
      employee.middle_name = middleNameVal;
      employee.suffix = suffixVal;
      employee.full_name = fullName;
    } else {
      // No employee record exists for this Employee ID yet — this is the employee's
      // first time registering, so provision the record automatically instead of
      // requiring an admin to have created it beforehand.
      const departmentId = await resolveDepartmentId(department);

      const [result] = await pool.query(
        `INSERT INTO employees (employee_code, full_name, surname, given_name, middle_name, suffix, department_id, email, status, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Full-time', 'Active')`,
        [employee_code, fullName, surnameVal, givenNameVal, middleNameVal, suffixVal, departmentId, decoded.email]
      );

      const [newRows] = await pool.query(
        `SELECT e.*, d.name AS department_name FROM employees e
         JOIN departments d ON e.department_id = d.id WHERE e.id = ?`,
        [result.insertId]
      );
      employee = newRows[0];

      await logAction({
        adminId: null,
        action: 'self_register',
        module: 'employees',
        details: { employeeCode: employee_code, email: decoded.email },
        ip: req.ip
      });
    }

    // Register the device (mirrors deviceController.registerDevice's rules).
    // A device can only ever belong to one employee, but an employee may register
    // and use multiple devices.
    const [existingDevice] = await pool.query('SELECT * FROM mobile_devices WHERE device_uid = ?', [device_uid]);
    let deviceStatus = 'pending';
    if (existingDevice[0]) {
      if (String(existingDevice[0].employee_id) !== String(employee.id)) {
        return res.status(409).json({
          success: false,
          message: 'This device is already registered to another employee. Contact your administrator if this isn\'t you.'
        });
      }
      deviceStatus = existingDevice[0].status;
    } else {
      await pool.query(
        `INSERT INTO mobile_devices (employee_id, device_uid, model, brand, os, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
        [employee.id, device_uid, device_model || null, device_brand || null, device_os || null]
      );
    }

    res.status(201).json({
      success: true,
      message: deviceStatus === 'approved' ? 'Device confirmed.' : 'Device registered and pending admin approval.',
      token: issueEmployeeToken(employee),
      employee: employeePayload(employee),
      deviceStatus
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/employee-auth/device-status
// Used by the mobile app's "waiting for approval" screen to poll whether an
// admin has approved this employee's device yet.
async function deviceStatus(req, res, next) {
  try {
    const status = await getDeviceStatusFor(req.employee.id, req.query.device_uid);
    res.json({ success: true, deviceStatus: status });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, googleLogin, linkDevice, deviceStatus };
