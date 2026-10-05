// Battle formulas, as described in docs/game-design/COMBAT_MECHANICS.md

export type CombatUnit = {
  attack: number;
  infantryDefence: number;
  cavalryDefence: number;
  isCavalry: boolean;
  amount: number;
  // Heroes lose health instead of dying, so the lone attacker rule doesn't apply to them
  isHero?: boolean;
};

export type CalculateBattleArgs = {
  attackers: CombatUnit[];
  defenders: CombatUnit[];
  isRaid: boolean;
  // Multiplier applied to total offence (e.g. brewery, hero bonus)
  attackMultiplier?: number;
  // Multiplier applied to total defence, including flat defence (e.g. wall)
  defenceMultiplier?: number;
  // Defence added before the multiplier (basic village defence, residence/palace, wall base)
  flatDefence?: number;
};

export type CalculateBattleReturn = {
  attackerPoints: number;
  defenderPoints: number;
  hasAttackerWon: boolean;
  // Fraction (0-1) of each side's units that die
  attackerLossRatio: number;
  defenderLossRatio: number;
};

// Units with offence below this value die when attacking alone, regardless of the battle result
const LONE_ATTACKER_OFFENCE_THRESHOLD = 83;

const MIN_LOSS_EXPONENT = 1.2578;
const MAX_LOSS_EXPONENT = 1.5;

export const BASIC_VILLAGE_DEFENCE = 10;

export const calculateLossExponent = (totalUnitCount: number): number => {
  if (totalUnitCount <= 0) {
    return MAX_LOSS_EXPONENT;
  }

  const k = 2 * (1.8592 - totalUnitCount ** 0.015);

  return Math.min(MAX_LOSS_EXPONENT, Math.max(MIN_LOSS_EXPONENT, k));
};

// improved_value = BASE_VALUE + (BASE_VALUE + 300 · UPKEEP / 7) · (1.007^LEVEL – 1)
export const calculateSmithyImprovedValue = (
  baseValue: number,
  unitWheatConsumption: number,
  level: number,
): number => {
  if (level <= 0) {
    return baseValue;
  }

  return (
    baseValue +
    (baseValue + (300 * unitWheatConsumption) / 7) * (1.007 ** level - 1)
  );
};

export const calculateBattle = ({
  attackers,
  defenders,
  isRaid,
  attackMultiplier = 1,
  defenceMultiplier = 1,
  flatDefence = 0,
}: CalculateBattleArgs): CalculateBattleReturn => {
  let infantryOffence = 0;
  let cavalryOffence = 0;
  let attackerUnitCount = 0;

  for (const { attack, isCavalry, amount } of attackers) {
    if (isCavalry) {
      cavalryOffence += attack * amount;
    } else {
      infantryOffence += attack * amount;
    }
    attackerUnitCount += amount;
  }

  const rawOffence = infantryOffence + cavalryOffence;
  // Total points are whole numbers
  const attackerPoints = Math.round(rawOffence * attackMultiplier);

  // Defence is weighted by the infantry/cavalry split of the attacking army
  const cavalryShare = rawOffence > 0 ? cavalryOffence / rawOffence : 0;
  const infantryShare = 1 - cavalryShare;

  let troopDefence = 0;
  let defenderUnitCount = 0;

  for (const { infantryDefence, cavalryDefence, amount } of defenders) {
    troopDefence +=
      amount *
      (infantryShare * infantryDefence + cavalryShare * cavalryDefence);
    defenderUnitCount += amount;
  }

  const defenderPoints = Math.round(
    (troopDefence + flatDefence) * defenceMultiplier,
  );

  if (attackerUnitCount === 0) {
    return {
      attackerPoints,
      defenderPoints,
      hasAttackerWon: false,
      attackerLossRatio: 0,
      defenderLossRatio: 0,
    };
  }

  const hasAttackerWon = attackerPoints > defenderPoints;
  const winnerPoints = hasAttackerWon ? attackerPoints : defenderPoints;
  const loserPoints = hasAttackerWon ? defenderPoints : attackerPoints;

  const exponent = calculateLossExponent(attackerUnitCount + defenderUnitCount);
  const x = winnerPoints > 0 ? (loserPoints / winnerPoints) ** exponent : 0;

  const winnerLossRatio = isRaid ? x / (1 + x) : x;
  const loserLossRatio = isRaid ? 1 - winnerLossRatio : 1;

  let attackerLossRatio = hasAttackerWon ? winnerLossRatio : loserLossRatio;
  const defenderLossRatio = hasAttackerWon ? loserLossRatio : winnerLossRatio;

  const isLoneHero = attackers.some(
    ({ isHero, amount }) => isHero && amount > 0,
  );

  if (
    attackerUnitCount === 1 &&
    !isLoneHero &&
    rawOffence < LONE_ATTACKER_OFFENCE_THRESHOLD
  ) {
    attackerLossRatio = 1;
  }

  return {
    attackerPoints,
    defenderPoints,
    hasAttackerWon,
    attackerLossRatio,
    defenderLossRatio,
  };
};

// Losses are rounded for each unit type separately
export const calculateUnitLosses = (amount: number, lossRatio: number) => {
  return Math.min(amount, Math.round(amount * lossRatio));
};
