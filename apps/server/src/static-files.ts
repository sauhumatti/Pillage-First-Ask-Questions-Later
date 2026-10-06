import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { createGzip } from 'node:zlib';

// Serves the built web app, following the same _redirects and _headers rules Netlify uses

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.webmanifest',
  '.xml',
  '.txt',
  '.wasm',
]);

type RedirectRule = {
  pattern: string[];
  target: string;
  status: number;
};

type HeaderRule = {
  pattern: RegExp;
  headers: [string, string][];
};

const parseRedirects = (contents: string): RedirectRule[] => {
  const rules: RedirectRule[] = [];

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const [from, target, status = '200'] = trimmed.split(/\s+/);

    if (from && target) {
      rules.push({
        pattern: from.split('/').filter(Boolean),
        target,
        status: Number.parseInt(status, 10),
      });
    }
  }

  return rules;
};

const matchesRedirect = (pattern: string[], segments: string[]): boolean => {
  for (let i = 0; i < pattern.length; i++) {
    const part = pattern[i]!;

    if (part === '*') {
      return true;
    }

    const segment = segments[i];

    if (segment === undefined) {
      return false;
    }

    if (part !== ':splat' && part !== segment) {
      return false;
    }
  }

  return pattern.length === segments.length;
};

const parseHeaders = (contents: string): HeaderRule[] => {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | null = null;

  for (const line of contents.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      const escaped = line
        .trim()
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      current = { pattern: new RegExp(`^${escaped}$`), headers: [] };
      rules.push(current);
      continue;
    }

    const index = line.indexOf(':');

    if (current && index > 0) {
      current.headers.push([
        line.slice(0, index).trim(),
        line.slice(index + 1).trim(),
      ]);
    }
  }

  return rules;
};

export const createStaticFileHandler = (rootDirectory: string) => {
  const root = resolve(rootDirectory);
  const readOptional = (name: string) => {
    const path = join(root, name);
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  };

  const redirects = parseRedirects(readOptional('_redirects'));
  const headerRules = parseHeaders(readOptional('_headers'));

  const resolveFile = (pathname: string): string | null => {
    const path = normalize(join(root, pathname));

    if (path !== root && !path.startsWith(root + sep)) {
      return null;
    }

    if (!existsSync(path)) {
      return null;
    }

    const stats = statSync(path);

    if (stats.isFile()) {
      return path;
    }

    const index = join(path, 'index.html');
    return stats.isDirectory() && existsSync(index) ? index : null;
  };

  const sendFile = (
    request: IncomingMessage,
    response: ServerResponse,
    filePath: string,
    urlPath: string,
    status = 200,
  ) => {
    const extension = extname(filePath);

    response.statusCode = status;
    response.setHeader(
      'Content-Type',
      CONTENT_TYPES[extension] ?? 'application/octet-stream',
    );

    for (const rule of headerRules) {
      if (rule.pattern.test(urlPath)) {
        for (const [name, value] of rule.headers) {
          response.setHeader(name, value);
        }
      }
    }

    if (extension === '.html') {
      response.setHeader('Cache-Control', 'no-cache');
    }

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    const acceptsGzip = /\bgzip\b/.test(
      request.headers['accept-encoding'] ?? '',
    );

    if (acceptsGzip && COMPRESSIBLE.has(extension)) {
      response.setHeader('Content-Encoding', 'gzip');
      response.setHeader('Vary', 'Accept-Encoding');
      createReadStream(filePath).pipe(createGzip()).pipe(response);
      return;
    }

    response.setHeader('Content-Length', statSync(filePath).size);
    createReadStream(filePath).pipe(response);
  };

  return (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ) => {
    let decodedPath: string;

    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      response.statusCode = 400;
      response.end();
      return;
    }

    const file = resolveFile(decodedPath);

    if (file) {
      sendFile(request, response, file, decodedPath);
      return;
    }

    const segments = decodedPath.split('/').filter(Boolean);

    for (const { pattern, target, status } of redirects) {
      if (!matchesRedirect(pattern, segments)) {
        continue;
      }

      if (status === 301 || status === 302) {
        response.statusCode = status;
        response.setHeader('Location', target);
        response.end();
        return;
      }

      const targetFile = resolveFile(target);

      if (targetFile) {
        sendFile(request, response, targetFile, decodedPath, status);
        return;
      }
    }

    response.statusCode = 404;
    response.end('Not found');
  };
};
