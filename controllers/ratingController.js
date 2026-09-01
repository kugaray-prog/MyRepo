const pool = require('../config/db');
const { logAction } = require('../services/auditService');

// Returns every Monday's date (YYYY-MM-DD) that falls within the given month/year.
function mondaysInMonth(year, month) {
  const dates = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    if (d.getDay() === 1) dates.push(new Date(d).toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// GET /api/ratings?month=&year=
// Returns every employee with their rating (1-5) for each Monday of the given
// month, plus a Total Rating = sum(ratings recorded) / (number of Mondays in
// that month) — matching CSPC's Monday flag-ceremony rating scheme.
async function getRatings(req, res, next) {
  try {
    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year = Number(req.query.year) || now.getFullYear();
    const mondays = mondaysInMonth(year, month);

    const [employees] = await pool.query(
      `SELECT e.id, e.employee_code, e.full_name, e.classification, e.rating_points, d.name AS department_name
       FROM employees e JOIN departments d ON e.department_id = d.id
       ORDER BY e.full_name ASC`
    );

    let ratingRows = [];
    if (mondays.length) {
      const [rows] = await pool.query(
        `SELECT employee_id, DATE_FORMAT(rating_date, '%Y-%m-%d') AS rating_date, rating
         FROM employee_ratings WHERE rating_date IN (?)`,
        [mondays]
      );
      ratingRows = rows;
    }

    const byEmployee = {};
    for (const emp of employees) byEmployee[emp.id] = {};
    for (const r of ratingRows) {
      if (!byEmployee[r.employee_id]) byEmployee[r.employee_id] = {};
      byEmployee[r.employee_id][r.rating_date] = r.rating;
    }

    const data = employees.map((emp) => {
      const ratings = byEmployee[emp.id] || {};
      const sum = Object.values(ratings).reduce((a, b) => a + Number(b), 0);
      const total = mondays.length ? Number((sum / mondays.length).toFixed(2)) : null;
      return { ...emp, ratings, total_rating: total };
    });

    res.json({ success: true, mondays, month, year, data });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/ratings — { employee_id, rating_date, rating, notes }
// Admin manually sets/edits a 1-5 rating for a specific Monday.
async function upsertRating(req, res, next) {
  try {
    const { employee_id, rating_date, rating, notes } = req.body;
    const ratingNum = Number(rating);
    if (!employee_id || !rating_date || !ratingNum || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ success: false, message: 'employee_id, rating_date, and a rating from 1-5 are required.' });
    }
    const day = new Date(`${rating_date}T00:00:00`).getDay();
    if (day !== 1) {
      return res.status(400).json({ success: false, message: 'rating_date must be a Monday.' });
    }

    await pool.query(
      `INSERT INTO employee_ratings (employee_id, rating_date, rating, is_manual, notes, updated_by)
       VALUES (?, ?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), is_manual = 1, notes = VALUES(notes), updated_by = VALUES(updated_by)`,
      [employee_id, rating_date, ratingNum, notes || null, req.admin.id]
    );

    await logAction({ adminId: req.admin.id, action: 'set_rating', module: 'ratings', details: { employee_id, rating_date, rating: ratingNum }, ip: req.ip });
    res.json({ success: true, message: 'Rating saved.' });
  } catch (err) {
    next(err);
  }
}

// Called internally from attendanceController after a Monday time-in — auto-fills
// a suggested rating from the attendance outcome, but never overwrites a rating an
// admin has already hand-edited (is_manual = 1).
async function autoFillMondayRating(employeeId, dateStr, attendanceStatus) {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  if (day !== 1) return; // only Mondays feed the ratings module

  const suggested = attendanceStatus === 'Present' ? 5 : attendanceStatus === 'Late' ? 3 : attendanceStatus === 'Excused' ? 4 : 1;

  await pool.query(
    `INSERT INTO employee_ratings (employee_id, rating_date, rating, is_manual)
     VALUES (?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE rating = IF(is_manual = 0, VALUES(rating), rating)`,
    [employeeId, dateStr, suggested]
  );
}

module.exports = { getRatings, upsertRating, autoFillMondayRating };
