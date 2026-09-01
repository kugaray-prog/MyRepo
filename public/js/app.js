// ============================================================
// GeoAttend Pro — Admin Dashboard Frontend
// Same UI/design as provided. All data now comes from the real
// Node.js/Express/MySQL backend via fetch() calls.
// ============================================================

const API = '/api';

function authHeaders(json = true) {
    const token = localStorage.getItem('ga_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
}

async function apiFetch(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
        ...options,
        headers: { ...authHeaders(!(options.body instanceof FormData)), ...(options.headers || {}) }
    });
    let data;
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
}

function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerText = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

const G_App = {
    state: {
        departments: [],
        employees: [],
        geofences: [],
        currentDept: null,
        currentDeptId: null,
        role: null
    },

    auth: {
        login: async () => {
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;
            const errorEl = document.getElementById('login-error');
            const btn = document.getElementById('login-btn');
            errorEl.innerText = '';

            if (!email || !password) {
                errorEl.innerText = 'Please enter both email and password.';
                return;
            }

            btn.innerText = 'Verifying...';
            try {
                const data = await apiFetch('/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ email, password })
                });
                localStorage.setItem('ga_token', data.token);
                localStorage.setItem('ga_admin', JSON.stringify(data.admin));

                document.getElementById('login-screen').style.opacity = '0';
                setTimeout(() => {
                    document.getElementById('login-screen').classList.add('hidden');
                    document.getElementById('app-sidebar').classList.remove('hidden');
                    document.getElementById('main-wrapper').classList.remove('hidden');
                    document.getElementById('main-wrapper').style.display = 'flex';
                    G_App.init();
                }, 400);
            } catch (err) {
                errorEl.innerText = err.message;
                btn.innerText = 'Verify & Authorize';
            }
        },
        logout: async () => {
            try { await apiFetch('/auth/logout', { method: 'POST' }); } catch (e) {}
            localStorage.removeItem('ga_token');
            localStorage.removeItem('ga_admin');
            location.reload();
        },
        checkSession: () => {
            const token = localStorage.getItem('ga_token');
            const admin = localStorage.getItem('ga_admin');
            if (token && admin) {
                document.getElementById('login-screen').classList.add('hidden');
                document.getElementById('app-sidebar').classList.remove('hidden');
                document.getElementById('main-wrapper').classList.remove('hidden');
                document.getElementById('main-wrapper').style.display = 'flex';
                G_App.init();
            }
        }
    },

    ui: {
        initNav: () => {
            document.querySelectorAll('.nav-item[data-target]').forEach(item => {
                item.addEventListener('click', () => {
                    const target = item.getAttribute('data-target');
                    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                    document.getElementById(target).classList.add('active');
                    document.getElementById('view-title').innerText = item.innerText.trim();

                    if (target === 'geofence') {
                        if (!G_App.geofence.map) {
                            G_App.geofence.init();
                        } else {
                            setTimeout(() => {
                                google.maps.event.trigger(G_App.geofence.map, 'resize');
                                G_App.geofence.map.setCenter(G_App.geofence.map.getCenter());
                            }, 200);
                        }
                        G_App.geofence.loadAlerts();
                    }
                    if (target === 'ocr-section') { G_App.ocr.initCamera(); G_App.ocr.loadRecords(); }
                    if (target === 'reports') G_App.reports.init();
                    if (target === 'settings') { G_App.settings.render(); G_App.adminAccounts.load(); }
                    if (target === 'mobile-app') G_App.mobile.render();
                    if (target === 'ratings') { G_App.ratings.initSelectors(); G_App.ratings.load(); }
                    if (target === 'departments') G_App.departments.render();
                    if (target === 'events') G_App.events.load();
                    lucide.createIcons();
                    document.getElementById('app-sidebar').classList.remove('mobile-open');
                });
            });
        },
        toggleDarkMode: () => document.body.classList.toggle('dark-mode'),
        // Auto-refresh: every 30s, silently re-fetch whichever view is
        // currently on screen so stats/tables/charts stay live without the
        // admin needing to manually reload the page.
        autoRefreshTimer: null,
        startAutoRefresh: () => {
            if (G_App.ui.autoRefreshTimer) return;
            G_App.ui.autoRefreshTimer = setInterval(() => G_App.ui.refreshActiveView(), 30000);
        },
        stopAutoRefresh: () => {
            if (G_App.ui.autoRefreshTimer) {
                clearInterval(G_App.ui.autoRefreshTimer);
                G_App.ui.autoRefreshTimer = null;
            }
        },
        refreshActiveView: async () => {
            if (document.hidden) return; // don't burn API calls on a backgrounded tab
            const activeView = document.querySelector('.view.active');
            if (!activeView) return;
            try {
                switch (activeView.id) {
                    case 'dashboard':
                        await G_App.ui.updateDashboard();
                        break;
                    case 'attendance':
                        if (G_App.attendance.currentEventId && !document.getElementById('attendance-detail').classList.contains('hidden')) {
                            await G_App.attendance.loadDetail();
                        } else {
                            await G_App.attendance.render();
                        }
                        break;
                    case 'geofence':
                        await G_App.geofence.load();
                        await G_App.geofence.loadAlerts();
                        break;
                    case 'events':
                        await G_App.events.load();
                        break;
                    case 'ratings':
                        await G_App.ratings.load();
                        break;
                    default:
                        break;
                }
            } catch (err) { /* non-fatal — next tick tries again */ }
        },        toggleNotifs: () => document.getElementById('notif-drawer').classList.toggle('open'),
        toggleMobileNav: () => document.getElementById('app-sidebar').classList.toggle('mobile-open'),
        applyRoleRestrictions: () => {
            const badge = document.getElementById('admin-name-badge');
            const adminData = JSON.parse(localStorage.getItem('ga_admin') || '{}');
            if (badge) badge.innerText = `${adminData.name || 'Admin'} (${G_App.state.role === 'super_admin' ? 'Super Admin' : 'OCR Admin'})`;

            if (G_App.state.role !== 'admin') return; // super_admin sees everything, nothing to restrict

            // OCR-only admin: hide every nav item except OCR Verification, and jump straight there.
            document.querySelectorAll('.nav-item[data-target]').forEach(item => {
                if (item.getAttribute('data-target') !== 'ocr-section') item.classList.add('hidden');
            });
            document.querySelectorAll('.nav-item[data-target]').forEach(i => i.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            const ocrNav = document.querySelector('.nav-item[data-target="ocr-section"]');
            if (ocrNav) ocrNav.classList.add('active');
            document.getElementById('ocr-section').classList.add('active');
            document.getElementById('view-title').innerText = 'OCR Verification';
            document.getElementById('view-subtitle').innerText = 'Restricted Access — Identity Verification Only';
        },
        updateDashboard: async () => {
            try {
                const { data } = await apiFetch('/dashboard/stats');
                document.getElementById('stat-total').innerText = data.totalEmployees;
                document.getElementById('stat-present').innerText = data.fullTime;
                document.getElementById('stat-late').innerText = data.partTime;
                document.getElementById('stat-absent').innerText = data.inactive;

                G_App.ui.initClassificationChart(data.classificationBreakdown);
                await G_App.ui.populateDeptEventFilter();
                await G_App.ui.loadDepartmentAttendanceChart();
            } catch (err) {
                toast(err.message, 'error');
            }
        },
        populateDeptEventFilter: async () => {
            const sel = document.getElementById('dash-dept-event');
            if (!sel || sel.dataset.loaded) return;
            try {
                const { data } = await apiFetch('/events?limit=50&status=all');
                sel.innerHTML = '<option value="">All Events</option>' +
                    data.map(e => `<option value="${e.id}">${e.title} — ${new Date(e.start_datetime).toLocaleDateString()}</option>`).join('');
                sel.dataset.loaded = '1';
            } catch (err) { /* non-fatal */ }
        },
        initClassificationChart: (breakdown) => {
            const canvas = document.getElementById('classificationChart');
            if (!canvas || !breakdown) return;
            const ctx = canvas.getContext('2d');
            if (window.classificationChart && typeof window.classificationChart.destroy === 'function') {
                window.classificationChart.destroy();
            }
            window.classificationChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Regular', 'COS', 'Casual'],
                    datasets: [{
                        data: [breakdown.Regular || 0, breakdown.COS || 0, breakdown.Casual || 0],
                        backgroundColor: ['#0D00A5', '#4318FF', '#FFB547']
                    }]
                },
                options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
            });
        },
        loadDepartmentAttendanceChart: async () => {
            const canvas = document.getElementById('deptAttendanceChart');
            if (!canvas) return;
            const eventId = document.getElementById('dash-dept-event') ? document.getElementById('dash-dept-event').value : '';
            const classification = document.getElementById('dash-dept-classification') ? document.getElementById('dash-dept-classification').value : 'all';
            try {
                const params = new URLSearchParams();
                if (eventId) params.set('event_id', eventId);
                if (classification && classification !== 'all') params.set('classification', classification);
                const { data } = await apiFetch(`/dashboard/department-attendance?${params.toString()}`);
                const ctx = canvas.getContext('2d');
                if (window.deptAttendanceChart && typeof window.deptAttendanceChart.destroy === 'function') {
                    window.deptAttendanceChart.destroy();
                }
                window.deptAttendanceChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: data.map(d => d.department),
                        datasets: [
                            { label: 'Total Employees', data: data.map(d => d.total_employees), backgroundColor: '#CBD5E1', borderRadius: 6 },
                            { label: 'Attended', data: data.map(d => d.attended), backgroundColor: '#05CD99', borderRadius: 6 }
                        ]
                    },
                    options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
                });
            } catch (err) { toast(err.message, 'error'); }
        }
    },

    departments: {
        load: async () => {
            const { data } = await apiFetch('/departments');
            G_App.state.departments = data;
            const options = data.length
                ? data.map(d => `<option>${d.name}</option>`).join('')
                : '<option value="" disabled selected>No departments yet — add one first</option>';

            document.getElementById('inp-dept').innerHTML = options;
            document.getElementById('filter-dept').innerHTML = '<option value="all">All Departments</option>' + (data.map(d => `<option>${d.name}</option>`).join(''));
            document.getElementById('rpt-dept').innerHTML = '<option value="all">All Offices</option>' + (data.map(d => `<option>${d.name}</option>`).join(''));
        },
        render: async () => {
            await G_App.departments.load();
            const data = G_App.state.departments || [];
            const tbody = document.getElementById('departments-table-body');
            if (!tbody) return;
            tbody.innerHTML = data.map(d => `
                <tr>
                    <td><b>${d.name}</b></td>
                    <td>${d.office || '—'}</td>
                    <td>${d.employee_count || 0}</td>
                    <td><button class="btn-primary" style="background:var(--danger); padding:6px 12px; font-size:0.75rem;" onclick="G_App.departments.remove(${d.id}, '${(d.name || '').replace(/'/g, "\\'")}')">Delete</button></td>
                </tr>
            `).join('') || '<tr><td colspan="4" style="color:var(--text-muted); text-align:center; padding:20px;">No departments yet. Click "Add Department" to create one.</td></tr>';
            lucide.createIcons();
        },
        openModal: () => {
            document.getElementById('dept-name').value = '';
            document.getElementById('dept-office').value = '';
            document.getElementById('dept-description').value = '';
            document.getElementById('dept-modal').classList.add('open');
        },
        closeModal: () => document.getElementById('dept-modal').classList.remove('open'),
        save: async () => {
            const name = document.getElementById('dept-name').value.trim();
            if (!name) return toast('Department name is required.', 'error');
            const payload = {
                name,
                office: document.getElementById('dept-office').value.trim() || undefined,
                description: document.getElementById('dept-description').value.trim() || undefined
            };
            try {
                await apiFetch('/departments', { method: 'POST', body: JSON.stringify(payload) });
                toast('Department created.', 'success');
                G_App.departments.closeModal();
                await G_App.departments.load();
                if (document.getElementById('departments').classList.contains('active')) G_App.departments.render();
                // If they were mid-way through registering a member, pre-select the department they just added.
                const deptSelect = document.getElementById('inp-dept');
                if (deptSelect) deptSelect.value = name;
            } catch (err) {
                toast(err.message, 'error');
            }
        },
        remove: async (id, name) => {
            if (!confirm(`Delete department "${name}"? This cannot be undone.`)) return;
            try {
                await apiFetch(`/departments/${id}`, { method: 'DELETE' });
                toast('Department deleted.', 'success');
                G_App.departments.render();
            } catch (err) {
                toast(err.message, 'error');
            }
        }
    },

    employees: {
        openModal: (id = null) => {
            const modal = document.getElementById('crud-modal');
            const title = document.getElementById('modal-title');
            const saveBtn = document.getElementById('btn-save-member');

            if (id) {
                const emp = G_App.state.employees.find(e => e.id == id);
                title.innerText = 'Edit Member';
                document.getElementById('inp-id').value = emp.id;
                document.getElementById('inp-code').value = emp.employee_code;
                document.getElementById('inp-surname').value = emp.surname || '';
                document.getElementById('inp-given-name').value = emp.given_name || '';
                document.getElementById('inp-middle-name').value = emp.middle_name || '';
                document.getElementById('inp-suffix').value = emp.suffix || '';
                document.getElementById('inp-dept').value = emp.department_name;
                document.getElementById('inp-position').value = emp.position || '';
                document.getElementById('inp-email').value = emp.email || '';
                document.getElementById('inp-status').value = emp.status;
                document.getElementById('inp-classification').value = emp.classification || 'Regular';
                document.getElementById('inp-remark').value = emp.remark || 'Active';
                saveBtn.onclick = () => G_App.employees.update();
            } else {
                title.innerText = 'Register Member';
                document.getElementById('inp-id').value = '';
                document.getElementById('inp-code').value = '';
                document.getElementById('inp-surname').value = '';
                document.getElementById('inp-given-name').value = '';
                document.getElementById('inp-middle-name').value = '';
                document.getElementById('inp-suffix').value = '';
                document.getElementById('inp-position').value = '';
                document.getElementById('inp-email').value = '';
                document.getElementById('inp-status').value = 'Full-time';
                document.getElementById('inp-classification').value = 'Regular';
                document.getElementById('inp-remark').value = 'Active';
                saveBtn.onclick = () => G_App.employees.save();
            }
            modal.classList.add('open');
        },
        closeModal: () => document.getElementById('crud-modal').classList.remove('open'),
        readForm: () => {
            const employeeCode = document.getElementById('inp-code').value.trim();
            const surname = document.getElementById('inp-surname').value.trim();
            const givenName = document.getElementById('inp-given-name').value.trim();
            const department = document.getElementById('inp-dept').value;
            if (!employeeCode) { toast('Employee ID is required.', 'error'); return null; }
            if (!surname || !givenName) { toast('Surname and Given Name are required.', 'error'); return null; }
            if (!department) { toast('Please select a department. Use "+ Add New" if none exist yet.', 'error'); return null; }
            return {
                employee_code: employeeCode,
                surname,
                given_name: givenName,
                middle_name: document.getElementById('inp-middle-name').value.trim(),
                suffix: document.getElementById('inp-suffix').value,
                department,
                position: document.getElementById('inp-position').value,
                email: document.getElementById('inp-email').value,
                status: document.getElementById('inp-status').value,
                classification: document.getElementById('inp-classification').value,
                remark: document.getElementById('inp-remark').value
            };
        },
        save: async () => {
            const payload = G_App.employees.readForm();
            if (!payload) return;
            try {
                await apiFetch('/employees', { method: 'POST', body: JSON.stringify(payload) });
                toast('Employee registered successfully.', 'success');
                G_App.employees.afterChange();
            } catch (err) {
                toast(err.message, 'error');
            }
        },
        update: async () => {
            const id = document.getElementById('inp-id').value;
            const payload = G_App.employees.readForm();
            if (!payload) return;
            try {
                await apiFetch(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
                toast('Employee updated successfully.', 'success');
                G_App.employees.afterChange();
            } catch (err) {
                toast(err.message, 'error');
            }
        },
        delete: async (id) => {
            if (!confirm('Are you sure you want to delete this resource?')) return;
            try {
                await apiFetch(`/employees/${id}`, { method: 'DELETE' });
                toast('Employee deleted.', 'success');
                G_App.employees.afterChange();
            } catch (err) {
                toast(err.message, 'error');
            }
        },
        setRemark: async (id, remark) => {
            try {
                await apiFetch(`/employees/${id}/remark`, { method: 'PATCH', body: JSON.stringify({ remark }) });
                const emp = G_App.state.employees.find(e => e.id == id);
                if (emp) emp.remark = remark;
                toast(`Remark set to ${remark}.`, 'success');
                G_App.employees.render();
            } catch (err) {
                toast(err.message, 'error');
            }
        },
        afterChange: async () => {
            G_App.employees.closeModal();
            await G_App.employees.load();
            G_App.ui.updateDashboard();
            G_App.attendance.render();
            G_App.mobile.render();
        },
        load: async () => {
            const dept = document.getElementById('filter-dept') ? document.getElementById('filter-dept').value : 'all';
            const classification = document.getElementById('filter-classification') ? document.getElementById('filter-classification').value : 'all';
            const { data } = await apiFetch(`/employees?department=${encodeURIComponent(dept)}&classification=${encodeURIComponent(classification)}&limit=200`);
            G_App.state.employees = data;
            G_App.employees.render();
        },
        statusBadgeClass: (status) => status === 'Full-time' ? 'success' : status === 'Part-time' ? 'warning' : status === 'COS' ? 'info' : 'danger',
        remarkBadgeClass: (remark) => remark === 'Active' ? 'success' : remark === 'Leave' ? 'warning' : 'danger',
        classificationBadgeClass: (c) => c === 'Regular' ? 'success' : c === 'COS' ? 'info' : 'warning',
        render: () => {
            const tbody = document.getElementById('employee-table-body');
            if (!tbody) return;
            tbody.innerHTML = G_App.state.employees.map(e => `
                <tr>
                    <td>${e.full_name}</td>
                    <td><code>${e.employee_code}</code></td>
                    <td>${e.department_name}</td>
                    <td>${e.position || 'N/A'}</td>
                    <td><span class="badge badge-${G_App.employees.classificationBadgeClass(e.classification)}">${e.classification || 'Regular'}</span></td>
                    <td><span class="badge badge-${G_App.employees.statusBadgeClass(e.status)}">${e.status}</span></td>
                    <td>
                        <select class="badge-select badge-${G_App.employees.remarkBadgeClass(e.remark)}" onchange="G_App.employees.setRemark(${e.id}, this.value)">
                            <option value="Active" ${e.remark === 'Active' ? 'selected' : ''}>Active</option>
                            <option value="Inactive" ${e.remark === 'Inactive' ? 'selected' : ''}>Inactive</option>
                            <option value="Leave" ${e.remark === 'Leave' ? 'selected' : ''}>Leave</option>
                        </select>
                    </td>
                    <td>
                        <button class="btn-icon btn-edit" onclick="G_App.employees.openModal(${e.id})"><i data-lucide="edit-3" size="14"></i></button>
                        <button class="btn-icon btn-delete" onclick="G_App.employees.delete(${e.id})"><i data-lucide="trash" size="14"></i></button>
                    </td>
                </tr>
            `).join('') || '<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">No employees yet.</td></tr>';
            lucide.createIcons();
        },
        filter: (q) => {
            const rows = document.querySelectorAll('#employee-table-body tr');
            rows.forEach(r => r.style.display = r.innerText.toLowerCase().includes(q.toLowerCase()) ? '' : 'none');
        },
        exportFile: (format) => {
            window.open(`${API}/employees/export/${format === 'excel' ? 'excel' : 'csv'}?token=${localStorage.getItem('ga_token')}`, '_blank');
        }
    },

    employeeImport: {
        validatedRows: [],
        openModal: () => {
            document.getElementById('import-file-input').value = '';
            document.getElementById('import-preview-summary').classList.add('hidden');
            document.getElementById('import-preview-table-wrap').classList.add('hidden');
            document.getElementById('btn-import-commit').classList.add('hidden');
            document.getElementById('import-modal').classList.add('open');
        },
        closeModal: () => document.getElementById('import-modal').classList.remove('open'),
        preview: async () => {
            const fileInput = document.getElementById('import-file-input');
            if (!fileInput.files.length) return;
            const formData = new FormData();
            formData.append('file', fileInput.files[0]);
            try {
                const { summary, rows } = await apiFetch('/employees/import/preview', { method: 'POST', body: formData });
                G_App.employeeImport.validatedRows = rows;

                const summaryEl = document.getElementById('import-preview-summary');
                summaryEl.classList.remove('hidden');
                summaryEl.innerHTML = `
                    <span class="badge badge-info">Total Rows: ${summary.totalRows}</span>
                    <span class="badge badge-success">Valid: ${summary.validRows}</span>
                    <span class="badge badge-warning">Duplicates: ${summary.duplicateRows}</span>
                    <span class="badge badge-danger">Invalid: ${summary.invalidRows}</span>
                `;

                const tableWrap = document.getElementById('import-preview-table-wrap');
                tableWrap.classList.remove('hidden');
                document.getElementById('import-preview-table').innerHTML = rows.map(r => `
                    <tr>
                        <td>${r.rowNumber}</td>
                        <td>${r.employee_code || '—'}</td>
                        <td>${[r.given_name, r.surname].filter(Boolean).join(' ') || '—'}</td>
                        <td>${r.department || '—'}</td>
                        <td>${r.isValid
                            ? '<span class="badge badge-success">Ready</span>'
                            : `<span class="badge badge-danger" title="${r.errors.join(', ')}">${r.errors[0]}</span>`}</td>
                    </tr>
                `).join('');

                document.getElementById('btn-import-commit').classList.toggle('hidden', summary.validRows === 0);
                toast(`Parsed ${summary.totalRows} rows — ${summary.validRows} ready to import.`, 'info');
            } catch (err) {
                toast(err.message, 'error');
            }
        },
        commit: async () => {
            const validRows = G_App.employeeImport.validatedRows.filter(r => r.isValid);
            if (!validRows.length) return toast('No valid rows to import.', 'error');
            try {
                const result = await apiFetch('/employees/import/commit', { method: 'POST', body: JSON.stringify({ rows: validRows }) });
                toast(result.message, 'success');
                G_App.employeeImport.closeModal();
                await G_App.employees.load();
                G_App.ui.updateDashboard();
            } catch (err) {
                toast(err.message, 'error');
            }
        }
    },

    events: {
        load: async () => {
            const search = document.getElementById('events-search') ? document.getElementById('events-search').value : '';
            const status = document.getElementById('events-status-filter') ? document.getElementById('events-status-filter').value : 'all';
            try {
                const params = new URLSearchParams({ search, status, limit: '100' });
                const { data } = await apiFetch(`/events?${params.toString()}`);
                const tbody = document.getElementById('events-table-body');
                if (!tbody) return;
                tbody.innerHTML = data.map(e => `
                    <tr>
                        <td><b>${e.title}</b>${e.recurrence_type === 'weekly' ? ' <span class="badge badge-info" style="font-size:0.6rem;">Recurring</span>' : ''}</td>
                        <td>${e.venue || 'N/A'}</td>
                        <td>${new Date(e.start_datetime).toLocaleString()}</td>
                        <td>${new Date(e.end_datetime).toLocaleString()}</td>
                        <td>${e.recurrence_type === 'weekly' ? `Weekly until ${e.recurrence_end_date || ''}` : 'One-time'}</td>
                        <td>${e.attendance_count}</td>
                        <td><span class="badge badge-${e.computed_status === 'ongoing' ? 'success' : (e.computed_status === 'completed' ? 'danger' : 'warning')}">${e.computed_status}</span></td>
                    </tr>
                `).join('') || '<tr><td colspan="7" style="text-align:center; padding:30px;">No events found.</td></tr>';
                lucide.createIcons();
            } catch (err) { toast(err.message, 'error'); }
        }
    },

    geofence: {
        map: null,
        infoWindow: null,
        polygonLayers: [],       // saved geofences drawn on the map (read-only reference shapes)
        drawnPoints: [],          // vertices of the polygon currently being drawn/edited
        drawMarkers: [],          // click markers for the in-progress polygon
        drawPolygon: null,        // live preview polygon layer for the in-progress shape
        showAll: false,           // false = only the 3 most recently-created events; true = full list
        defaultLocation: null,    // CSPC coordinates, fetched once and cached
        loadAlerts: async () => {
            try {
                const { data } = await apiFetch('/attendance/anomalies?resolved=0');
                G_App.geofence.renderAlerts(data);
            } catch (err) {
                // Non-fatal — the rest of the Geo-Fence module still works without alerts.
            }
        },
        renderAlerts: (alerts) => {
            const container = document.getElementById('geofence-alerts');
            if (!alerts.length) {
                container.innerHTML = '';
                return;
            }
            container.innerHTML = `
                <div class="card" style="background: #FEF2F2; border-color: #FECACA;">
                    <h3 style="color: var(--danger); font-weight: 800; display:flex; align-items:center; gap:10px; margin-bottom: 15px;">
                        <i data-lucide="alert-triangle"></i> ${alerts.length} Anomaly Alert${alerts.length > 1 ? 's' : ''} — Possible Spoofing/Hacking Detected
                    </h3>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        ${alerts.map(a => `
                            <div style="background:#fff; border-radius:14px; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; gap:15px; flex-wrap:wrap;">
                                <div>
                                    <strong>${a.full_name}</strong> <span style="color:var(--text-muted); font-size:0.8rem;">(${a.employee_code})</span>
                                    — ${a.event_title || 'Unknown event'}<br>
                                    <span style="color:var(--text-muted); font-size:0.8rem;">${a.details} · ${new Date(a.created_at).toLocaleString()}</span>
                                </div>
                                <button class="btn-primary" style="background: var(--danger); padding: 8px 16px; font-size: 0.8rem;" onclick="G_App.geofence.resolveAlert(${a.id})">Mark Resolved</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            lucide.createIcons();
        },
        resolveAlert: async (id) => {
            try {
                await apiFetch(`/attendance/anomalies/${id}/resolve`, { method: 'PATCH' });
                toast('Alert marked as resolved.', 'success');
                G_App.geofence.loadAlerts();
            } catch (err) {
                toast(err.message, 'error');
            }
        },
        init: () => {
            if (!window.google || !window.google.maps) {
                document.getElementById('geo-map').innerHTML =
                    '<div style="display:flex; align-items:center; justify-content:center; height:100%; padding: 30px; text-align:center; color: var(--text-muted); font-weight: 700;">Google Maps failed to load. Check that GOOGLE_MAPS_API_KEY is set in .env and valid.</div>';
                return;
            }
            G_App.geofence.map = new google.maps.Map(document.getElementById('geo-map'), {
                center: { lat: 13.4079, lng: 123.3735 }, // CSPC — overridden below once /default-location resolves
                zoom: 16,
                mapTypeControl: true,
                streetViewControl: false,
                fullscreenControl: false
            });
            G_App.geofence.infoWindow = new google.maps.InfoWindow();
            G_App.geofence.map.addListener('click', (e) => {
                G_App.geofence.addPoint(e.latLng.lat(), e.latLng.lng());
            });
            G_App.geofence.fetchDefaultLocation();
            G_App.geofence.load();
        },
        fetchDefaultLocation: async () => {
            try {
                const { data } = await apiFetch('/geofences/default-location');
                G_App.geofence.defaultLocation = data;
                if (G_App.geofence.map) G_App.geofence.map.setCenter({ lat: data.lat, lng: data.lng });
            } catch (err) { /* non-fatal — falls back to the hardcoded CSPC coordinates already set as the map center */ }
        },
        // "Use CSPC Default Location" button — fills the lat/lng fields with CSPC's
        // coordinates (the system's configured default Geo-Fence location).
        useCspcDefault: () => {
            const loc = G_App.geofence.defaultLocation || { lat: 13.4079, lng: 123.3735, label: 'CSPC' };
            document.getElementById('gf-lat').value = loc.lat.toFixed(7);
            document.getElementById('gf-lng').value = loc.lng.toFixed(7);
            G_App.geofence.dropCenterMarker(loc.lat, loc.lng);
            G_App.geofence.focusOn(loc.lat, loc.lng);
            if (!document.getElementById('gf-venue').value) document.getElementById('gf-venue').value = loc.label || 'CSPC';
            toast('CSPC default location applied.', 'success');
        },
        onRecurrenceTypeChange: () => {
            const type = document.getElementById('gf-recurrence-type').value;
            document.getElementById('gf-recurrence-fields').classList.toggle('hidden', type !== 'weekly');
        },
        toggleViewAll: () => {
            G_App.geofence.showAll = !G_App.geofence.showAll;
            G_App.geofence.renderList();
        },
        focusOn: (lat, lng) => {
            if (!G_App.geofence.map) return;
            G_App.geofence.map.panTo({ lat: Number(lat), lng: Number(lng) });
            G_App.geofence.map.setZoom(16);
        },
        load: async () => {
            try {
                const { data } = await apiFetch('/geofences');
                G_App.state.geofences = data;
                G_App.geofence.renderList();
                G_App.geofence.updateMapPolygons();
            } catch (err) { toast(err.message, 'error'); }
        },
        centerMarker: null,   // marker showing the manually-typed / centroid lat-lng
        addPoint: (lat, lng) => {
            G_App.geofence.drawnPoints.push({ lat, lng });
            const marker = new google.maps.Marker({
                position: { lat, lng },
                map: G_App.geofence.map,
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#0D00A5', fillOpacity: 1, strokeWeight: 0 }
            });
            G_App.geofence.drawMarkers.push(marker);
            G_App.geofence.redrawPreview();
            G_App.geofence.syncCoordFieldsFromPoints();
        },
        undoPoint: () => {
            if (G_App.geofence.drawnPoints.length === 0) return;
            G_App.geofence.drawnPoints.pop();
            const marker = G_App.geofence.drawMarkers.pop();
            if (marker) marker.setMap(null);
            G_App.geofence.redrawPreview();
            G_App.geofence.syncCoordFieldsFromPoints();
        },
        clearPoints: () => {
            G_App.geofence.drawnPoints = [];
            G_App.geofence.drawMarkers.forEach(m => m.setMap(null));
            G_App.geofence.drawMarkers = [];
            G_App.geofence.redrawPreview();
        },
        redrawPreview: () => {
            if (G_App.geofence.drawPolygon) {
                G_App.geofence.drawPolygon.setMap(null);
                G_App.geofence.drawPolygon = null;
            }
            const pts = G_App.geofence.drawnPoints;
            document.getElementById('gf-point-count').innerText = `${pts.length} point${pts.length === 1 ? '' : 's'}`;
            if (pts.length >= 2) {
                G_App.geofence.drawPolygon = new google.maps.Polygon({
                    paths: pts.map(p => ({ lat: p.lat, lng: p.lng })),
                    strokeColor: '#4318FF', strokeWeight: 3, strokeOpacity: 0.9,
                    fillColor: '#4318FF', fillOpacity: 0.15,
                    map: G_App.geofence.map
                });
            }
        },
        // Auto-fills the Latitude/Longitude fields with the centroid of the points drawn so far.
        syncCoordFieldsFromPoints: () => {
            const pts = G_App.geofence.drawnPoints;
            if (pts.length === 0) return;
            const sum = pts.reduce((acc, p) => ({ lat: acc.lat + Number(p.lat), lng: acc.lng + Number(p.lng) }), { lat: 0, lng: 0 });
            document.getElementById('gf-lat').value = (sum.lat / pts.length).toFixed(7);
            document.getElementById('gf-lng').value = (sum.lng / pts.length).toFixed(7);
            G_App.geofence.dropCenterMarker(sum.lat / pts.length, sum.lng / pts.length);
        },
        // Called when the admin manually types into the Latitude/Longitude inputs.
        onCoordInput: () => {
            const lat = parseFloat(document.getElementById('gf-lat').value);
            const lng = parseFloat(document.getElementById('gf-lng').value);
            if (!isNaN(lat) && !isNaN(lng)) G_App.geofence.dropCenterMarker(lat, lng);
        },
        dropCenterMarker: (lat, lng) => {
            if (!G_App.geofence.map) return;
            if (!G_App.geofence.centerMarker) {
                G_App.geofence.centerMarker = new google.maps.Marker({
                    map: G_App.geofence.map,
                    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#05CD99', fillOpacity: 0.9, strokeColor: '#fff', strokeWeight: 2 }
                });
            }
            G_App.geofence.centerMarker.setPosition({ lat, lng });
        },
        // "Preview on Map" button — pans/zooms to the typed coordinates without requiring a click.
        previewCoords: () => {
            const lat = parseFloat(document.getElementById('gf-lat').value);
            const lng = parseFloat(document.getElementById('gf-lng').value);
            if (isNaN(lat) || isNaN(lng)) return toast('Enter a valid latitude and longitude first.', 'error');
            G_App.geofence.dropCenterMarker(lat, lng);
            G_App.geofence.focusOn(lat, lng);
        },
        // "Use My Location" button — fills the fields from the browser's geolocation.
        useMyLocation: () => {
            if (!navigator.geolocation) return toast('Geolocation is not supported by this browser.', 'error');
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    document.getElementById('gf-lat').value = pos.coords.latitude.toFixed(7);
                    document.getElementById('gf-lng').value = pos.coords.longitude.toFixed(7);
                    G_App.geofence.dropCenterMarker(pos.coords.latitude, pos.coords.longitude);
                    G_App.geofence.focusOn(pos.coords.latitude, pos.coords.longitude);
                },
                () => toast('Could not get your current location.', 'error')
            );
        },
        save: async () => {
            const id = document.getElementById('gf-id').value;
            const lat = document.getElementById('gf-lat').value;
            const lng = document.getElementById('gf-lng').value;
            const recurrenceType = document.getElementById('gf-recurrence-type').value;
            const recurrenceDays = Array.from(document.querySelectorAll('#gf-weekday-picker input:checked')).map(el => el.value).join(',');
            const payload = {
                title: document.getElementById('gf-title').value,
                venue: document.getElementById('gf-venue').value,
                start: document.getElementById('gf-start').value,
                end: document.getElementById('gf-end').value,
                points: G_App.geofence.drawnPoints,
                center_lat: lat !== '' ? Number(lat) : null,
                center_lng: lng !== '' ? Number(lng) : null,
                recurrence_type: recurrenceType,
                recurrence_days: recurrenceDays,
                recurrence_end_date: document.getElementById('gf-recurrence-end').value || null
            };
            if (!payload.title || !payload.start || !payload.end) {
                return toast('Complete the event name and schedule.', 'error');
            }
            if (payload.points.length < 3) {
                return toast('Click at least 3 points on the map to draw the boundary polygon.', 'error');
            }
            if (payload.center_lat === null || payload.center_lng === null) {
                return toast('Enter the Latitude and Longitude of the geofence center.', 'error');
            }
            if (recurrenceType === 'weekly' && (!recurrenceDays || !payload.recurrence_end_date)) {
                return toast('Pick at least one weekday and a "Repeat Until" date for a recurring schedule.', 'error');
            }
            try {
                if (id) {
                    await apiFetch(`/geofences/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
                } else {
                    await apiFetch('/geofences', { method: 'POST', body: JSON.stringify(payload) });
                }
                G_App.geofence.clearForm();
                await G_App.geofence.load();
                toast('Protocol saved successfully.', 'success');
                // Only refresh the Dashboard's charts/stats if that page is
                // actually the visible view — refreshing it while on the
                // Geo-Fences page reaches into hidden canvases and can throw
                // (e.g. Chart.js "destroy is not a function" if a chart on a
                // display:none canvas wasn't fully constructed the first time).
                const dashboardView = document.getElementById('dashboard');
                if (dashboardView && dashboardView.classList.contains('active')) {
                    G_App.ui.updateDashboard();
                }
            } catch (err) {
                toast(err.message, 'error');
            }
        },
        edit: (id) => {
            const gf = G_App.state.geofences.find(g => g.id == id);
            if (!gf) return;
            document.getElementById('gf-form-title').innerText = 'Edit Boundary Protocol';
            document.getElementById('gf-id').value = gf.id;
            document.getElementById('gf-title').value = gf.title;
            document.getElementById('gf-venue').value = gf.venue || '';
            document.getElementById('gf-start').value = (gf.start_datetime || '').replace(' ', 'T').slice(0, 16);
            document.getElementById('gf-end').value = (gf.end_datetime || '').replace(' ', 'T').slice(0, 16);
            document.getElementById('gf-lat').value = gf.center_lat != null ? Number(gf.center_lat).toFixed(7) : '';
            document.getElementById('gf-lng').value = gf.center_lng != null ? Number(gf.center_lng).toFixed(7) : '';
            document.getElementById('btn-gf-cancel').classList.remove('hidden');
            document.getElementById('btn-gf-save').innerHTML = '<i data-lucide="save"></i> Update Protocol';
            lucide.createIcons();

            // Load the existing polygon onto the map so it can be redrawn/adjusted.
            G_App.geofence.clearPoints();
            (gf.points || []).forEach(p => G_App.geofence.addPoint(p.lat, p.lng));

            if (gf.center_lat && gf.center_lng) {
                G_App.geofence.dropCenterMarker(gf.center_lat, gf.center_lng);
                G_App.geofence.focusOn(gf.center_lat, gf.center_lng);
            }
        },
        delete: async (id) => {
            if (!confirm('Terminate this Geo-Fence protocol?')) return;
            try {
                await apiFetch(`/geofences/${id}`, { method: 'DELETE' });
                await G_App.geofence.load();
                toast('Geofence terminated.', 'success');
            } catch (err) { toast(err.message, 'error'); }
        },
        clearForm: () => {
            document.getElementById('gf-form-title').innerText = 'Boundary Protocol';
            ['gf-id', 'gf-title', 'gf-venue', 'gf-start', 'gf-end', 'gf-lat', 'gf-lng'].forEach(id => document.getElementById(id).value = '');
            document.getElementById('gf-recurrence-type').value = 'none';
            document.getElementById('gf-recurrence-end').value = '';
            document.querySelectorAll('#gf-weekday-picker input:checked').forEach(el => el.checked = false);
            document.getElementById('gf-recurrence-fields').classList.add('hidden');
            document.getElementById('btn-gf-cancel').classList.add('hidden');
            document.getElementById('btn-gf-save').innerHTML = '<i data-lucide="shield-check"></i> Initialize Protocol';
            G_App.geofence.clearPoints();
            if (G_App.geofence.centerMarker) {
                G_App.geofence.centerMarker.setMap(null);
                G_App.geofence.centerMarker = null;
            }
            lucide.createIcons();
        },
        updateMapPolygons: () => {
            G_App.geofence.polygonLayers.forEach(layer => layer.setMap(null));
            G_App.geofence.polygonLayers = [];
            G_App.state.geofences.forEach(gf => {
                if (!gf.points || gf.points.length < 3) return;
                const polygon = new google.maps.Polygon({
                    paths: gf.points.map(p => ({ lat: p.lat, lng: p.lng })),
                    strokeColor: gf.computed_status === 'active' ? '#05CD99' : '#0D00A5',
                    strokeWeight: 2, strokeOpacity: 0.9,
                    fillColor: gf.computed_status === 'active' ? '#05CD99' : '#0D00A5',
                    fillOpacity: 0.12,
                    map: G_App.geofence.map
                });
                polygon.addListener('click', (e) => {
                    G_App.geofence.infoWindow.setContent(`<b>${gf.title}</b><br>${gf.venue || ''}`);
                    G_App.geofence.infoWindow.setPosition(e.latLng);
                    G_App.geofence.infoWindow.open(G_App.geofence.map);
                });
                G_App.geofence.polygonLayers.push(polygon);
            });
        },
        renderList: () => {
            const all = G_App.state.geofences || [];
            const visible = G_App.geofence.showAll ? all : all.slice(0, 3);
            document.getElementById('geofence-list-title').innerText = G_App.geofence.showAll ? `All Events (${all.length})` : 'Recent Events';
            document.getElementById('geofence-view-all-link').innerText = G_App.geofence.showAll ? 'Show Recent' : 'View All';
            document.getElementById('geofence-list').innerHTML = visible.map(gf => `
                <div class="card" style="padding:15px; background:var(--bg-body); margin-bottom: 5px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div onclick="G_App.geofence.focusOn(${gf.center_lat},${gf.center_lng})" style="cursor:pointer; flex: 1;">
                            <h5 style="font-weight:800; color:var(--primary)">${gf.title} <span class="badge badge-${gf.computed_status === 'active' ? 'success' : (gf.computed_status === 'expired' ? 'danger' : 'warning')}">${gf.computed_status}</span>
                                ${gf.recurrence_type === 'weekly' ? '<span class="badge badge-info" title="Recurring event"><i data-lucide=\'repeat\' size=\'10\'></i> Recurring</span>' : ''}
                            </h5>
                            <div style="font-size:0.7rem; color:var(--text-muted)">${gf.venue || 'No Venue'} · ${(gf.points || []).length} boundary points</div>
                            <div style="font-size:0.65rem; color:var(--text-muted); margin-top:5px;">${gf.start_datetime} → ${gf.end_datetime}</div>
                        </div>
                        <div style="display:flex; gap:5px;">
                            <button class="btn-icon btn-edit" onclick="G_App.geofence.edit('${gf.id}')"><i data-lucide="edit-2" size="12"></i></button>
                            <button class="btn-icon btn-delete" onclick="G_App.geofence.delete('${gf.id}')"><i data-lucide="trash-2" size="12"></i></button>
                        </div>
                    </div>
                </div>
            `).join('') || '<p style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding: 20px 0;">No events yet.</p>';
            lucide.createIcons();
        }
    },

    attendance: {
        currentEventId: null,
        currentEventTitle: null,
        sessionsCache: {}, // attendance_id -> sessions array, cached per detail view
        render: async () => {
            try {
                const { data } = await apiFetch('/attendance/by-event');
                const folders = document.getElementById('attendance-folders');
                folders.innerHTML = data.map(e => `
                    <div class="card" onclick="G_App.attendance.openEvent(${e.id}, '${(e.title || '').replace(/'/g, "\\'")}')" style="cursor:pointer; text-align:center; padding: 40px;">
                        <i data-lucide="calendar-check" size="60" style="color:#FFB547; margin-bottom: 15px;"></i>
                        <h3 style="font-weight:800; color:var(--primary);">${e.title}</h3>
                        <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 5px;">
                            <p style="color:var(--text-muted); font-size: 0.85rem; font-weight: 700;">
                                Attendance Logs: <span style="color:var(--primary); font-size: 1.1rem;">${e.log_count}</span>
                            </p>
                            <p style="color:var(--text-muted); font-size: 0.75rem;">${new Date(e.start_datetime).toLocaleDateString()} · ${e.venue || 'No venue'}</p>
                            <span class="badge badge-${e.computed_status === 'ongoing' ? 'success' : (e.computed_status === 'completed' ? 'danger' : 'warning')}" style="align-self:center;">${e.computed_status}</span>
                        </div>
                    </div>
                `).join('') || '<p style="color:var(--text-muted); grid-column: 1/-1; text-align:center; padding: 40px;">No events yet. Create one from Geo-Fences.</p>';
                lucide.createIcons();
            } catch (err) { toast(err.message, 'error'); }
        },
        openEvent: async (eventId, eventTitle) => {
            G_App.attendance.currentEventId = eventId;
            G_App.attendance.currentEventTitle = eventTitle;
            G_App.attendance.sessionsCache = {};
            document.getElementById('attendance-root').classList.add('hidden');
            document.getElementById('attendance-detail').classList.remove('hidden');
            document.getElementById('current-dept-title').innerText = eventTitle;
            const searchInput = document.getElementById('attendance-detail-search');
            if (searchInput) searchInput.value = '';
            await G_App.attendance.loadDetail();
        },
        // Re-fetches and re-renders the currently-open event's table in place —
        // used both by openEvent and by the auto-refresh loop, so a live event's
        // logs update on their own without the admin needing to reopen it.
        loadDetail: async () => {
            if (!G_App.attendance.currentEventId) return;
            try {
                const { data } = await apiFetch(`/attendance?event_id=${encodeURIComponent(G_App.attendance.currentEventId)}`);
                const tbody = document.getElementById('attendance-dept-table');
                tbody.innerHTML = data.map(log => `
                    <tr>
                        <td><b>${log.full_name}</b></td>
                        <td>${log.department_name || 'N/A'}</td>
                        <td>${log.attendance_date}</td>
                        <td>${G_App.attendance.timeSessionCell(log)}</td>
                        <td>${G_App.attendance.durationCell(log)}</td>
                        <td>${log.longitude ?? '--'}</td>
                        <td>${log.latitude ?? '--'}</td>
                        <td>${G_App.attendance.faceVerificationCell(log)}</td>
                        <td><span class="badge badge-${log.attendance_status === 'Present' ? 'success' : (log.attendance_status === 'Late' ? 'warning' : 'danger')}">${log.attendance_status}</span></td>
                    </tr>
                `).join('') || '<tr><td colspan="9" style="text-align:center; padding:30px;">No attendance logs found for this event.</td></tr>';
                lucide.createIcons();
                const searchInput = document.getElementById('attendance-detail-search');
                if (searchInput && searchInput.value) G_App.attendance.filterDetail(searchInput.value);
            } catch (err) { toast(err.message, 'error'); }
        },
        filterDetail: (q) => {
            const rows = document.querySelectorAll('#attendance-dept-table > tr');
            rows.forEach(r => r.style.display = r.innerText.toLowerCase().includes(q.toLowerCase()) ? '' : 'none');
        },
        // Time Started / Time Ended, with a dropdown when the employee entered
        // and left the geofence more than once — each boundary crossing (its
        // own time-in/time-out pair) is a separate row in attendance_sessions,
        // so a single "Time Started"/"Time Ended" pair can't represent all of
        // them. With one session, the pair is shown directly; with more than
        // one, a dropdown reveals every individual dip.
        timeSessionCell: (log) => {
            const single = `
                <div><span style="color:var(--success); font-weight:700;">${log.time_in ? new Date(log.time_in).toLocaleTimeString() : '--'}</span>
                <span style="color:var(--text-muted); margin:0 4px;">→</span>
                <span style="color:var(--danger); font-weight:700;">${log.time_out ? new Date(log.time_out).toLocaleTimeString() : '--'}</span>${log.auto_ended ? ' <span class="badge badge-info" style="font-size:0.6rem;">Auto</span>' : ''}</div>
            `;
            if (!(log.session_count > 1)) return single;
            const cellId = `sessions-${log.id}`;
            return `
                <button class="btn-primary" style="padding:6px 12px; font-size:0.7rem; background:var(--primary-light); color:var(--primary);" onclick="G_App.attendance.toggleSessions(${log.id})">
                    <i data-lucide="chevron-down" size="12"></i> <span id="${cellId}-label">${log.session_count} time-in/time-out pairs</span>
                </button>
                <div id="${cellId}" class="hidden" style="margin-top:8px; display:flex; flex-direction:column; gap:6px;"></div>
            `;
        },
        toggleSessions: async (attendanceId) => {
            const wrap = document.getElementById(`sessions-${attendanceId}`);
            const label = document.getElementById(`sessions-${attendanceId}-label`);
            if (!wrap) return;
            const opening = wrap.classList.contains('hidden');
            wrap.classList.toggle('hidden');
            if (!opening) return;
            label.innerText = 'Loading…';
            try {
                if (!G_App.attendance.sessionsCache[attendanceId]) {
                    const { data } = await apiFetch(`/attendance/${attendanceId}/sessions/admin`);
                    G_App.attendance.sessionsCache[attendanceId] = data;
                }
                const sessions = G_App.attendance.sessionsCache[attendanceId];
                wrap.innerHTML = sessions.map((s, i) => `
                    <div style="display:flex; justify-content:space-between; gap:10px; background:var(--bg-body); border-radius:8px; padding:6px 10px; font-size:0.75rem;">
                        <span style="font-weight:700;">#${i + 1}</span>
                        <span style="color:var(--success);">${s.time_in ? new Date(s.time_in).toLocaleTimeString() : '--'}</span>
                        <span>→</span>
                        <span style="color:var(--danger);">${s.time_out ? new Date(s.time_out).toLocaleTimeString() : 'Still in'}</span>
                        ${s.auto_ended ? '<span class="badge badge-info" style="font-size:0.6rem;">Auto</span>' : ''}
                    </div>
                `).join('');
                label.innerText = `${sessions.length} time-in/time-out pairs`;
            } catch (err) {
                label.innerText = 'Failed to load sessions';
            }
        },
        // Accumulated duration across every time-in/time-out session for the
        // day (an employee can leave/re-enter the event's geofence multiple
        // times while it's still running — see total_duration_seconds /
        // open_session_time_in from the API). Keeps counting up live while
        // still on-going instead of freezing at the last known total.
        durationCell: (log) => {
            const base = Number(log.total_duration_seconds) || 0;
            let seconds = base;
            if (log.open_session_time_in) {
                const openedAt = new Date(log.open_session_time_in).getTime();
                if (!isNaN(openedAt)) seconds = base + Math.max(0, (Date.now() - openedAt) / 1000);
            }
            const totalSeconds = Math.max(0, Math.round(seconds));
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const label = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
            const color = log.time_out ? 'var(--text-main)' : 'var(--warning)';
            return `<span style="font-weight:700; color:${color};">${label}</span>`;
        },
        faceVerificationCell: (log) => {
            if (!log.selfie_path) {
                return log.requires_face_verification
                    ? '<span class="badge badge-danger">Awaiting Verification</span>'
                    : '<span style="color:var(--text-muted); font-size:0.8rem;">Not required</span>';
            }
            const cellId = `face-photo-${log.id}`;
            const locLabel = (log.selfie_lat && log.selfie_lng) ? `${Number(log.selfie_lat).toFixed(5)}, ${Number(log.selfie_lng).toFixed(5)}` : 'No location';
            return `
                <button class="btn-primary" style="padding:8px 14px; font-size:0.75rem;" onclick="G_App.attendance.toggleFacePhoto('${cellId}')">
                    <i data-lucide="eye" size="14"></i> <span id="${cellId}-label">View</span>
                </button>
                <div id="${cellId}" class="hidden" style="margin-top:10px;">
                    <img src="${log.selfie_path}" style="width:120px; height:120px; object-fit:cover; border-radius:12px; border:1px solid var(--border);">
                    <p style="font-size:0.7rem; color:var(--text-muted); margin-top:5px; max-width:120px;"><i data-lucide="map-pin" size="10"></i> ${locLabel}</p>
                </div>
            `;
        },
        toggleFacePhoto: (cellId) => {
            const el = document.getElementById(cellId);
            const label = document.getElementById(`${cellId}-label`);
            el.classList.toggle('hidden');
            label.innerText = el.classList.contains('hidden') ? 'View' : 'Hide';
        },
        goBack: () => {
            document.getElementById('attendance-root').classList.remove('hidden');
            document.getElementById('attendance-detail').classList.add('hidden');
            G_App.attendance.currentEventId = null;
        },
        generateReport: () => {
            window.open(`${API}/reports/export/csv?event_id=${encodeURIComponent(G_App.attendance.currentEventId)}&token=${localStorage.getItem('ga_token')}`, '_blank');
        }
    },

    reports: {
        init: () => {
            const empSel = document.getElementById('rpt-employee');
            empSel.innerHTML = '<option value="all">All Personnel</option>' +
                G_App.state.employees.map(e => `<option value="${e.id}">${e.full_name}</option>`).join('');
        },
        generate: async () => {
            const params = new URLSearchParams({
                department: document.getElementById('rpt-dept').value,
                year: document.getElementById('rpt-year').value,
                month: document.getElementById('rpt-month').value,
                employee_id: document.getElementById('rpt-employee').value
            });
            try {
                const { data, summary } = await apiFetch(`/reports?${params.toString()}`);
                document.getElementById('report-results').classList.remove('hidden');
                document.getElementById('rpt-res-subtitle').innerText =
                    `${summary.total} records — ${summary.present} present, ${summary.late} late, ${summary.absent} absent`;

                const tbody = document.getElementById('report-table-body');
                tbody.innerHTML = data.length ? data.map(log => `
                    <tr>
                        <td>${log.attendance_date}</td>
                        <td>${log.full_name}</td>
                        <td>${log.department_name}</td>
                        <td><span class="badge badge-${log.attendance_status === 'Present' ? 'success' : (log.attendance_status === 'Late' ? 'warning' : 'danger')}">${log.attendance_status}</span></td>
                        <td>${log.late_minutes || 0}</td>
                    </tr>
                `).join('') : '<tr><td colspan="5" style="text-align:center; padding:40px;">No records found for this criteria.</td></tr>';
            } catch (err) { toast(err.message, 'error'); }
        },
        exportFile: (format) => {
            const params = new URLSearchParams({
                department: document.getElementById('rpt-dept').value,
                year: document.getElementById('rpt-year').value,
                month: document.getElementById('rpt-month').value,
                employee_id: document.getElementById('rpt-employee').value,
                token: localStorage.getItem('ga_token')
            });
            window.open(`${API}/reports/export/${format}?${params.toString()}`, '_blank');
        }
    },

    ocr: {
        initCamera: async () => {
            try {
                const v = document.getElementById('ocr-video');
                const s = await navigator.mediaDevices.getUserMedia({ video: true });
                v.srcObject = s;
            } catch (e) { console.log('Camera unavailable in this browser/context.'); }
        },
        process: async () => {
            const video = document.getElementById('ocr-video');
            const canvas = document.getElementById('ocr-canvas');
            const line = document.getElementById('scan-line');
            const output = document.getElementById('ocr-output');

            if (!video.srcObject) return toast('Camera not available.', 'error');

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);

            line.style.display = 'block';
            output.innerText = 'CALIBRATING OCR SCANNER...';

            canvas.toBlob(async (blob) => {
                const formData = new FormData();
                formData.append('image', blob, 'capture.jpg');
                try {
                    const result = await apiFetch('/ocr/verify', { method: 'POST', body: formData });
                    line.style.display = 'none';
                    if (result.employee) {
                        output.innerText = `SUCCESS: ${result.employee.full_name} [${result.employee.employee_code}]\nMATCH CONFIDENCE: ${result.confidence.toFixed(1)}%\n${result.message}`;
                    } else {
                        output.innerText = `RESULT: ${result.result.toUpperCase()}\nCONFIDENCE: ${result.confidence.toFixed(1)}%\n${result.message}`;
                    }
                    G_App.ocr.loadRecords();
                } catch (err) {
                    line.style.display = 'none';
                    output.innerText = `ERROR: ${err.message}`;
                }
            }, 'image/jpeg', 0.9);
        },
        loadRecords: async () => {
            try {
                const { data } = await apiFetch('/ocr/records');
                document.getElementById('ocr-records-table').innerHTML = data.slice(0, 15).map(r => `
                    <tr>
                        <td>${r.full_name || r.extracted_name || 'Unknown'}</td>
                        <td>${Number(r.confidence).toFixed(1)}%</td>
                        <td><span class="badge badge-${r.result === 'matched' ? 'success' : 'danger'}">${r.result}</span></td>
                    </tr>
                `).join('') || '<tr><td colspan="3" style="text-align:center; padding:20px;">No OCR records yet.</td></tr>';
            } catch (err) { /* silent */ }
        }
    },

    mobile: {
        render: async () => {
            try {
                const { data } = await apiFetch('/devices');
                document.getElementById('mobile-device-table').innerHTML = data.map(d => `
                    <tr>
                        <td><b>${d.full_name}</b></td>
                        <td>${d.model || 'N/A'}</td>
                        <td><code>${d.mac_address || 'N/A'}</code></td>
                        <td><span class="badge badge-${d.status === 'approved' ? 'success' : (d.status === 'pending' ? 'warning' : 'danger')}">${d.status}</span></td>
                        <td>
                            ${d.status !== 'approved' ? `<button class="btn-icon btn-edit" onclick="G_App.mobile.setStatus(${d.id},'approved')"><i data-lucide="check" size="14"></i></button>` : ''}
                            <button class="btn-icon btn-delete" onclick="G_App.mobile.setStatus(${d.id},'blacklisted')"><i data-lucide="ban" size="14"></i></button>
                        </td>
                    </tr>
                `).join('') || '<tr><td colspan="5" style="text-align:center; padding:20px;">No devices registered yet.</td></tr>';
                lucide.createIcons();
            } catch (err) { toast(err.message, 'error'); }
        },
        setStatus: async (id, status) => {
            try {
                await apiFetch(`/devices/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
                toast(`Device marked as ${status}.`, 'success');
                G_App.mobile.render();
            } catch (err) { toast(err.message, 'error'); }
        }
    },

    settings: {
        render: () => {
            const certSel = document.getElementById('cert-employee-select');
            if (certSel) certSel.innerHTML = G_App.state.employees.map(e => `<option value="${e.id}">${e.full_name} (${e.employee_code})</option>`).join('');
            lucide.createIcons();
        },
        generateCertificate: async () => {
            const employeeId = document.getElementById('cert-employee-select').value;
            const event = document.getElementById('cert-event').value || 'Professional Development Workshop';
            if (!employeeId) return toast('Select an employee first.', 'error');

            try {
                const result = await apiFetch('/certificates/generate', {
                    method: 'POST',
                    body: JSON.stringify({ employee_id: employeeId, event_title: event })
                });
                toast('Certificate generated.', 'success');
                window.open(result.data.downloadUrl, '_blank');
            } catch (err) {
                toast(err.message, 'error');
            }
        }
    },

    adminAccounts: {
        load: async () => {
            if (G_App.state.role !== 'super_admin') return; // OCR-only admins can't see this
            try {
                const { data } = await apiFetch('/admin-accounts');
                G_App.adminAccounts.render(data);
            } catch (err) {
                // Silently skip — element may not be visible for this role.
            }
        },
        render: (accounts) => {
            const list = document.getElementById('admin-accounts-list');
            if (!list) return;
            list.innerHTML = accounts.map(a => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-body); padding:14px 18px; border-radius:14px;">
                    <div>
                        <strong>${a.full_name}</strong> ${a.is_active ? '' : '<span class="badge badge-danger" style="margin-left:6px;">Disabled</span>'}<br>
                        <span style="color:var(--text-muted); font-size:0.8rem;">${a.email}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span class="badge badge-${a.role === 'super_admin' ? 'info' : 'warning'}">${a.role === 'super_admin' ? 'Super Admin' : 'Admin (OCR only)'}</span>
                        <button class="btn-icon btn-delete" onclick="G_App.adminAccounts.remove(${a.id})"><i data-lucide="trash" size="14"></i></button>
                    </div>
                </div>
            `).join('') || '<p style="color:var(--text-muted); font-size:0.85rem;">No admin accounts yet.</p>';
            lucide.createIcons();
        },
        openModal: () => {
            ['aa-name', 'aa-email', 'aa-password'].forEach(id => document.getElementById(id).value = '');
            document.getElementById('aa-role').value = 'admin';
            document.getElementById('admin-account-modal').classList.add('open');
        },
        closeModal: () => document.getElementById('admin-account-modal').classList.remove('open'),
        save: async () => {
            const payload = {
                full_name: document.getElementById('aa-name').value.trim(),
                email: document.getElementById('aa-email').value.trim(),
                password: document.getElementById('aa-password').value,
                role: document.getElementById('aa-role').value
            };
            if (!payload.full_name || !payload.email || !payload.password) {
                return toast('Full name, email, and password are required.', 'error');
            }
            try {
                await apiFetch('/admin-accounts', { method: 'POST', body: JSON.stringify(payload) });
                toast('Admin account created.', 'success');
                G_App.adminAccounts.closeModal();
                G_App.adminAccounts.load();
            } catch (err) {
                toast(err.message, 'error');
            }
        },
        remove: async (id) => {
            if (!confirm('Delete this admin account? This cannot be undone.')) return;
            try {
                await apiFetch(`/admin-accounts/${id}`, { method: 'DELETE' });
                toast('Admin account deleted.', 'success');
                G_App.adminAccounts.load();
            } catch (err) {
                toast(err.message, 'error');
            }
        }
    },

    ratings: {
        current: { month: new Date().getMonth() + 1, year: new Date().getFullYear() },
        initSelectors: () => {
            const monthSel = document.getElementById('ratings-month');
            const yearSel = document.getElementById('ratings-year');
            const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            monthSel.innerHTML = monthNames.map((m, i) => `<option value="${i + 1}" ${i + 1 === G_App.ratings.current.month ? 'selected' : ''}>${m}</option>`).join('');
            const thisYear = new Date().getFullYear();
            const years = [thisYear - 1, thisYear, thisYear + 1];
            yearSel.innerHTML = years.map(y => `<option value="${y}" ${y === G_App.ratings.current.year ? 'selected' : ''}>${y}</option>`).join('');
        },
        load: async () => {
            const month = Number(document.getElementById('ratings-month').value) || G_App.ratings.current.month;
            const year = Number(document.getElementById('ratings-year').value) || G_App.ratings.current.year;
            G_App.ratings.current = { month, year };
            try {
                const { mondays, data } = await apiFetch(`/ratings?month=${month}&year=${year}`);
                G_App.ratings.render(mondays, data);
            } catch (err) {
                toast(err.message, 'error');
            }
        },
        render: (mondays, data) => {
            const table = document.getElementById('ratings-table');
            if (!mondays.length) {
                table.innerHTML = '<tbody><tr><td style="padding:25px;">No Mondays found for this month.</td></tr></tbody>';
                return;
            }
            const dayLabel = (iso) => new Date(`${iso}T00:00:00`).getDate();
            const head = `<thead><tr><th>Employee</th>${mondays.map(m => `<th style="text-align:center;">Mon ${dayLabel(m)}</th>`).join('')}<th style="text-align:center;">Total Rating</th><th style="text-align:center;" title="5 Attended = 1 point, 1 No-Attendance = -1">Rating Points</th></tr></thead>`;
            const body = data.map(e => `
                <tr>
                    <td>${e.full_name}<br><span style="color:var(--text-muted); font-weight:600; font-size:0.75rem;">${e.employee_code}</span></td>
                    ${mondays.map(m => `
                        <td style="text-align:center;">
                            <select class="badge-select" style="background: var(--bg-body); color: var(--text-main); min-width:52px;"
                                onchange="G_App.ratings.setRating(${e.id}, '${m}', this.value)">
                                ${[1,2,3,4,5].map(n => `<option value="${n}" ${Number(e.ratings[m]) === n ? 'selected' : (!e.ratings[m] && n === 1 ? '' : '')}>${n}</option>`).join('')}
                                ${!e.ratings[m] ? '<option value="" selected>—</option>' : ''}
                            </select>
                        </td>
                    `).join('')}
                    <td style="text-align:center; font-weight:800;">${e.total_rating != null ? e.total_rating : '--'}</td>
                    <td style="text-align:center; font-weight:800; color:${(e.rating_points || 0) < 0 ? 'var(--danger)' : 'var(--success)'};">${e.rating_points ?? 0}</td>
                </tr>
            `).join('');
            table.innerHTML = head + `<tbody>${body}</tbody>`;
        },
        setRating: async (employeeId, ratingDate, value) => {
            if (!value) return;
            try {
                await apiFetch('/ratings', { method: 'PATCH', body: JSON.stringify({ employee_id: employeeId, rating_date: ratingDate, rating: Number(value) }) });
                toast('Rating saved.', 'success');
                G_App.ratings.load();
            } catch (err) {
                toast(err.message, 'error');
            }
        }
    },

    init: async () => {
        const adminData = JSON.parse(localStorage.getItem('ga_admin') || '{}');
        G_App.state.role = adminData.role || 'super_admin';
        G_App.ui.initNav();
        G_App.ui.applyRoleRestrictions();

        if (G_App.state.role === 'admin') {
            // OCR-only admin: skip loading modules they can't access (would 403).
            G_App.ocr.initCamera();
            G_App.ocr.loadRecords();
            lucide.createIcons();
            return;
        }

        await G_App.departments.load();
        await G_App.employees.load();
        G_App.ui.updateDashboard();
        G_App.attendance.render();
        G_App.settings.render();
        G_App.adminAccounts.load();
        G_App.mobile.render();
        G_App.ui.startAutoRefresh();
        lucide.createIcons();
    }
};

window.onload = () => {
    lucide.createIcons();
    G_App.auth.checkSession();
};
