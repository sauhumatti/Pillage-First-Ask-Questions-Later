import { z } from 'zod';
import type { DbFacade } from '@pillage-first/utils/facades/database';
import { resolveEvent } from '../http/events/resolve-event';
import type { AiDecisionProvider } from './ai-contract';
import {
  browserDecisionProvider,
  executeAiDecision,
  prepareAiDecision,
} from './ai-decisions';
import {
  initializeGameClock,
  releaseGameClock,
  saveGameClock,
} from './game-clock';

const eventSchema = z.object({ id: z.number(), at: z.number() });
const turnSchema = z.object({
  playerId: z.number(),
  at: z.number(),
  turn: z.number(),
});
export const AI_TURN_INTERVAL = 5 * 60 * 1000;

export const startSimulation = (
  database: DbFacade,
  decide: AiDecisionProvider = browserDecisionProvider,
): (() => void) | null => {
  const clock = initializeGameClock(database);
  if (!clock) {
    return null;
  }
  let stopped = false;
  let advancing = false;
  let lastWallTime = performance.now();
  let providerRetryAfter = 0;
  let lastRate = clock.rate;
  const advance = async () => {
    if (stopped || advancing) {
      return;
    }
    const wallTime = performance.now();
    const elapsed = Math.min(1000, wallTime - lastWallTime);
    lastWallTime = wallTime;
    if (clock.rate !== lastRate) {
      lastRate = clock.rate;
      return;
    }
    if (!clock.rate) {
      return;
    }
    advancing = true;
    const rate = clock.rate;
    const target = clock.now + elapsed * rate;
    try {
      for (
        let count = 0;
        count < 500 && !stopped && clock.rate === rate;
        count += 1
      ) {
        const event = database.selectObject({
          sql: 'SELECT id, resolves_at AS at FROM events ORDER BY resolves_at, id LIMIT 1;',
          schema: eventSchema,
        });
        const turn = database.selectObject({
          sql: 'SELECT player_id AS playerId, next_at AS at, turn FROM ai_turns ORDER BY next_at, player_id LIMIT 1;',
          schema: turnSchema,
        });
        const nextTime = Math.min(
          event?.at ?? Number.POSITIVE_INFINITY,
          turn?.at ?? Number.POSITIVE_INFINITY,
        );
        if (nextTime > target) {
          clock.now = target;
          break;
        }
        clock.now = Math.max(clock.now, nextTime);
        if (event && event.at <= (turn?.at ?? Number.POSITIVE_INFINITY)) {
          database.transaction((db) => resolveEvent(db, event.id));
        } else if (turn) {
          const { request, candidates } = prepareAiDecision(
            database,
            turn.playerId,
            turn.turn,
          );
          let actionId = candidates[0].id;
          if (
            request.villages.length &&
            performance.now() >= providerRetryAfter
          ) {
            clock.waitingForAi = true;
            try {
              actionId = (await decide(request)).actionId;
            } catch {
              providerRetryAfter = performance.now() + 60000;
            } finally {
              clock.waitingForAi = false;
            }
          }
          if (stopped || clock.rate !== rate) {
            break;
          }
          if (
            !executeAiDecision(database, turn.playerId, candidates, actionId)
          ) {
            executeAiDecision(
              database,
              turn.playerId,
              candidates,
              candidates[0].id,
            );
          }
          database.exec({
            sql: 'UPDATE ai_turns SET next_at = $next, turn = turn + 1 WHERE player_id = $player;',
            bind: { $next: turn.at + AI_TURN_INTERVAL, $player: turn.playerId },
          });
        }
      }
      if (!stopped) {
        saveGameClock(database);
      }
    } catch (error) {
      clock.rate = 0;
      console.error('Simulation paused after an error', error);
    } finally {
      // API latency does not become elapsed game time.
      lastWallTime = performance.now();
      advancing = false;
    }
  };
  const timer = setInterval(() => {
    void advance();
  }, 100);
  return () => {
    stopped = true;
    clearInterval(timer);
    releaseGameClock(database);
  };
};
