import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { decideWithOpenRouter } from '../ai-provider';

const input = {
  playerId: 2,
  turn: 0,
  gameTime: 100,
  villages: [],
  actions: [{ id: 'wait', description: 'Wait' }],
};
beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubEnv('OPENROUTER_MODEL', 'test/model');
  vi.stubEnv('OPENROUTER_REQUESTS_PER_HOUR', '120');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
test('requires server credentials and a configured model', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', '');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(decideWithOpenRouter(input)).rejects.toThrow('not configured');
  expect(fetch).not.toHaveBeenCalled();
});
test('requests a structured decision and accepts only an offered action', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"actionId":"wait"}' } }],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(decideWithOpenRouter(input)).resolves.toEqual({
    actionId: 'wait',
  });
  const [url, request] = fetch.mock.calls[0];
  expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(JSON.parse(request.body)).toMatchObject({
    model: 'test/model',
    max_tokens: 100,
  });
});
test('rejects invented actions rather than passing them to the engine', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"actionId":"spawn-army"}' } }],
        }),
        { status: 200 },
      ),
    ),
  );
  await expect(decideWithOpenRouter(input)).rejects.toThrow(
    'unavailable action',
  );
});
test('handles rate limits as provider failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{}', { status: 429 })),
  );
  await expect(decideWithOpenRouter(input)).rejects.toThrow('429');
});
test('a zero request budget prevents spending', async () => {
  vi.stubEnv('OPENROUTER_REQUESTS_PER_HOUR', '0');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(decideWithOpenRouter(input)).rejects.toThrow('budget reached');
  expect(fetch).not.toHaveBeenCalled();
});
