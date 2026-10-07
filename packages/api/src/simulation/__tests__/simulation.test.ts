import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { migrateAndSeed } from '@pillage-first/db';
import { serverMock } from '@pillage-first/mocks/server';
import {
  createDbFacade,
  type DbFacade,
} from '@pillage-first/utils/facades/database';
import { resolveEvent } from '../../http/events/resolve-event';
import { executeAiDecision, prepareAiDecision } from '../ai-decisions';
import {
  getGameClock,
  getGameTime,
  initializeGameClock,
  releaseGameClock,
} from '../game-clock';
import { startSimulation } from '../runtime';

let database: DbFacade;
let stop: (() => void) | null;
beforeEach(async () => {
  const sqlite = await sqlite3InitModule();
  database = createDbFacade(new sqlite.oo1.DB(':memory:', 'c'), false);
  migrateAndSeed(database, {
    ...serverMock,
    configuration: { ...serverMock.configuration, mapSize: 50 },
  });
  stop = null;
});
afterEach(() => {
  stop?.();
  releaseGameClock(database);
  database.close();
  vi.useRealTimers();
});
const count = (sql: string) =>
  database.selectValue({ sql, schema: z.number() });

test('new compact worlds have exactly 20 equal starting villages and heroes', () => {
  expect(count('SELECT COUNT(*) FROM players')).toBe(20);
  expect(count('SELECT COUNT(*) FROM villages')).toBe(20);
  expect(count('SELECT COUNT(*) FROM heroes')).toBe(20);
  expect(
    count(
      'SELECT COUNT(*) FROM resource_sites rs JOIN villages v ON v.tile_id = rs.tile_id WHERE rs.wood = 750 AND rs.clay = 750 AND rs.iron = 750 AND rs.wheat = 750',
    ),
  ).toBe(20);
  expect(count('SELECT COUNT(*) FROM building_fields WHERE level > 1')).toBe(0);
  expect(
    count(
      "SELECT COUNT(*) FROM troops t JOIN villages v ON v.tile_id = t.tile_id JOIN unit_ids ui ON ui.id = t.unit_id WHERE ui.unit = 'HERO' AND t.amount = 1",
    ),
  ).toBe(20);
});
test('clock restores paused and excludes wall time while closed', () => {
  const clock = initializeGameClock(database)!;
  clock.now += 90000;
  clock.rate = 10;
  const expected = clock.now;
  releaseGameClock(database);
  expect(initializeGameClock(database)).toMatchObject({
    rate: 0,
    now: expected,
  });
});
test('AI decisions expose affordable actions and execute at normal cost without changing human resources', () => {
  initializeGameClock(database);
  const before = database.selectValue({
    sql: 'SELECT wood FROM resource_sites WHERE tile_id = (SELECT tile_id FROM villages WHERE player_id = 1)',
    schema: z.number(),
  });
  const { request, candidates } = prepareAiDecision(database, 2, 0);
  expect(request.villages).toHaveLength(1);
  expect(candidates.length).toBeGreaterThan(1);
  expect(executeAiDecision(database, 2, candidates, 'invented')).toBe(false);
  expect(executeAiDecision(database, 2, candidates, candidates[0].id)).toBe(
    true,
  );
  expect(
    count(
      'SELECT COUNT(*) FROM events WHERE village_id = (SELECT id FROM villages WHERE player_id = 2)',
    ),
  ).toBeGreaterThan(0);
  expect(
    database.selectValue({
      sql: 'SELECT wood FROM resource_sites WHERE tile_id = (SELECT tile_id FROM villages WHERE player_id = 1)',
      schema: z.number(),
    }),
  ).toBe(before);
});
test('pause freezes game time, speed advances it, and provider failures fall back to legal AI actions', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  stop = startSimulation(database, async () => {
    throw new Error('Unavailable');
  });
  const clock = getGameClock(database);
  const initial = getGameTime(database);
  await vi.advanceTimersByTimeAsync(1000);
  expect(getGameTime(database)).toBe(initial);
  clock.rate = 10;
  await vi.advanceTimersByTimeAsync(1000);
  expect(getGameTime(database) - initial).toBeGreaterThanOrEqual(8000);
  database.exec({
    sql: 'UPDATE ai_turns SET next_at = $at',
    bind: { $at: clock.now + 1000 },
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(count('SELECT COUNT(*) FROM ai_turns WHERE turn > 0')).toBe(19);
  expect(count('SELECT COUNT(*) FROM events')).toBeGreaterThan(0);
  clock.rate = 0;
  const paused = clock.now;
  await vi.advanceTimersByTimeAsync(5000);
  expect(clock.now).toBe(paused);
});

test('normal play and fast-forward produce identical event ordering and AI outcomes', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  const chooseFirst = async (input: { actions: { id: string }[] }) => ({
    actionId: input.actions[0].id,
  });
  const capture = () => ({
    clock: getGameTime(database),
    fields: database.selectObjects({
      sql: 'SELECT village_id, field_id, building_id, level FROM building_fields ORDER BY village_id, field_id',
      schema: z.object({
        village_id: z.number(),
        field_id: z.number(),
        building_id: z.number(),
        level: z.number(),
      }),
    }),
    events: database.selectObjects({
      sql: 'SELECT type, starts_at, resolves_at, village_id FROM events ORDER BY resolves_at, id',
      schema: z.object({
        type: z.string(),
        starts_at: z.number(),
        resolves_at: z.number(),
        village_id: z.number().nullable(),
      }),
    }),
  });
  stop = startSimulation(database, chooseFirst);
  getGameClock(database).rate = 1;
  await vi.advanceTimersByTimeAsync(600100);
  const normal = capture();
  stop!();
  database.close();
  const sqlite = await sqlite3InitModule();
  database = createDbFacade(new sqlite.oo1.DB(':memory:', 'c'), false);
  migrateAndSeed(database, {
    ...serverMock,
    configuration: { ...serverMock.configuration, mapSize: 50 },
  });
  stop = startSimulation(database, chooseFirst);
  getGameClock(database).rate = 10;
  await vi.advanceTimersByTimeAsync(60100);
  expect(capture()).toEqual(normal);
}, 20000);

test('a model action is rejected if the village changed while the decision was pending', () => {
  initializeGameClock(database);
  const { candidates } = prepareAiDecision(database, 2, 0);
  const selected = candidates.find(
    (candidate) => candidate.event?.type === 'buildingLevelChange',
  )!;
  expect(selected).toBeDefined();
  const event = z
    .object({ villageId: z.number(), buildingFieldId: z.number() })
    .parse(selected.event);
  database.exec({
    sql: 'UPDATE building_fields SET level = level + 1 WHERE village_id = $village AND field_id = $field',
    bind: { $village: event.villageId, $field: event.buildingFieldId },
  });
  expect(executeAiDecision(database, 2, candidates, selected.id)).toBe(false);
  expect(count('SELECT COUNT(*) FROM events')).toBe(0);
});

test('AI raids use the normal troop movement and combat engine', () => {
  const clock = initializeGameClock(database)!;
  database.exec({
    sql: "UPDATE troops SET amount = 50 WHERE tile_id = (SELECT tile_id FROM villages WHERE player_id = 2) AND unit_id != (SELECT id FROM unit_ids WHERE unit = 'HERO')",
  });
  const { candidates } = prepareAiDecision(database, 2, 6);
  const raid = candidates.find(
    (candidate) => candidate.event?.type === 'troopMovementRaid',
  )!;
  expect(raid).toBeDefined();
  expect(executeAiDecision(database, 2, candidates, raid.id)).toBe(true);
  const event = database.selectObject({
    sql: "SELECT id, resolves_at AS at FROM events WHERE type = 'troopMovementRaid'",
    schema: z.object({ id: z.number(), at: z.number() }),
  })!;
  clock.now = event.at;
  expect(() =>
    database.transaction((db) => resolveEvent(db, event.id)),
  ).not.toThrow();
  expect(
    count("SELECT COUNT(*) FROM events WHERE type = 'troopMovementRaid'"),
  ).toBe(0);
  expect(count('SELECT COUNT(*) FROM reports')).toBeGreaterThan(0);
});
