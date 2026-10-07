import { z } from 'zod';
import { buildings } from '@pillage-first/game-assets/buildings';
import { getUnitsByTribe } from '@pillage-first/game-assets/utils/units';
import { buildingIdSchema } from '@pillage-first/types/models/building';
import type { GameEvent } from '@pillage-first/types/models/game-event';
import { tribeSchema } from '@pillage-first/types/models/tribe';
import { unitIdSchema } from '@pillage-first/types/models/unit';
import type { DbFacade } from '@pillage-first/utils/facades/database';
import { assessBuildingRequirements } from '@pillage-first/utils/game/building-requirements';
import { createEvents } from '../utils/create-event';
import {
  getEventCost,
  validateEventCreationPrerequisites,
  validateEventCreationResources,
} from '../utils/events';
import { calculateResourceSiteResourcesAt } from '../utils/village';
import { withActingPlayer } from './actor';
import {
  type AiDecisionProvider,
  type AiRequest,
  aiResponseSchema,
} from './ai-contract';
import { getGameTime } from './game-clock';

type EventInput = Parameters<typeof createEvents>[1];
type Candidate = {
  id: string;
  description: string;
  priority: number;
  event: EventInput | null;
};
const villageSchema = z.object({
  id: z.number(),
  tileId: z.number(),
  population: z.number(),
  tribe: tribeSchema,
});
const fieldSchema = z.object({
  fieldId: z.number(),
  buildingId: buildingIdSchema,
  level: z.number(),
});
const troopSchema = z.object({
  unitId: unitIdSchema,
  amount: z.number(),
  tileId: z.number(),
  sourceTileId: z.number(),
});

export const prepareAiDecision = (
  database: DbFacade,
  playerId: number,
  turn: number,
) =>
  withActingPlayer(playerId, () => {
    const villages = database.selectObjects({
      sql: `SELECT v.id, v.tile_id AS tileId, ti.tribe,
    COALESCE((SELECT SUM(bd.population) FROM building_fields bf JOIN building_ids bi ON bi.id = bf.building_id
      JOIN building_data bd ON bd.building_id = bi.building AND bd.level = bf.level AND bd.population IS NOT NULL WHERE bf.village_id = v.id), 0) AS population
    FROM villages v JOIN players p ON p.id = v.player_id JOIN tribe_ids ti ON ti.id = p.tribe_id WHERE v.player_id = $player ORDER BY v.id;`,
      bind: { $player: playerId },
      schema: villageSchema,
    });
    const candidates: Candidate[] = [];
    const snapshots: AiRequest['villages'] = [];
    const add = (description: string, priority: number, event: EventInput) => {
      try {
        const sample = event as GameEvent;
        validateEventCreationPrerequisites(database, sample);
        const cost = getEventCost(database, sample);
        if (!validateEventCreationResources(database, sample, cost)) {
          return;
        }
        candidates.push({
          id: `action-${candidates.length}`,
          description,
          priority,
          event,
        });
      } catch {
        /* Illegal or unaffordable actions are not offered to the model. */
      }
    };
    for (const village of villages) {
      const resources = calculateResourceSiteResourcesAt(
        database,
        village.tileId,
        getGameTime(database),
      );
      snapshots.push({
        id: village.id,
        population: village.population,
        resources: {
          wood: resources.currentWood,
          clay: resources.currentClay,
          iron: resources.currentIron,
          wheat: resources.currentWheat,
        },
      });
      const fields = database.selectObjects({
        sql: 'SELECT bf.field_id AS fieldId, bi.building AS buildingId, bf.level FROM building_fields bf JOIN building_ids bi ON bi.id = bf.building_id WHERE bf.village_id = $village ORDER BY field_id;',
        bind: { $village: village.id },
        schema: fieldSchema,
      });
      const levels = new Map<(typeof fields)[number]['buildingId'], number>();
      for (const field of fields) {
        levels.set(
          field.buildingId,
          Math.max(levels.get(field.buildingId) ?? 0, field.level),
        );
      }
      const minimumResourceLevel = Math.min(
        ...fields.filter((f) => f.fieldId <= 18).map((f) => f.level),
      );
      for (const field of fields) {
        const definition = buildings.find((b) => b.id === field.buildingId)!;
        if (
          field.level >= definition.maxLevel ||
          field.buildingId === 'EMBASSY' ||
          field.buildingId === 'TREASURY'
        ) {
          continue;
        }
        let priority =
          field.fieldId <= 18 ? 90 - field.level * 3 : 25 - field.level;
        if (
          field.buildingId === 'WHEAT_FIELD' &&
          resources.currentWheat < 300
        ) {
          priority += 30;
        }
        if (field.buildingId === 'MAIN_BUILDING' && field.level < 5) {
          priority = 75;
        }
        if (
          (field.buildingId === 'WAREHOUSE' ||
            field.buildingId === 'GRANARY') &&
          ((field.buildingId === 'WAREHOUSE' &&
            Math.max(
              resources.currentWood,
              resources.currentClay,
              resources.currentIron,
            ) >
              resources.warehouseCapacity * 0.85) ||
            (field.buildingId === 'GRANARY' &&
              resources.currentWheat > resources.granaryCapacity * 0.85))
        ) {
          priority = 110;
        }
        if (
          field.buildingId === 'RESIDENCE' &&
          minimumResourceLevel >= 3 &&
          field.level < 10
        ) {
          priority = 85;
        }
        add(
          `Village ${village.id}: upgrade ${field.buildingId} to level ${field.level + 1}`,
          priority,
          {
            type: 'buildingLevelChange',
            villageId: village.id,
            buildingFieldId: field.fieldId,
            buildingId: field.buildingId,
            previousLevel: field.level,
            level: field.level + 1,
          } as EventInput,
        );
      }
      const emptyField = Array.from({ length: 20 }, (_, i) => i + 19).find(
        (id) => !fields.some((f) => f.fieldId === id),
      );
      if (emptyField !== undefined) {
        for (const definition of buildings) {
          if (
            definition.category === 'resource-production' ||
            definition.id.endsWith('_WALL') ||
            ['EMBASSY', 'TREASURY', 'RALLY_POINT'].includes(definition.id)
          ) {
            continue;
          }
          if (
            !assessBuildingRequirements({
              building: definition,
              tribe: village.tribe,
              maxLevelByBuildingId: levels,
              buildingIdsInQueue: new Set(),
            }).canBuild
          ) {
            continue;
          }
          const priorities: Record<string, number> = {
            WAREHOUSE: 100,
            GRANARY: 99,
            BARRACKS: 80,
            RESIDENCE: minimumResourceLevel >= 3 ? 85 : 30,
            ACADEMY: 45,
            MARKETPLACE: 40,
          };
          add(
            `Village ${village.id}: construct ${definition.id}`,
            priorities[definition.id] ?? 20,
            {
              type: 'buildingConstruction',
              villageId: village.id,
              buildingFieldId: emptyField,
              buildingId: definition.id,
              previousLevel: 0,
              level: 1,
            } as EventInput,
          );
        }
      }
      const troops = database.selectObjects({
        sql: 'SELECT ui.unit AS unitId, t.amount, t.tile_id AS tileId, t.source_tile_id AS sourceTileId FROM troops t JOIN unit_ids ui ON ui.id = t.unit_id WHERE t.tile_id = $tile AND t.source_tile_id = $tile;',
        bind: { $tile: village.tileId },
        schema: troopSchema,
      });
      let armySize = 0;
      let settlerCount = 0;
      const tribeUnits = getUnitsByTribe(village.tribe);
      for (const troop of troops) {
        if (troop.unitId !== 'HERO') {
          armySize += troop.amount;
        }
        if (
          tribeUnits.some(
            (unit) => unit.id === troop.unitId && unit.tier === 'settler',
          )
        ) {
          settlerCount += troop.amount;
        }
      }
      const inbound = database.selectValue({
        sql: `SELECT COUNT(*) FROM events WHERE type IN ('troopMovementAttack','troopMovementRaid') AND CAST(json_extract(meta, '$.targetTileId') AS INTEGER) = $tile;`,
        bind: { $tile: village.tileId },
        schema: z.number(),
      })!;
      for (const unit of getUnitsByTribe(village.tribe)) {
        if (
          unit.tier === 'hero' ||
          unit.tier === 'siege-ram' ||
          unit.tier === 'siege-catapult' ||
          unit.tier === 'administration'
        ) {
          continue;
        }
        const trainingBuilding =
          unit.tier === 'settler'
            ? 'RESIDENCE'
            : unit.category === 'cavalry'
              ? 'STABLE'
              : 'BARRACKS';
        const durationEffectId =
          trainingBuilding === 'RESIDENCE'
            ? 'residenceTrainingDuration'
            : trainingBuilding === 'STABLE'
              ? 'stableTrainingDuration'
              : 'barracksTrainingDuration';
        if (unit.tier === 'settler' && settlerCount >= 3) {
          continue;
        }
        add(
          `Village ${village.id}: train one ${unit.id}`,
          unit.tier === 'settler'
            ? 105
            : inbound > 0
              ? 120
              : armySize < 15 && minimumResourceLevel >= 1
                ? 95
                : 35,
          {
            type: 'troopTraining',
            villageId: village.id,
            unitId: unit.id,
            buildingId: trainingBuilding,
            durationEffectId,
            batchId: `ai-${playerId}-${turn}`,
            amount: 1,
          } as EventInput,
        );
        if (unit.researchRequirements.length > 0) {
          add(`Village ${village.id}: research ${unit.id}`, 30, {
            type: 'unitResearch',
            villageId: village.id,
            unitId: unit.id,
          } as EventInput);
        }
      }
      const settlers = troops.filter((t) =>
        getUnitsByTribe(village.tribe).some(
          (u) => u.id === t.unitId && u.tier === 'settler',
        ),
      );
      if (settlers.some((t) => t.amount >= 3)) {
        const target = database.selectValue({
          sql: `SELECT t.id FROM tiles t WHERE t.type_id = (SELECT id FROM tile_type_ids WHERE type = 'free') AND NOT EXISTS (SELECT 1 FROM villages v WHERE v.tile_id = t.id) ORDER BY (t.x - (SELECT x FROM tiles WHERE id = $origin)) * (t.x - (SELECT x FROM tiles WHERE id = $origin)) + (t.y - (SELECT y FROM tiles WHERE id = $origin)) * (t.y - (SELECT y FROM tiles WHERE id = $origin)), t.id LIMIT 1;`,
          bind: { $origin: village.tileId },
          schema: z.number(),
        });
        if (target) {
          add(
            `Village ${village.id}: found a new village on tile ${target}`,
            150,
            {
              type: 'troopMovementFindNewVillage',
              villageId: village.id,
              originTileId: village.tileId,
              targetTileId: target,
              troops: [{ ...settlers[0], amount: 3 }],
            } as EventInput,
          );
        }
      }
      if (armySize >= 15) {
        // Public map information only: no enemy resource balances or hidden garrisons.
        const targets = database.selectObjects({
          sql: 'SELECT v.tile_id AS tileId FROM villages v JOIN tiles t ON t.id = v.tile_id WHERE v.player_id != $player ORDER BY (t.x - (SELECT x FROM tiles WHERE id = $origin)) * (t.x - (SELECT x FROM tiles WHERE id = $origin)) + (t.y - (SELECT y FROM tiles WHERE id = $origin)) * (t.y - (SELECT y FROM tiles WHERE id = $origin)), v.id LIMIT 3;',
          bind: { $player: playerId, $origin: village.tileId },
          schema: z.object({ tileId: z.number() }),
        });
        const combatTroops = troops
          .filter((t) => {
            const unit = getUnitsByTribe(village.tribe).find(
              (u) => u.id === t.unitId,
            );
            return (
              unit &&
              (unit.category === 'infantry' || unit.category === 'cavalry') &&
              unit.tier !== 'scout'
            );
          })
          .map((t) => ({ ...t, amount: Math.floor(t.amount / 2) }))
          .filter((t) => t.amount > 0);
        if (combatTroops.length) {
          for (const target of targets) {
            add(
              `Village ${village.id}: raid enemy tile ${target.tileId} with half the army; defenders unknown`,
              inbound ? 5 : turn % 6 === 0 ? 100 : 10,
              {
                type: 'troopMovementRaid',
                villageId: village.id,
                originTileId: village.tileId,
                targetTileId: target.tileId,
                troops: combatTroops,
              } as EventInput,
            );
            add(
              `Village ${village.id}: attack enemy tile ${target.tileId} with half the army; defenders unknown`,
              inbound ? 4 : 9,
              {
                type: 'troopMovementAttack',
                villageId: village.id,
                originTileId: village.tileId,
                targetTileId: target.tileId,
                troops: combatTroops,
              } as EventInput,
            );
          }
        }
      }
    }
    candidates.sort(
      (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
    );
    const offered = candidates.slice(0, 63);
    offered.push({
      id: 'wait',
      description: 'Wait and save resources',
      priority: 0,
      event: null,
    });
    const request: AiRequest = {
      playerId,
      turn,
      gameTime: getGameTime(database),
      villages: snapshots.slice(0, 100),
      actions: offered.map(({ id, description }) => ({ id, description })),
    };
    return { request, candidates: offered };
  });

export const executeAiDecision = (
  database: DbFacade,
  playerId: number,
  candidates: Candidate[],
  actionId: string,
): boolean => {
  const selected = candidates.find((c) => c.id === actionId);
  if (!selected) {
    return false;
  }
  if (!selected.event) {
    return true;
  }
  return withActingPlayer(playerId, () => {
    const owner = database.selectValue({
      sql: 'SELECT player_id FROM villages WHERE id = $id;',
      bind: { $id: selected.event!.villageId },
      schema: z.number(),
    });
    if (owner !== playerId) {
      return false;
    }
    // Player actions can change the world while a model request is pending.
    const fresh = prepareAiDecision(database, playerId, 0);
    if (
      !fresh.candidates.some(
        (candidate) =>
          JSON.stringify(candidate.event) === JSON.stringify(selected.event),
      )
    ) {
      return false;
    }
    try {
      database.transaction((db) => createEvents(db, selected.event!));
      return true;
    } catch {
      return false;
    }
  });
};

export const browserDecisionProvider: AiDecisionProvider = async (request) => {
  const response = await fetch(
    new URL('/api/ai/decide', globalThis.location.origin),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pillage-first': '1' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) {
    throw new Error('AI service unavailable');
  }
  return aiResponseSchema.parse(await response.json());
};
