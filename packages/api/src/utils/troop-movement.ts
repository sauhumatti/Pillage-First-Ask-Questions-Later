import { z } from 'zod';
import { PLAYER_ID } from '@pillage-first/game-assets/player';
import {
  calculateLootableCarryCapacity,
  calculateTotalCarryCapacity,
  distributeLoot,
} from '@pillage-first/game-assets/utils/troops';
import { getUnitDefinition } from '@pillage-first/game-assets/utils/units';
import type { GameEvent } from '@pillage-first/types/models/game-event';
import type { ResourceBundle } from '@pillage-first/types/models/resource';
import type { Troop } from '@pillage-first/types/models/troop';
import { type UnitId, unitIdSchema } from '@pillage-first/types/models/unit';
import type { DbFacade } from '@pillage-first/utils/facades/database';
import { getEffectBreakdown } from '@pillage-first/utils/game/calculate-computed-effect';
import {
  BASIC_VILLAGE_DEFENCE,
  type CalculateBattleReturn,
  type CombatUnit,
  calculateBattle,
  calculateSmithyImprovedValue,
  calculateUnitLosses,
} from '@pillage-first/utils/game/combat';
import {
  selectAllRelevantEffectsByIdQuery,
  updateWheatProductionByTroopsAndTileIdEffectQuery,
} from '../queries/effect-queries';
import {
  selectBattleReportParticipantsByTargetTileIdQuery,
  selectCombatTroopsByTileIdQuery,
  selectHasHeroHealthRegenerationEventQuery,
  selectHeroHealthByPlayerIdQuery,
  selectUnitImprovementLevelsByPlayerIdsQuery,
  updateHeroHealthByPlayerIdQuery,
} from '../queries/troop-movement-queries';
import {
  createHeroHealthRegenerationEventByVillageId,
  onHeroDeath,
} from './hero';
import { type CreateNewBattleReport, insertBattleReport } from './report';
import { removeTroops } from './troops';
import {
  getVillageTileId,
  subtractResourceSiteResourcesAt,
  updateResourceSiteResourcesAt,
} from './village';
import { apiEffectSchema } from './zod/effect-schemas';

type BattleReportParticipant = CreateNewBattleReport['attacker'];
type BattleReportUnit = CreateNewBattleReport['attacker']['units'][number];
type BattleReportParticipantRole = 'attacker' | 'defender' | 'reinforcement';

const emptyLoot = (): ResourceBundle => {
  return [0, 0, 0, 0];
};

const mapTroopsToBattleReportUnits = (
  troops: (
    | GameEvent<'troopMovementAttack'>
    | GameEvent<'troopMovementRaid'>
  )['troops'],
): BattleReportUnit[] => {
  const amountByUnitId = new Map<UnitId, number>();

  for (const troop of troops) {
    amountByUnitId.set(
      troop.unitId,
      (amountByUnitId.get(troop.unitId) ?? 0) + troop.amount,
    );
  }

  return [...amountByUnitId.entries()].map(([unitId, amount]) => ({
    unitId,
    amountBefore: amount,
    amountAfter: amount,
  }));
};

const stealResourcesFromTarget = (
  database: DbFacade,
  targetVillageId: number | null,
  targetTileId: number,
  timestamp: number,
  carryCapacity: number,
  crannyCapacity: number,
): ResourceBundle => {
  if (carryCapacity <= 0) {
    return emptyLoot();
  }

  if (typeof targetVillageId === 'number') {
    return subtractResourceSiteResourcesAt(
      database,
      getVillageTileId(database, targetVillageId),
      timestamp,
      ({ currentWood, currentClay, currentIron, currentWheat }) => {
        const availableResources: ResourceBundle = [
          currentWood,
          currentClay,
          currentIron,
          currentWheat,
        ];

        return distributeLoot(
          availableResources,
          calculateLootableCarryCapacity(
            availableResources,
            carryCapacity,
            crannyCapacity,
          ),
        );
      },
    );
  }

  return subtractResourceSiteResourcesAt(
    database,
    targetTileId,
    timestamp,
    ({ currentWood, currentClay, currentIron, currentWheat }) =>
      distributeLoot(
        [currentWood, currentClay, currentIron, currentWheat],
        carryCapacity,
      ),
  );
};

const getBattleReportParticipants = (
  database: DbFacade,
  villageId: number,
  originTileId: number,
  targetTileId: number,
) => {
  const rows = database.selectObjects({
    sql: selectBattleReportParticipantsByTargetTileIdQuery,
    bind: {
      $village_id: villageId,
      $origin_tile_id: originTileId,
      $target_tile_id: targetTileId,
    },
    schema: z.strictObject({
      role: z.enum(['attacker', 'defender', 'reinforcement']),
      tile_id: z.number(),
      player_id: z.number().nullable(),
      unit_id: unitIdSchema.nullable(),
      amount: z.number().nullable(),
    }),
  });

  const participantsByRoleAndTileId = new Map<
    `${BattleReportParticipantRole}:${number}`,
    BattleReportParticipant
  >();

  for (const row of rows) {
    const key = `${row.role}:${row.tile_id}` as const;
    let participant = participantsByRoleAndTileId.get(key);

    if (!participant) {
      participant = {
        tileId: row.tile_id,
        playerId: row.player_id,
        units: [],
      };

      participantsByRoleAndTileId.set(key, participant);
    }

    if (row.unit_id !== null && row.amount !== null) {
      participant.units.push({
        unitId: row.unit_id,
        amountBefore: row.amount,
        amountAfter: row.amount,
      });
    }
  }

  const reinforcements: BattleReportParticipant[] = [];

  for (const [key, reinforcement] of participantsByRoleAndTileId) {
    if (key.startsWith('reinforcement:')) {
      reinforcements.push(reinforcement);
    }
  }

  return {
    attacker: participantsByRoleAndTileId.get(`attacker:${originTileId}`)!,
    defender: participantsByRoleAndTileId.get(`defender:${targetTileId}`)!,
    reinforcements,
  };
};

type StationedTroop = {
  unitId: UnitId;
  amount: number;
  sourceTileId: number;
  playerId: number | null;
};

type SmithyLevels = Map<`${number}:${UnitId}`, number>;

const selectSmithyLevels = (
  database: DbFacade,
  playerIds: number[],
): SmithyLevels => {
  const rows = database.selectObjects({
    sql: selectUnitImprovementLevelsByPlayerIdsQuery,
    bind: { $player_ids: JSON.stringify(playerIds) },
    schema: z.strictObject({
      playerId: z.number(),
      unitId: unitIdSchema,
      level: z.number(),
    }),
  });

  return new Map(
    rows.map(({ playerId, unitId, level }) => [
      `${playerId}:${unitId}` as const,
      level,
    ]),
  );
};

const toCombatUnit = (
  unitId: UnitId,
  amount: number,
  smithyLevel: number,
): CombatUnit => {
  const {
    attack,
    infantryDefence,
    cavalryDefence,
    unitWheatConsumption,
    category,
  } = getUnitDefinition(unitId);

  const improve = (value: number) =>
    calculateSmithyImprovedValue(value, unitWheatConsumption, smithyLevel);

  return {
    attack: improve(attack),
    infantryDefence: improve(infantryDefence),
    cavalryDefence: improve(cavalryDefence),
    isCavalry: category === 'cavalry',
    amount,
  };
};

const selectVillageEffectBreakdown = (
  database: DbFacade,
  effectId: 'attack' | 'infantryDefence',
  villageId: number,
  tileId: number,
) => {
  const effects = database.selectObjects({
    sql: selectAllRelevantEffectsByIdQuery,
    bind: { $effect_id: effectId, $village_id: villageId },
    schema: apiEffectSchema,
  });

  return getEffectBreakdown(effectId, effects, tileId);
};

// Wall and other village buildings. Walls give the same bonus against infantry and cavalry.
// Only building effects are used, since global effects (e.g. hero) belong to the player.
const selectVillageDefenceModifiers = (
  database: DbFacade,
  targetVillageId: number | null,
  targetTileId: number,
) => {
  if (targetVillageId === null) {
    return { flatDefence: 0, defenceMultiplier: 1 };
  }

  const { buildingEffectValues } = selectVillageEffectBreakdown(
    database,
    'infantryDefence',
    targetVillageId,
    targetTileId,
  );

  let flatDefence = BASIC_VILLAGE_DEFENCE;

  for (const value of buildingEffectValues.base) {
    flatDefence += value;
  }

  return { flatDefence, defenceMultiplier: buildingEffectValues.bonus };
};

const decreaseTroopWheatConsumption = (
  database: DbFacade,
  tileId: number,
  deadTroops: { unitId: UnitId; amount: number }[],
  timestamp: number,
) => {
  let consumption = 0;

  for (const { unitId, amount } of deadTroops) {
    consumption += getUnitDefinition(unitId).unitWheatConsumption * amount;
  }

  if (consumption === 0) {
    return;
  }

  updateResourceSiteResourcesAt(database, tileId, timestamp);

  database.exec({
    sql: updateWheatProductionByTroopsAndTileIdEffectQuery,
    bind: { $tile_id: tileId, $increase_amount: -consumption },
  });
};

// The hero doesn't die proportionally like other units, it loses health instead.
// Returns whether the hero survived.
const applyHeroBattleDamage = (
  database: DbFacade,
  playerId: number,
  lossRatio: number,
  heroVillageId: number,
  timestamp: number,
): boolean => {
  const health = database.selectValue({
    sql: selectHeroHealthByPlayerIdQuery,
    bind: { $player_id: playerId },
    schema: z.number(),
  });

  if (health === undefined || health === null) {
    return true;
  }

  const healthAfter = Math.max(0, health - Math.round(lossRatio * 100));

  database.exec({
    sql: updateHeroHealthByPlayerIdQuery,
    bind: { $player_id: playerId, $health: healthAfter },
  });

  if (healthAfter === 0) {
    onHeroDeath(database, timestamp);
    return false;
  }

  const hasRegenerationEvent = database.selectValue({
    sql: selectHasHeroHealthRegenerationEventQuery,
    schema: z.coerce.boolean(),
  });

  if (healthAfter < 100 && !hasRegenerationEvent) {
    createHeroHealthRegenerationEventByVillageId(
      database,
      heroVillageId,
      timestamp,
    );
  }

  return true;
};

const getBattleOutcome = (
  attackerUnitCount: number,
  attackerLosses: number,
): CreateNewBattleReport['outcome'] => {
  if (attackerLosses === 0) {
    return 'attackerNoLoss';
  }

  if (attackerLosses >= attackerUnitCount) {
    return 'attackerFullLoss';
  }

  return 'attackerSomeLoss';
};

type ResolveOffensiveMovementReturn = {
  loot: ResourceBundle;
  survivingTroops: Troop[];
};

export const resolveOffensiveMovement = (
  database: DbFacade,
  args: GameEvent<'troopMovementAttack'> | GameEvent<'troopMovementRaid'>,
  targetVillageId: number | null,
  crannyCapacity: number,
): ResolveOffensiveMovementReturn => {
  const { villageId, resolvesAt, originTileId, targetTileId, troops } = args;
  const isRaid = args.type === 'troopMovementRaid';

  // Read participants before any losses are applied, so the report has the "before" amounts
  const { attacker, defender, reinforcements } = getBattleReportParticipants(
    database,
    villageId,
    originTileId,
    targetTileId,
  );

  const attackerPlayerId = attacker.playerId ?? PLAYER_ID;

  const stationedTroops = database.selectObjects({
    sql: selectCombatTroopsByTileIdQuery,
    bind: { $tile_id: targetTileId },
    schema: z.strictObject({
      unitId: unitIdSchema,
      amount: z.number(),
      sourceTileId: z.number(),
      playerId: z.number().nullable(),
    }),
  }) satisfies StationedTroop[];

  const smithyLevels = selectSmithyLevels(database, [
    attackerPlayerId,
    ...new Set(
      stationedTroops.flatMap(({ playerId }) =>
        playerId === null ? [] : [playerId],
      ),
    ),
  ]);

  const getSmithyLevel = (playerId: number | null, unitId: UnitId) =>
    playerId === null ? 0 : (smithyLevels.get(`${playerId}:${unitId}`) ?? 0);

  const { combinedBonusEffectValue: attackMultiplier } =
    selectVillageEffectBreakdown(database, 'attack', villageId, originTileId);

  const { flatDefence, defenceMultiplier } = selectVillageDefenceModifiers(
    database,
    targetVillageId,
    targetTileId,
  );

  const battle: CalculateBattleReturn = calculateBattle({
    attackers: troops.map(({ unitId, amount }) =>
      toCombatUnit(unitId, amount, getSmithyLevel(attackerPlayerId, unitId)),
    ),
    defenders: stationedTroops.map(({ unitId, amount, playerId }) =>
      toCombatUnit(unitId, amount, getSmithyLevel(playerId, unitId)),
    ),
    isRaid,
    attackMultiplier,
    defenceMultiplier,
    flatDefence,
  });

  // Defender losses
  const deadDefenders: Troop[] = [];
  const amountAfterByParticipant = new Map<`${number}:${UnitId}`, number>();

  for (const { unitId, amount, sourceTileId, playerId } of stationedTroops) {
    let losses = calculateUnitLosses(amount, battle.defenderLossRatio);

    if (unitId === 'HERO') {
      const hasSurvived =
        playerId === null ||
        applyHeroBattleDamage(
          database,
          playerId,
          battle.defenderLossRatio,
          targetVillageId ?? villageId,
          resolvesAt,
        );
      losses = hasSurvived ? 0 : amount;
    }

    const key = `${sourceTileId}:${unitId}` as const;
    amountAfterByParticipant.set(
      key,
      (amountAfterByParticipant.get(key) ?? 0) + amount - losses,
    );

    if (losses > 0) {
      deadDefenders.push({
        unitId,
        amount: losses,
        tileId: targetTileId,
        sourceTileId,
      });
    }
  }

  if (deadDefenders.length > 0) {
    removeTroops(database, deadDefenders);

    if (targetVillageId !== null) {
      decreaseTroopWheatConsumption(
        database,
        targetTileId,
        deadDefenders,
        resolvesAt,
      );
    }
  }

  // Attacker losses
  const survivingTroops: Troop[] = [];
  const deadAttackers: { unitId: UnitId; amount: number }[] = [];
  let attackerUnitCount = 0;
  let attackerLosses = 0;

  for (const troop of troops) {
    let losses = calculateUnitLosses(troop.amount, battle.attackerLossRatio);

    if (troop.unitId === 'HERO') {
      const hasSurvived = applyHeroBattleDamage(
        database,
        attackerPlayerId,
        battle.attackerLossRatio,
        villageId,
        resolvesAt,
      );
      losses = hasSurvived ? 0 : troop.amount;
    }

    attackerUnitCount += troop.amount;
    attackerLosses += losses;

    if (losses > 0) {
      deadAttackers.push({ unitId: troop.unitId, amount: losses });
    }

    if (troop.amount - losses > 0) {
      survivingTroops.push({ ...troop, amount: troop.amount - losses });
    }
  }

  // Troops on the move still consume wheat in their home village
  decreaseTroopWheatConsumption(
    database,
    originTileId,
    deadAttackers,
    resolvesAt,
  );

  const loot = stealResourcesFromTarget(
    database,
    targetVillageId,
    targetTileId,
    resolvesAt,
    calculateTotalCarryCapacity(survivingTroops),
    crannyCapacity,
  );

  const withAmountAfter = (participant: BattleReportParticipant) => ({
    ...participant,
    units: participant.units.map((unit) => ({
      ...unit,
      amountAfter:
        amountAfterByParticipant.get(`${participant.tileId}:${unit.unitId}`) ??
        unit.amountBefore,
    })),
  });

  const survivingAmountByUnitId = new Map<UnitId, number>();

  for (const { unitId, amount } of survivingTroops) {
    survivingAmountByUnitId.set(
      unitId,
      (survivingAmountByUnitId.get(unitId) ?? 0) + amount,
    );
  }

  const attackerUnits = mapTroopsToBattleReportUnits(troops).map((unit) => ({
    ...unit,
    amountAfter: survivingAmountByUnitId.get(unit.unitId) ?? 0,
  }));

  insertBattleReport(database, {
    villageId,
    timestamp: resolvesAt,
    outcome: getBattleOutcome(attackerUnitCount, attackerLosses),
    originTileId,
    targetTileId,
    isRaid,
    loot,
    canAttackerSeeFullReport: survivingTroops.length > 0,
    attackerPoints: battle.attackerPoints,
    defenderPoints: battle.defenderPoints,
    attacker: {
      ...attacker,
      units: attackerUnits,
    },
    defender: withAmountAfter(defender),
    reinforcements: reinforcements.map(withAmountAfter),
  });

  return { loot, survivingTroops };
};
