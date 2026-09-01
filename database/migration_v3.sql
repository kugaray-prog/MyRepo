-- ============================================================
-- GeoAttend Pro — Migration v3
-- Run this ONCE against your EXISTING database to split the
-- employee "Full Name" field into Surname / Given Name /
-- Middle Name / Suffix, without losing existing data.
--
-- Usage:
--   mysql -u <user> -p geoattend_pro < database/migration_v3.sql
-- ============================================================

USE geoattend_pro;

-- ------------------------------------------------------------
-- 1) Add the new name columns. full_name is KEPT (and is still
--    kept in sync automatically by the app) so every existing
--    query, report, and certificate that reads full_name keeps
--    working unchanged.
-- ------------------------------------------------------------
ALTER TABLE employees
  ADD COLUMN surname VARCHAR(80) NULL AFTER full_name,
  ADD COLUMN given_name VARCHAR(80) NULL AFTER surname,
  ADD COLUMN middle_name VARCHAR(80) NULL AFTER given_name,
  ADD COLUMN suffix VARCHAR(10) NULL AFTER middle_name;

-- ------------------------------------------------------------
-- 2) Best-effort backfill for existing rows: assumes full_name
--    was stored as "Given [Middle] Surname" (the previous
--    single-field format). Review/edit any records this guesses
--    wrong from the admin dashboard afterwards — it only fills
--    in surname/given_name, it never touches full_name.
-- ------------------------------------------------------------
UPDATE employees
SET
  surname = TRIM(SUBSTRING_INDEX(full_name, ' ', -1)),
  given_name = TRIM(SUBSTRING_INDEX(full_name, ' ', 1))
WHERE surname IS NULL;
