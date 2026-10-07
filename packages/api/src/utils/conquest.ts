import { z } from 'zod';
import type { DbFacade } from '@pillage-first/utils/facades/database';
import {
  insertEffectQuery,
  selectWheatProductionEffectIdQuery,
} from '../queries/effect-queries';
import { insertGatherersHutExpeditionByVillageIdQuery } from '../queries/troop-movement-queries';
import { getActingPlayerId } from '../simulation/actor';
import {
  getPlayerCulturePointsRequirementContext,
  getVillageExpansionSlots,
  updatePlayerCulturePointsAt,
} from './culture-points';
import { getVillageTileId, updateResourceSiteResourcesAt } from './village';

// A village can only be taken when the player has enough culture points for another village
// and the attacking village has a free expansion slot
export const canConquerVillage = (
  database: DbFacade,
  attackingVillageId: number,
  timestamp: number,
): boolean => {
  updatePlayerCulturePointsAt(database, timestamp, getActingPlayerId());

  const culturePoints = database.selectValue({
    sql: 'SELECT culture_points FROM players WHERE id = $player_id;',
    bind: { $player_id: getActingPlayerId() },
    schema: z.number(),
  })!;

  const { nextVillageCulturePointsRequirement } =
    getPlayerCulturePointsRequirementContext(database, getActingPlayerId());

  const { totalExpansionSlots, usedExpansionSlots } = getVillageExpansionSlots(
    database,
    attackingVillageId,
  );

  return (
    culturePoints >= nextVillageCulturePointsRequirement &&
    usedExpansionSlots < totalExpansionSlots
  );
};

export const conquerVillage = (
  database: DbFacade,
  villageId: number,
  attackingVillageId: number,
  timestamp: number,
): void => {
  const tileId = getVillageTileId(database, villageId);

  updateResourceSiteResourcesAt(database, tileId, timestamp);

  database.exec({
    sql: `
      UPDATE villages
      SET
        player_id = $player_id,
        parent_village_id = $parent_village_id,
        slug = (
          SELECT 'v-' || (COUNT(*) + 1)
          FROM villages
          WHERE player_id = $player_id
        )
      WHERE id = $village_id;
    `,
    bind: {
      $player_id: getActingPlayerId(),
      $parent_village_id: attackingVillageId,
      $village_id: villageId,
    },
  });

  // The previous owner's research and troops stationed elsewhere don't carry over
  database.exec({
    sql: 'DELETE FROM unit_research WHERE village_id = $village_id;',
    bind: { $village_id: villageId },
  });

  database.exec({
    sql: 'DELETE FROM troops WHERE source_tile_id = $tile_id AND tile_id != $tile_id;',
    bind: { $tile_id: tileId },
  });

  database.exec({
    sql: insertGatherersHutExpeditionByVillageIdQuery,
    bind: { $village_id: villageId },
  });

  // Every player village needs a troop wheat consumption effect
  const hasTroopWheatEffect = database.selectValue({
    sql: `
      SELECT EXISTS (
        SELECT 1
        FROM effects
        WHERE
          tile_id = $tile_id
          AND source_id = (SELECT id FROM effect_source_ids WHERE source = 'troops')
          AND effect_id = (SELECT id FROM effect_ids WHERE effect = 'wheatProduction')
      );
    `,
    bind: { $tile_id: tileId },
    schema: z.coerce.boolean(),
  });

  if (!hasTroopWheatEffect) {
    database.exec({
      sql: insertEffectQuery,
      bind: {
        $effect_id: database.selectValue({
          sql: selectWheatProductionEffectIdQuery,
          schema: z.number(),
        })!,
        $value: 0,
        $type: 'base',
        $scope: 'local',
        $source: 'troops',
        $tile_id: tileId,
        $source_specifier: 0,
      },
    });
  }
};
