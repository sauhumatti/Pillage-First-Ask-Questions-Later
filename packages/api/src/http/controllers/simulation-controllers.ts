import { z } from 'zod';
import {
  clockSchema,
  getGameClock,
  saveGameClock,
} from '../../simulation/game-clock';
import { createController } from '../controller';
export const getSimulation = createController('/simulation', {
  summary: 'Get game time and playback state',
  response: clockSchema,
})(({ database }) => ({ ...getGameClock(database) }));
export const updateSimulation = createController('/simulation', 'patch', {
  summary: 'Pause or change playback speed',
  requestBody: z
    .object({
      rate: z.union([
        z.literal(0),
        z.literal(1),
        z.literal(2),
        z.literal(5),
        z.literal(10),
      ]),
    })
    .strict(),
  response: clockSchema,
})(({ database, body }) => {
  const clock = getGameClock(database);
  if (!clock.enabled) {
    throw new Error('Playback controls require a new 50x50 world');
  }
  clock.rate = body.rate;
  saveGameClock(database);
  return { ...clock };
});
