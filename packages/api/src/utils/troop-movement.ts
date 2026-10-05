import { z } from 'zod';
import { PLAYER_ID } from '@pillage-first/game-assets/player';
import {
  calculateHeroBonusMultiplier,
  createCombatUnit,
  createHeroCombatUnit,
  getWallDefenceAtLevel,
  getWallDurabilityByTribe,
} from '@pillage-first/game-assets/utils/combat';
import {
  calculateLootableCarryCapacity,
  calculateTotalCarryCapacity,
  distributeLoot,
} from '@pillage-first/game-assets/utils/troops';
import { getUnitDefinition } from '@pillage-first/game-assets/utils/units';
import {
  type Building,
  buildingIdSchema,
} from '@pillage-first/types/models/building';
import type {
  CatapultTarget,
  GameEvent,
} from '@pillage-first/types/models/game-event';
import type {
  ResourceBundle,
  Resources,
} from '@pillage-first/types/models/resource';
import { type Tribe, tribeSchema } from '@pillage-first/types/models/tribe';
import type { Troop } from '@pillage-first/types/models/troop';
import { type UnitId, unitIdSchema } from '@pillage-first/types/models/unit';
import type { DbFacade } from '@pillage-first/utils/facades/database';
import { getEffectBreakdown } from '@pillage-first/utils/game/calculate-computed-effect';
import {
  BASIC_VILLAGE_DEFENCE,
  type CalculateBattleReturn,
  type CombatUnit,
  calculateBattle,
  calculateDemolitionPoints,
  calculateInBattleWallLevel,
  calculateLevelAfterDemolition,
  calculateUnitLosses,
} from '@pillage-first/utils/game/combat';
import {
  selectAllRelevantEffectsByIdQuery,
  updateWheatProductionByTroopsAndTileIdEffectQuery,
} from '../queries/effect-queries';
import {
  selectBattleReportParticipantsByTargetTileIdQuery,
  selectBuildingFieldsForSiegeByVillageIdQuery,
  selectCombatTroopsByTileIdQuery,
  selectDefensiveStructuresByVillageIdQuery,
  selectHasHeroHealthRegenerationEventQuery,
  selectHeroCombatStatsByPlayerIdQuery,
  selectHeroHealthByPlayerIdQuery,
  selectTribeByVillageTileIdQuery,
  selectUnitImprovementLevelsByPlayerIdsQuery,
  updateHeroHealthByPlayerIdQuery,
} from '../queries/troop-movement-queries';
import {
  createHeroHealthRegenerationEventByVillageId,
  onHeroDeath,
} from './hero';
import {
  type CreateNewBattleReport,
  insertBattleReport,
  insertScoutingReport,
} from './report';
import { removeTroops } from './troops';
import {
  calculateResourceSiteResourcesAt,
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

type HeroCombatStats = {
  fightingStrength: number;
  // Stored in tenths of a percent, 2 per bonus point
  attackBonus: number;
  defenceBonus: number;
  isMounted: boolean;
};

const selectHeroCombatStats = (
  database: DbFacade,
  playerId: number | null,
): HeroCombatStats | null => {
  if (playerId === null) {
    return null;
  }

  return (
    database.selectObject({
      sql: selectHeroCombatStatsByPlayerIdQuery,
      bind: { $player_id: playerId },
      schema: z.strictObject({
        fightingStrength: z.number(),
        attackBonus: z.number(),
        defenceBonus: z.number(),
        isMounted: z.coerce.boolean(),
      }),
    }) ?? null
  );
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

type SiegeBuildingField = {
  fieldId: number;
  buildingId: Building['id'];
  level: number;
};

export type DamagedBuilding = SiegeBuildingField & { levelAfter: number };

type SiegeContext = {
  defenderTribe: Tribe;
  wall: SiegeBuildingField | null;
  // Buildings catapults can hit. The wall can only be damaged by rams.
  targets: SiegeBuildingField[];
  rams: { amount: number; upgradeLevel: number };
  catapults: { amount: number; upgradeLevel: number };
};

const getPointsRatio = ({
  attackerPoints,
  defenderPoints,
}: CalculateBattleReturn) =>
  defenderPoints > 0
    ? attackerPoints / defenderPoints
    : Number.POSITIVE_INFINITY;

const selectSiegeContext = (
  database: DbFacade,
  troops: Troop[],
  targetVillageId: number,
  targetTileId: number,
  getUpgradeLevel: (unitId: UnitId) => number,
): SiegeContext => {
  const rams = { amount: 0, upgradeLevel: 0 };
  const catapults = { amount: 0, upgradeLevel: 0 };

  for (const { unitId, amount } of troops) {
    if (unitId === 'HERO') {
      continue;
    }

    const { tier } = getUnitDefinition(unitId);

    if (tier === 'siege-ram') {
      rams.amount += amount;
      rams.upgradeLevel = getUpgradeLevel(unitId);
    }

    if (tier === 'siege-catapult') {
      catapults.amount += amount;
      catapults.upgradeLevel = getUpgradeLevel(unitId);
    }
  }

  const fields = database.selectObjects({
    sql: selectBuildingFieldsForSiegeByVillageIdQuery,
    bind: { $village_id: targetVillageId },
    schema: z.strictObject({
      fieldId: z.number(),
      buildingId: buildingIdSchema,
      level: z.number(),
    }),
  });

  const isWall = ({ buildingId }: SiegeBuildingField) =>
    buildingId.endsWith('_WALL');

  return {
    defenderTribe: selectTribeByTileId(database, targetTileId),
    wall: fields.find(isWall) ?? null,
    targets: fields.filter((field) => !isWall(field)),
    rams,
    catapults,
  };
};

const pickRandom = <T>(items: T[]): T | undefined => {
  return items[Math.floor(Math.random() * items.length)];
};

// Catapults are split evenly between up to two targets. A target that doesn't exist is replaced by a random building.
const resolveCatapultDamage = (
  { targets, catapults }: SiegeContext,
  catapultTargets: CatapultTarget[],
  pointsRatio: number,
): DamagedBuilding[] => {
  const requestedTargets: CatapultTarget[] =
    catapultTargets.length > 0 ? catapultTargets : ['random'];
  const levelByFieldId = new Map(
    targets.map(({ fieldId, level }) => [fieldId, level]),
  );
  const damagedBuildings: DamagedBuilding[] = [];

  const points = calculateDemolitionPoints(
    catapults.amount / requestedTargets.length,
    catapults.upgradeLevel,
    pointsRatio,
  );

  for (const target of requestedTargets) {
    const standing = targets.filter(
      ({ fieldId }) => (levelByFieldId.get(fieldId) ?? 0) > 0,
    );

    const matching = standing
      .filter(({ buildingId }) => buildingId === target)
      .sort(
        (a, b) =>
          levelByFieldId.get(b.fieldId)! - levelByFieldId.get(a.fieldId)!,
      );

    const field = matching[0] ?? pickRandom(standing);

    if (!field) {
      continue;
    }

    const level = levelByFieldId.get(field.fieldId)!;
    const levelAfter = calculateLevelAfterDemolition(level, points);

    if (levelAfter < level) {
      levelByFieldId.set(field.fieldId, levelAfter);

      const existing = damagedBuildings.find(
        ({ fieldId }) => fieldId === field.fieldId,
      );

      if (existing) {
        existing.levelAfter = levelAfter;
      } else {
        damagedBuildings.push({ ...field, level, levelAfter });
      }
    }
  }

  return damagedBuildings;
};

type ResolveOffensiveMovementReturn = {
  loot: ResourceBundle;
  survivingTroops: Troop[];
  damagedBuildings: DamagedBuilding[];
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

  const attackingHero = troops.some(({ unitId }) => unitId === 'HERO')
    ? selectHeroCombatStats(database, attackerPlayerId)
    : null;
  const defendingHeroOwnerId =
    stationedTroops.find(({ unitId }) => unitId === 'HERO')?.playerId ?? null;
  const defendingHero = selectHeroCombatStats(database, defendingHeroOwnerId);

  const toCombatUnit = (
    unitId: UnitId,
    amount: number,
    playerId: number | null,
    hero: HeroCombatStats | null,
  ): CombatUnit[] => {
    if (unitId === 'HERO') {
      return hero
        ? [createHeroCombatUnit(hero.fightingStrength, hero.isMounted)]
        : [];
    }

    return [createCombatUnit(unitId, amount, getSmithyLevel(playerId, unitId))];
  };

  const runBattle = (
    battleFlatDefence: number,
    battleDefenceMultiplier: number,
  ): CalculateBattleReturn =>
    calculateBattle({
      attackers: troops.flatMap(({ unitId, amount }) =>
        toCombatUnit(unitId, amount, attackerPlayerId, attackingHero),
      ),
      defenders: stationedTroops.flatMap(({ unitId, amount, playerId }) =>
        toCombatUnit(unitId, amount, playerId, defendingHero),
      ),
      isRaid,
      attackMultiplier:
        attackMultiplier *
        calculateHeroBonusMultiplier((attackingHero?.attackBonus ?? 0) / 2),
      defenceMultiplier:
        battleDefenceMultiplier *
        calculateHeroBonusMultiplier((defendingHero?.defenceBonus ?? 0) / 2),
      flatDefence: battleFlatDefence,
    });

  let battle = runBattle(flatDefence, defenceMultiplier);

  // Rams and catapults only work in normal attacks on villages
  const siege =
    !isRaid && targetVillageId !== null
      ? selectSiegeContext(
          database,
          troops,
          targetVillageId,
          targetTileId,
          (unitId) => getSmithyLevel(attackerPlayerId, unitId),
        )
      : null;

  const damagedBuildings: DamagedBuilding[] = [];

  if (siege !== null && siege.rams.amount > 0 && siege.wall !== null) {
    const { wall, defenderTribe } = siege;

    // Rams lower the wall used in the battle, then the battle is fought again
    const earlyPoints = calculateDemolitionPoints(
      siege.rams.amount,
      siege.rams.upgradeLevel,
      getPointsRatio(battle),
    );
    const inBattleWallLevel = calculateInBattleWallLevel(
      wall.level,
      earlyPoints,
      getWallDurabilityByTribe(defenderTribe),
    );
    const currentWallDefence = getWallDefenceAtLevel(defenderTribe, wall.level);
    const inBattleWallDefence = getWallDefenceAtLevel(
      defenderTribe,
      inBattleWallLevel,
    );

    battle = runBattle(
      flatDefence - currentWallDefence.base + inBattleWallDefence.base,
      (defenceMultiplier / currentWallDefence.bonus) *
        inBattleWallDefence.bonus,
    );

    const levelAfter = calculateLevelAfterDemolition(
      wall.level,
      calculateDemolitionPoints(
        siege.rams.amount,
        siege.rams.upgradeLevel,
        getPointsRatio(battle),
      ),
    );

    if (levelAfter < wall.level) {
      damagedBuildings.push({ ...wall, levelAfter });
    }
  }

  if (siege !== null && siege.catapults.amount > 0) {
    damagedBuildings.push(
      ...resolveCatapultDamage(
        siege,
        args.catapultTargets ?? [],
        getPointsRatio(battle),
      ),
    );
  }

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
    damagedBuildings: damagedBuildings.map(
      ({ buildingId, level, levelAfter }) => ({
        buildingId,
        levelBefore: level,
        levelAfter,
      }),
    ),
  });

  return { loot, survivingTroops, damagedBuildings };
};

// Every attacking scout scouts with this strength, regardless of tribe
const SCOUT_SCOUTING_STRENGTH = 35;

export const isScoutingMovement = (
  args: GameEvent<'troopMovementAttack'> | GameEvent<'troopMovementRaid'>,
): boolean => {
  return (
    args.scoutingTarget !== undefined &&
    args.troops.length > 0 &&
    args.troops.every(
      ({ unitId }) =>
        unitId !== 'HERO' && getUnitDefinition(unitId).tier === 'scout',
    )
  );
};

const selectTribeByTileId = (database: DbFacade, tileId: number): Tribe => {
  return (
    database.selectValue({
      sql: selectTribeByVillageTileIdQuery,
      bind: { $tile_id: tileId },
      schema: tribeSchema,
    }) ?? 'nature'
  );
};

const getScoutingOutcome = (
  amountBefore: number,
  amountLost: number,
):
  | 'scoutAttackerNoLoss'
  | 'scoutAttackerSomeLoss'
  | 'scoutAttackerFullLoss' => {
  if (amountLost === 0) {
    return 'scoutAttackerNoLoss';
  }

  if (amountLost >= amountBefore) {
    return 'scoutAttackerFullLoss';
  }

  return 'scoutAttackerSomeLoss';
};

// Only scouts fight scouts. Attacking scouts that survive report the target's
// troops, plus either its resources or its defensive structures.
export const resolveScoutingMovement = (
  database: DbFacade,
  args: GameEvent<'troopMovementAttack'> | GameEvent<'troopMovementRaid'>,
  targetVillageId: number | null,
): { survivingTroops: Troop[] } => {
  const { villageId, resolvesAt, originTileId, targetTileId, troops } = args;
  const scoutingTarget = args.scoutingTarget!;

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

  // Oasis animals don't fight scouts
  const defendingScouts = stationedTroops.filter(({ unitId }) => {
    if (unitId === 'HERO') {
      return false;
    }

    const { tier, tribe } = getUnitDefinition(unitId);

    return tier === 'scout' && tribe !== 'nature';
  });

  let attackerLossRatio = 0;
  let defenderLossRatio = 0;

  if (defendingScouts.length > 0) {
    const smithyLevels = selectSmithyLevels(database, [
      ...new Set(
        defendingScouts.flatMap(({ playerId }) =>
          playerId === null ? [] : [playerId],
        ),
      ),
    ]);

    const { defenceMultiplier } = selectVillageDefenceModifiers(
      database,
      targetVillageId,
      targetTileId,
    );

    const battle = calculateBattle({
      attackers: troops.map(({ amount }) => ({
        attack: SCOUT_SCOUTING_STRENGTH,
        infantryDefence: 0,
        cavalryDefence: 0,
        isCavalry: false,
        amount,
      })),
      defenders: defendingScouts.map(({ unitId, amount, playerId }) =>
        createCombatUnit(
          unitId,
          amount,
          playerId === null
            ? 0
            : (smithyLevels.get(`${playerId}:${unitId}`) ?? 0),
        ),
      ),
      // Scouting losses work like a raid, so both sides can survive
      isRaid: true,
      defenceMultiplier,
    });

    attackerLossRatio = battle.attackerLossRatio;
    defenderLossRatio = battle.defenderLossRatio;
  }

  // Defending scout losses
  const deadDefenders: Troop[] = [];

  for (const { unitId, amount, sourceTileId } of defendingScouts) {
    const losses = calculateUnitLosses(amount, defenderLossRatio);

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

  // Attacking scout losses
  const survivingTroops: Troop[] = [];
  const deadAttackers: { unitId: UnitId; amount: number }[] = [];
  let amountBefore = 0;
  let amountLost = 0;

  for (const troop of troops) {
    const losses = calculateUnitLosses(troop.amount, attackerLossRatio);

    amountBefore += troop.amount;
    amountLost += losses;

    if (losses > 0) {
      deadAttackers.push({ unitId: troop.unitId, amount: losses });
    }

    if (troop.amount - losses > 0) {
      survivingTroops.push({ ...troop, amount: troop.amount - losses });
    }
  }

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

  decreaseTroopWheatConsumption(
    database,
    originTileId,
    deadAttackers,
    resolvesAt,
  );

  const successful = survivingTroops.length > 0;

  // The report shows what the target had before the scouting fight
  const defenderUnits = new Map<number, { unitId: UnitId; amount: number }[]>();

  for (const { unitId, amount, sourceTileId } of stationedTroops) {
    const units = defenderUnits.get(sourceTileId) ?? [];
    units.push({ unitId, amount });
    defenderUnits.set(sourceTileId, units);
  }

  let resources: Resources | undefined;
  let defensiveStructures:
    | { buildingId: Building['id']; level: number }[]
    | undefined;

  if (successful && scoutingTarget === 'resources') {
    const { currentWood, currentClay, currentIron, currentWheat } =
      calculateResourceSiteResourcesAt(database, targetTileId, resolvesAt);

    resources = {
      wood: Math.floor(currentWood),
      clay: Math.floor(currentClay),
      iron: Math.floor(currentIron),
      wheat: Math.floor(currentWheat),
    };
  }

  if (
    successful &&
    scoutingTarget === 'defensiveStructures' &&
    targetVillageId !== null
  ) {
    defensiveStructures = database.selectObjects({
      sql: selectDefensiveStructuresByVillageIdQuery,
      bind: { $village_id: targetVillageId },
      schema: z.strictObject({
        buildingId: buildingIdSchema,
        level: z.number(),
      }),
    });
  }

  insertScoutingReport(database, {
    villageId,
    timestamp: resolvesAt,
    outcome: getScoutingOutcome(amountBefore, amountLost),
    originTileId,
    targetTileId,
    perspective: 'attacker',
    successful,
    target: scoutingTarget,
    attacker: {
      tribe: selectTribeByTileId(database, originTileId),
      units: attackerUnits,
    },
    defender: {
      tribe: selectTribeByTileId(database, targetTileId),
      units: successful ? (defenderUnits.get(targetTileId) ?? []) : [],
      reinforcements: successful
        ? [...defenderUnits.entries()]
            .filter(([tileId]) => tileId !== targetTileId)
            .map(([tileId, units]) => ({
              tileId,
              tribe: selectTribeByTileId(database, tileId),
              units,
            }))
        : [],
    },
    resources,
    defensiveStructures,
  });

  return { survivingTroops };
};
