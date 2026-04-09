const nodemailer = require('nodemailer');

/** R&D test recipients only; replace with user collection when scheduling is productionized. */
const SCHEDULE_TEST_RECIPIENTS = [
  'hfaisal@chidry.com',
  'rivaniszyn@chidry.com',
];

/**
 * Sends "Scheduled Job Triggered" to hardcoded test addresses.
 * Uses the same SMTP env vars as machine-report email.
 */
async function sendScheduledJobTestEmail() {
  const recipients = SCHEDULE_TEST_RECIPIENTS;

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = process.env.SMTP_SECURE !== 'false';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    const err = new Error('SMTP_USER or SMTP_PASS is not set');
    err.code = 'SMTP_CONFIG';
    throw err;
  }

  const fromEmail = process.env.SMTP_FROM_EMAIL || user;
  const fromName = process.env.SMTP_FROM_NAME || 'ChiTrac';

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: recipients,
    subject: 'Scheduled Job Triggered',
    text: 'The scheduled test job has triggered.',
    html: '<p>The scheduled test job has triggered.</p>',
  });
}

module.exports = { sendScheduledJobTestEmail };
