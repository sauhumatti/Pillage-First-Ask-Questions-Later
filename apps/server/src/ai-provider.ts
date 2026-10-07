import {
  type AiDecisionProvider,
  aiRequestSchema,
  aiResponseSchema,
} from '@pillage-first/api/ai-decision';

let windowStart = Date.now();
let requests = 0;
export const decideWithOpenRouter: AiDecisionProvider = async (input) => {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!key || !model) {
    throw new Error('OpenRouter is not configured');
  }
  const limit = Number(process.env.OPENROUTER_REQUESTS_PER_HOUR ?? 120);
  if (!Number.isFinite(limit) || limit < 0) {
    throw new Error('Invalid OpenRouter request budget');
  }
  if (Date.now() - windowStart >= 3600000) {
    requests = 0;
    windowStart = Date.now();
  }
  if (requests >= limit) {
    throw new Error('OpenRouter request budget reached');
  }
  const request = aiRequestSchema.parse(input);
  requests += 1;
  const response = await fetch(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 100,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You control one player in a Travian-style strategy game. Grow the economy, train and defend an army, expand, and raid when useful. The engine lists legal, affordable actions in approximate strategic order. Choose exactly one offered action id. Opponent troops and resources are unknown. Return only JSON: {"actionId":"offered-id"}. Do not invent ids.',
          },
          { role: 'user', content: JSON.stringify(request) },
        ],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`OpenRouter request failed (${response.status})`);
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const decision = aiResponseSchema.parse(
    JSON.parse(data.choices?.[0]?.message?.content ?? 'null'),
  );
  if (!request.actions.some((action) => action.id === decision.actionId)) {
    throw new Error('Model selected an unavailable action');
  }
  return decision;
};
