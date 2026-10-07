import type { Plugin } from 'vite';
import { aiRequestSchema } from '@pillage-first/api/ai-decision';
// biome-ignore lint/style/noRestrictedImports: Node loads this server-only Vite plugin directly.
import { decideWithOpenRouter } from '../server/src/ai-provider.ts';

// Server-only middleware: credentials never enter the browser bundle.
export const aiDevPlugin = (): Plugin => ({
  name: 'pillage-first-ai-development',
  configureServer(server) {
    server.middlewares.use('/api/ai/decide', async (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (
        request.method !== 'POST' ||
        request.headers['x-pillage-first'] !== '1'
      ) {
        response.statusCode = 403;
        response.end('{}');
        return;
      }
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) {
        response.statusCode = 403;
        response.end('{}');
        return;
      }
      try {
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 32768) {
            throw new Error('Request too large');
          }
        }
        const decision = await decideWithOpenRouter(
          aiRequestSchema.parse(JSON.parse(body)),
        );
        response.end(JSON.stringify(decision));
      } catch {
        response.statusCode = 503;
        response.end(
          JSON.stringify({
            error: 'AI service unavailable; using local decisions',
          }),
        );
      }
    });
  },
});
