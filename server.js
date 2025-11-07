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

const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.BREVO_SMTP_KEY
  }
});


// 📦 In-memory bookings
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

app.use(cors({
  origin: ['https://hotelmaruthi.com', 'http://hotelmaruthi.com'],
  methods: ['GET', 'POST', 'DELETE'],
  credentials: true
}));
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

  const prices = { Deluxe: 1, Executive: 1 };
  const base = prices[roomType];
  const gst = Math.round(base * 0.05);
  const total = base + gst;

  const bookingId = generateBookingId(roomType, checkin, bookings.length + 1);
  const booking = { bookingId, roomType, checkin, checkout, customerEmail, customerPhone, total };
  bookings.push(booking);

  // Reduce room count
  availableRooms[roomType] -= 1;
  writeRoomData(availableRooms);

  try {
    // ✅ Send confirmation email
    await transporter.sendMail({
     from: `"Hotel Maruthi" <${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: "✅ Booking Confirmation - Hotel Maruthi",
      html: `
        <h2>Booking Confirmed 🎉</h2>
        <p>Dear Guest,</p>
        <p>Thank you for booking with <b>Hotel Maruthi</b>.</p>
        <p><b>Booking ID:</b> ${bookingId}</p>
        <p><b>Room Type:</b> ${roomType}</p>
        <p><b>Check-in:</b> ${checkin}</p>
        <p><b>Check-out:</b> ${checkout}</p>
        <p><b>Total Amount:</b> ₹${total}</p>
        <hr>
        <p>For any queries, please contact us at <b>hotelmaruthi@gmail.com</b>.</p>
        <p>We look forward to your stay!</p>
        <p>— Hotel Maruthi Team 🏨</p>
      `
    });

    // ✅ Send owner notification email
    await transporter.sendMail({
    from: `"Hotel Maruthi" <${process.env.EMAIL_USER}>`,
      to: "hotelmaruthi@gmail.com",
      subject: "📢 New Booking Received!",
      html: `
        <h2>New Booking Alert 🚨</h2>
        <p><b>Booking ID:</b> ${bookingId}</p>
        <p><b>Room Type:</b> ${roomType}</p>
        <p><b>Guest Email:</b> ${customerEmail}</p>
        <p><b>Guest Phone:</b> ${customerPhone}</p>
        <p><b>Check-in:</b> ${checkin}</p>
        <p><b>Check-out:</b> ${checkout}</p>
        <p><b>Total:</b> ₹${total}</p>
      `
    });
  } catch (err) {
    console.error("❌ Email sending failed:", err);
  }

  res.json({ status: "Booked", booking });
});

// ❌ Cancel booking
app.delete('/api/cancel-booking', async (req, res) => {
  const id = req.query.id;
  const idx = bookings.findIndex(b => b.bookingId === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const booking = bookings[idx];
  bookings.splice(idx, 1);

  const today = new Date().toISOString().split("T")[0];
  const refundAmount = today < booking.checkin ? booking.total * 0.5 : 0;

  const data = readRoomData();
  data[booking.roomType] += 1;
  writeRoomData(data);

  try {
    // 💌 Send cancellation email to customer
    await transporter.sendMail({
    from: `"Hotel Maruthi" <${process.env.EMAIL_USER}>`,
      to: booking.customerEmail,
      subject: "❌ Booking Cancelled - Hotel Maruthi",
      html: `
        <h2>Booking Cancelled</h2>
        <p>Dear Guest,</p>
        <p>Your booking with <b>Hotel Maruthi</b> has been cancelled successfully.</p>
        <p><b>Booking ID:</b> ${booking.bookingId}</p>
        <p><b>Room Type:</b> ${booking.roomType}</p>
        <p><b>Refund Amount:</b> ₹${refundAmount}</p>
        <hr>
        <p>We hope to serve you again soon.</p>
        <p>— Hotel Maruthi Team 🏨</p>
      `
    });

    // 📢 Notify owner
    await transporter.sendMail({
    from: `"Hotel Maruthi" <${process.env.EMAIL_USER}>`,
      to: "hotelmaruthi@gmail.com",
      subject: "🚨 Booking Cancelled by Customer",
      html: `
        <h2>Booking Cancelled</h2>
        <p><b>Booking ID:</b> ${booking.bookingId}</p>
        <p><b>Room Type:</b> ${booking.roomType}</p>
        <p><b>Customer:</b> ${booking.customerEmail} (${booking.customerPhone})</p>
      `
    });
  } catch (err) {
    console.error("❌ Failed to send cancellation email:", err);
  }

  res.json({ status: "Cancelled", refundAmount });
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

app.get('/', (req, res) => res.send("Hotel Maruthi API Running ✅"));

const PORT = process.env.PORT || 3000;
transporter.verify()
  .then(() => console.log('✅ SMTP connected successfully — ready to send emails'))
  .catch(err => console.error('❌ SMTP connection failed:', err));
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server Live: ${PORT}`));
