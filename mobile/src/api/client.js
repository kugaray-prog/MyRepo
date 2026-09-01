import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Point this at your machine's LAN IP when testing on a physical device,
// e.g. http://192.168.1.20:3000/api — 'localhost' only works in a simulator.
export const API_BASE_URL = 'http://172.16.22.233:3000/api';

const api = axios.create({ baseURL: API_BASE_URL, timeout: 15000 });

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('employee_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Set by AuthContext on mount. Lets any API call anywhere in the app trigger
// a clean sign-out when the server reports this device's cached employee_id
// no longer exists (e.g. the employee record was deleted/recreated by an
// admin) — instead of every screen having to special-case that error itself.
let staleSessionHandler = null;
export function setStaleSessionHandler(fn) {
  staleSessionHandler = fn;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const code = error?.response?.data?.code;
    if ((code === 'EMPLOYEE_NOT_FOUND' || code === 'STALE_REFERENCE') && staleSessionHandler) {
      staleSessionHandler();
    }
    return Promise.reject(error);
  }
);

export async function registerDevice(payload) {
  const { data } = await api.post('/devices/register', payload);
  return data;
}

// POST /api/employee-auth/google { credential, device_uid } — credential is the
// Google ID token. device_uid lets the server report this specific device's
// approval status (an employee may have more than one registered device).
export async function googleLogin(credential, deviceUid) {
  const { data } = await api.post('/employee-auth/google', { credential, device_uid: deviceUid });
  return data;
}

// POST /api/employee-auth/link-device — confirms the pending Google sign-in against
// an admin-provisioned employee record and registers this device.
export async function linkDevice(payload) {
  const { data } = await api.post('/employee-auth/link-device', payload);
  return data;
}

// GET /api/employee-auth/device-status — polled by the "Waiting for Approval"
// screen to detect the moment an admin approves this device. device_uid
// scopes the check to this physical device, since an employee may have more
// than one registered device with different statuses.
export async function getDeviceStatus(deviceUid) {
  const { data } = await api.get('/employee-auth/device-status', { params: { device_uid: deviceUid } });
  return data;
}

export async function submitAttendance(payload) {
  const { data } = await api.post('/attendance/submit', payload);
  return data;
}

// POST /api/attendance/:id/heartbeat — sent periodically while an attendance
// session is open, so the server can auto-close it (set time_out) once the
// employee has been outside the geofence for a couple of consecutive pings.
export async function sendHeartbeat(attendanceId, latitude, longitude) {
  const { data } = await api.post(`/attendance/${attendanceId}/heartbeat`, { latitude, longitude });
  return data;
}

// GET /api/attendance/my-history — used to restore attendance state (including
// accumulated duration across all of today's time-in/time-out sessions) after
// an app restart/refresh, not just from local storage.
export async function getMyHistory() {
  const { data } = await api.get('/attendance/my-history');
  return data;
}

// GET /api/attendance/:id/sessions — the individual time-in/time-out dips
// behind one day's summary row, e.g. for a "9:03 AM–9:41 AM, 10:15 AM–…" breakdown.
export async function getAttendanceSessions(attendanceId) {
  const { data } = await api.get(`/attendance/${attendanceId}/sessions`);
  return data;
}

// GET /api/geofences/mobile/active — the employee-facing endpoint (active + upcoming
// events only). This is what actually connects an admin-created event/geofence to the
// mobile app; the plain '/geofences' route is admin-only and will 403 for employee tokens.
export async function getGeofences() {
  const { data } = await api.get('/geofences/mobile/active');
  return data;
}

export default api;
