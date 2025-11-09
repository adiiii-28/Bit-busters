const express = require('express');
const router = express.Router();
const { listMentors } = require('../controllers/mentorController');

// GET /api/mentors
router.get('/', listMentors);

module.exports = router;
