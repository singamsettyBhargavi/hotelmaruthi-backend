require('dotenv').config();

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const app = express();

// ✅ Brevo SMTP email setup
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false, // Use STARTTLS
  auth: {
  user: "9ad4d0001@smtp-brevo.com",
  pass: process.env.BREVO_SMTP_KEY   // ✅ Load from environment variable
}
});

// Simulated in-memory database
const bookings = [];
const totalRooms = { Deluxe: 7, Executive: 7 }; // ✅ only these two types now

// Generate Booking ID
function generateBookingId(roomType, checkin, idx) {
  return (
    'BK' +
    checkin.replace(/-/g, '') +
    '-' +
    roomType +
    '-' +
    idx
  );
}

// Check for date overlaps
function isDateOverlap(aStart, aEnd, bStart, bEnd) {
  return !(aEnd <= bStart || aStart >= bEnd);
}

// Middleware setup
app.use(cors());
app.use(express.json());

// ✅ Room availability API
app.get('/api/room-availability', (req, res) => {
  const { checkin, checkout } = req.query;
  if (!checkin || !checkout)
    return res.status(400).json({ error: 'Missing checkin or checkout date' });

  const result = {};
  for (let type of Object.keys(totalRooms)) {
    const overlapping = bookings.filter(
      b => b.roomType === type && isDateOverlap(checkin, checkout, b.checkin, b.checkout)
    ).length;
    result[type] = overlapping < totalRooms[type];
  }
  res.json(result);
});

// ✅ Booking endpoint
app.post('/api/book-room', async (req, res) => {
  const { roomType, checkin, checkout, customerEmail, customerPhone } = req.body;
  if (!roomType || !checkin || !checkout || !customerEmail || !customerPhone)
    return res.status(400).json({ error: 'Missing parameters' });

  if (!totalRooms[roomType])
    return res.status(400).json({ error: 'Invalid room type' });

  const overlapping = bookings.filter(
    b => b.roomType === roomType && isDateOverlap(checkin, checkout, b.checkin, b.checkout)
  ).length;

  if (overlapping >= totalRooms[roomType])
    return res.status(409).json({ error: 'Room not available' });

  // ✅ Room pricing (not per night) + GST calculation
  const roomPrices = { Deluxe: 1350, Executive: 1700 };
  const basePrice = roomPrices[roomType];
  const gst = Math.round(basePrice * 0.05); // 5% GST
  const totalPrice = basePrice + gst;

  const bookingId = generateBookingId(roomType, checkin, bookings.length + 1);
  const booking = { bookingId, roomType, checkin, checkout, customerEmail, customerPhone, basePrice, gst, totalPrice };
  bookings.push(booking);

  // ✅ Email to customer
  transporter.sendMail({
    from: "Hotel Maruthi <hotelmaruthivzm9@gmail.com>",
    to: customerEmail,
    subject: "Your Booking Confirmed - Hotel Maruthi",
    html: `
      <p>Dear Customer,<br>
      Your booking is <b>CONFIRMED</b> at <b>Hotel Maruthi</b>.<br><br>
      <b>Booking ID:</b> ${bookingId}<br>
      <b>Room Type:</b> ${roomType}<br>
      <b>Check-in:</b> ${checkin}<br>
      <b>Check-out:</b> ${checkout}<br>
      <b>Room Price:</b> ₹${basePrice}<br>
      <b>GST (5%):</b> ₹${gst}<br>
      <b>Total Amount:</b> <b>₹${totalPrice}</b><br>
      <b>Mobile:</b> ${customerPhone}<br><br>
      Thank you for choosing <b>Hotel Maruthi</b>!</p>`
  }, err => {
    if (err) console.error("❌ Mail error (customer):", err);
    else console.log("✅ Booking confirmation mail sent to customer!");
  });

  // ✅ Email to owner
  transporter.sendMail({
    from: "Booking Alert <no-reply@hotelmaruthi.com>",
    to: "hotelmaruthivzm9@gmail.com",
    subject: "New Booking - " + bookingId,
    html: `
      <b>New Booking Received</b><br>
      <b>Booking ID:</b> ${bookingId}<br>
      <b>Room Type:</b> ${roomType}<br>
      <b>Check-in:</b> ${checkin}<br>
      <b>Check-out:</b> ${checkout}<br>
      <b>Room Price:</b> ₹${basePrice}<br>
      <b>GST (5%):</b> ₹${gst}<br>
      <b>Total Amount:</b> ₹${totalPrice}<br>
      <b>Customer Email:</b> ${customerEmail}<br>
      <b>Customer Phone:</b> ${customerPhone}<br>`
  }, err => {
    if (err) console.error("❌ Mail error (owner):", err);
    else console.log("✅ Owner booking notification mail sent!");
  });

  res.json({ status: 'Booked', booking });
});


// ✅ Cancel booking + refund endpoint
app.delete('/api/cancel-booking', (req, res) => {
  const bookingId = req.query.id;
  if (!bookingId) return res.status(400).json({ error: 'Missing booking ID' });

  const idx = bookings.findIndex(b => b.bookingId === bookingId);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });
  const booking = bookings[idx];

  const checkinDate = new Date(booking.checkin);
  const now = new Date();
  const millisPerDay = 1000 * 60 * 60 * 24;
  const daysBefore = Math.ceil((checkinDate - now) / millisPerDay);

  let refundPercent = 0;
  if (daysBefore >= 3) refundPercent = 1.0;
  else if (daysBefore >= 1) refundPercent = 0.5;

  const roomPrices = { Deluxe: 1800, Executive: 2500 };
  const nights = (new Date(booking.checkout) - new Date(booking.checkin)) / millisPerDay;
  const basePrice = nights * (roomPrices[booking.roomType] || 0);
  const refundAmount = Math.round(basePrice * refundPercent);

  bookings.splice(idx, 1);

  // ✅ Email customer about cancellation
  transporter.sendMail({
    from: "Hotel Maruthi <hotelmaruthivzm9@gmail.com>",
    to: booking.customerEmail,
    subject: "Booking Cancelled - Hotel Maruthi",
    html: `<p>Dear Customer,<br>Your booking <b>${booking.bookingId}</b> has been <b>cancelled</b>.<br>
    Refund amount: <b>₹${refundAmount}</b><br>
    If paid online, it will be processed within 3–5 business days.<br>
    Thank you for choosing Hotel Maruthi!</p>`
  });

  // ✅ Email owner about cancellation
  transporter.sendMail({
    from: "Booking Alert <no-reply@hotelmaruthi.com>",
    to: "hotelmaruthivzm9@gmail.com",
    subject: "Booking Cancelled - " + booking.bookingId,
    html: `<b>Booking Cancelled</b><br>
    <b>Booking ID:</b> ${booking.bookingId}<br>
    <b>Refund:</b> ₹${refundAmount}<br>
    <b>Customer Email:</b> ${booking.customerEmail}<br>
    <b>Customer Phone:</b> ${booking.customerPhone}<br>`
  });

  res.json({ status: 'Cancelled', refundAmount });
});

// Root endpoint
app.get('/', (req, res) => res.send('Hotel Maruthi Room Booking API is running!'));

// ✅ Listen on Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));
