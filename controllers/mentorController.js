const User = require('../models/User');

// GET /api/mentors
// Query params: academicField, skills (comma-separated), company, minYears, role(optional), isMentor(optional)
exports.listMentors = async (req, res) => {
  try {
    const { academicField, skills, company, minYears, role, isMentor } = req.query;

    const filter = {};

    // Only mentors by default
    if (typeof isMentor === 'string') {
      filter.isMentor = isMentor === 'true';
    } else {
      filter.isMentor = true;
    }

    if (academicField) filter.academicField = academicField;
    if (company) filter.company = company;
    if (role) filter.role = role; // 'student' | 'alumni'

    if (minYears) {
      const years = Number(minYears);
      if (!Number.isNaN(years)) {
        filter.yearsOfExperience = { $gte: years };
      }
    }

    if (skills) {
      const list = skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length) {
        // require that mentor has all skills listed
        filter.skills = { $all: list };
      }
    }

    const mentors = await User.find(filter).select('-password');
    res.json({ count: mentors.length, mentors });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch mentors', error: err.message });
  }
};
