import type { Server } from '@pillage-first/types/models/server';
import type { UnitId } from '@pillage-first/types/models/unit';

/**
 * Calculates loyalty increase frequency.
 * Loyalty increases by 1 every 60 minutes, scaled with game world speed.
 */
export const calculateLoyaltyIncreaseEventDuration = (
  serverSpeed: Server['configuration']['speed'],
): number => {
  const baseFrequencyMinutes = 60;
  return Math.trunc((baseFrequencyMinutes / serverSpeed) * 60 * 1000);
};

// How much loyalty each surviving administrator removes, inclusive range
const chiefLoyaltyReductionRanges = new Map<UnitId, [number, number]>([
  ['ROMAN_CHIEF', [20, 30]],
  ['HUN_CHIEF', [15, 30]],
]);

const DEFAULT_CHIEF_LOYALTY_REDUCTION_RANGE: [number, number] = [20, 25];

export const getChiefLoyaltyReductionRange = (
  unitId: UnitId,
): [number, number] => {
  return (
    chiefLoyaltyReductionRanges.get(unitId) ??
    DEFAULT_CHIEF_LOYALTY_REDUCTION_RANGE
  );
};

export const rollChiefLoyaltyReduction = (
  unitId: UnitId,
  random: () => number = Math.random,
): number => {
  const [min, max] = getChiefLoyaltyReductionRange(unitId);

  return min + Math.floor(random() * (max - min + 1));
};
