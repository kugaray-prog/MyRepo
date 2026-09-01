const pool = require('../config/db');

// GET /api/dashboard/stats
async function getStats(req, res, next) {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [[totalEmployees]] = await pool.query('SELECT COUNT(*) AS count FROM employees');
    const [[fullTime]] = await pool.query(`SELECT COUNT(*) AS count FROM employees WHERE status = 'Full-time'`);
    const [[partTime]] = await pool.query(`SELECT COUNT(*) AS count FROM employees WHERE status = 'Part-time'`);
    const [[inactive]] = await pool.query(`SELECT COUNT(*) AS count FROM employees WHERE status = 'Inactive'`);
    const [[departments]] = await pool.query('SELECT COUNT(*) AS count FROM departments');
    const [[activeEvents]] = await pool.query(
      `SELECT COUNT(*) AS count FROM events WHERE NOW() BETWEEN start_datetime AND end_datetime`
    );
    const [[activeGeofences]] = await pool.query('SELECT COUNT(*) AS count FROM geofences WHERE is_active = 1');
    const [[devices]] = await pool.query(`SELECT COUNT(*) AS count FROM mobile_devices WHERE status = 'approved'`);
    const [[todayPresent]] = await pool.query(
      `SELECT COUNT(*) AS count FROM attendance WHERE attendance_date = ? AND attendance_status = 'Present'`,
      [today]
    );
    const [[todayLate]] = await pool.query(
      `SELECT COUNT(*) AS count FROM attendance WHERE attendance_date = ? AND attendance_status = 'Late'`,
      [today]
    );

    const [classificationBreakdown] = await pool.query(
      `SELECT COALESCE(classification, 'Regular') AS classification, COUNT(*) AS count
       FROM employees GROUP BY classification`
    );
    // Always return all three buckets, even if a classification currently has zero employees.
    const classificationMap = { Regular: 0, COS: 0, Casual: 0 };
    for (const row of classificationBreakdown) classificationMap[row.classification] = row.count;

    res.json({
      success: true,
      data: {
        totalEmployees: totalEmployees.count,
        fullTime: fullTime.count,
        partTime: partTime.count,
        inactive: inactive.count,
        departments: departments.count,
        activeEvents: activeEvents.count,
        activeGeofences: activeGeofences.count,
        registeredDevices: devices.count,
        todayPresent: todayPresent.count,
        todayLate: todayLate.count,
        classificationBreakdown: classificationMap
      }
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/dashboard/department-attendance?event_id=&date=&department_id=&classification=
// Total employees vs. employees who attended, grouped by department — powers
// the Dashboard "Department Attendance" grouped bar chart.
async function getDepartmentAttendance(req, res, next) {
  try {
    const { event_id, date, department_id, classification } = req.query;

    // Build the employee-join condition (beyond the department match) separately
    // so it can be embedded directly in the LEFT JOIN's ON clause — filtering
    // employees inside the JOIN condition (not a WHERE) keeps departments with
    // zero matching employees in the results, showing 0 instead of disappearing.
    let empJoinExtra = '';
    const empParams = [];
    if (classification && classification !== 'all') { empJoinExtra += ' AND e.classification = ?'; empParams.push(classification); }

    let attWhere = 'WHERE 1=1';
    const attParams = [];
    if (event_id) { attWhere += ' AND a.event_id = ?'; attParams.push(event_id); }
    if (date) { attWhere += ' AND a.attendance_date = ?'; attParams.push(date); }
    if (department_id) { attWhere += ' AND emp.department_id = ?'; attParams.push(department_id); }
    if (classification && classification !== 'all') { attWhere += ' AND emp.classification = ?'; attParams.push(classification); }

    let deptWhere = '';
    const deptParams = [];
    if (department_id) { deptWhere = 'WHERE d.id = ?'; deptParams.push(department_id); }

    const [totals] = await pool.query(
      `SELECT d.id, d.name, COUNT(e.id) AS total_employees
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id ${empJoinExtra}
       ${deptWhere}
       GROUP BY d.id ORDER BY d.name`,
      [...empParams, ...deptParams]
    );

    const [attended] = await pool.query(
      `SELECT emp.department_id, COUNT(DISTINCT a.employee_id) AS attended_count
       FROM attendance a
       JOIN employees emp ON a.employee_id = emp.id
       ${attWhere} AND a.attendance_status IN ('Present','Late')
       GROUP BY emp.department_id`,
      attParams
    );
    const attendedByDept = Object.fromEntries(attended.map((r) => [r.department_id, r.attended_count]));

    const data = totals.map((d) => ({
      department: d.name,
      total_employees: d.total_employees,
      attended: attendedByDept[d.id] || 0
    }));

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = { getStats, getDepartmentAttendance };
