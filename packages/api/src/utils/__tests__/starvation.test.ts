import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { prepareTestDatabase } from '@pillage-first/db';
import { createTroopStarvationEventMock } from '@pillage-first/mocks/event';
import type { DbFacade } from '@pillage-first/utils/facades/database';
import { troopStarvationResolver } from '../../http/events/resolvers/starvation-resolvers';
import { selectStarvingTroops } from '../starvation';

const VILLAGE_TILE_ID = 100;

describe(selectStarvingTroops, () => {
  test('reinforcements starve before the village own troops', () => {
    expect(
      selectStarvingTroops(
        [
          {
            unitId: 'LEGIONNAIRE',
            amount: 10,
            tileId: VILLAGE_TILE_ID,
            sourceTileId: VILLAGE_TILE_ID,
          },
          {
            unitId: 'PHALANX',
            amount: 10,
            tileId: VILLAGE_TILE_ID,
            sourceTileId: 5,
          },
        ],
        VILLAGE_TILE_ID,
        3,
      ),
    ).toStrictEqual([
      {
        unitId: 'PHALANX',
        amount: 3,
        tileId: VILLAGE_TILE_ID,
        sourceTileId: 5,
      },
    ]);
  });

  test('units with the highest upkeep starve first and enough die to cover the deficit', () => {
    expect(
      selectStarvingTroops(
        [
          {
            unitId: 'LEGIONNAIRE',
            amount: 10,
            tileId: VILLAGE_TILE_ID,
            sourceTileId: VILLAGE_TILE_ID,
          },
          {
            unitId: 'EQUITES_CAESARIS',
            amount: 2,
            tileId: VILLAGE_TILE_ID,
            sourceTileId: VILLAGE_TILE_ID,
          },
        ],
        VILLAGE_TILE_ID,
        10,
      ),
    ).toStrictEqual([
      // 2 · 4 = 8 wheat, then 2 legionnaires for the remaining 2
      {
        unitId: 'EQUITES_CAESARIS',
        amount: 2,
        tileId: VILLAGE_TILE_ID,
        sourceTileId: VILLAGE_TILE_ID,
      },
      {
        unitId: 'LEGIONNAIRE',
        amount: 2,
        tileId: VILLAGE_TILE_ID,
        sourceTileId: VILLAGE_TILE_ID,
      },
    ]);
  });

  test('the hero never starves', () => {
    expect(
      selectStarvingTroops(
        [
          {
            unitId: 'HERO',
            amount: 1,
            tileId: VILLAGE_TILE_ID,
            sourceTileId: VILLAGE_TILE_ID,
          },
        ],
        VILLAGE_TILE_ID,
        100,
      ),
    ).toStrictEqual([]);
  });
});

describe(troopStarvationResolver, () => {
  const setUpVillage = (
    database: DbFacade,
    { wheat, legionnaires }: { wheat: number; legionnaires: number },
    timestamp: number,
  ) => {
    const tileId = database.selectValue({
      sql: 'SELECT tile_id FROM villages WHERE id = 1;',
      schema: z.number(),
    })!;

    database.exec({
      sql: "DELETE FROM troops WHERE tile_id = $tile_id AND unit_id != (SELECT id FROM unit_ids WHERE unit = 'HERO');",
      bind: { $tile_id: tileId },
    });

    database.exec({
      sql: `
        INSERT INTO troops (unit_id, amount, tile_id, source_tile_id)
        SELECT id, $amount, $tile_id, $tile_id FROM unit_ids WHERE unit = 'LEGIONNAIRE';
      `,
      bind: { $tile_id: tileId, $amount: legionnaires },
    });

    // Upkeep far beyond what the village produces
    database.exec({
      sql: `
        UPDATE effects
        SET value = $amount
        WHERE
          tile_id = $tile_id
          AND source_id = (SELECT id FROM effect_source_ids WHERE source = 'troops')
          AND effect_id = (SELECT id FROM effect_ids WHERE effect = 'wheatProduction');
      `,
      bind: { $tile_id: tileId, $amount: legionnaires },
    });

    database.exec({
      sql: 'UPDATE resource_sites SET wheat = $wheat, updated_at = $timestamp WHERE tile_id = $tile_id;',
      bind: { $tile_id: tileId, $wheat: wheat, $timestamp: timestamp },
    });

    return tileId;
  };

  const selectLegionnaires = (database: DbFacade, tileId: number) =>
    database.selectValue({
      sql: `
        SELECT COALESCE(SUM(t.amount), 0)
        FROM troops t JOIN unit_ids ui ON ui.id = t.unit_id
        WHERE t.tile_id = $tile_id AND ui.unit = 'LEGIONNAIRE';
      `,
      bind: { $tile_id: tileId },
      schema: z.number(),
    })!;

  test('troops starve when the village is out of wheat and losing it', async () => {
    const database = await prepareTestDatabase();
    const tileId = setUpVillage(
      database,
      { wheat: 0, legionnaires: 5000 },
      10_000,
    );

    troopStarvationResolver(
      database,
      createTroopStarvationEventMock({ resolvesAt: 10_000 }),
    );

    const remaining = selectLegionnaires(database, tileId);

    expect(remaining).toBeLessThan(5000);
    expect(remaining).toBeGreaterThan(0);
  });

  test('troops survive while there is wheat in the granary', async () => {
    const database = await prepareTestDatabase();
    const tileId = setUpVillage(
      database,
      { wheat: 5000, legionnaires: 5000 },
      10_000,
    );

    troopStarvationResolver(
      database,
      createTroopStarvationEventMock({ resolvesAt: 10_000 }),
    );

    expect(selectLegionnaires(database, tileId)).toBe(5000);
  });

  test('schedules the next check', async () => {
    const database = await prepareTestDatabase();

    troopStarvationResolver(
      database,
      createTroopStarvationEventMock({ resolvesAt: 10_000 }),
    );

    expect(
      database.selectValue({
        sql: "SELECT COUNT(*) FROM events WHERE type = 'troopStarvation';",
        schema: z.number(),
      }),
    ).toBe(1);
  });
});
