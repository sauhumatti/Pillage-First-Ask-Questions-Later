import { items } from '@pillage-first/game-assets/items';
import {
  calculateBreweryAttackMultiplier,
  calculateHeroBonusMultiplier,
  calculateHeroFightingStrength,
  calculateVillageDefenceModifiers,
  createCombatUnit,
  createHeroCombatUnit,
  distributeTrappedUnits,
  getWallDefenceAtLevel,
  getWallDurabilityByTribe,
} from '@pillage-first/game-assets/utils/combat';
import { getUnitDefinition } from '@pillage-first/game-assets/utils/units';
import type { Tribe } from '@pillage-first/types/models/tribe';
import type { UnitId } from '@pillage-first/types/models/unit';
import {
  type CombatUnit,
  calculateBattle,
  calculateDemolitionPoints,
  calculateInBattleWallLevel,
  calculateLevelAfterDemolition,
  calculateUnitLosses,
} from '@pillage-first/utils/game/combat';
import type {
  CombatSimulatorHeroStats,
  CombatSimulatorState,
  CombatSimulatorTroop,
} from '../providers/combat-simulator-context';

export type SimulatedUnitResult = {
  unitId: UnitId;
  amountBefore: number;
  amountTrapped: number;
  amountLost: number;
  amountAfter: number;
};

export type SimulatedCombatResult = {
  attackerPoints: number;
  defenderPoints: number;
  hasAttackerWon: boolean;
  // Wall level after rams, when rams attacked a wall
  wallLevelAfter: number | null;
  attacker: SimulatedUnitResult[];
  defender: SimulatedUnitResult[];
  reinforcements: SimulatedUnitResult[][];
  // Health the hero loses, out of 100
  attackerHeroDamage: number | null;
  defenderHeroDamage: number | null;
};

const getHeroItemPowerBonus = ({ itemIdsBySlot }: CombatSimulatorHeroStats) => {
  let power = 0;

  for (const itemId of Object.values(itemIdsBySlot)) {
    const item = items.find(({ id }) => id === itemId);

    for (const bonus of item?.heroBonus ?? []) {
      if (bonus.attribute === 'power') {
        power += bonus.value;
      }
    }
  }

  return power;
};

const hasHero = (troops: CombatSimulatorTroop[]) =>
  troops.some(({ unitId, amount }) => unitId === 'HERO' && amount > 0);

const toCombatUnits = (
  troops: CombatSimulatorTroop[],
  tribe: Tribe,
  heroStats: CombatSimulatorHeroStats | null,
): CombatUnit[] => {
  return troops.flatMap((troop) => {
    if (troop.amount <= 0) {
      return [];
    }

    if (troop.unitId === 'HERO') {
      if (heroStats === null) {
        return [];
      }

      // A hero fights at full strength regardless of health
      const strength = calculateHeroFightingStrength(
        tribe,
        heroStats.strength,
        getHeroItemPowerBonus(heroStats),
      );

      return [createHeroCombatUnit(strength, heroStats.mounted)];
    }

    return [
      createCombatUnit(
        troop.unitId,
        troop.amount,
        troop.smithyImprovementLevel,
      ),
    ];
  });
};

const toUnitResults = (
  troops: CombatSimulatorTroop[],
  lossRatio: number,
  trapped: number[] = [],
): SimulatedUnitResult[] => {
  return troops.flatMap((troop, index) => {
    if (troop.amount <= 0 || troop.unitId === 'HERO') {
      return [];
    }

    const amountTrapped = trapped[index] ?? 0;
    const amountLost = calculateUnitLosses(
      troop.amount - amountTrapped,
      lossRatio,
    );

    return [
      {
        unitId: troop.unitId,
        amountBefore: troop.amount,
        amountTrapped,
        amountLost,
        amountAfter: troop.amount - amountTrapped - amountLost,
      },
    ];
  });
};

export const simulateCombat = (
  state: CombatSimulatorState,
): SimulatedCombatResult | null => {
  const { attacker, defender, combatMode } = state;
  const attackerHasTroops = attacker.troops.some(({ amount }) => amount > 0);

  if (!attackerHasTroops) {
    return null;
  }

  // Traps only catch regular units
  const trapped = distributeTrappedUnits(
    attacker.troops.map((troop) =>
      troop.unitId === 'HERO' ? { ...troop, amount: 0 } : troop,
    ),
    defender.village.trapCount,
  );
  const freeAttackerTroops = attacker.troops.map((troop, index) => ({
    ...troop,
    amount: troop.amount - (trapped[index] ?? 0),
  }));

  const attackerHero = hasHero(attacker.troops) ? attacker.heroStats : null;
  const defenderHero = hasHero(defender.troops) ? defender.heroStats : null;

  const { flatDefence, defenceMultiplier } =
    defender.tribe === 'nature'
      ? { flatDefence: 0, defenceMultiplier: 1 }
      : calculateVillageDefenceModifiers({
          tribe: defender.tribe,
          wallLevel: defender.village.wallLevel,
          residenceLevel: defender.village.residenceLevel,
        });

  const runBattle = (
    battleFlatDefence: number,
    battleDefenceMultiplier: number,
  ) =>
    calculateBattle({
      attackers: toCombatUnits(
        freeAttackerTroops,
        attacker.tribe,
        attackerHero,
      ),
      defenders: [
        ...toCombatUnits(defender.troops, defender.tribe, defenderHero),
        ...defender.reinforcements.flatMap(({ troops, tribe }) =>
          toCombatUnits(troops, tribe, null),
        ),
      ],
      isRaid: combatMode === 'raid',
      attackMultiplier:
        calculateBreweryAttackMultiplier(attacker.village.breweryLevel) *
        calculateHeroBonusMultiplier(attackerHero?.attackBonus ?? 0),
      defenceMultiplier:
        battleDefenceMultiplier *
        calculateHeroBonusMultiplier(defenderHero?.defenceBonus ?? 0),
      flatDefence: battleFlatDefence,
    });

  let battle = runBattle(flatDefence, defenceMultiplier);
  const { wallLevel } = defender.village;
  let wallLevelAfter: number | null = null;

  // Rams only work in normal attacks
  const rams = freeAttackerTroops.filter(
    ({ unitId, amount }) =>
      unitId !== 'HERO' &&
      amount > 0 &&
      getUnitDefinition(unitId).tier === 'siege-ram',
  );
  let ramAmount = 0;

  for (const { amount } of rams) {
    ramAmount += amount;
  }

  if (
    combatMode === 'attack' &&
    ramAmount > 0 &&
    wallLevel > 0 &&
    defender.tribe !== 'nature'
  ) {
    const ramUpgradeLevel = rams[0]!.smithyImprovementLevel;
    const ratio = () =>
      battle.defenderPoints > 0
        ? battle.attackerPoints / battle.defenderPoints
        : Number.POSITIVE_INFINITY;

    const inBattleWallLevel = calculateInBattleWallLevel(
      wallLevel,
      calculateDemolitionPoints(ramAmount, ramUpgradeLevel, ratio()),
      getWallDurabilityByTribe(defender.tribe),
    );
    const currentWall = getWallDefenceAtLevel(defender.tribe, wallLevel);
    const inBattleWall = getWallDefenceAtLevel(
      defender.tribe,
      inBattleWallLevel,
    );

    battle = runBattle(
      flatDefence - currentWall.base + inBattleWall.base,
      (defenceMultiplier / currentWall.bonus) * inBattleWall.bonus,
    );

    wallLevelAfter = calculateLevelAfterDemolition(
      wallLevel,
      calculateDemolitionPoints(ramAmount, ramUpgradeLevel, ratio()),
    );
  }

  return {
    attackerPoints: battle.attackerPoints,
    defenderPoints: battle.defenderPoints,
    hasAttackerWon: battle.hasAttackerWon,
    wallLevelAfter,
    attacker: toUnitResults(attacker.troops, battle.attackerLossRatio, trapped),
    defender: toUnitResults(defender.troops, battle.defenderLossRatio),
    reinforcements: defender.reinforcements.map(({ troops }) =>
      toUnitResults(troops, battle.defenderLossRatio),
    ),
    attackerHeroDamage: attackerHero
      ? Math.min(attackerHero.hp, Math.round(battle.attackerLossRatio * 100))
      : null,
    defenderHeroDamage: defenderHero
      ? Math.min(defenderHero.hp, Math.round(battle.defenderLossRatio * 100))
      : null,
  };
};
