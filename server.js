require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');

const app = express();

// 📁 Room data file
const ROOM_FILE = './roomData.json';

// 📌 Helper to read room availability
function readRoomData() {
  if (!fs.existsSync(ROOM_FILE)) {
    fs.writeFileSync(ROOM_FILE, JSON.stringify({ Deluxe: 7, Executive: 7 }, null, 2));
  }
  return JSON.parse(fs.readFileSync(ROOM_FILE));
}

// 📌 Helper to write room availability
function writeRoomData(data) {
  fs.writeFileSync(ROOM_FILE, JSON.stringify(data, null, 2));
}

// 💌 Brevo SMTP setup
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: "9ad4d0001@smtp-brevo.com",
    pass: process.env.BREVO_SMTP_KEY
  }
});

// 📦 in-memory bookings
const bookings = [];
const totalRooms = { Deluxe: 7, Executive: 7 };

// 🎫 Booking ID generator
function generateBookingId(roomType, checkin, idx) {
  return 'BK' + checkin.replace(/-/g, '') + '-' + roomType + '-' + idx;
}

// 📅 Check date overlap
function isDateOverlap(aStart, aEnd, bStart, bEnd) {
  return !(aEnd <= bStart || aStart >= bEnd);
}

app.use(cors());
app.use(express.json());

// ✅ Get availability
app.get('/api/room-availability', (req, res) => {
  const data = readRoomData();
  const { checkin, checkout } = req.query;
  if (!checkin || !checkout) return res.status(400).json({ error: 'Missing dates' });

  const result = {};
  for (let type in data) {
    const overlapping = bookings.filter(b =>
      b.roomType === type && isDateOverlap(checkin, checkout, b.checkin, b.checkout)
    ).length;

    result[type] = data[type] - overlapping;
  }

  res.json(result);
});

// ✅ Book room
app.post('/api/book-room', async (req, res) => {
  const { roomType, checkin, checkout, customerEmail, customerPhone } = req.body;

  if (!roomType || !checkin || !checkout || !customerEmail || !customerPhone)
    return res.status(400).json({ error: 'Missing details' });

  const overlapping = bookings.filter(b =>
    b.roomType === roomType && isDateOverlap(checkin, checkout, b.checkin, b.checkout)
  ).length;

  const availableRooms = readRoomData();
  if (overlapping >= availableRooms[roomType])
    return res.status(409).json({ error: 'Room not available' });

  const prices = { Deluxe: 1350, Executive: 1700 };
  const base = prices[roomType];
  const gst = Math.round(base * 0.05);
  const total = base + gst;

  const bookingId = generateBookingId(roomType, checkin, bookings.length + 1);
  const booking = { bookingId, roomType, checkin, checkout, customerEmail, customerPhone, total };
  bookings.push(booking);

  // Reduce room count
  availableRooms[roomType] -= 1;
  writeRoomData(availableRooms);

  res.json({ status: "Booked", booking });
});

// ❌ Cancel booking
app.delete('/api/cancel-booking', (req, res) => {
  const id = req.query.id;
  const idx = bookings.findIndex(b => b.bookingId === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const booking = bookings[idx];
  bookings.splice(idx, 1);

  const data = readRoomData();
  data[booking.roomType] += 1; // add back room
  writeRoomData(data);

  res.json({ status: "Cancelled", refundAmount: 0 });
});

// 🧑‍💼 Admin - update room availability
app.post('/api/admin/update', (req, res) => {
  const { roomType, count } = req.body;
  const data = readRoomData();
  data[roomType] = count;
  writeRoomData(data);
  res.json({ success: true });
});

// 📊 Admin - summary
app.get('/api/admin/summary', (req, res) => {
  const data = readRoomData();
  res.json({
    Deluxe: { total: 7, booked: 7 - data.Deluxe, available: data.Deluxe },
    Executive: { total: 7, booked: 7 - data.Executive, available: data.Executive }
  });
});

// ✅ Admin Login API
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "maruthi123";

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ success: true, message: "Login successful" });
  } else {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }
});


app.get('/', (req, res) => res.send("Hotel Maruthi API Running ✅"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server Live: ${PORT}`));


