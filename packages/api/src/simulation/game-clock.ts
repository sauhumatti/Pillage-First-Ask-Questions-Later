import { z } from 'zod';
import type { DbFacade } from '@pillage-first/utils/facades/database';

export const clockSchema = z.object({
  enabled: z.boolean(),
  now: z.number(),
  rate: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(5),
    z.literal(10),
  ]),
  waitingForAi: z.boolean(),
});
export type GameClock = z.infer<typeof clockSchema>;
const clocks = new WeakMap<DbFacade, GameClock>();

export const getGameTime = (database: DbFacade): number =>
  clocks.get(database)?.now ?? Date.now();
export const getGameClock = (database: DbFacade): GameClock =>
  clocks.get(database) ?? {
    enabled: false,
    now: Date.now(),
    rate: 1,
    waitingForAi: false,
  };
export const initializeGameClock = (database: DbFacade): GameClock | null => {
  if (
    database.selectValue({
      sql: 'SELECT map_size FROM servers LIMIT 1;',
      schema: z.number(),
    }) !== 50
  ) {
    return null;
  }
  database.execMulti({
    sql: `CREATE TABLE IF NOT EXISTS simulation_clock (id INTEGER PRIMARY KEY CHECK(id = 1), game_time INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_turns (player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE, next_at INTEGER NOT NULL, turn INTEGER NOT NULL DEFAULT 0);`,
  });
  database.exec({
    sql: 'INSERT OR IGNORE INTO simulation_clock SELECT 1, created_at FROM servers LIMIT 1;',
  });
  database.exec({
    sql: 'INSERT OR IGNORE INTO ai_turns (player_id, next_at) SELECT id, (SELECT game_time FROM simulation_clock) + 300000 FROM players WHERE id != 1;',
  });
  const now = database.selectValue({
    sql: 'SELECT game_time FROM simulation_clock;',
    schema: z.number(),
  })!;
  const clock: GameClock = { enabled: true, now, rate: 0, waitingForAi: false };
  clocks.set(database, clock);
  return clock;
};
export const saveGameClock = (database: DbFacade): void => {
  const clock = clocks.get(database);
  if (clock) {
    database.exec({
      sql: 'UPDATE simulation_clock SET game_time = $now WHERE id = 1;',
      bind: { $now: Math.floor(clock.now) },
    });
  }
};
export const releaseGameClock = (database: DbFacade): void => {
  saveGameClock(database);
  clocks.delete(database);
};
