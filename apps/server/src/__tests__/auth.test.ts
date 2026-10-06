import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createAuth } from '../auth';

const createDataDirectory = () =>
  mkdtempSync(join(tmpdir(), 'pillage-first-auth-'));

const cookieHeader = (setCookie: string) => setCookie.split(';')[0]!;

describe(createAuth, () => {
  test('a session cookie from login is accepted', () => {
    const auth = createAuth({
      password: 'secret',
      dataDirectory: createDataDirectory(),
    });

    expect(auth.checkPassword('1.1.1.1', 'secret')).toBe(true);
    expect(
      auth.isAuthenticated(cookieHeader(auth.createSessionCookie(false))),
    ).toBe(true);
  });

  test('missing and tampered cookies are rejected', () => {
    const auth = createAuth({
      password: 'secret',
      dataDirectory: createDataDirectory(),
    });
    const cookie = cookieHeader(auth.createSessionCookie(false));

    expect(auth.isAuthenticated(undefined)).toBe(false);
    expect(auth.isAuthenticated(`${cookie}x`)).toBe(false);
    expect(auth.isAuthenticated('pf_session=abc.def')).toBe(false);
  });

  test('changing the password signs everyone out', () => {
    const dataDirectory = createDataDirectory();
    const cookie = cookieHeader(
      createAuth({ password: 'old', dataDirectory }).createSessionCookie(false),
    );

    expect(
      createAuth({ password: 'old', dataDirectory }).isAuthenticated(cookie),
    ).toBe(true);
    expect(
      createAuth({ password: 'new', dataDirectory }).isAuthenticated(cookie),
    ).toBe(false);
  });

  test('wrong passwords are rate limited per address', () => {
    const auth = createAuth({
      password: 'secret',
      dataDirectory: createDataDirectory(),
    });

    for (let i = 0; i < 10; i++) {
      expect(auth.checkPassword('2.2.2.2', 'wrong')).toBe(false);
    }

    expect(auth.isRateLimited('2.2.2.2')).toBe(true);
    expect(auth.isRateLimited('3.3.3.3')).toBe(false);
  });

  test('cookies are marked secure behind https', () => {
    const auth = createAuth({
      password: 'secret',
      dataDirectory: createDataDirectory(),
    });

    expect(auth.createSessionCookie(true)).toContain('Secure');
    expect(auth.createSessionCookie(false)).not.toContain('Secure');
  });
});
