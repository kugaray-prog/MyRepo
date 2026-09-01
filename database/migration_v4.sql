-- ============================================================
-- GeoAttend Pro — Migration v4
-- Run this ONCE against your EXISTING database to add:
--   1) Employee Classification (Regular / COS / Casual)
--   2) Recurring / multi-day Flag Ceremony events
--   3) Automatic end-time tracking when an employee leaves the
--      geofence (last-seen location + auto-close bookkeeping)
--   4) A literal "5 Attended = 1 Rating Point" employee rating
--      counter, separate from the existing percentage-based
--      attendance_score and the existing Monday 1-5 rating table
--   5) Default CSPC coordinates seeded into settings
--
-- Usage:
--   mysql -u <user> -p geoattend_pro < database/migration_v4.sql
--
-- Written as plain ALTER/CREATE statements (no "IF NOT EXISTS"
-- on columns/indexes) for compatibility with older MySQL/MariaDB
-- — run it exactly once on a database that hasn't already been
-- migrated.
-- ============================================================

USE geoattend_pro;

-- ------------------------------------------------------------
-- 1) Employee Classification: Regular / COS / Casual
--    (kept separate from the existing "status" column, which
--    controls Full-time/Part-time/COS/Inactive employment type)
-- ------------------------------------------------------------
ALTER TABLE employees
  ADD COLUMN classification ENUM('Regular','COS','Casual') DEFAULT 'Regular' AFTER status;

-- Best-effort backfill: anyone already marked status='COS' is
-- classified COS; everyone else defaults to Regular. Review and
-- adjust individual records (e.g. Casual) from the admin dashboard.
UPDATE employees SET classification = 'COS' WHERE status = 'COS';

CREATE INDEX idx_employees_classification ON employees(classification);

-- ------------------------------------------------------------
-- 2) Recurring / multi-day events. A "parent" event stores the
--    recurrence rule; each generated occurrence is its own row
--    in `events` (so it keeps its own geofence + attendance
--    records) linked back via parent_event_id.
-- ------------------------------------------------------------
ALTER TABLE events
  ADD COLUMN recurrence_type ENUM('none','weekly','dates') NOT NULL DEFAULT 'none' AFTER is_active,
  ADD COLUMN recurrence_days VARCHAR(20) NULL AFTER recurrence_type, -- comma list of ISO weekdays, 1=Mon..7=Sun, e.g. "1,3,5"
  ADD COLUMN recurrence_end_date DATE NULL AFTER recurrence_days,
  ADD COLUMN is_recurring_parent TINYINT(1) NOT NULL DEFAULT 0 AFTER recurrence_end_date,
  ADD COLUMN parent_event_id INT NULL AFTER is_recurring_parent,
  ADD CONSTRAINT fk_events_parent FOREIGN KEY (parent_event_id) REFERENCES events(id) ON DELETE CASCADE;

CREATE INDEX idx_events_parent ON events(parent_event_id);

-- ------------------------------------------------------------
-- 3) Automatic end-time when the employee leaves the geofence.
--    last_lat/last_lng/last_ping_at track the mobile app's most
--    recent location "heartbeat" while a session is open;
--    outside_streak counts consecutive outside-geofence pings so
--    a single noisy GPS reading doesn't end the session early;
--    auto_ended flags that time_out was set by this mechanism
--    (vs. a manual submission) for reporting/audit purposes.
-- ------------------------------------------------------------
ALTER TABLE attendance
  ADD COLUMN last_lat DECIMAL(10,7) NULL AFTER work_hours,
  ADD COLUMN last_lng DECIMAL(10,7) NULL AFTER last_lat,
  ADD COLUMN last_ping_at DATETIME NULL AFTER last_lng,
  ADD COLUMN outside_streak INT NOT NULL DEFAULT 0 AFTER last_ping_at,
  ADD COLUMN auto_ended TINYINT(1) NOT NULL DEFAULT 0 AFTER outside_streak;

-- ------------------------------------------------------------
-- 4) Literal "5 Attended = 1 Rating Point, 1 No Attendance =
--    deduction" counter. Kept alongside (not replacing) the
--    existing attendance_score percentage and the Monday
--    employee_ratings table, since different parts of the app
--    already depend on those.
-- ------------------------------------------------------------
ALTER TABLE employees
  ADD COLUMN rating_points DECIMAL(6,2) NOT NULL DEFAULT 0 AFTER attendance_score;

-- ------------------------------------------------------------
-- 5) Seed the default Geo-Fence location: CSPC (Camarines Sur
--    Polytechnic Colleges). Used as the initial map center /
--    suggested coordinates when an admin creates a new event.
--    Adjust cspc_latitude / cspc_longitude here if your campus
--    coordinates differ.
-- ------------------------------------------------------------
INSERT INTO settings (setting_key, setting_value) VALUES
  ('cspc_latitude', '13.4079'),
  ('cspc_longitude', '123.3735'),
  ('cspc_label', 'CSPC - Camarines Sur Polytechnic Colleges, Nabua, Camarines Sur'),
  ('default_geofence_radius', '150')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
