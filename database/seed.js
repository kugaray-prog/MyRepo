/**
 * Seeds the database with a default admin account, departments,
 * and sample employees so the dashboard is usable immediately after setup.
 * Run with: npm run seed
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../config/db');

async function seed() {
  const conn = await pool.getConnection();
  try {
    console.log('Seeding GeoAttend Pro database...');

    // 1. Default admin account
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@geoattend.pro';
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'password';
    const [existingAdmin] = await conn.query('SELECT id FROM admin_accounts WHERE email = ?', [adminEmail]);

    if (existingAdmin.length === 0) {
      const hash = await bcrypt.hash(adminPassword, 12);
      await conn.query(
        `INSERT INTO admin_accounts (full_name, email, password_hash, role) VALUES (?, ?, ?, 'super_admin')`,
        ['Super Admin', adminEmail, hash]
      );
      console.log(`Created admin account: ${adminEmail} / ${adminPassword}`);
    } else {
      console.log('Admin account already exists, skipping.');
    }

    // 2. Departments
    const departments = ['Engineering Faculty', 'College of Computer Studies', 'College of Health'];
    for (const name of departments) {
      const [rows] = await conn.query('SELECT id FROM departments WHERE name = ?', [name]);
      if (rows.length === 0) {
        await conn.query('INSERT INTO departments (name, office) VALUES (?, ?)', [name, name]);
      }
    }
    const [deptRows] = await conn.query('SELECT id, name FROM departments');
    const deptMap = Object.fromEntries(deptRows.map(d => [d.name, d.id]));

    // 3. Sample employees
    const employees = [
      { code: 'E001', name: 'Dr. Sarah Jenkins', dept: 'Engineering Faculty', position: 'Senior Professor', status: 'Full-time', email: 'sarah.jenkins@geoattend.pro' },
      { code: 'E002', name: 'Prof. Michael Chen', dept: 'College of Computer Studies', position: 'IT Instructor', status: 'Part-time', email: 'michael.chen@geoattend.pro' },
      { code: 'E003', name: 'Dr. Emily Watson', dept: 'College of Health', position: 'Department Dean', status: 'Full-time', email: 'emily.watson@geoattend.pro' }
    ];
    const empPassHash = await bcrypt.hash('employee123', 12);
    for (const e of employees) {
      const [rows] = await conn.query('SELECT id FROM employees WHERE employee_code = ?', [e.code]);
      if (rows.length === 0) {
        await conn.query(
          `INSERT INTO employees (employee_code, full_name, department_id, office, position, email, password_hash, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [e.code, e.name, deptMap[e.dept], e.dept, e.position, e.email, empPassHash, e.status]
        );
      }
    }

    // 4. Default settings
    const defaults = [
      ['late_grace_minutes', '15'],
      ['default_geofence_radius', '150'],
      ['ocr_min_confidence', '70'],
      ['school_name', 'GeoAttend Institution'],
      ['cspc_latitude', '13.4079'],
      ['cspc_longitude', '123.3735'],
      ['cspc_label', 'CSPC - Camarines Sur Polytechnic Colleges, Nabua, Camarines Sur']
    ];
    for (const [key, value] of defaults) {
      await conn.query(
        `INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = setting_value`,
        [key, value]
      );
    }

    console.log('Seeding complete.');
  } catch (err) {
    console.error('Seeding failed:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

seed();
