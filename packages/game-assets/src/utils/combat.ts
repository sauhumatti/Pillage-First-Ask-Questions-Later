import type { Building } from '@pillage-first/types/models/building';
import type { EffectId } from '@pillage-first/types/models/effect';
import type { Tribe } from '@pillage-first/types/models/tribe';
import type { TroopLike } from '@pillage-first/types/models/troop';
import type { UnitId } from '@pillage-first/types/models/unit';
import {
  BASIC_VILLAGE_DEFENCE,
  type CombatUnit,
  calculateSmithyImprovedValue,
} from '@pillage-first/utils/game/combat';
import { getBuildingDefinition } from './buildings';
import { getUnitDefinition } from './units';

const tribeToWallBuildingId = new Map<Tribe, Building['id']>([
  ['romans', 'ROMAN_WALL'],
  ['gauls', 'GAUL_WALL'],
  ['teutons', 'TEUTONIC_WALL'],
  ['huns', 'HUN_WALL'],
  ['egyptians', 'EGYPTIAN_WALL'],
  ['spartans', 'SPARTAN_WALL'],
  ['natars', 'NATAR_WALL'],
  ['nature', 'NATURE_WALL'],
]);

export const getWallBuildingIdByTribe = (tribe: Tribe): Building['id'] => {
  return tribeToWallBuildingId.get(tribe)!;
};

const getBuildingEffectValue = (
  buildingId: Building['id'],
  tribe: Tribe,
  effectId: EffectId,
  type: 'base' | 'bonus',
  level: number,
): number | null => {
  const effect = getBuildingDefinition(buildingId)
    .effects(tribe)
    .find((effect) => effect.effectId === effectId && effect.type === type);

  if (!effect) {
    return null;
  }

  const clampedLevel = Math.min(
    Math.max(0, level),
    effect.valuesPerLevel.length - 1,
  );

  return effect.valuesPerLevel[clampedLevel] ?? null;
};

type VillageDefenceModifiersArgs = {
  tribe: Tribe;
  wallLevel: number;
  residenceLevel: number;
};

// Walls and the residence give the same bonus against infantry and cavalry
export const calculateVillageDefenceModifiers = ({
  tribe,
  wallLevel,
  residenceLevel,
}: VillageDefenceModifiersArgs) => {
  const wallBuildingId = getWallBuildingIdByTribe(tribe);

  const wallBase =
    getBuildingEffectValue(
      wallBuildingId,
      tribe,
      'infantryDefence',
      'base',
      wallLevel,
    ) ?? 0;
  const wallBonus =
    getBuildingEffectValue(
      wallBuildingId,
      tribe,
      'infantryDefence',
      'bonus',
      wallLevel,
    ) ?? 1;
  const residenceBase =
    getBuildingEffectValue(
      'RESIDENCE',
      tribe,
      'infantryDefence',
      'base',
      residenceLevel,
    ) ?? 0;

  return {
    flatDefence: BASIC_VILLAGE_DEFENCE + wallBase + residenceBase,
    defenceMultiplier: wallBonus,
  };
};

export const calculateBreweryAttackMultiplier = (
  breweryLevel: number,
): number => {
  return (
    getBuildingEffectValue(
      'BREWERY',
      'teutons',
      'attack',
      'bonus',
      breweryLevel,
    ) ?? 1
  );
};

const getHeroStrengthPerPoint = (tribe: Tribe): number => {
  return tribe === 'romans' ? 100 : 80;
};

// Fighting strength is used for both offence and defence
export const calculateHeroFightingStrength = (
  tribe: Tribe,
  strengthPoints: number,
  itemPowerBonus = 0,
): number => {
  const strengthPerPoint = getHeroStrengthPerPoint(tribe);

  return strengthPerPoint + strengthPerPoint * strengthPoints + itemPowerBonus;
};

// Each attack or defence bonus point adds 0.2%
export const calculateHeroBonusMultiplier = (bonusPoints: number): number => {
  return 1 + bonusPoints * 0.002;
};

export const createHeroCombatUnit = (
  fightingStrength: number,
  isMounted: boolean,
): CombatUnit => {
  return {
    attack: fightingStrength,
    infantryDefence: fightingStrength,
    cavalryDefence: fightingStrength,
    isCavalry: isMounted,
    amount: 1,
    isHero: true,
  };
};

export const createCombatUnit = (
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

// Traps capture attacking units before the battle, spread evenly across unit types.
// Returns the amount trapped for each troop entry, in the same order.
export const distributeTrappedUnits = (
  troops: TroopLike[],
  trapCount: number,
): number[] => {
  let total = 0;

  for (const { amount } of troops) {
    total += amount;
  }

  if (total === 0 || trapCount <= 0) {
    return troops.map(() => 0);
  }

  const capturedTotal = Math.min(total, trapCount);
  const trapped = troops.map(({ amount }) =>
    Math.floor((amount * capturedTotal) / total),
  );

  let remaining = capturedTotal;

  for (const amount of trapped) {
    remaining -= amount;
  }

  // Hand out units lost to rounding, largest groups first
  const order = troops
    .map(({ amount }, index) => ({ index, free: amount - trapped[index]! }))
    .sort((a, b) => b.free - a.free);

  for (const { index, free } of order) {
    if (remaining === 0) {
      break;
    }

    if (free > 0) {
      trapped[index] = trapped[index]! + 1;
      remaining -= 1;
    }
  }

  return trapped;
};
