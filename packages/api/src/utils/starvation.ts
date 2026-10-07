import { z } from 'zod';
import { getUnitDefinition } from '@pillage-first/game-assets/utils/units';
import type { Troop } from '@pillage-first/types/models/troop';
import { unitIdSchema } from '@pillage-first/types/models/unit';
import type { DbFacade } from '@pillage-first/utils/facades/database';
import { calculateComputedEffect } from '@pillage-first/utils/game/calculate-computed-effect';
import { selectResourceSiteResourcesRelevantEffectsByTileIdQuery } from '../queries/effect-queries';
import { getActingPlayerId } from '../simulation/actor';
import { createEvents } from './create-event';
import { decreaseTroopWheatConsumption } from './troop-movement';
import { removeTroops } from './troops';
import { calculateResourceSiteResourcesAt } from './village';
import { apiEffectSchema } from './zod/effect-schemas';

// Starvation is checked once an hour. Each check kills troops worth one hour of the wheat deficit.
export const TROOP_STARVATION_CHECK_INTERVAL = 60 * 60 * 1000;

export const createTroopStarvationEvent = (
  database: DbFacade,
  startsAt: number,
) => {
  const hasPendingEvent = database.selectValue({
    sql: "SELECT EXISTS (SELECT 1 FROM events WHERE type = 'troopStarvation');",
    schema: z.coerce.boolean(),
  });

  if (hasPendingEvent) {
    return;
  }

  createEvents<'troopStarvation'>(database, {
    villageId: null,
    startsAt,
    type: 'troopStarvation',
  });
};

// Troops starve in this order: reinforcements from other villages, then the village's own troops.
// Within each group, units with the highest wheat upkeep starve first. The hero never starves.
export const selectStarvationOrder = <
  T extends { unitId: Troop['unitId']; sourceTileId: number },
>(
  troops: T[],
  villageTileId: number,
): T[] => {
  return troops
    .filter(({ unitId }) => unitId !== 'HERO')
    .sort((a, b) => {
      const aIsReinforcement = a.sourceTileId !== villageTileId ? 0 : 1;
      const bIsReinforcement = b.sourceTileId !== villageTileId ? 0 : 1;

      if (aIsReinforcement !== bIsReinforcement) {
        return aIsReinforcement - bIsReinforcement;
      }

      return (
        getUnitDefinition(b.unitId).unitWheatConsumption -
        getUnitDefinition(a.unitId).unitWheatConsumption
      );
    });
};

// Returns the troops that starve to cover `deficit` wheat
export const selectStarvingTroops = (
  troops: Troop[],
  villageTileId: number,
  deficit: number,
): Troop[] => {
  const starving: Troop[] = [];
  let remainingDeficit = deficit;

  for (const troop of selectStarvationOrder(troops, villageTileId)) {
    if (remainingDeficit <= 0) {
      break;
    }

    const { unitWheatConsumption } = getUnitDefinition(troop.unitId);

    if (unitWheatConsumption <= 0) {
      continue;
    }

    const amount = Math.min(
      troop.amount,
      Math.ceil(remainingDeficit / unitWheatConsumption),
    );

    starving.push({ ...troop, amount });
    remainingDeficit -= amount * unitWheatConsumption;
  }

  return starving;
};

// Kills troops in villages that are out of wheat and still losing it. Returns the affected village and tile ids.
export const starveTroopsAt = (database: DbFacade, timestamp: number) => {
  const villages = database.selectObjects({
    sql: 'SELECT id, tile_id AS tileId FROM villages WHERE player_id = $player_id OR (SELECT map_size FROM servers LIMIT 1) = 50;',
    bind: { $player_id: getActingPlayerId() },
    schema: z.strictObject({ id: z.number(), tileId: z.number() }),
  });

  const affectedVillageIds: number[] = [];
  const affectedTileIds: number[] = [];

  for (const { id, tileId } of villages) {
    const { currentWheat } = calculateResourceSiteResourcesAt(
      database,
      tileId,
      timestamp,
    );

    if (currentWheat > 0) {
      continue;
    }

    const effects = database.selectObjects({
      sql: selectResourceSiteResourcesRelevantEffectsByTileIdQuery,
      bind: { $tile_id: tileId },
      schema: apiEffectSchema,
    });

    const { total: wheatProduction } = calculateComputedEffect(
      'wheatProduction',
      effects,
      tileId,
    );

    if (wheatProduction >= 0) {
      continue;
    }

    const troops = database.selectObjects({
      sql: `
        SELECT
          ui.unit AS unitId,
          t.amount,
          t.tile_id AS tileId,
          t.source_tile_id AS sourceTileId
        FROM troops t JOIN unit_ids ui ON ui.id = t.unit_id
        WHERE t.tile_id = $tile_id;
      `,
      bind: { $tile_id: tileId },
      schema: z.strictObject({
        unitId: unitIdSchema,
        amount: z.number(),
        tileId: z.number(),
        sourceTileId: z.number(),
      }),
    });

    const starving = selectStarvingTroops(troops, tileId, -wheatProduction);

    if (starving.length === 0) {
      continue;
    }

    removeTroops(database, starving);
    decreaseTroopWheatConsumption(database, tileId, starving, timestamp);

    affectedVillageIds.push(id);
    affectedTileIds.push(tileId);
  }

  return { affectedVillageIds, affectedTileIds };
};
