const nodemailer = require('nodemailer');

function createTransportFromEnv() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = process.env.SMTP_SECURE !== 'false';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    return null;
  }
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

/**
 * @param {{ to: string, resetUrl: string }} opts
 */
async function sendPasswordResetLinkEmail(opts) {
  const { to, resetUrl } = opts;
  const transporter = createTransportFromEnv();
  if (!transporter) {
    const err = new Error('SMTP_USER or SMTP_PASS is not configured');
    err.code = 'SMTP_CONFIG';
    throw err;
  }
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const fromName = process.env.SMTP_FROM_NAME || 'ChiTrac';
  const safeTo = String(to).trim();

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: safeTo,
    subject: 'ChiTrac — reset your password',
    text: `Reset your password using this link (valid for 15 minutes):\n\n${resetUrl}\n`,
    html: `<p>Reset your password using the link below (valid for 15 minutes):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
  });
}

module.exports = {
  sendPasswordResetLinkEmail,
  createTransportFromEnv
};
