const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

exports.signup = async (req, res) => {
  try {
    const {
      email,
      password,
      role,
      fullName,
      academicField,
      skills,
      company,
      yearsOfExperience,
      isMentor,
    } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' });

    const user = new User({
      email,
      password,
      role,
      fullName,
      academicField,
      skills,
      company,
      yearsOfExperience,
      isMentor,
    });

    await user.save();

    const token = generateToken(user._id);
    const userData = await User.findById(user._id).select('-password');

    res.status(201).json({ token, user: userData });
  } catch (err) {
    res.status(500).json({ message: 'Signup failed', error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = generateToken(user._id);
    const userData = await User.findById(user._id).select('-password');

    res.json({ token, user: userData });
  } catch (err) {
    res.status(500).json({ message: 'Login failed', error: err.message });
  }
};
