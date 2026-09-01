const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

router.use(requireAuth, requireRole('super_admin'));
router.get('/', eventController.getAllEvents);
router.get('/:id/occurrences', eventController.getOccurrences);

module.exports = router;
