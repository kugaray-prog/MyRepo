// ============================================================
// CSPC GeoAttend — Mobile Web App
// Same UI/design as provided. All data now comes from the real
// GeoAttend Pro backend via fetch() calls — no simulated logic.
// ============================================================

const API = window.__API_BASE__ || '/api';

// ---- Persistent device identity -----------------------------------------
// Browsers cannot read a real MAC address or IMEI (that's blocked for
// privacy/security reasons on every modern browser), so we generate and
// persist our own device UUID instead — this is what actually gets sent to
// the backend as device_uid for device-binding and attendance validation.
function getDeviceUid() {
  let uid = localStorage.getItem('ga_device_uid');
  if (!uid) {
    uid = (crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    localStorage.setItem('ga_device_uid', uid);
  }
  return uid;
}

function parseDeviceInfo() {
  const ua = navigator.userAgent || '';
  let brand = 'Unknown', model = navigator.platform || 'Unknown Device', os = 'Unknown OS';
  if (/iphone/i.test(ua)) { brand = 'Apple'; model = 'iPhone'; os = (ua.match(/OS (\d+_\d+)/) || [])[1]?.replace('_', '.') ? `iOS ${ua.match(/OS (\d+_\d+)/)[1].replace('_', '.')}` : 'iOS'; }
  else if (/ipad/i.test(ua)) { brand = 'Apple'; model = 'iPad'; os = 'iPadOS'; }
  else if (/android/i.test(ua)) { brand = 'Android'; model = (ua.match(/Android[^;]*;\s([^)]*)\)/) || [])[1] || 'Android Device'; os = `Android ${(ua.match(/Android (\d+)/) || [])[1] || ''}`.trim(); }
  else { brand = 'Desktop'; model = 'Web Browser'; os = navigator.platform || 'Unknown'; }
  return { brand, model, os };
}

// ---- Session storage ------------------------------------------------------
function saveSession(token, employee) {
  localStorage.setItem('ga_mobile_token', token);
  localStorage.setItem('ga_mobile_employee', JSON.stringify(employee));
}
function getToken() { return localStorage.getItem('ga_mobile_token'); }
function getEmployee() {
  const raw = localStorage.getItem('ga_mobile_employee');
  return raw ? JSON.parse(raw) : null;
}
function clearSession() {
  localStorage.removeItem('ga_mobile_token');
  localStorage.removeItem('ga_mobile_employee');
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  let data;
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

// ---- Real-time clock --------------------------------------------------------
setInterval(() => {
  const clockEl = document.getElementById('clock');
  if (clockEl) clockEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}, 1000);

// ---- Screen management ------------------------------------------------------
let pendingGoogleToken = null; // set after a Google login that didn't match an existing employee
let activeGeofence = null;     // the currently-relevant event/geofence for attendance
let currentAttendanceRecordAction = null; // 'time_in' once checked in, drives the button's next tap

function switchScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');

  const mainScreens = ['home', 'logs', 'profile'];
  document.getElementById('bottomNav').style.display = mainScreens.includes(id) ? 'flex' : 'none';

  const navs = document.querySelectorAll('.nav-item');
  navs.forEach(n => n.classList.remove('active'));
  if (id === 'home') { navs[0].classList.add('active'); loadHomeData(); }
  if (id === 'logs') { navs[1].classList.add('active'); loadLogs(); }
  if (id === 'profile') { navs[2].classList.add('active'); renderProfile(); }
  if (id === 'register') prefillRegistrationForm();
}

function showOverlay(title, sub) {
  const o = document.getElementById('globalOverlay');
  document.getElementById('overlayTitle').textContent = title;
  document.getElementById('overlaySub').textContent = sub;
  o.style.display = 'flex';
}
function hideOverlay() { document.getElementById('globalOverlay').style.display = 'none'; }

// ---- Google Sign-In -----------------------------------------------------
function initGoogleSignIn() {
  const clientId = window.__GOOGLE_CLIENT_ID__;
  const errorEl = document.getElementById('login-error');
  if (!clientId) {
    errorEl.textContent = 'Google Sign-In is not configured yet (missing GOOGLE_CLIENT_ID).';
    return;
  }
  if (!window.google || !window.google.accounts) {
    // Google's script hasn't finished loading yet — retry shortly.
    setTimeout(initGoogleSignIn, 300);
    return;
  }
  google.accounts.id.initialize({ client_id: clientId, callback: handleGoogleCredential });
  // Render Google's real button off-screen; our styled button proxies a click to it,
  // so the visible UI stays exactly as designed while using Google's supported flow.
  google.accounts.id.renderButton(document.getElementById('g_id_signin_proxy'), { type: 'standard' });
}

function handleGoogleClick() {
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  if (!window.__GOOGLE_CLIENT_ID__) {
    errorEl.textContent = 'Google Sign-In is not configured yet (missing GOOGLE_CLIENT_ID).';
    return;
  }
  const realButton = document.querySelector('#g_id_signin_proxy div[role="button"]');
  if (realButton) { realButton.click(); return; }
  // Fallback if the rendered button isn't ready yet.
  google.accounts.id.prompt();
}

async function handleGoogleCredential(response) {
  showOverlay('🔐 Authenticating', 'Verifying with Google...');
  try {
    const data = await apiFetch('/employee-auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential: response.credential })
    });

    if (data.matched) {
      saveSession(data.token, data.employee);
      pendingGoogleToken = null;
      hideOverlay();
      switchScreen('choice');
    } else {
      pendingGoogleToken = data.pendingToken;
      window.__pendingGoogleProfile = data.google;
      hideOverlay();
      switchScreen('choice');
    }
  } catch (err) {
    hideOverlay();
    document.getElementById('login-error').textContent = err.message;
  }
}

// ---- Post-login choice ----------------------------------------------------
function skipToHome() {
  if (!getToken()) {
    alert('You need to register this device first — we could not find an existing account linked to your Google sign-in.');
    switchScreen('register');
    return;
  }
  showOverlay('🔄 Syncing', 'Connecting to Secure Enclave...');
  setTimeout(() => {
    hideOverlay();
    switchScreen('home');
  }, 400);
}

// ---- Device registration ---------------------------------------------------
function prefillRegistrationForm() {
  const profile = window.__pendingGoogleProfile;
  if (profile) {
    document.getElementById('reg-fname').value = profile.given_name || '';
    document.getElementById('reg-lname').value = profile.family_name || '';
  }
  const info = parseDeviceInfo();
  document.getElementById('reg-device-info').innerHTML =
    `<strong>DEVICE MODEL:</strong> ${info.brand} ${info.model}<br><strong>DEVICE ID:</strong> ${getDeviceUid().slice(0, 18)}…`;
}

async function finalizeBinding() {
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';

  const lastName = document.getElementById('reg-lname').value.trim();
  const firstName = document.getElementById('reg-fname').value.trim();
  const middleName = document.getElementById('reg-mname').value.trim();
  const employeeId = document.getElementById('reg-empid').value.trim().toUpperCase();
  const department = document.getElementById('reg-dept').value;

  if (!lastName || !firstName || !employeeId) {
    errorEl.textContent = 'Please fill in your name and Employee ID.';
    return;
  }
  if (!pendingGoogleToken) {
    errorEl.textContent = 'Your Google sign-in session expired. Please sign in again.';
    switchScreen('login');
    return;
  }

  const info = parseDeviceInfo();
  showOverlay('🛰️ Binding Device', 'Registering this device...');
  try {
    const data = await apiFetch('/employee-auth/link-device', {
      method: 'POST',
      body: JSON.stringify({
        pendingToken: pendingGoogleToken,
        employee_code: employeeId,
        first_name: firstName,
        last_name: lastName,
        middle_name: middleName,
        department,
        device_uid: getDeviceUid(),
        device_model: `${info.brand} ${info.model}`,
        device_brand: info.brand,
        device_os: info.os
      })
    });

    saveSession(data.token, data.employee);
    pendingGoogleToken = null;
    hideOverlay();
    document.getElementById('welcome-text').textContent = 'Welcome, ' + data.employee.full_name.split(' ')[0] + '!';

    if (data.deviceStatus === 'pending') {
      alert('Device registered! It is now pending admin approval before you can submit attendance.');
    }
    switchScreen('home');
  } catch (err) {
    hideOverlay();
    errorEl.textContent = err.message;
  }
}

// ---- Home dashboard: real active/upcoming events + geofence status --------
async function loadHomeData() {
  const employee = getEmployee();
  if (employee) document.getElementById('welcome-text').textContent = `Welcome, ${employee.full_name.split(' ')[0]}!`;
  document.getElementById('today-date-label').textContent =
    new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  let geofences = [];
  try {
    const data = await apiFetch('/geofences/mobile/active');
    geofences = data.data || [];
  } catch (err) {
    console.error('Could not load events:', err.message);
  }

  const active = geofences.find(g => g.computed_status === 'active');
  const upcoming = geofences.filter(g => g.computed_status !== 'active');

  renderTodaySchedule(geofences);
  renderUpcoming(upcoming);
  renderAttendanceCard(active);

  if (active) checkGeofenceStatus(active);
  else document.getElementById('geofence-status-text').textContent = 'NO ACTIVE EVENT';
}

function renderAttendanceCard(active) {
  activeGeofence = active || null;
  const btn = document.getElementById('btn-checkin');
  const nameEl = document.getElementById('current-event-name');
  const venueEl = document.getElementById('current-event-venue');

  if (!active) {
    nameEl.textContent = 'No active event';
    venueEl.textContent = '📍 --';
    btn.textContent = 'No Active Event';
    btn.disabled = true;
    btn.className = 'btn btn-gold';
    return;
  }

  nameEl.textContent = active.title;
  venueEl.textContent = `📍 ${active.venue || 'TBA'}`;
  btn.disabled = false;
  btn.className = 'btn btn-gold';
  btn.textContent = currentAttendanceRecordAction === 'time_in' ? 'End Attendance' : 'Start Attendance';
}

function renderTodaySchedule(geofences) {
  const container = document.getElementById('today-schedule-list');
  const todayStr = new Date().toDateString();
  const today = geofences.filter(g => new Date(g.start_datetime).toDateString() === todayStr);

  if (today.length === 0) {
    container.innerHTML = '<div class="event-item"><div class="event-info"><p>No events scheduled today.</p></div></div>';
    return;
  }
  container.innerHTML = today.map(g => {
    const pillClass = g.computed_status === 'active' ? 'soon' : 'waiting';
    const pillLabel = g.computed_status === 'active' ? 'Ongoing' : 'Waiting';
    const time = new Date(g.start_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="event-item">
        <div class="event-info"><h4>${g.title}</h4><p>${time} • ${g.venue || 'TBA'}</p></div>
        <span class="status-pill ${pillClass}">${pillLabel}</span>
      </div>`;
  }).join('');
}

function renderUpcoming(upcoming) {
  const container = document.getElementById('upcoming-events-list');
  if (upcoming.length === 0) {
    container.innerHTML = '<div class="event-item"><div class="event-info"><p>Nothing else scheduled.</p></div></div>';
    return;
  }
  container.innerHTML = upcoming.map(g => {
    const start = new Date(g.start_datetime);
    const isTomorrow = start.toDateString() === new Date(Date.now() + 86400000).toDateString();
    const dateLabel = isTomorrow
      ? `Tomorrow, ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `
      <div class="event-item">
        <div class="event-info"><h4>${g.title}</h4><p>${dateLabel}</p></div>
        <span class="status-pill">Next</span>
      </div>`;
  }).join('');
}

// ---- Live geofence containment check (point-in-polygon, mirrors backend) --
function isInsidePolygon(lat, lng, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lat, yi = points[i].lng;
    const xj = points[j].lat, yj = points[j].lng;
    const intersect = (yi > lng) !== (yj > lng) && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

let lastKnownPosition = null;

function checkGeofenceStatus(geofence) {
  const statusEl = document.getElementById('geofence-status-text');
  if (!navigator.geolocation) {
    statusEl.textContent = 'GPS UNAVAILABLE';
    statusEl.style.color = 'var(--error)';
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      lastKnownPosition = pos.coords;
      if (geofence.points && geofence.points.length >= 3) {
        const inside = isInsidePolygon(pos.coords.latitude, pos.coords.longitude, geofence.points);
        statusEl.textContent = inside ? 'ACTIVE' : 'OUTSIDE BOUNDARY';
        statusEl.style.color = inside ? 'var(--success)' : 'var(--error)';
      }
    },
    () => {
      statusEl.textContent = 'LOCATION DENIED';
      statusEl.style.color = 'var(--error)';
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

// ---- Attendance start/end ---------------------------------------------------
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation is not supported on this device.'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 });
  });
}

async function handleAttendance() {
  if (!activeGeofence) return;
  const employee = getEmployee();
  if (!employee) return;

  const btn = document.getElementById('btn-checkin');
  const isStarting = currentAttendanceRecordAction !== 'time_in';

  showOverlay(isStarting ? '📍 Geofencing' : '🛰️ Finalizing', isStarting ? 'Recording Start Time...' : 'Recording End Time...');
  try {
    const pos = await getCurrentPosition();
    const result = await apiFetch('/attendance/submit', {
      method: 'POST',
      body: JSON.stringify({
        employee_id: employee.id,
        device_uid: getDeviceUid(),
        event_id: activeGeofence.event_id,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      })
    });

    hideOverlay();
    currentAttendanceRecordAction = result.data.action;

    if (result.data.action === 'time_in') {
      btn.textContent = 'End Attendance';
      btn.classList.replace('btn-gold', 'btn-outline');
      btn.style.borderColor = 'var(--cspc-gold)';
      btn.style.color = 'var(--cspc-gold)';
      alert(result.message);
    } else {
      btn.textContent = 'Attendance Completed';
      btn.classList.remove('btn-outline');
      btn.style.background = 'var(--success)';
      btn.style.color = 'white';
      btn.style.border = 'none';
      btn.disabled = true;
      alert(result.message);
    }
  } catch (err) {
    hideOverlay();
    alert(err.message);
  }
}

// ---- Logs ---------------------------------------------------------------
async function loadLogs() {
  const container = document.getElementById('logs-container');
  container.innerHTML = '<div style="text-align:center; padding:40px; color:gray;">Loading…</div>';
  try {
    const data = await apiFetch('/attendance/my-history');
    renderLogs(data.data || []);
  } catch (err) {
    container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--error);">${err.message}</div>`;
  }
}

function renderLogs(logs) {
  const container = document.getElementById('logs-container');
  if (logs.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:40px; color:gray;">📋<br>No attendance history found.</div>';
    return;
  }
  container.innerHTML = logs.map(log => `
    <div class="card">
      <div class="log-item" style="flex-direction: column; align-items: flex-start; gap: 8px;">
        <div style="width: 100%; display: flex; justify-content: space-between;">
          <strong>${log.event_title || 'Event'}</strong>
          <span class="status-pill ${log.time_out ? 'success' : 'waiting'}">${log.time_out ? 'Completed' : 'On-going'}</span>
        </div>
        <div style="font-size: 12px; color: var(--text-sub);">
          📅 ${log.attendance_date}<br>
          <span style="color: var(--success);">In: ${log.time_in ? new Date(log.time_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span> |
          <span style="color: var(--error);">Out: ${log.time_out ? new Date(log.time_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
        </div>
      </div>
    </div>
  `).join('');
}

// ---- Profile --------------------------------------------------------------
function renderProfile() {
  const employee = getEmployee();
  const info = parseDeviceInfo();
  document.getElementById('profile-card').innerHTML = `
    <div style="text-align:center; margin-bottom:15px;">
      <div style="width:60px; height:60px; background:var(--cspc-blue); border-radius:50%; margin:0 auto 10px; display:flex; align-items:center; justify-content:center; color:white; font-size:24px;">👤</div>
      <h3 style="color:var(--cspc-blue);">${employee ? employee.full_name : 'Unknown'}</h3>
      <p style="font-size:12px; color:gray;">${employee ? employee.employee_code : '--'} ${employee && employee.department ? '· ' + employee.department : ''}</p>
    </div>
    <div style="border-top:1px solid #eee; padding-top:15px; font-size:13px; font-family: monospace;">
      <p style="margin-bottom:8px;"><strong>DEVICE MODEL:</strong> ${info.brand} ${info.model}</p>
      <p><strong>DEVICE ID:</strong> ${getDeviceUid().slice(0, 18)}…</p>
    </div>
  `;
}

function handleLogout() {
  clearSession();
  location.reload();
}

// ---- Boot -------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  initGoogleSignIn();

  // Resume an existing session (skip login if already registered/logged in on this device).
  if (getToken() && getEmployee()) {
    switchScreen('home');
  }
});
