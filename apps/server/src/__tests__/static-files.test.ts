import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createStaticFileHandler } from '../static-files';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'pillage-first-static-'));
  const write = (path: string, contents: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), contents);
  };

  write('index.html', 'home');
  write('assets/app.js', 'console.log(1)');
  write('game/server-slug/village-slug/village/index.html', 'village page');
  write('__spa-fallback.html', 'spa');
  write('not-found/index.html', 'missing');
  write(
    '_redirects',
    [
      '/old /new 301',
      '/game/:splat/:splat/village /game/server-slug/village-slug/village/index.html 200',
      '/game/* /__spa-fallback.html 200',
      '/* /not-found/index.html 404!',
    ].join('\n'),
  );
  write('_headers', '/*.js\n  Cache-Control: immutable\n');

  const serveStatic = createStaticFileHandler(root);
  server = createServer((request, response) => {
    serveStatic(request, response, new URL(request.url!, 'http://x').pathname);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

const get = (path: string) =>
  fetch(`${baseUrl}${path}`, { redirect: 'manual' });

describe(createStaticFileHandler, () => {
  test('serves files and directory indexes', async () => {
    expect(await (await get('/')).text()).toBe('home');
    expect(await (await get('/assets/app.js')).text()).toBe('console.log(1)');
  });

  test('applies headers rules', async () => {
    expect((await get('/assets/app.js')).headers.get('cache-control')).toBe(
      'immutable',
    );
  });

  test('rewrites pre-rendered game pages', async () => {
    const response = await get('/game/s-abcd/v-1/village');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('village page');
  });

  test('falls back to the single page app for other game routes', async () => {
    expect(await (await get('/game/s-abcd/v-1/reports/12')).text()).toBe('spa');
  });

  test('redirects and 404 rules', async () => {
    const redirect = await get('/old');
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe('/new');

    const missing = await get('/nope');
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('missing');
  });

  test('never serves files outside the web app', async () => {
    const response = await get('/..%2F..%2Fetc%2Fpasswd');
    expect(response.status).toBe(404);
  });
});
