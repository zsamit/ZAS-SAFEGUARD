/**
 * ZAS Safeguard — Contact Form + Blog Subscription Cloud Functions
 * 
 * DROP INTO: firebase-backend/functions/
 * Then add to firebase-backend/functions/index.js:
 *   const contactAndBlog = require('./contactAndBlog');
 *   exports.submitContactForm = contactAndBlog.submitContactForm;
 *   exports.subscribeBlog = contactAndBlog.subscribeBlog;
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// admin.initializeApp() is called in index.js — do not call here
const db = () => admin.firestore();

// ─── CORS helper ────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://zassafeguard.com',
  'https://zas-safeguard.web.app',
  'https://zas-safeguard.firebaseapp.com',
  'http://localhost:5173',  // local dev
  'http://localhost:3000',
];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '3600');
}

// ─── Rate limiting helper ────────────────────────────────────────────────────
async function checkRateLimit(key, maxPerHour) {
  const ref = db().doc(`rate_limits/${key}`);
  const snap = await ref.get();
  const now = Date.now();
  if (snap.exists) {
    const { count, windowStart } = snap.data();
    const elapsed = now - (windowStart || 0);
    if (elapsed < 3600000 && count >= maxPerHour) {
      return false; // rate limited
    }
    if (elapsed >= 3600000) {
      await ref.set({ count: 1, windowStart: now });
    } else {
      await ref.update({ count: admin.firestore.FieldValue.increment(1) });
    }
  } else {
    await ref.set({ count: 1, windowStart: now });
  }
  return true; // allowed
}

// ─── submitContactForm ───────────────────────────────────────────────────────
exports.submitContactForm = functions.https.onRequest(async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, subject, message, timestamp } = req.body;

  // Validate
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (message.length > 5000) {
    return res.status(400).json({ error: 'Message too long' });
  }

  // Rate limit: 3 submissions per hour per IP
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  const ipKey = `contact_${ip.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const allowed = await checkRateLimit(ipKey, 3);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
  }

  try {
    // Write to Firestore
    await db().collection('contact_submissions').add({
      name: name.trim().slice(0, 100),
      email: email.trim().toLowerCase(),
      subject,
      message: message.trim().slice(0, 5000),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      clientTimestamp: timestamp || null,
      ip,
      status: 'unread',
    });

    // Trigger email via firestore-send-email extension
    // (The extension watches the 'mail' collection and sends emails)
    await db().collection('mail').add({
      to: 'info@zasgloballlc.com',
      message: {
        subject: `New contact form submission: ${subject}`,
        text: `Name: ${name}\nEmail: ${email}\nSubject: ${subject}\n\nMessage:\n${message}`,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
          <p><strong>Subject:</strong> ${subject}</p>
          <hr>
          <p><strong>Message:</strong></p>
          <p style="white-space:pre-wrap">${message}</p>
        `,
      },
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[submitContactForm] Error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── subscribeBlog ───────────────────────────────────────────────────────────
exports.subscribeBlog = functions.https.onRequest(async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email address required' });
  }

  // Rate limit: 5 per hour per IP
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  const ipKey = `blog_sub_${ip.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const allowed = await checkRateLimit(ipKey, 5);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many requests.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // Check if already subscribed
    const existing = await db()
      .collection('blog_subscribers')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (!existing.empty) {
      // Already subscribed — return success silently (don't reveal subscription status)
      return res.status(200).json({ success: true });
    }

    await db().collection('blog_subscribers').add({
      email: normalizedEmail,
      subscribedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'blog_page',
      active: true,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[subscribeBlog] Error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
