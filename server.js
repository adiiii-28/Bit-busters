require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server: WebSocketServer } = require('ws');

const authRoutes = require('./routes/auth');
const mentorRoutes = require('./routes/mentors');
const { protect } = require('./middleware/authMiddleware');
const User = require('./models/User');

const app = express();

// Allow cross-origin requests from local files and localhost
app.use(cors({ origin: true }));
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

// Admin emails from env (comma-separated)
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const isAdmin = (req, res, next) => {
  if (!req.user || !req.user.email) return res.status(401).json({ message: 'Not authorized' });
  const ok = ADMIN_EMAILS.includes(String(req.user.email).toLowerCase());
  if (!ok) return res.status(403).json({ message: 'Forbidden: Admins only' });
  next();
};

// Simple health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', port: PORT });
});

console.log('Starting MentorConnect backend...');
if (!MONGO_URI) {
  console.warn('Warning: MONGO_URI is not set. Set it in .env to connect to MongoDB.');
}
console.log('Connecting to MongoDB...');
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    const httpServer = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // WebSocket signaling server for WebRTC calls
    const wss = new WebSocketServer({ server: httpServer });
    const rooms = new Map(); // roomId -> Set of sockets

    function joinRoom(ws, roomId) {
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      rooms.get(roomId).add(ws);
      ws._roomId = roomId;
    }

    function leaveRoom(ws) {
      const roomId = ws._roomId;
      if (!roomId) return;
      const set = rooms.get(roomId);
      if (set) {
        set.delete(ws);
        if (!set.size) rooms.delete(roomId);
      }
      ws._roomId = undefined;
    }

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const roomId = url.searchParams.get('room');
      const user = url.searchParams.get('user') || 'anon';
      if (roomId) joinRoom(ws, roomId);

      ws.on('message', (msg) => {
        // Relay SDP/ICE messages to others in the same room
        try {
          const payload = JSON.parse(msg.toString());
          const peers = rooms.get(ws._roomId);
          if (!peers) return;
          peers.forEach((peer) => {
            if (peer !== ws && peer.readyState === peer.OPEN) {
              peer.send(JSON.stringify({ from: user, ...payload }));
            }
          });
        } catch (e) {}
      });

      ws.on('close', () => {
        // Notify peers that this user left
        const peers = rooms.get(ws._roomId);
        if (peers) {
          peers.forEach((peer) => {
            if (peer !== ws && peer.readyState === peer.OPEN) {
              peer.send(JSON.stringify({ type: 'peer-left', from: user }));
            }
          });
        }
        leaveRoom(ws);
      });
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error', err);
    process.exit(1);
  });

// Admin endpoints
app.get('/api/users', protect, isAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ count: users.length, users });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load users', error: err.message });
  }
});

app.patch('/api/users/:id', protect, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = {};
    const pick = (k) => {
      if (req.body[k] !== undefined) allowed[k] = req.body[k];
    };
    // Allow only these fields to be modified by admin
    ['role','isMentor','company','yearsOfExperience','fullName','academicField','skills'].forEach(pick);
    // Optional: coerce types
    if (allowed.yearsOfExperience != null) {
      const n = Number(allowed.yearsOfExperience);
      if (Number.isNaN(n)) return res.status(400).json({ message: 'yearsOfExperience must be a number' });
      allowed.yearsOfExperience = n;
    }
    // Save
    const updated = await User.findByIdAndUpdate(id, {$set: allowed}, { new: true, runValidators: true }).select('-password');
    if (!updated) return res.status(404).json({ message: 'User not found' });
    res.json({ user: updated });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update user', error: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/mentors', mentorRoutes);

// AI mentor suggestions via Hugging Face Inference API (proxy)
app.post('/api/ai/suggest-mentors', protect, async (req, res) => {
  try {
    const API_KEY = process.env.HUGGINGFACE_API_KEY;
    if (!API_KEY) return res.status(500).json({ message: 'HUGGINGFACE_API_KEY missing in .env' });

    const { skills = [], academicField = '', role = 'student' } = req.body || {};
    const skillList = Array.isArray(skills) ? skills.join(', ') : String(skills || '');

    const prompt = `You are MentorConnect. Based on the user's background, suggest exactly 3 mentor matches as a compact JSON array of objects with keys fullName, company, yearsOfExperience, and topSkills. Do not include any extra text.\n\nUser background:\n- Academic field: ${academicField || 'Unknown'}\n- Skills: ${skillList || 'None'}\n- Role: ${role}\n\nReturn only JSON, e.g.: [ {"fullName":"A","company":"X","yearsOfExperience":5,"topSkills":["React","Node"]}, ... ]`;

    const hfRes = await fetch('https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 256, temperature: 0.7 } })
    });

    const ct = hfRes.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await hfRes.json() : await hfRes.text();

    let text = '';
    if (Array.isArray(payload) && payload[0] && payload[0].generated_text) {
      text = payload[0].generated_text;
    } else if (typeof payload === 'string') {
      text = payload;
    } else {
      text = JSON.stringify(payload);
    }

    // Extract JSON array from the model output
    let suggestions = [];
    try {
      const start = text.indexOf('[');
      const end = text.lastIndexOf(']');
      if (start !== -1 && end !== -1) {
        const jsonStr = text.slice(start, end + 1);
        suggestions = JSON.parse(jsonStr);
      }
    } catch {}

    // Normalize and fallback if empty
    if (!Array.isArray(suggestions) || !suggestions.length) {
      suggestions = [
        { fullName: 'Aditi Sharma', company: 'Google', yearsOfExperience: 5, topSkills: ['DSA','System Design'] },
        { fullName: 'Rohit Mehta', company: 'Qualcomm', yearsOfExperience: 7, topSkills: ['C/C++','Firmware'] },
        { fullName: 'Neha Verma', company: 'Microsoft', yearsOfExperience: 6, topSkills: ['Product','Roadmaps'] }
      ];
    }

    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ message: 'AI suggestion failed', error: err.message });
  }
});
