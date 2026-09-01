const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const employeeAuthController = require('../controllers/employeeAuthController');
const { requireEmployeeAuth } = require('../middleware/authMiddleware');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, message: 'Too many login attempts. Please try again later.' }
});

router.post('/login', loginLimiter, employeeAuthController.login);
router.post('/google', loginLimiter, employeeAuthController.googleLogin);
router.post('/link-device', loginLimiter, employeeAuthController.linkDevice);
router.get('/device-status', requireEmployeeAuth, employeeAuthController.deviceStatus);

module.exports = router;
