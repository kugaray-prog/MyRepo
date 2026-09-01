-- ============================================================
-- GeoAttend Pro — Migration v5
-- Run this ONCE against your EXISTING database to add:
--   1) Multiple time-in / time-out cycles per employee/event/day
--      (attendance_sessions — one row per geofence dip), so an
--      employee can leave and re-enter the geofence any number of
--      times while the event is still running.
--   2) Accumulated duration tracking on the parent `attendance`
--      row (total_duration_seconds), which keeps growing across
--      every session instead of being overwritten by the last one.
--
-- Usage:
--   mysql -u <user> -p geoattend_pro < database/migration_v5.sql
--
-- Written as plain ALTER/CREATE statements (no "IF NOT EXISTS" on
-- columns/indexes) for compatibility with older MySQL/MariaDB —
-- run it exactly once on a database that hasn't already been
-- migrated.
-- ============================================================

USE geoattend_pro;

-- ------------------------------------------------------------
-- 1) Accumulated duration on the parent attendance row.
--    time_in keeps meaning "first time-in of the day"; time_out
--    now means "most recent time-out" and is set back to NULL
--    whenever the employee re-enters the geofence and a new
--    session opens — so `time_out IS NULL` still means
--    "currently on-going" for a whole day/event, even across
--    several separate visits.
-- ------------------------------------------------------------
ALTER TABLE attendance
  ADD COLUMN total_duration_seconds INT NOT NULL DEFAULT 0 AFTER work_hours;

-- Backfill from any existing single time_in/time_out pairs.
UPDATE attendance
  SET total_duration_seconds = GREATEST(0, TIMESTAMPDIFF(SECOND, time_in, time_out))
  WHERE time_in IS NOT NULL AND time_out IS NOT NULL;

-- ------------------------------------------------------------
-- 2) attendance_sessions — one row per time-in/time-out cycle
--    ("dip" into the geofence). The parent `attendance` row is
--    the one-per-day summary (status, ratings, totals); this
--    table is the detailed trail of every session that fed into
--    that summary.
-- ------------------------------------------------------------
CREATE TABLE attendance_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attendance_id INT NOT NULL,
  employee_id INT NOT NULL,
  time_in DATETIME NOT NULL,
  time_out DATETIME NULL,
  duration_seconds INT NULL,
  in_latitude DECIMAL(10,7) NULL,
  in_longitude DECIMAL(10,7) NULL,
  out_latitude DECIMAL(10,7) NULL,
  out_longitude DECIMAL(10,7) NULL,
  auto_ended TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (attendance_id) REFERENCES attendance(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_attendance_sessions_attendance ON attendance_sessions(attendance_id);
CREATE INDEX idx_attendance_sessions_open ON attendance_sessions(attendance_id, time_out);

-- Backfill one session per existing attendance row so history isn't lost.
INSERT INTO attendance_sessions
  (attendance_id, employee_id, time_in, time_out, duration_seconds, in_latitude, in_longitude, out_latitude, out_longitude, auto_ended)
SELECT id, employee_id, time_in, time_out, total_duration_seconds, latitude, longitude, last_lat, last_lng, auto_ended
FROM attendance
WHERE time_in IS NOT NULL;
