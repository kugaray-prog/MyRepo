const express = require('express');
const router = express.Router();
const ocrController = require('../controllers/ocrController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const { uploadOcr } = require('../middleware/uploadMiddleware');

// Both super_admin and OCR-only 'admin' accounts can use this module.
router.use(requireAuth, requireRole('super_admin', 'admin'));

router.post('/verify', uploadOcr.single('image'), ocrController.verifyId);
router.get('/records', ocrController.getOcrRecords);

module.exports = router;
