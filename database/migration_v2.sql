-- ============================================================
-- GeoAttend Pro — Migration v2
-- Run this ONCE against your EXISTING database to add the new
-- features (COS status + remarks, Monday ratings, dual-admin
-- roles, face verification, geo-anomaly alerts) without losing
-- your current data.
--
-- Usage:
--   mysql -u <user> -p geoattend_pro < database/migration_v2.sql
--
-- Written as plain ALTER/CREATE statements (no "IF NOT EXISTS"
-- on columns/indexes) for compatibility with older MySQL/MariaDB
-- — run it exactly once on a database that hasn't already been
-- migrated.
-- ============================================================

USE geoattend_pro;

-- ------------------------------------------------------------
-- 1) Employee status: add COS (Contract of Service) + a
--    separately-editable "remark" (Active / Inactive / Leave)
-- ------------------------------------------------------------
ALTER TABLE employees
  MODIFY COLUMN status ENUM('Full-time','Part-time','COS','Inactive') DEFAULT 'Full-time';

ALTER TABLE employees
  ADD COLUMN remark ENUM('Active','Inactive','Leave') DEFAULT 'Active' AFTER status;

-- ------------------------------------------------------------
-- 2) Ratings module: per-Monday 1-5 rating (1 = absent, 5 =
--    present), editable by the admin, independent of the
--    auto-computed attendance_score used elsewhere.
-- ------------------------------------------------------------
CREATE TABLE employee_ratings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  rating_date DATE NOT NULL, -- always a Monday
  rating TINYINT NOT NULL DEFAULT 1, -- 1 (absent) .. 5 (present)
  is_manual TINYINT(1) DEFAULT 0, -- 1 once an admin has hand-edited it (protects it from attendance auto-fill)
  notes VARCHAR(255) NULL,
  updated_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES admin_accounts(id) ON DELETE SET NULL,
  UNIQUE KEY uniq_emp_rating_date (employee_id, rating_date),
  CONSTRAINT chk_rating_range CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB;

CREATE INDEX idx_employee_ratings_date ON employee_ratings(rating_date);

-- ------------------------------------------------------------
-- 3) Face verification + geo-anomaly detection on attendance
-- ------------------------------------------------------------
ALTER TABLE attendance
  ADD COLUMN selfie_path VARCHAR(255) NULL AFTER rejection_reason,
  ADD COLUMN selfie_lat DECIMAL(10,7) NULL AFTER selfie_path,
  ADD COLUMN selfie_lng DECIMAL(10,7) NULL AFTER selfie_lat,
  ADD COLUMN requires_face_verification TINYINT(1) DEFAULT 0 AFTER selfie_lng,
  ADD COLUMN face_verified_at DATETIME NULL AFTER requires_face_verification;

CREATE TABLE geo_anomalies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attendance_id INT NULL,
  employee_id INT NOT NULL,
  event_id INT NULL,
  device_uid VARCHAR(150) NULL,
  anomaly_type ENUM('duplicate_geolocation','device_mismatch','impossible_travel','other') DEFAULT 'duplicate_geolocation',
  details TEXT NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  resolved TINYINT(1) DEFAULT 0,
  resolved_by INT NULL,
  resolved_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (attendance_id) REFERENCES attendance(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  FOREIGN KEY (resolved_by) REFERENCES admin_accounts(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE INDEX idx_geo_anomalies_resolved ON geo_anomalies(resolved);

-- ------------------------------------------------------------
-- 4) Dual-admin roles already exist in admin_accounts.role
--    ('super_admin' | 'admin' | 'staff'). From this migration
--    onward the app enforces: 'super_admin' = full access,
--    'admin' = OCR Verification module only. No schema change
--    needed here — just re-affirming the intent.
-- ------------------------------------------------------------
