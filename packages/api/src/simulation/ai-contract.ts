import { z } from 'zod';
export const aiRequestSchema = z
  .object({
    playerId: z.number().int().min(2),
    turn: z.number().int().nonnegative(),
    gameTime: z.number(),
    villages: z
      .array(
        z.object({
          id: z.number(),
          resources: z.object({
            wood: z.number(),
            clay: z.number(),
            iron: z.number(),
            wheat: z.number(),
          }),
          population: z.number(),
        }),
      )
      .max(100),
    actions: z
      .array(
        z.object({ id: z.string().max(100), description: z.string().max(500) }),
      )
      .min(1)
      .max(64),
  })
  .strict();
export const aiResponseSchema = z
  .object({ actionId: z.string().max(100) })
  .strict();
export type AiRequest = z.infer<typeof aiRequestSchema>;
export type AiDecisionProvider = (
  request: AiRequest,
) => Promise<z.infer<typeof aiResponseSchema>>;
