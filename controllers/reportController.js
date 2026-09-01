const pool = require('../config/db');

async function buildFilteredQuery({ department, year, month, employee_id, event_id, status }) {
  let where = 'WHERE 1=1';
  const params = [];

  if (department && department !== 'all') {
    where += ' AND d.name = ?';
    params.push(department);
  }
  if (year) {
    where += ' AND YEAR(a.attendance_date) = ?';
    params.push(year);
  }
  if (month && month !== 'all') {
    where += ' AND MONTH(a.attendance_date) = ?';
    params.push(Number(month) + 1);
  }
  if (employee_id && employee_id !== 'all') {
    where += ' AND a.employee_id = ?';
    params.push(employee_id);
  }
  if (event_id && event_id !== 'all') {
    where += ' AND a.event_id = ?';
    params.push(event_id);
  }
  if (status && status !== 'all') {
    where += ' AND a.attendance_status = ?';
    params.push(status);
  }

  return { where, params };
}

// GET /api/reports?department=&year=&month=&employee_id=&event_id=&status=
async function generateReport(req, res, next) {
  try {
    const { where, params } = await buildFilteredQuery(req.query);
    const [rows] = await pool.query(
      `SELECT a.attendance_date, a.time_in, a.time_out, a.attendance_status, a.verification_status,
              a.late_minutes, a.work_hours, e.full_name, e.employee_code, d.name AS department_name,
              ev.title AS event_title
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       JOIN departments d ON e.department_id = d.id
       LEFT JOIN events ev ON a.event_id = ev.id
       ${where}
       ORDER BY a.attendance_date DESC`,
      params
    );

    const summary = {
      total: rows.length,
      present: rows.filter((r) => r.attendance_status === 'Present').length,
      late: rows.filter((r) => r.attendance_status === 'Late').length,
      absent: rows.filter((r) => r.attendance_status === 'Absent').length
    };

    res.json({ success: true, data: rows, summary });
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/export/:format  (csv|excel)
async function exportReport(req, res, next) {
  try {
    const { where, params } = await buildFilteredQuery(req.query);
    const [rows] = await pool.query(
      `SELECT a.attendance_date AS Date, e.full_name AS Employee, e.employee_code AS 'Employee ID',
              d.name AS Department, a.attendance_status AS Status, a.late_minutes AS 'Late Minutes',
              a.work_hours AS 'Work Hours'
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       JOIN departments d ON e.department_id = d.id
       ${where}
       ORDER BY a.attendance_date DESC`,
      params
    );

    if (req.params.format === 'csv') {
      const { Parser } = require('json2csv');
      const csv = new Parser().parse(rows);
      res.header('Content-Type', 'text/csv');
      res.attachment('attendance_report.csv');
      return res.send(csv);
    }

    if (req.params.format === 'excel') {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Attendance Report');
      if (rows.length > 0) {
        sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key, width: 20 }));
        sheet.addRows(rows);
        sheet.getRow(1).font = { bold: true };
      }
      res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.attachment('attendance_report.xlsx');
      await workbook.xlsx.write(res);
      return res.end();
    }

    res.status(400).json({ success: false, message: 'Unsupported export format. Use csv or excel.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { generateReport, exportReport };
