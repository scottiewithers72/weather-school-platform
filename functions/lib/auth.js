// Password hashing (scrypt) + stateless session tokens (HMAC JWT).
// No external auth dependency — Node crypto only.
import crypto from 'node:crypto';

const SCRYPT_N = 16384, KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N }).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [, salt, hash] = stored.split('$');
  const test = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N }).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload, days = 30) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  const body = { ...payload, exp: Date.now() + days * 864e5 };
  const data = b64u(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  try {
    const secret = process.env.JWT_SECRET;
    const [data, sig] = token.split('.');
    const expect = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const body = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (body.exp < Date.now()) return null;
    return body;
  } catch { return null; }
}

// Pull the family session from a request (Authorization: Bearer <token>)
export function requireFamily(event) {
  const h = event.headers?.authorization || event.headers?.Authorization || '';
  const token = h.replace(/^Bearer\s+/i, '');
  const session = token ? verifyToken(token) : null;
  if (!session?.familyId) {
    const err = new Error('Not signed in');
    err.statusCode = 401;
    throw err;
  }
  return session; // { familyId, email }
}
