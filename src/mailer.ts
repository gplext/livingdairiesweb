import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { queries } from './db';

/**
 * Email notifications for new orders.
 *
 * SMTP settings are read from the admin console (Settings > Notifications),
 * stored in the `settings` table. Any value not set there falls back to .env:
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM
 *
 * Recipients come from the `notification_emails` table (admin-managed list).
 * If the list has no active entries, falls back to ADMIN_EMAIL from .env.
 *
 * If no SMTP host or no recipients are configured, emailing is disabled and
 * the app runs normally — orders are still saved, nothing crashes.
 */

export interface OrderEmailData {
  orderId: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerEmail: string | null;
  productName: string;
  quantity: number;
  totalPrice: number;
  notes: string | null;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

const RETRIES = 3;
const RETRY_DELAY_MS = 5000;

/** DB setting first, .env second, default third. */
function cfg(key: string, envKey: string, fallback = ''): string {
  return queries.getSetting(key) ?? process.env[envKey] ?? fallback;
}

export function getSmtpConfig(): SmtpConfig {
  const user = cfg('smtp_user', 'SMTP_USER');
  return {
    host: cfg('smtp_host', 'SMTP_HOST'),
    port: parseInt(cfg('smtp_port', 'SMTP_PORT', '587')),
    secure: cfg('smtp_secure', 'SMTP_SECURE', 'false') === 'true',
    user,
    pass: cfg('smtp_pass', 'SMTP_PASS'),
    from: cfg('mail_from', 'MAIL_FROM') || user,
  };
}

/** Active admin-console recipients, or ADMIN_EMAIL from .env as fallback. */
export function getRecipients(): string[] {
  const list = queries.getActiveNotificationEmails().map((r) => r.email);
  if (list.length > 0) return list;
  return process.env.ADMIN_EMAIL ? [process.env.ADMIN_EMAIL] : [];
}

export function isMailEnabled(): boolean {
  return Boolean(getSmtpConfig().host && getRecipients().length > 0);
}

/** Fresh transporter per call so admin-panel changes apply instantly. */
function buildTransporter(c: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendWithRetry(mail: nodemailer.SendMailOptions): Promise<void> {
  const transporter = buildTransporter(getSmtpConfig());
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      await transporter.sendMail(mail);
      return;
    } catch (err) {
      lastErr = err;
      console.error(`[mailer] send attempt ${attempt}/${RETRIES} failed:`, (err as Error).message);
      if (attempt < RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

function orderSummaryHtml(o: OrderEmailData): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px;color:#555;">${label}</td><td style="padding:6px 12px;font-weight:600;">${value}</td></tr>`;
  return `
    <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;border:1px solid #ddd;">
      ${row('Order #', String(o.orderId))}
      ${row('Product', o.productName)}
      ${row('Quantity', String(o.quantity))}
      ${row('Total', `${o.totalPrice} PKR`)}
      ${row('Customer', o.customerName)}
      ${row('Phone', o.customerPhone)}
      ${row('Address', o.customerAddress)}
      ${o.customerEmail ? row('Email', o.customerEmail) : ''}
      ${o.notes ? row('Notes', o.notes) : ''}
    </table>`;
}

/** Alert all configured recipients that a new order arrived. Throws on final failure. */
export async function sendOrderNotification(o: OrderEmailData): Promise<void> {
  const recipients = getRecipients();
  if (recipients.length === 0) throw new Error('No notification recipients configured');
  const c = getSmtpConfig();
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  await sendWithRetry({
    from: c.from,
    to: c.from, // primary To: self; recipients are BCC so they can't see each other
    bcc: recipients,
    subject: `🥛 New Order #${o.orderId} — ${o.productName} ×${o.quantity} (${o.totalPrice} PKR)`,
    html: `
      <h2 style="font-family:Arial,sans-serif;">New order received</h2>
      ${orderSummaryHtml(o)}
      <p style="font-family:Arial,sans-serif;font-size:14px;margin-top:16px;">
        <a href="${baseUrl}/admin/orders" style="background:#1b4332;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px;">View in Admin Panel</a>
      </p>`,
  });
}

/** Optional confirmation to the customer (only if they gave an email). */
export async function sendCustomerConfirmation(o: OrderEmailData): Promise<void> {
  if (!o.customerEmail) return;
  const c = getSmtpConfig();
  await sendWithRetry({
    from: c.from,
    to: o.customerEmail,
    subject: `Your Living Dairies order #${o.orderId} is confirmed`,
    html: `
      <h2 style="font-family:Arial,sans-serif;">Thank you, ${o.customerName}!</h2>
      <p style="font-family:Arial,sans-serif;font-size:14px;">
        Your order has been received. We'll deliver it fresh to your doorstep.
      </p>
      ${orderSummaryHtml(o)}
      <p style="font-family:Arial,sans-serif;font-size:13px;color:#777;margin-top:16px;">
        Living Dairies · Lahore, Pakistan
      </p>`,
  });
}

export interface ContactMessageData {
  name: string;
  phone: string | null;
  email: string | null;
  subject: string | null;
  message: string;
}

/** Forward a contact-form message to all configured notification recipients. */
export async function sendContactMessage(m: ContactMessageData): Promise<void> {
  const recipients = getRecipients();
  if (recipients.length === 0) throw new Error('No notification recipients configured');
  const c = getSmtpConfig();
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px;color:#555;">${label}</td><td style="padding:6px 12px;font-weight:600;">${value}</td></tr>`;
  await sendWithRetry({
    from: c.from,
    to: c.from,
    bcc: recipients,
    replyTo: m.email || undefined,
    subject: `✉️ Contact form: ${m.subject || 'General Enquiry'} — ${m.name}`,
    html: `
      <h2 style="font-family:Arial,sans-serif;">New contact form message</h2>
      <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;border:1px solid #ddd;">
        ${row('Name', m.name)}
        ${m.phone ? row('Phone', m.phone) : ''}
        ${m.email ? row('Email', m.email) : ''}
        ${row('Subject', m.subject || 'General Enquiry')}
      </table>
      <p style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap;border-left:3px solid #1b4332;padding-left:12px;margin-top:16px;">${m.message}</p>`,
  });
}

/** Used by the admin panel's "Send test email" button. */
export async function sendTestEmail(): Promise<string[]> {
  const recipients = getRecipients();
  if (recipients.length === 0) throw new Error('No recipients configured');
  const c = getSmtpConfig();
  if (!c.host) throw new Error('SMTP host not configured');
  await sendWithRetry({
    from: c.from,
    to: c.from,
    bcc: recipients,
    subject: '✅ Living Dairies — test email',
    html: `<p style="font-family:Arial,sans-serif;">SMTP is working. Order notifications will be delivered to: <b>${recipients.join(', ')}</b></p>`,
  });
  return recipients;
}
