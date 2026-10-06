import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SESSION_COOKIE = 'pf_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

const loadOrCreateSecret = (dataDirectory: string): string => {
  const secretPath = join(dataDirectory, 'session-secret');

  if (existsSync(secretPath)) {
    return readFileSync(secretPath, 'utf8').trim();
  }

  const secret = randomBytes(32).toString('hex');
  writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
};

const safeEqual = (a: string, b: string): boolean => {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
};

const parseCookies = (header: string | undefined): Map<string, string> => {
  const cookies = new Map<string, string>();

  for (const part of header?.split(';') ?? []) {
    const index = part.indexOf('=');

    if (index > 0) {
      cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
    }
  }

  return cookies;
};

export type Auth = ReturnType<typeof createAuth>;

// Single password auth. Sessions are signed cookies, so they survive restarts,
// and changing the password signs everyone out.
export const createAuth = ({
  password,
  dataDirectory,
}: {
  password: string | null;
  dataDirectory: string;
}) => {
  const secret = loadOrCreateSecret(dataDirectory);
  const signingKey = createHmac('sha256', secret)
    .update(password ?? '')
    .digest();
  const loginAttempts = new Map<string, number[]>();

  const sign = (payload: string) =>
    createHmac('sha256', signingKey).update(payload).digest('base64url');

  const createSessionCookie = (isSecure: boolean): string => {
    const payload = Buffer.from(
      JSON.stringify({ issuedAt: Date.now() }),
    ).toString('base64url');

    return [
      `${SESSION_COOKIE}=${payload}.${sign(payload)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
      ...(isSecure ? ['Secure'] : []),
    ].join('; ');
  };

  const clearSessionCookie = () =>
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

  const isAuthenticated = (cookieHeader: string | undefined): boolean => {
    if (password === null) {
      return true;
    }

    const token = parseCookies(cookieHeader).get(SESSION_COOKIE);

    if (!token) {
      return false;
    }

    const [payload, signature] = token.split('.');

    if (!payload || !signature || !safeEqual(signature, sign(payload))) {
      return false;
    }

    try {
      const { issuedAt } = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as { issuedAt: number };

      return Date.now() - issuedAt < SESSION_MAX_AGE_SECONDS * 1000;
    } catch {
      return false;
    }
  };

  const isRateLimited = (ip: string): boolean => {
    const now = Date.now();
    const attempts = (loginAttempts.get(ip) ?? []).filter(
      (time) => now - time < LOGIN_ATTEMPT_WINDOW_MS,
    );
    loginAttempts.set(ip, attempts);
    return attempts.length >= MAX_LOGIN_ATTEMPTS;
  };

  const checkPassword = (ip: string, attempt: string): boolean => {
    if (password === null) {
      return true;
    }

    const isCorrect = safeEqual(attempt, password);

    if (!isCorrect) {
      loginAttempts.set(ip, [...(loginAttempts.get(ip) ?? []), Date.now()]);
    }

    return isCorrect;
  };

  return {
    isPasswordRequired: password !== null,
    isAuthenticated,
    isRateLimited,
    checkPassword,
    createSessionCookie,
    clearSessionCookie,
  };
};
