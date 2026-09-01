const pool = require('../config/db');
const geofenceService = require('../services/geofenceService');
const config = require('../config/config');
const { logAction } = require('../services/auditService');
const { autoFillMondayRating } = require('./ratingController');

// Geolocation tolerance (in degrees) used to flag "suspiciously identical"
// coordinates between different employees/devices — a common spoofing/hacking
// signature (everyone reporting the exact same fake GPS point). ~11 meters.
const ANOMALY_COORD_TOLERANCE = 0.0001;
const ANOMALY_WINDOW_MINUTES = 15;

// Looks for other recent attendance submissions for the same event whose GPS
// coordinates are suspiciously close to this one but came from a different
// employee or device — logs a geo_anomalies row and flags the record for
// face verification when found.
async function detectGeoAnomaly({ attendanceId, employeeId, eventId, deviceUid, latitude, longitude }) {
  const [rows] = await pool.query(
    `SELECT a.id, a.employee_id, a.latitude, a.longitude, md.device_uid
     FROM attendance a
     LEFT JOIN mobile_devices md ON a.device_id = md.id
     WHERE a.event_id = ? AND a.employee_id != ? AND a.time_in >= (NOW() - INTERVAL ? MINUTE)
       AND ABS(a.latitude - ?) < ? AND ABS(a.longitude - ?) < ?`,
    [eventId, employeeId, ANOMALY_WINDOW_MINUTES, latitude, ANOMALY_COORD_TOLERANCE, longitude, ANOMALY_COORD_TOLERANCE]
  );
  if (!rows.length) return false;

  const details = `Matches attendance from employee #${rows[0].employee_id}` +
    (rows[0].device_uid && rows[0].device_uid !== deviceUid ? ` (different device: ${rows[0].device_uid})` : '');

  await pool.query(
    `INSERT INTO geo_anomalies (attendance_id, employee_id, event_id, device_uid, anomaly_type, details, latitude, longitude)
     VALUES (?, ?, ?, ?, 'duplicate_geolocation', ?, ?, ?)`,
    [attendanceId, employeeId, eventId, deviceUid || null, details, latitude, longitude]
  );

  await pool.query('UPDATE attendance SET requires_face_verification = 1, verification_status = ? WHERE id = ?', ['Pending', attendanceId]);

  await pool.query(
    `INSERT INTO notifications (employee_id, title, message, type) VALUES (?, 'Face Verification Required', ?, 'face_verification_required')`,
    [employeeId, 'We detected unusual location activity on your attendance. Please open the app and complete a quick face verification to confirm it was really you.']
  );

  return true;
}

// Recomputes an employee's attendance_score from their real attendance history —
// Present counts full credit, Late counts half credit, out of all recorded days.
// Keeps the Ratings leaderboard on the admin dashboard reflecting actual behavior
// instead of the static 100.00 default every employee starts with.
async function recalculateAttendanceScore(employeeId) {
  const [rows] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN attendance_status = 'Present' THEN 1 ELSE 0 END) AS present_count,
       SUM(CASE WHEN attendance_status = 'Late' THEN 1 ELSE 0 END) AS late_count
     FROM attendance WHERE employee_id = ?`,
    [employeeId]
  );
  const { total, present_count, late_count } = rows[0];
  if (!total) return;
  const score = ((Number(present_count) + Number(late_count) * 0.5) / total) * 100;
  await pool.query('UPDATE employees SET attendance_score = ? WHERE id = ?', [score.toFixed(2), employeeId]);
}

// Literal "5 Attended = 1 Rating Point, 1 No Attendance = deduction" rule
// requested for the employee/dashboard/report Rating displays. This is kept
// separate from recalculateAttendanceScore's percentage score and from the
// Monday employee_ratings leaderboard — each already has call sites elsewhere
// that depend on their current behavior, so this adds the literal counter
// alongside them rather than replacing either.
// Present/Late count as "Attended"; Absent counts as "No Attendance".
async function recalculateRatingPoints(employeeId) {
  const [rows] = await pool.query(
    `SELECT
       SUM(CASE WHEN attendance_status IN ('Present','Late') THEN 1 ELSE 0 END) AS attended_count,
       SUM(CASE WHEN attendance_status = 'Absent' THEN 1 ELSE 0 END) AS absent_count
     FROM attendance WHERE employee_id = ?`,
    [employeeId]
  );
  const attended = Number(rows[0].attended_count) || 0;
  const absent = Number(rows[0].absent_count) || 0;
  const points = Math.floor(attended / 5) - absent;
  await pool.query('UPDATE employees SET rating_points = ? WHERE id = ?', [points, employeeId]);
}

// Runs both rating recalculations together — call this after ANY insert,
// update, or delete of an attendance row so ratings never drift from the
// real attendance history (added / updated / removed / status flips all funnel here).
async function recalculateAllRatings(employeeId) {
  await recalculateAttendanceScore(employeeId);
  await recalculateRatingPoints(employeeId);
}

// Appended to attendance SELECTs so callers can render a "Duration" column
// and know whether a session is still ticking. open_session_time_in is the
// time_in of the currently-open attendance_sessions row (NULL once nothing
// is open); the client adds "now - open_session_time_in" to
// total_duration_seconds to show a live, still-accumulating duration while
// attendance_status stays "on-going". session_count is how many separate
// time-in/time-out dips make up that total, for a "×3 sessions" style hint.
const ATTENDANCE_DURATION_SUBQUERIES = `,
       (SELECT s.time_in FROM attendance_sessions s
         WHERE s.attendance_id = a.id AND s.time_out IS NULL
         ORDER BY s.time_in DESC LIMIT 1) AS open_session_time_in,
       (SELECT COUNT(*) FROM attendance_sessions s WHERE s.attendance_id = a.id) AS session_count`;

// Self-healing safety net: closes any attendance session left open past its
// event's end time. Normally the mobile app's heartbeat auto-closes a
// session once the device has been outside the geofence for a couple of
// pings — but that only works while the app is open and pinging. If the
// event simply ends while the employee is still standing inside the
// boundary, or the app gets closed/backgrounded before the outside-streak
// trips, nothing ever closes the session and its duration keeps climbing
// forever every time it's viewed. This runs before any attendance read (both
// the mobile "my history" and the admin attendance table) so a stale session
// gets closed and its total finalized before anyone sees it, capped at the
// event's own end_datetime rather than "now" so no extra time leaks in.
async function closeSessionsForEndedEvents() {
  const [staleRows] = await pool.query(
    `SELECT a.id, a.employee_id, a.attendance_status, a.total_duration_seconds,
            e.start_datetime, e.end_datetime
     FROM attendance a
     JOIN events e ON a.event_id = e.id
     WHERE a.time_out IS NULL AND e.end_datetime < NOW()`
  );
  if (!staleRows.length) return;

  for (const record of staleRows) {
    const [openSessionRows] = await pool.query(
      'SELECT * FROM attendance_sessions WHERE attendance_id = ? AND time_out IS NULL ORDER BY time_in ASC LIMIT 1',
      [record.id]
    );
    const openSession = openSessionRows[0];

    let sessionDurationSeconds = 0;
    if (openSession) {
      await pool.query(
        `UPDATE attendance_sessions
         SET time_out = ?, duration_seconds = GREATEST(0, TIMESTAMPDIFF(SECOND, time_in, ?)),
             auto_ended = 1
         WHERE id = ?`,
        [record.end_datetime, record.end_datetime, openSession.id]
      );
      const [[updatedSession]] = await pool.query('SELECT duration_seconds FROM attendance_sessions WHERE id = ?', [openSession.id]);
      sessionDurationSeconds = updatedSession ? updatedSession.duration_seconds : 0;
    }

    const totalDurationSeconds = (record.total_duration_seconds || 0) + sessionDurationSeconds;
    const workHours = (totalDurationSeconds / 3600).toFixed(2);

    // Once the event is fully over, we know the final total — if the employee
    // was present for less than minAttendanceRatioForPresence of the event's
    // scheduled duration, they're marked Absent regardless of how their
    // check-in was originally classified.
    const eventDurationSeconds = Math.max(1, (new Date(record.end_datetime) - new Date(record.start_datetime)) / 1000);
    const attendedRatio = totalDurationSeconds / eventDurationSeconds;
    const finalStatus = attendedRatio < config.attendance.minAttendanceRatioForPresence ? 'Absent' : record.attendance_status;

    await pool.query(
      `UPDATE attendance SET time_out = ?, total_duration_seconds = ?, work_hours = ?, attendance_status = ?, auto_ended = 1 WHERE id = ?`,
      [record.end_datetime, totalDurationSeconds, workHours, finalStatus, record.id]
    );
    await pool.query(
      `INSERT INTO attendance_logs (attendance_id, employee_id, action, details) VALUES (?, ?, 'auto_time_out', ?)`,
      [record.id, record.employee_id, JSON.stringify({
        reason: 'event_ended', sessionDurationSeconds, totalDurationSeconds,
        attendedRatio: Number(attendedRatio.toFixed(3)), finalStatus
      })]
    );

    if (finalStatus !== record.attendance_status) {
      await recalculateAllRatings(record.employee_id);
    }
  }
}

// GET /api/attendance/my-history  (employee JWT required — used by the mobile app)
async function getMyHistory(req, res, next) {
  try {
    await closeSessionsForEndedEvents();
    const [rows] = await pool.query(
      `SELECT a.*, ev.title AS event_title${ATTENDANCE_DURATION_SUBQUERIES} FROM attendance a
       LEFT JOIN events ev ON a.event_id = ev.id
       WHERE a.employee_id = ?
       ORDER BY a.attendance_date DESC, a.time_in DESC
       LIMIT 200`,
      [req.employee.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

// GET /api/attendance/:id/sessions  (employee JWT required — session-level
// breakdown behind the summary row, e.g. "9:03 AM–9:41 AM", "10:15 AM–…")
async function getSessions(req, res, next) {
  try {
    const [attendanceRows] = await pool.query(
      'SELECT id FROM attendance WHERE id = ? AND employee_id = ?',
      [req.params.id, req.employee.id]
    );
    if (!attendanceRows[0]) return res.status(404).json({ success: false, message: 'Attendance record not found.' });

    const [rows] = await pool.query(
      'SELECT * FROM attendance_sessions WHERE attendance_id = ? ORDER BY time_in ASC',
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

// GET /api/attendance/:id/sessions/admin  (admin JWT required — same
// session-level breakdown as getSessions, but for the admin's attendance
// table dropdown, so it isn't scoped to a single employee's own token.)
async function getSessionsAdmin(req, res, next) {
  try {
    const [attendanceRows] = await pool.query('SELECT id FROM attendance WHERE id = ?', [req.params.id]);
    if (!attendanceRows[0]) return res.status(404).json({ success: false, message: 'Attendance record not found.' });

    const [rows] = await pool.query(
      'SELECT * FROM attendance_sessions WHERE attendance_id = ? ORDER BY time_in ASC',
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

// GET /api/attendance?department=&date=&status=
async function getAttendance(req, res, next) {
  try {
    await closeSessionsForEndedEvents();
    const { department = 'all', date, status = 'all', event_id } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (department !== 'all') {
      where += ' AND d.name = ?';
      params.push(department);
    }
    if (date) {
      where += ' AND a.attendance_date = ?';
      params.push(date);
    }
    if (status !== 'all') {
      where += ' AND a.attendance_status = ?';
      params.push(status);
    }
    if (event_id) {
      where += ' AND a.event_id = ?';
      params.push(event_id);
    }

    const [rows] = await pool.query(
      `SELECT a.*, e.full_name, e.employee_code, d.name AS department_name, ev.title AS event_title${ATTENDANCE_DURATION_SUBQUERIES}
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       JOIN departments d ON e.department_id = d.id
       LEFT JOIN events ev ON a.event_id = ev.id
       ${where}
       ORDER BY a.attendance_date DESC, a.time_in DESC
       LIMIT 500`,
      params
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

// GET /api/attendance/by-department  (folder counts for the admin UI)
async function getAttendanceByDepartment(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT d.id, d.name, COUNT(e.id) AS member_count,
              (SELECT COUNT(*) FROM attendance a JOIN employees e2 ON a.employee_id = e2.id WHERE e2.department_id = d.id) AS log_count
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id
       GROUP BY d.id ORDER BY d.name`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/attendance/submit
 * Core mobile attendance flow. Validates, in order:
 *   1. Employee + device authorization
 *   2. GPS accuracy
 *   3. Event schedule window
 *   4. Geofence containment
 *   5. Session continuation (multi-session time-in/time-out, same day)
 * Body: { employee_id, device_uid, event_id, latitude, longitude, accuracy, ocr_record_id }
 */
async function submitAttendance(req, res, next) {
  try {
    const { employee_id, device_uid, event_id, latitude, longitude, accuracy, ocr_record_id } = req.body;

    if (!employee_id || !event_id || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: 'employee_id, event_id, latitude, and longitude are required.' });
    }

    // Same stale-local-session guard as deviceController.registerDevice —
    // fail with a clear, specific message instead of an FK constraint crash
    // if this device's cached employee_id no longer exists.
    const [employeeExists] = await pool.query('SELECT id FROM employees WHERE id = ?', [employee_id]);
    if (!employeeExists[0]) {
      return res.status(404).json({
        success: false,
        code: 'EMPLOYEE_NOT_FOUND',
        message: 'Your account could not be found. Please sign out and sign in again.'
      });
    }

    // 1. Device authorization
    let device = null;
    if (device_uid) {
      const [deviceRows] = await pool.query(
        'SELECT * FROM mobile_devices WHERE device_uid = ? AND employee_id = ?',
        [device_uid, employee_id]
      );
      device = deviceRows[0];
      if (!device) {
        return res.status(403).json({ success: false, message: 'This device is not registered to this employee.' });
      }
      if (device.status === 'blacklisted' || device.status === 'rejected') {
        return res.status(403).json({ success: false, message: 'This device is not authorized for attendance.' });
      }
      if (device.status === 'pending') {
        return res.status(403).json({ success: false, message: 'This device is pending admin approval.' });
      }
    }

    // 2. GPS accuracy
    if (accuracy !== undefined && accuracy > config.attendance.maxAccuracyMeters) {
      return res.status(400).json({ success: false, message: `GPS accuracy too low (${accuracy}m). Move to an open area and try again.` });
    }

    // 3. Event schedule
    const [eventRows] = await pool.query('SELECT * FROM events WHERE id = ?', [event_id]);
    const event = eventRows[0];
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    const now = new Date();
    if (now < new Date(event.start_datetime) || now > new Date(event.end_datetime)) {
      return res.status(400).json({ success: false, message: 'Attendance is only allowed during the scheduled event window.' });
    }

    // 4. Geofence containment
    const [geofenceRows] = await pool.query('SELECT * FROM geofences WHERE event_id = ? AND is_active = 1', [event_id]);
    const geofence = geofenceRows[0];
    if (!geofence) return res.status(404).json({ success: false, message: 'No active geofence configured for this event.' });
    if (geofenceRows.length > 1) {
      // Shouldn't normally happen (createGeofence makes one event -> one geofence),
      // but if test data ended up with duplicates, flag it — the row picked here
      // (geofenceRows[0]) may not be the one the mobile app's own /mobile/active
      // fetch resolved to, which would explain an inside/outside mismatch.
      console.warn(`[geofence check] event_id ${event_id} has ${geofenceRows.length} active geofences — using id ${geofence.id}. Duplicate geofences can cause client/server mismatches.`);
    }

    let points = [];
    if (geofence.shape_type !== 'circle') {
      const [pointRows] = await pool.query(
        'SELECT lat, lng FROM geofence_points WHERE geofence_id = ? ORDER BY point_order',
        [geofence.id]
      );
      // mysql2 returns DECIMAL columns as strings by default — convert to Number
      // here (mirroring geofenceController.js's own conversion) so this array is
      // safe to hand to geofenceService regardless of that service's internals.
      points = pointRows.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
    }

    const { inside, distanceMeters } = geofenceService.isInsideGeofence(
      parseFloat(latitude),
      parseFloat(longitude),
      { ...geofence, points }
    );

    // Debug logging — compares the submitted GPS point against the exact polygon
    // the server used for this decision. If the mobile app's live "inside" check
    // disagrees with this, the printed points/coords make it obvious whether it's
    // GPS drift near a small polygon's edge vs a genuine data mismatch.
    console.log('[geofence check]', {
      event_id,
      geofence_id: geofence.id,
      shape_type: geofence.shape_type,
      submitted: { lat: parseFloat(latitude), lng: parseFloat(longitude) },
      points,
      inside,
      distanceMeters
    });

    if (!inside) {
      await pool.query(
        `INSERT INTO attendance_logs (employee_id, action, details) VALUES (?, 'attendance_rejected', ?)`,
        [employee_id, JSON.stringify({ reason: 'outside_geofence', distanceMeters })]
      );
      return res.status(403).json({
        success: false,
        message: `You are outside the geofence boundary${distanceMeters ? ` (${distanceMeters}m away)` : ''}.`
      });
    }

    // 5. Session continuation — an employee may time in and out of the SAME
    // event any number of times while it hasn't ended yet, and every dip
    // accumulates into that day's total_duration_seconds. `attendance` stays
    // one row per employee/event/day (status, ratings, running total);
    // `attendance_sessions` holds one row per individual time-in/time-out.
    const today = now.toISOString().slice(0, 10);
    const [existingRows] = await pool.query(
      'SELECT * FROM attendance WHERE employee_id = ? AND attendance_date = ? AND event_id = ?',
      [employee_id, today, event_id]
    );
    const existing = existingRows[0];

    const lateGraceMs = config.attendance.lateGraceMinutes * 60 * 1000;
    const lateThreshold = new Date(new Date(event.start_datetime).getTime() + lateGraceMs);
    const isLate = now > lateThreshold;
    const lateMinutes = isLate ? Math.round((now - new Date(event.start_datetime)) / 60000) : 0;

    if (existing) {
      // A session is already open (time_out not yet set) — nothing to do;
      // time-out is handled automatically by heartbeat() once the device
      // actually leaves the geofence, not by a second call to this endpoint.
      if (!existing.time_out) {
        return res.status(409).json({ success: false, message: 'Attendance session already in progress for this event.' });
      }

      // The employee left and has now re-entered the geofence while the
      // event is still running: open a brand-new session, and flip the
      // parent row back to "on-going" (time_out = NULL) without touching
      // its original time_in or accumulated total_duration_seconds.
      const [sessionResult] = await pool.query(
        `INSERT INTO attendance_sessions (attendance_id, employee_id, time_in, in_latitude, in_longitude)
         VALUES (?, ?, NOW(), ?, ?)`,
        [existing.id, employee_id, latitude, longitude]
      );
      await pool.query(
        `UPDATE attendance SET time_out = NULL, outside_streak = 0, latitude = ?, longitude = ?, accuracy_meters = ? WHERE id = ?`,
        [latitude, longitude, accuracy || null, existing.id]
      );
      await pool.query(
        `INSERT INTO attendance_logs (attendance_id, employee_id, action, details) VALUES (?, ?, 'time_in', ?)`,
        [existing.id, employee_id, JSON.stringify({ latitude, longitude, session_id: sessionResult.insertId, re_entry: true })]
      );

      const anomalyDetectedAgain = await detectGeoAnomaly({
        attendanceId: existing.id,
        employeeId: employee_id,
        eventId: event_id,
        deviceUid: device_uid,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude)
      });
      if (!anomalyDetectedAgain) {
        await pool.query(
          `INSERT INTO notifications (employee_id, title, message, type) VALUES (?, 'Time-In Recorded', ?, 'attendance_success')`,
          [employee_id, `You re-entered "${event.title}" and were automatically timed in again.`]
        );
      }

      return res.status(200).json({
        success: true,
        message: 'Welcome back — time-in recorded again.',
        data: { id: existing.id, sessionId: sessionResult.insertId, action: 'time_in', status: existing.attendance_status, requiresFaceVerification: anomalyDetectedAgain }
      });
    }

    // First time-in of the day for this event.
    const [insertResult] = await pool.query(
      `INSERT INTO attendance
        (employee_id, event_id, geofence_id, device_id, ocr_record_id, attendance_date, time_in,
         latitude, longitude, accuracy_meters, attendance_status, verification_status, late_minutes)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, 'Verified', ?)`,
      [
        employee_id,
        event_id,
        geofence.id,
        device ? device.id : null,
        ocr_record_id || null,
        today,
        latitude,
        longitude,
        accuracy || null,
        isLate ? 'Late' : 'Present',
        lateMinutes
      ]
    );

    await pool.query(
      `INSERT INTO attendance_sessions (attendance_id, employee_id, time_in, in_latitude, in_longitude)
       VALUES (?, ?, NOW(), ?, ?)`,
      [insertResult.insertId, employee_id, latitude, longitude]
    );

    await pool.query(
      `INSERT INTO attendance_logs (attendance_id, employee_id, action, details) VALUES (?, ?, 'time_in', ?)`,
      [insertResult.insertId, employee_id, JSON.stringify({ latitude, longitude, isLate })]
    );

    const anomalyDetected = await detectGeoAnomaly({
      attendanceId: insertResult.insertId,
      employeeId: employee_id,
      eventId: event_id,
      deviceUid: device_uid,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude)
    });

    if (!anomalyDetected) {
      await pool.query(
        `INSERT INTO notifications (employee_id, title, message, type) VALUES (?, 'Attendance Recorded', ?, 'attendance_success')`,
        [employee_id, `Your attendance for "${event.title}" was recorded as ${isLate ? 'Late' : 'Present'}.`]
      );
    }

    await recalculateAllRatings(employee_id);
    await autoFillMondayRating(employee_id, today, isLate ? 'Late' : 'Present');

    res.status(201).json({
      success: true,
      message: anomalyDetected
        ? 'Attendance recorded, but unusual location activity was detected. Please complete face verification in the app.'
        : `Attendance recorded as ${isLate ? 'Late' : 'Present'}.`,
      data: { id: insertResult.insertId, action: 'time_in', status: isLate ? 'Late' : 'Present', lateMinutes, requiresFaceVerification: anomalyDetected }
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/attendance/:id/face-verify  (employee JWT required)
// Body (multipart): selfie (file), latitude, longitude
async function faceVerify(req, res, next) {
  try {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    const [rows] = await pool.query('SELECT * FROM attendance WHERE id = ? AND employee_id = ?', [id, req.employee.id]);
    const record = rows[0];
    if (!record) return res.status(404).json({ success: false, message: 'Attendance record not found.' });
    if (!req.file) return res.status(400).json({ success: false, message: 'A selfie photo is required.' });

    const selfiePath = `/uploads/selfies/${req.file.filename}`;

    await pool.query(
      `UPDATE attendance SET selfie_path = ?, selfie_lat = ?, selfie_lng = ?, requires_face_verification = 0,
       face_verified_at = NOW(), verification_status = 'Verified' WHERE id = ?`,
      [selfiePath, latitude || null, longitude || null, id]
    );

    await pool.query(
      `UPDATE geo_anomalies SET resolved = 1, resolved_at = NOW() WHERE attendance_id = ? AND resolved = 0`,
      [id]
    );

    await pool.query(
      `INSERT INTO attendance_logs (attendance_id, employee_id, action, details) VALUES (?, ?, 'face_verified', ?)`,
      [id, req.employee.id, JSON.stringify({ latitude, longitude })]
    );

    res.json({ success: true, message: 'Face verification submitted. Your attendance is now confirmed.' });
  } catch (err) {
    next(err);
  }
}

// GET /api/attendance/anomalies  (admin — powers the Geo-Fence alerts panel)
async function getAnomalies(req, res, next) {
  try {
    const { resolved = '0' } = req.query;
    const [rows] = await pool.query(
      `SELECT ga.*, e.full_name, e.employee_code, ev.title AS event_title
       FROM geo_anomalies ga
       JOIN employees e ON ga.employee_id = e.id
       LEFT JOIN events ev ON ga.event_id = ev.id
       WHERE ga.resolved = ?
       ORDER BY ga.created_at DESC
       LIMIT 100`,
      [resolved === '1' ? 1 : 0]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/attendance/anomalies/:id/resolve  (admin)
async function resolveAnomaly(req, res, next) {
  try {
    await pool.query(
      'UPDATE geo_anomalies SET resolved = 1, resolved_by = ?, resolved_at = NOW() WHERE id = ?',
      [req.admin.id, req.params.id]
    );
    res.json({ success: true, message: 'Alert marked as resolved.' });
  } catch (err) {
    next(err);
  }
}

// GET /api/attendance/by-event  (folder counts for the "organized by Event" admin UI)
async function getAttendanceByEvent(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT e.id, e.title, e.venue, e.start_datetime, e.end_datetime,
              (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id) AS log_count
       FROM events e
       ORDER BY e.start_datetime DESC
       LIMIT 100`
    );
    const now = new Date();
    const data = rows.map((e) => {
      const start = new Date(e.start_datetime);
      const end = new Date(e.end_datetime);
      let computed_status = 'upcoming';
      if (now >= start && now <= end) computed_status = 'ongoing';
      else if (now > end) computed_status = 'completed';
      return { ...e, computed_status };
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/attendance/:id  (admin — manual correction, e.g. flipping a
// record between Present/Late/Absent/Excused). Always re-recalculates the
// affected employee's ratings afterward so nothing goes stale.
async function updateAttendance(req, res, next) {
  try {
    const { id } = req.params;
    const { attendance_status } = req.body;
    const validStatuses = ['Present', 'Late', 'Absent', 'Excused'];
    if (!validStatuses.includes(attendance_status)) {
      return res.status(400).json({ success: false, message: `attendance_status must be one of: ${validStatuses.join(', ')}.` });
    }

    const [rows] = await pool.query('SELECT * FROM attendance WHERE id = ?', [id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Attendance record not found.' });

    await pool.query('UPDATE attendance SET attendance_status = ? WHERE id = ?', [attendance_status, id]);
    await pool.query(
      `INSERT INTO attendance_logs (attendance_id, employee_id, action, details) VALUES (?, ?, 'admin_status_change', ?)`,
      [id, rows[0].employee_id, JSON.stringify({ from: rows[0].attendance_status, to: attendance_status, by: req.admin.id })]
    );

    await recalculateAllRatings(rows[0].employee_id);
    await logAction({ adminId: req.admin.id, action: 'update', module: 'attendance', details: { id, attendance_status }, ip: req.ip });

    res.json({ success: true, message: 'Attendance record updated and ratings recalculated.' });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/attendance/:id  (admin)
async function deleteAttendance(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT * FROM attendance WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Attendance record not found.' });

    await pool.query('DELETE FROM attendance WHERE id = ?', [req.params.id]);
    await recalculateAllRatings(rows[0].employee_id);
    await logAction({ adminId: req.admin.id, action: 'delete', module: 'attendance', details: { id: req.params.id }, ip: req.ip });

    res.json({ success: true, message: 'Attendance record deleted and ratings recalculated.' });
  } catch (err) {
    next(err);
  }
}

// POST /api/attendance/:id/heartbeat  (employee JWT required — mobile app)
// Body: { latitude, longitude }
// The mobile app calls this periodically (see config.attendance.heartbeatMinIntervalSeconds)
// while an attendance session is open (time_in set, time_out not yet set).
// When the employee's location falls outside the event's geofence for
// config.attendance.autoEndOutsideStreakThreshold consecutive pings in a row,
// the server automatically closes the session (sets time_out + work_hours) —
// a single stray/inaccurate GPS reading is not enough to end it early.
async function heartbeat(req, res, next) {
  try {
    const { id } = req.params;
    const { latitude, longitude } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: 'latitude and longitude are required.' });
    }

    const [rows] = await pool.query('SELECT * FROM attendance WHERE id = ? AND employee_id = ?', [id, req.employee.id]);
    const record = rows[0];
    if (!record) return res.status(404).json({ success: false, message: 'Attendance record not found.' });
    if (record.time_out) {
      // Nothing currently open — the employee already left. If they walk
      // back into the geofence, submitAttendance() opens a fresh session
      // automatically, so there's nothing for this ping to do right now.
      return res.json({ success: true, message: 'No session currently open.', data: { ended: true } });
    }

    // The event may have simply ended while the employee was still standing
    // inside the boundary — that's not a "left the geofence" case at all, so
    // the outside-streak logic below would never catch it and the session
    // (and its duration) would keep running forever. Close it immediately,
    // capped at the event's own end time.
    const [eventRows] = await pool.query('SELECT end_datetime FROM events WHERE id = ?', [record.event_id]);
    if (eventRows[0] && new Date(eventRows[0].end_datetime) <= new Date()) {
      await closeSessionsForEndedEvents();
      return res.json({ success: true, message: 'Event has ended.', data: { ended: true } });
    }

    // Debounce: ignore pings that arrive faster than the configured minimum interval.
    if (record.last_ping_at) {
      const secondsSinceLast = (Date.now() - new Date(record.last_ping_at).getTime()) / 1000;
      if (secondsSinceLast < config.attendance.heartbeatMinIntervalSeconds) {
        return res.json({ success: true, message: 'Ping ignored (too soon).', data: { ended: false } });
      }
    }

    const [geofenceRows] = await pool.query('SELECT * FROM geofences WHERE id = ?', [record.geofence_id]);
    const geofence = geofenceRows[0];
    let inside = true;
    if (geofence) {
      let points = [];
      if (geofence.shape_type !== 'circle') {
        const [pointRows] = await pool.query('SELECT lat, lng FROM geofence_points WHERE geofence_id = ? ORDER BY point_order', [geofence.id]);
        points = pointRows.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
      }
      ({ inside } = geofenceService.isInsideGeofence(parseFloat(latitude), parseFloat(longitude), { ...geofence, points }));
    }

    const newStreak = inside ? 0 : (record.outside_streak || 0) + 1;
    const shouldAutoEnd = newStreak >= config.attendance.autoEndOutsideStreakThreshold;

    if (shouldAutoEnd) {
      // Close whichever session is still open for this attendance row, and
      // fold its duration into the running total — a later re-entry (see
      // submitAttendance) opens a new session and keeps adding to this same
      // total rather than overwriting it.
      const [openSessionRows] = await pool.query(
        'SELECT * FROM attendance_sessions WHERE attendance_id = ? AND time_out IS NULL ORDER BY time_in DESC LIMIT 1',
        [id]
      );
      const openSession = openSessionRows[0];

      let sessionDurationSeconds = 0;
      if (openSession) {
        await pool.query(
          `UPDATE attendance_sessions
           SET time_out = NOW(), duration_seconds = GREATEST(0, TIMESTAMPDIFF(SECOND, time_in, NOW())),
               out_latitude = ?, out_longitude = ?, auto_ended = 1
           WHERE id = ?`,
          [latitude, longitude, openSession.id]
        );
        const [[updatedSession]] = await pool.query('SELECT duration_seconds FROM attendance_sessions WHERE id = ?', [openSession.id]);
        sessionDurationSeconds = updatedSession ? updatedSession.duration_seconds : 0;
      } else {
        // Shouldn't normally happen (a session is opened every time time_out
        // is cleared) — fall back to the parent row's own time_in so a
        // duration is still recorded instead of silently dropping it.
        sessionDurationSeconds = Math.max(0, Math.round((Date.now() - new Date(record.time_in).getTime()) / 1000));
      }

      const totalDurationSeconds = (record.total_duration_seconds || 0) + sessionDurationSeconds;
      const workHours = (totalDurationSeconds / 3600).toFixed(2);

      await pool.query(
        `UPDATE attendance SET time_out = NOW(), total_duration_seconds = ?, work_hours = ?, last_lat = ?, last_lng = ?, last_ping_at = NOW(), outside_streak = ?, auto_ended = 1 WHERE id = ?`,
        [totalDurationSeconds, workHours, latitude, longitude, newStreak, id]
      );
      await pool.query(
        `INSERT INTO attendance_logs (attendance_id, employee_id, action, details) VALUES (?, ?, 'auto_time_out', ?)`,
        [id, req.employee.id, JSON.stringify({ latitude, longitude, reason: 'left_geofence', sessionDurationSeconds, totalDurationSeconds })]
      );
      await pool.query(
        `INSERT INTO notifications (employee_id, title, message, type) VALUES (?, 'Time-Out Recorded', ?, 'attendance_auto_end')`,
        [req.employee.id, `You left the event area, so your session was automatically timed out. Total time so far: ${workHours} hour(s).`]
      );
    } else {
      await pool.query(
        `UPDATE attendance SET last_lat = ?, last_lng = ?, last_ping_at = NOW(), outside_streak = ? WHERE id = ?`,
        [latitude, longitude, newStreak, id]
      );
    }

    res.json({ success: true, data: { ended: shouldAutoEnd, inside, outsideStreak: newStreak } });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAttendance,
  getAttendanceByDepartment,
  getAttendanceByEvent,
  submitAttendance,
  getMyHistory,
  getSessions,
  getSessionsAdmin,
  faceVerify,
  getAnomalies,
  resolveAnomaly,
  updateAttendance,
  deleteAttendance,
  heartbeat
};
