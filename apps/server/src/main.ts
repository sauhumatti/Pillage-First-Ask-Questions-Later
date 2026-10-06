// Pillage First! game server: runs game worlds on the server, so saves follow
// the player to any device, and serves the web app.
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { serializeError } from '@pillage-first/utils/errors';
import { createAuth } from './auth';
import { createStaticFileHandler } from './static-files';
import { WorldHost } from './world-host';
import { gameWorldSchema, isValidSlug, WorldRegistry } from './world-registry';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');
const STATIC_DIR = resolve(
  process.env.STATIC_DIR ??
    resolve(dirname(fileURLToPath(import.meta.url)), '../../web/build/client'),
);
const PASSWORD = process.env.GAME_PASSWORD ?? null;
const ALLOW_NO_PASSWORD = process.env.ALLOW_NO_PASSWORD === 'true';

const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_BODY_BYTES = 1024 * 1024 * 1024;
const SSE_HEARTBEAT_MS = 25_000;

if (!PASSWORD && !ALLOW_NO_PASSWORD) {
  console.error(
    'GAME_PASSWORD is not set. Set it to protect your game worlds, or set ALLOW_NO_PASSWORD=true to run without one.',
  );
  process.exit(1);
}

mkdirSync(DATA_DIR, { recursive: true });

const registry = new WorldRegistry(DATA_DIR);
const host = new WorldHost(registry.getDatabasePath);
const auth = createAuth({
  password: PASSWORD || null,
  dataDirectory: DATA_DIR,
});
const serveStatic = existsSync(STATIC_DIR)
  ? createStaticFileHandler(STATIC_DIR)
  : null;

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const sendJson = (response: ServerResponse, status: number, body?: unknown) => {
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');

  if (body === undefined) {
    response.end();
    return;
  }

  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};

const readBody = async (
  request: IncomingMessage,
  limit: number,
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += (chunk as Buffer).length;

    if (size > limit) {
      throw new HttpError(413, 'Request body is too large');
    }

    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks);
};

const readJson = async <T>(
  request: IncomingMessage,
  schema: z.ZodType<T>,
): Promise<T> => {
  const body = await readBody(request, MAX_JSON_BODY_BYTES);

  try {
    return schema.parse(JSON.parse(body.toString('utf8') || 'null'));
  } catch {
    throw new HttpError(400, 'Invalid request body');
  }
};

const getClientIp = (request: IncomingMessage) =>
  (request.headers['x-forwarded-for'] as string | undefined)
    ?.split(',')[0]
    ?.trim() ??
  request.socket.remoteAddress ??
  'unknown';

const isSecureRequest = (request: IncomingMessage) =>
  request.headers['x-forwarded-proto'] === 'https' ||
  'encrypted' in request.socket;

const requireWorld = (slug: string) => {
  if (!isValidSlug(slug) || !registry.get(slug)) {
    throw new HttpError(404, 'Game world not found');
  }
};

const streamEvents = async (
  request: IncomingMessage,
  response: ServerResponse,
  slug: string,
) => {
  const world = await host.open(slug);

  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write(': connected\n\n');

  const unsubscribe = world.subscribe((message) => {
    response.write(`data: ${JSON.stringify(message)}\n\n`);
  });
  const heartbeat = setInterval(() => {
    response.write(': heartbeat\n\n');
  }, SSE_HEARTBEAT_MS);

  request.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
};

const handleApi = async (
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[],
) => {
  const method = request.method ?? 'GET';
  const route = segments.join('/');

  if (route === 'session' && method === 'GET') {
    sendJson(
      response,
      auth.isAuthenticated(request.headers.cookie) ? 200 : 401,
      {
        isPasswordRequired: auth.isPasswordRequired,
      },
    );
    return;
  }

  if (route === 'login' && method === 'POST') {
    const ip = getClientIp(request);

    if (auth.isRateLimited(ip)) {
      throw new HttpError(429, 'Too many login attempts, try again later');
    }

    const { password } = await readJson(
      request,
      z.object({ password: z.string() }),
    );

    if (!auth.checkPassword(ip, password)) {
      throw new HttpError(401, 'Wrong password');
    }

    response.setHeader(
      'Set-Cookie',
      auth.createSessionCookie(isSecureRequest(request)),
    );
    sendJson(response, 204);
    return;
  }

  if (route === 'logout' && method === 'POST') {
    response.setHeader('Set-Cookie', auth.clearSessionCookie());
    sendJson(response, 204);
    return;
  }

  if (!auth.isAuthenticated(request.headers.cookie)) {
    throw new HttpError(401, 'Not logged in');
  }

  // Blocks cross-site form posts: browsers can't add custom headers to those
  if (method !== 'GET' && request.headers['x-pillage-first'] !== '1') {
    throw new HttpError(403, 'Missing request header');
  }

  const [resource, slug, action] = segments;

  if (resource !== 'worlds') {
    throw new HttpError(404, 'Not found');
  }

  if (slug === undefined) {
    if (method === 'GET') {
      sendJson(response, 200, registry.list());
      return;
    }

    if (method === 'POST') {
      const { server } = await readJson(
        request,
        z.object({ server: gameWorldSchema }),
      );

      if (!isValidSlug(server.slug) || registry.get(server.slug)) {
        throw new HttpError(409, 'A game world with this slug already exists');
      }

      await host.create(server);
      await registry.add(server);
      sendJson(response, 201, server);
      return;
    }
  }

  if (slug === 'import' && action === undefined && method === 'POST') {
    const databaseBuffer = await readBody(request, MAX_IMPORT_BODY_BYTES);
    const id = randomUUID();
    const newSlug = `s-${id.slice(0, 4)}`;
    const server = await host.import(
      new Uint8Array(databaseBuffer),
      id,
      newSlug,
    );
    await registry.add(server);
    sendJson(response, 201, server);
    return;
  }

  if (slug === undefined) {
    throw new HttpError(405, 'Method not allowed');
  }

  requireWorld(slug);

  if (action === undefined && method === 'DELETE') {
    await host.close(slug);
    await registry.remove(slug);
    sendJson(response, 204);
    return;
  }

  if (action === 'open' && method === 'POST') {
    await host.open(slug);

    // Opening a world upgrades its save to the current version of the game
    const world = registry.get(slug);

    if (world && world.version !== import.meta.env.VERSION) {
      await registry.add({ ...world, version: import.meta.env.VERSION });
    }

    sendJson(response, 204);
    return;
  }

  if (action === 'request' && method === 'POST') {
    const gameRequest = await readJson(
      request,
      z.object({ url: z.string(), method: z.string(), body: z.unknown() }),
    );
    const world = await host.open(slug);
    const data = await world.request(gameRequest);
    sendJson(response, 200, { data: data ?? null });
    return;
  }

  if (action === 'events' && method === 'GET') {
    await streamEvents(request, response, slug);
    return;
  }

  if (action === 'export' && method === 'GET') {
    await host.flush(slug);
    const databasePath = registry.getDatabasePath(slug);
    response.writeHead(200, {
      'Content-Type': 'application/x-sqlite3',
      'Content-Disposition': `attachment; filename="${slug}.sqlite3"`,
      'Content-Length': statSync(databasePath).size,
      'Cache-Control': 'no-store',
    });
    createReadStream(databasePath).pipe(response);
    return;
  }

  throw new HttpError(404, 'Not found');
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const segments = url.pathname.split('/').filter(Boolean);

  try {
    if (segments[0] === 'api') {
      await handleApi(request, response, segments.slice(1));
      return;
    }

    if (url.pathname === '/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (!serveStatic) {
      throw new HttpError(404, `Web app not found in ${STATIC_DIR}`);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      throw new HttpError(405, 'Method not allowed');
    }

    serveStatic(request, response, url.pathname);
  } catch (error) {
    if (response.headersSent) {
      response.end();
      return;
    }

    if (error instanceof HttpError) {
      sendJson(response, error.status, {
        error: { name: 'HttpError', message: error.message },
      });
      return;
    }

    // Game errors (e.g. not enough resources) are shown to the player as they are in the browser version
    sendJson(response, 500, { error: serializeError(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Pillage First! server listening on http://${HOST}:${PORT}`);
  console.log(`Saving game worlds to ${DATA_DIR}`);

  if (!serveStatic) {
    console.warn(
      `Web app build not found in ${STATIC_DIR}, only the API is served`,
    );
  }
});

const shutdown = async (signal: string) => {
  console.log(`${signal} received, saving game worlds...`);
  server.close();
  await host.closeAll();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
