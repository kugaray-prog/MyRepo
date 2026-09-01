require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const { notFound, errorHandler } = require('./middleware/errorMiddleware');

// Safety nets: log and continue rather than crashing the whole server on an
// unexpected async error (e.g. a transient OCR engine or network failure).
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// Security & core middleware
// ------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: false // relaxed so CDN assets (Chart.js, fonts, Leaflet) load in the admin UI
  })
);
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev_session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
  })
);

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 });
app.use('/api', apiLimiter);

// ------------------------------------------------------------
// Static assets & uploaded files
// ------------------------------------------------------------
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------
// View engine (serves the unmodified admin dashboard UI)
// ------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ------------------------------------------------------------
// API routes
// ------------------------------------------------------------
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/employee-auth', require('./routes/employeeAuthRoutes'));
app.use('/api/employees', require('./routes/employeeRoutes'));
app.use('/api/departments', require('./routes/departmentRoutes'));
app.use('/api/attendance', require('./routes/attendanceRoutes'));
app.use('/api/geofences', require('./routes/geofenceRoutes'));
app.use('/api/events', require('./routes/eventRoutes'));
app.use('/api/ocr', require('./routes/ocrRoutes'));
app.use('/api/devices', require('./routes/deviceRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/certificates', require('./routes/certificateRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/ratings', require('./routes/ratingRoutes'));
app.use('/api/admin-accounts', require('./routes/adminAccountRoutes'));

app.get('/api/health', (req, res) => res.json({ success: true, message: 'GeoAttend Pro API is running.' }));

// ------------------------------------------------------------
// Admin dashboard page (your existing UI, unmodified, now data-driven)
// ------------------------------------------------------------
app.get('/', (req, res) => {
  res.render('dashboard', {
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
  });
});

app.get('/mobile', (req, res) => {
  res.render('mobile', {
    googleClientId: process.env.GOOGLE_CLIENT_ID || ''
  });
});

// ------------------------------------------------------------
// Error handling
// ------------------------------------------------------------
app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`GeoAttend Pro server running at http://localhost:${PORT}`);
});
