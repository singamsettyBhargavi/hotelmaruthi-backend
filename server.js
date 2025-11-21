setInterval(() => {
  fetch("https://hotelmaruthi-backend.onrender.com").then(() => 
    console.log("🌐 Keeping Render awake")
  ).catch(() => {});
}, 5 * 60 * 1000);

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const BOOKINGS_FILE = './bookingsData.json';

// Read all bookings from file
function readBookings() {
  if (!fs.existsSync(BOOKINGS_FILE)) {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify([], null, 2));
  }
  return JSON.parse(fs.readFileSync(BOOKINGS_FILE));
}

// Write bookings to file
function writeBookings(data) {
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(data, null, 2));
}

// Replace your old in-memory array with this:
let bookings = readBookings();


// 💌 Brevo API email sender
async function sendBrevoEmail(to, subject, htmlContent) {
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": process.env.BREVO_SMTP_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: { name: "Hotel Maruthi", email: "hotelmaruthivzm9@gmail.com" },
        to: [{ email: to }],
        subject,
        htmlContent
      })
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!response.ok) {
      console.error("❌ Brevo API Error:", response.status, data);
      return { ok: false, status: response.status, body: data };
    }

    console.log("📧 Email Sent Successfully:", response.status, data);
    return { ok: true, status: response.status, body: data };
  } catch (error) {
    console.error("❌ Email Sending Failed:", error);
    return { ok: false, error: String(error) };
  }
}

const app = express();

const ROOM_FILE = './roomData.json';

function readRoomData() {
  if (!fs.existsSync(ROOM_FILE)) {
    fs.writeFileSync(ROOM_FILE, JSON.stringify({ Deluxe: 7, Executive: 7 }, null, 2));
  }
  return JSON.parse(fs.readFileSync(ROOM_FILE));
}

function writeRoomData(data) {
  fs.writeFileSync(ROOM_FILE, JSON.stringify(data, null, 2));
}

// const bookings = [];
const totalRooms = { Deluxe: 7, Executive: 7 };

function generateBookingId(roomType, checkin, idx) {
  return 'BK' + checkin.replace(/-/g, '') + '-' + roomType + '-' + idx;
}

function isDateOverlap(aStart, aEnd, bStart, bEnd) {
  return !(aEnd <= bStart || aStart >= bEnd);
}

app.use(cors({
  origin: [
    'https://hotelmaruthi.com',
    'http://hotelmaruthi.com',
    'https://www.hotelmaruthi.com',
    'http://www.hotelmaruthi.com'
  ],
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

// ✅ Book room - WITH paymentId support
app.post('/api/book-room', async (req, res) => {
  const { roomType, checkin, checkout, customerEmail, customerPhone, paymentId } = req.body;
  console.log("📥 Received booking:", req.body);

  if (!roomType || !checkin || !checkout || !customerEmail || !customerPhone)
    return res.status(400).json({ error: 'Missing details' });

  const overlapping = bookings.filter(b =>
    b.roomType === roomType && isDateOverlap(checkin, checkout, b.checkin, b.checkout)
  ).length;

  const availableRooms = readRoomData();
  if (overlapping >= availableRooms[roomType])
    return res.status(409).json({ error: 'Room not available' });

  //code change
const basePrices = { Deluxe: 1350, Executive: 1700 }; 
const includedAdults = 2;
const includedChildren = 2;
const extraBedCharge = 400;

const { adults, children, childrenAges } = req.body; // childrenAges must be sent from frontend as comma string ("10,14") or array

let childrenAgesArr = [];
if (childrenAges && typeof childrenAges === "string") {
  childrenAgesArr = childrenAges.split(",").map(a => parseInt(a.trim())).filter(a => !isNaN(a));
}
while (childrenAgesArr.length < children) {
  childrenAgesArr.push(13); // Default to 13 (charged) if missing
}

const chargedChildren = childrenAgesArr.filter(age => age >= 13).length;
const extraAdults = Math.max(0, adults - includedAdults);

const extraBeds = extraAdults + chargedChildren;
const subtotalRoom = basePrices[roomType];   // Only once, not per night!
const subtotalExtra = extraBeds * extraBedCharge; // Only once, not per night
const gst = Math.round(subtotalRoom * 0.05); // GST only on room
const total = subtotalRoom + subtotalExtra + gst;




const bookingId = generateBookingId(roomType, checkin, bookings.length + 1);
  
const booking = {
  bookingId,
  roomType,
  checkin,
  checkout,
  customerEmail,
  customerPhone,
  adults,
  children,
  total,
  paymentId: paymentId || null,
  status: "BOOKED"
};

  
  bookings.push(booking);

  availableRooms[roomType] -= 1;
  writeRoomData(availableRooms);

  try {
    await sendBrevoEmail(
      "hotelmaruthivzm9@gmail.com",
      "📢 New Booking Received!",
      `
        <h2>New Booking Alert 🚨</h2>
        <p><b>Booking ID:</b> ${bookingId}</p>
        <p><b>Room Type:</b> ${roomType}</p>
        <p><b>Guest Email:</b> ${customerEmail}</p>
        <p><b>Guest Phone:</b> ${customerPhone}</p>
        <p><b>Check-in:</b> ${checkin}</p>
        <p><b>Check-out:</b> ${checkout}</p>
        <p><b>Total:</b> ₹${total}</p>
      `
    );

    await sendBrevoEmail(
      customerEmail,
      "✅ Booking Confirmation - Hotel Maruthi",
      `
        <h2>Booking Confirmed 🎉</h2>
        <p>Dear Guest,</p>
        <p>Thank you for booking with <b>Hotel Maruthi</b>.</p>
        <p><b>Booking ID:</b> ${bookingId}</p>
        <p><b>Room Type:</b> ${roomType}</p>
        <p><b>Check-in:</b> ${checkin}</p>
        <p><b>Check-out:</b> ${checkout}</p>
        <p><b>Total Amount:</b> ₹${total}</p>
        <hr>
        <p>For any queries, please contact us at <b>hotelmaruthivzm9@gmail.com</b>.</p>
        <p>We look forward to your stay!</p>
        <p>— Hotel Maruthi Team 🏨</p>
      `
    );

  } catch (err) {
    console.error("❌ Email Sending Failed:", err);
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
// If cancelling before check-in date, refund 70% of total. On/after check-in, no refund.
const refundAmount = today < booking.checkin ? booking.total * 0.7 : 0;

  const data = readRoomData();
  data[booking.roomType] += 1;
  writeRoomData(data);

  // Process Razorpay refund if eligible
if (refundAmount > 0 && booking.paymentId) {
  try {
    const razorpayAuth = Buffer.from(
      `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
    ).toString('base64');

    const refundRes = await fetch(
      `https://api.razorpay.com/v1/payments/${booking.paymentId}/refund`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${razorpayAuth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ amount: Math.round(refundAmount * 100) }) // paise
      }
    );
    const refundData = await refundRes.json();
    if (refundRes.ok) {
      console.log("💰 Refund processed successfully:", refundData);
    } else {
      console.error("❌ Razorpay refund failed:", refundData);
    }
  } catch (err) {
    console.error("❌ Refund API error:", err);
  }
}


  try {
   await sendBrevoEmail(
  booking.customerEmail,
  "❌ Booking Cancelled & Refund Processed - Hotel Maruthi",
  `
    <div style="font-family:Arial,sans-serif;max-width:490px;color:#222;">
      <h2 style="color:#c0392b;">Booking Cancelled & Refund Initiated</h2>
      <p>Dear Guest,</p>
      <p>Your booking at <b>Hotel Maruthi</b> has been <span style="color:#de0b0b;">cancelled</span> and a refund is being processed.</p>
      <ul style="margin-bottom:0.7em;">
        <li><b>Booking ID:</b> ${booking.bookingId}</li>
        <li><b>Room Type:</b> ${booking.roomType}</li>
        <li><b>Check-in:</b> ${booking.checkin}</li>
        <li><b>Check-out:</b> ${booking.checkout}</li>
        <li><b>Refund Amount:</b> ₹${refundAmount} <br>
            <span style="color:#009688;">(You will receive the refund to your original payment method within 2-5 business days.)</span>
        </li>
      </ul>
     <div style="background:#f3f7ff;border-left:4px solid #007bff;padding:10px 16px;margin:18px 0 6px 0;font-size:0.98em;">
  <b>Our Cancellation Policy:</b><br>
  <ul>
    <li>Cancel <b>before check-in date</b>: <b>70% refund</b></li>
    <li>Cancel on check-in date or later: <b>No refund</b></li>
  </ul>
</div>

      <hr>
      <p style="color:#666;">If you have questions, reply to this email or contact us at <a href="mailto:hotelmaruthivzm9@gmail.com" style="color:#007bff;text-decoration:none;">hotelmaruthivzm9@gmail.com</a>.</p>
      <p style="color:#008a1a;">We hope to welcome you again soon!<br>— Hotel Maruthi Team 🏨</p>
    </div>
  `
);

 await sendBrevoEmail(
      "hotelmaruthivzm9@gmail.com",
      "🚨 Booking Cancelled by Customer",
      `
        <h2>Booking Cancelled</h2>
        <p><b>Booking ID:</b> ${booking.bookingId}</p>
        <p><b>Room Type:</b> ${booking.roomType}</p>
        <p><b>Customer:</b> ${booking.customerEmail} (${booking.customerPhone})</p>
      `
    );

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

const ADMIN_EMAIL = "hotelmaruthivzm9@gmail.com"; // Change as needed

function sendCheckoutNotifications() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const todayStr = today.toISOString().split('T')[0];
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Notify for checkouts today or tomorrow
  const upcomingCheckouts = bookings.filter(b =>
    b.checkout === todayStr || b.checkout === tomorrowStr
  );
  upcomingCheckouts.forEach(b => {
    sendBrevoEmail(
      ADMIN_EMAIL,
      `🔔 Checkout Reminder for ${b.roomType} (Booking ${b.bookingId})`,
      `<p>Checkout is happening ${b.checkout === todayStr ? "today" : "tomorrow"} for Booking:<br>
         <b>Room Type:</b> ${b.roomType}<br>
         <b>Guest:</b> ${b.customerEmail} (${b.customerPhone})<br>
         <b>Check-in:</b> ${b.checkin}<br>
         <b>Check-out:</b> ${b.checkout}</p>`
    );
   sendBrevoEmail(
  b.customerEmail,
  `🔔 Reminder: Check-out soon at Hotel Maruthi`,
  `<p>Dear Guest,<br>Your checkout is scheduled for ${b.checkout}. If you need assistance, let us know!<br>— Hotel Maruthi</p>`
)
});
}

// Run every day at 8 am (setInterval in dev, use cron in production)
setInterval(sendCheckoutNotifications, 24 * 60 * 60 * 1000); // daily

function pruneOldBookings() {
  const now = new Date();
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(now.getMonth() - 2);

  // Keep only bookings with check-in or checkout after twoMonthsAgo
  const filtered = bookings.filter(b =>
    new Date(b.checkin) >= twoMonthsAgo || new Date(b.checkout) >= twoMonthsAgo
  );
  if (filtered.length !== bookings.length) {
    bookings = filtered;
    writeBookings(bookings);
    console.log("🗑️ Old bookings pruned, only last 2 months kept.");
  }
}
setInterval(pruneOldBookings, 24 * 60 * 60 * 1000);
app.get('/api/admin/history', (req, res) => {
  res.json(bookings); // Send in-memory booking data
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server Live: ${PORT}`));
