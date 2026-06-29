const nodemailer = require('nodemailer');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function sendPasswordResetEmail({ to, username, resetUrl, expiresInMinutes }) {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = process.env.SMTP_SECURE !== 'false';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    const error = new Error('SMTP_USER or SMTP_PASS is not set');
    error.code = 'SMTP_CONFIG';
    throw error;
  }

  const fromEmail = process.env.SMTP_FROM_EMAIL || user;
  const fromName = process.env.SMTP_FROM_NAME || 'ChiTrac';
  const safeUsername = escapeHtml(username);
  const safeResetUrl = escapeHtml(resetUrl);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: 'Reset your ChiTrac password',
    text: [
      `Hello ${username},`,
      '',
      'A ChiTrac administrator requested a password reset for your account.',
      `Set a new password within ${expiresInMinutes} minutes:`,
      resetUrl,
      '',
      'If you were not expecting this email, contact your ChiTrac administrator.'
    ].join('\n'),
    html: [
      `<p>Hello ${safeUsername},</p>`,
      '<p>A ChiTrac administrator requested a password reset for your account.</p>',
      `<p><a href="${safeResetUrl}">Set a new password</a></p>`,
      `<p>This link expires in ${expiresInMinutes} minutes and can only be used once.</p>`,
      '<p>If you were not expecting this email, contact your ChiTrac administrator.</p>'
    ].join('')
  });
}

module.exports = { sendPasswordResetEmail };
