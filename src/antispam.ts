import crypto from 'crypto';
import type { RequestHandler } from 'express';

/**
 * Spam protection for the public forms (order + contact).
 *
 *  1. Honeypot   — both forms contain a hidden "website" field. People never
 *                  see it; bots that fill in every field give themselves away.
 *  2. Form token — the page fetches GET /api/form-token when it loads and sends
 *                  the token back with the form. A script that posts straight
 *                  to the API has no token, and a form submitted less than
 *                  MIN_FILL_MS after the page loaded was not typed by a person.
 *  3. Rate limit — a cap on submissions per IP address.
 *
 * The text checks at the bottom (links, phone numbers) are used by routes/api.ts.
 */

const MIN_FILL_MS = 3000;

// Tokens are signed so they cannot be made up. Without SESSION_SECRET a random
// key is used, which only means open pages need a new token after a restart
// (the pages fetch one automatically).
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function sign(issuedAt: string): string {
  return crypto.createHmac('sha256', SECRET).update(`form-token:${issuedAt}`).digest('base64url');
}

export function issueFormToken(): string {
  const issuedAt = Date.now().toString(36);
  return `${issuedAt}.${sign(issuedAt)}`;
}

/** Milliseconds since the token was issued, or null if it is missing or forged. */
function formTokenAge(token: unknown): number | null {
  if (typeof token !== 'string') return null;
  const [issuedAt, signature] = token.split('.');
  if (!issuedAt || !signature) return null;
  const given = Buffer.from(signature);
  const expected = Buffer.from(sign(issuedAt));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  return Date.now() - parseInt(issuedAt, 36);
}

export interface Blocked {
  code: 'bot' | 'token' | 'too_fast';
  error: string; // shown to the visitor
}

/** Honeypot + token check. Returns null when the submission may go ahead. */
export function checkForm(body: Record<string, unknown>): Blocked | null {
  if (text(body.website) !== '') {
    return { code: 'bot', error: 'Could not submit the form. Please refresh the page and try again' };
  }
  const age = formTokenAge(body.token);
  if (age === null) {
    return { code: 'token', error: 'Could not verify the form. Please refresh the page and try again' };
  }
  if (age < MIN_FILL_MS) {
    return { code: 'too_fast', error: 'That was very quick. Please wait a few seconds and try again' };
  }
  return null;
}

/** Allow at most `max` requests per IP address within `windowMs`. */
export function rateLimit(max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, number[]>();

  // Forget addresses that have gone quiet, so the map cannot grow forever.
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, times] of hits) {
      if (times[times.length - 1] < cutoff) hits.delete(ip);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(ip, recent);
      console.warn(`[antispam] rate limit reached on ${req.originalUrl} from ${ip}`);
      return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later' });
    }
    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}

// ============= TEXT CHECKS =============

/** A form value as trimmed text ('' for anything that is not text). */
export function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

/** Like text(), with line breaks and repeated spaces collapsed to one space. */
export function oneLine(value: unknown): string {
  return text(value).replace(/\s+/g, ' ');
}

const LINK = /https?:\/\/|www\./i;
// A map pin is a normal thing to paste into a delivery address.
const MAP_LINK =
  /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.|maps\.)?google\.com(?:\.pk)?\/maps|maps\.google\.com(?:\.pk)?|maps\.apple\.com)(?:[/?#]\S*)?(?=\s|$)/gi;

/** True if the text contains a web link. Spam exists to deliver links; real orders don't need them. */
export function hasLink(value: string, allowMapLinks = false): boolean {
  return LINK.test(allowMapLinks ? value.replace(MAP_LINK, '') : value);
}

/** Pakistani mobile or landline number, however it is written (0300 1234567, +92 300 1234567, 042-35755446). */
export function isPakistaniPhone(value: string): boolean {
  let digits = value.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+92')) digits = digits.slice(3);
  else if (digits.startsWith('0092')) digits = digits.slice(4);
  else if (digits.startsWith('92') && digits.length >= 12) digits = digits.slice(2);
  digits = digits.replace(/^0/, '');
  // What is left is the national number: mobile 3XXXXXXXXX, or area code + landline.
  return /^[1-9]\d{8,9}$/.test(digits);
}
