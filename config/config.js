module.exports = {
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  },
  ocr: {
    minConfidence: 70 // percent — below this, OCR result is rejected as low_confidence
  },
  attendance: {
    lateGraceMinutes: 10,
    // If an employee's accumulated time inside the geofence, once the event
    // has ended, comes out to less than this fraction of the event's total
    // scheduled duration, they're marked Absent regardless of how their
    // check-in was originally classified (Present/Late) — showing up for a
    // few minutes and leaving doesn't count as having attended.
    minAttendanceRatioForPresence: Number(process.env.ATTENDANCE_MIN_RATIO) || 0.6,
    // GPS readings less accurate (higher, in meters) than this are rejected.
    // Desktop/laptop browsers have no real GPS chip and estimate location via
    // WiFi/IP (~100-1000m accuracy), so the strict default will almost always
    // fail there — that's expected, not a bug. On an actual phone outdoors,
    // GPS accuracy is typically 5-20m and passes easily.
    // Override via .env (ATTENDANCE_MAX_ACCURACY_METERS) if you need looser
    // testing on desktop; keep it at 50-100 for real phone deployments.
    maxAccuracyMeters: Number(process.env.ATTENDANCE_MAX_ACCURACY_METERS) || 100,
    // How many consecutive "outside the geofence" location pings from the
    // mobile app are required before the server auto-closes an attendance
    // session (sets time_out). Requiring more than one absorbs a single
    // noisy/inaccurate GPS reading instead of ending the session on it.
    autoEndOutsideStreakThreshold: Number(process.env.ATTENDANCE_AUTO_END_STREAK) || 2,
    // Minimum minutes between accepted heartbeat pings for the same
    // attendance record, to avoid flooding the DB from a tight watchPosition loop.
    heartbeatMinIntervalSeconds: Number(process.env.ATTENDANCE_HEARTBEAT_MIN_SECONDS) || 20
  },
  // Default/initial Geo-Fence location: CSPC (Camarines Sur Polytechnic
  // Colleges). Used to pre-fill the map/coordinates when an admin opens the
  // "create event" form. Admins can still change the location/radius per event.
  // Override via .env if your campus coordinates differ.
  defaultGeofence: {
    label: process.env.CSPC_LABEL || 'CSPC - Camarines Sur Polytechnic Colleges, Nabua, Camarines Sur',
    lat: Number(process.env.CSPC_LATITUDE) || 13.4079,
    lng: Number(process.env.CSPC_LONGITUDE) || 123.3735
  }
};
