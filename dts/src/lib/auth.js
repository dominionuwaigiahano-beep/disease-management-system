import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';

const COOKIE = 'dts_session';
const MAX_AGE = 60 * 60 * 8; // eight hours, one working day

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET must be set and at least 32 characters.');
  }
  return new TextEncoder().encode(s);
}

/**
 * A cookie marked Secure is discarded by the browser over plain HTTP.
 * On Vercel every request arrives over HTTPS, but a colleague running
 * `npm start` on their own machine reaches the app over http://localhost
 * and would never be able to sign in. So the flag follows the actual
 * protocol rather than an assumption drawn from NODE_ENV.
 */
function isHttps() {
  const h = headers();
  const proto = h.get('x-forwarded-proto') ?? '';
  if (proto) return proto.split(',')[0].trim() === 'https';
  const host = h.get('host') ?? '';
  return !(host.startsWith('localhost') || host.startsWith('127.0.0.1'));
}

export const hashPassword = (plain) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export async function issueSession(user) {
  const token = await new SignJWT({
    sub: String(user.id), name: user.full_name, role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  cookies().set(COOKIE, token, {
    httpOnly: true,                 // not readable by page scripts
    sameSite: 'lax',
    secure: isHttps(),
    path: '/',
    maxAge: MAX_AGE,
  });
}

export function clearSession() {
  cookies().set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export async function currentUser() {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { id: Number(payload.sub), name: payload.name, role: payload.role };
  } catch {
    return null;
  }
}

const RANK = { viewer: 1, records_officer: 2, administrator: 3 };

/** Throws a Response the route handlers turn into 401/403. */
export async function requireUser(minRole = 'viewer') {
  const user = await currentUser();
  if (!user) throw new AuthError('Sign in to continue.', 401);
  if (RANK[user.role] < RANK[minRole]) {
    throw new AuthError('Your role does not permit this action.', 403);
  }
  return user;
}

export class AuthError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
