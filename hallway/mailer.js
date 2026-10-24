// Sends the login code over any SMTP provider (Gmail app password, Brevo, Resend SMTP, SES...).
const nodemailer = require('nodemailer');
const PROD = process.env.NODE_ENV === 'production';
const { SMTP_HOST, SMTP_PORT = '587', SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

if (PROD && !SMTP_HOST) throw new Error('Set SMTP_HOST/SMTP_USER/SMTP_PASS in production.');
const transport = SMTP_HOST && nodemailer.createTransport({
  host: SMTP_HOST, port: +SMTP_PORT, secure: SMTP_PORT === '465', auth: { user: SMTP_USER, pass: SMTP_PASS },
});

async function sendOtp(to, code) {
  if (!transport) { console.log(`[dev] OTP for ${to}: ${code}`); return { dev: true }; }
  await transport.sendMail({
    from: MAIL_FROM || SMTP_USER, to,
    subject: `${code} is your Hallway code`,
    text: `Your Hallway code is ${code}. It expires in 10 minutes. If this wasn't you, ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px;border:2px solid #16162E;border-radius:20px;background:#EEF0FF;color:#16162E">
      <h2 style="margin:0 0 8px">Your Hallway code</h2>
      <div style="font-size:40px;font-weight:800;letter-spacing:8px;background:#FFD84D;border:2px solid #16162E;border-radius:14px;padding:12px;text-align:center">${code}</div>
      <p style="margin:12px 0 0">Expires in 10 minutes. Didn’t ask for this? Ignore this email.</p></div>`,
  });
  return { dev: false };
}
module.exports = { sendOtp };
