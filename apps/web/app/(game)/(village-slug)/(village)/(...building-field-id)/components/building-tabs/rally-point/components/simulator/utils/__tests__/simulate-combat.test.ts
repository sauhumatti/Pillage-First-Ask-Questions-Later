import { describe, expect, test } from 'vitest';
import type {
  CombatSimulatorHeroStats,
  CombatSimulatorState,
} from '../../providers/combat-simulator-context';
import { simulateCombat } from '../simulate-combat';

const heroStats: CombatSimulatorHeroStats = {
  hp: 100,
  strength: 0,
  attackBonus: 0,
  defenceBonus: 0,
  mounted: false,
  itemIdsBySlot: {},
};

const createState = (
  overrides: Partial<CombatSimulatorState> = {},
): CombatSimulatorState => ({
  combatMode: 'attack',
  playerRole: 'attacker',
  attacker: {
    tribe: 'romans',
    troops: [],
    heroStats,
    village: { breweryLevel: 0 },
  },
  defender: {
    tribe: 'gauls',
    troops: [],
    heroStats,
    village: { wallLevel: 0, residenceLevel: 0, trapCount: 0 },
    reinforcements: [],
  },
  ...overrides,
});

describe(simulateCombat, () => {
  test('returns null without attacking troops', () => {
    expect(simulateCombat(createState())).toBeNull();
  });

  test('matches the documented imperian attack', () => {
    const state = createState();
    state.attacker.troops = [
      { unitId: 'IMPERIAN', amount: 100, smithyImprovementLevel: 0 },
      { unitId: 'LEGIONNAIRE', amount: 50, smithyImprovementLevel: 0 },
    ];
    state.defender.troops = [
      { unitId: 'PHALANX', amount: 150, smithyImprovementLevel: 0 },
    ];

    const result = simulateCombat(state)!;

    expect(result.hasAttackerWon).toBe(true);
    expect(result.attackerPoints).toBe(9000);
    // Basic village defence of 10 is included
    expect(result.defenderPoints).toBe(6010);
    expect(result.defender).toStrictEqual([
      {
        unitId: 'PHALANX',
        amountBefore: 150,
        amountTrapped: 0,
        amountLost: 150,
        amountAfter: 0,
      },
    ]);
  });

  test('a wall makes the defender win', () => {
    const state = createState();
    state.attacker.troops = [
      { unitId: 'SWORDSMAN', amount: 150, smithyImprovementLevel: 0 },
    ];
    state.attacker.tribe = 'gauls';
    state.defender.tribe = 'romans';
    state.defender.troops = [
      { unitId: 'PRAETORIAN', amount: 100, smithyImprovementLevel: 0 },
      { unitId: 'LEGIONNAIRE', amount: 25, smithyImprovementLevel: 0 },
    ];
    state.defender.village.wallLevel = 15;

    const result = simulateCombat(state)!;

    expect(result.hasAttackerWon).toBe(false);
    expect(result.attacker[0]!.amountAfter).toBe(0);
  });

  test('trapped units do not fight', () => {
    const state = createState();
    state.attacker.troops = [
      { unitId: 'LEGIONNAIRE', amount: 10, smithyImprovementLevel: 0 },
    ];
    state.defender.village.trapCount = 4;

    const result = simulateCombat(state)!;

    expect(result.attackerPoints).toBe(6 * 40);
    expect(result.attacker[0]!.amountTrapped).toBe(4);
  });

  test('an attacking hero adds fighting strength and takes damage instead of dying', () => {
    const state = createState();
    state.attacker.troops = [
      { unitId: 'HERO', amount: 1, smithyImprovementLevel: 0 },
    ];
    state.attacker.heroStats = { ...heroStats, strength: 1 };
    state.defender.troops = [
      { unitId: 'PHALANX', amount: 1, smithyImprovementLevel: 0 },
    ];

    const result = simulateCombat(state)!;

    // Roman hero: 100 + 100 · 1 strength
    expect(result.attackerPoints).toBe(200);
    expect(result.attacker).toStrictEqual([]);
    expect(result.attackerHeroDamage).toBeGreaterThan(0);
  });

  test('brewery and hero attack bonus multiply offence', () => {
    const state = createState();
    state.attacker.tribe = 'teutons';
    state.attacker.troops = [
      { unitId: 'CLUBSWINGER', amount: 100, smithyImprovementLevel: 0 },
      { unitId: 'HERO', amount: 1, smithyImprovementLevel: 0 },
    ];
    state.attacker.heroStats = { ...heroStats, attackBonus: 50 };
    state.attacker.village.breweryLevel = 10;

    const result = simulateCombat(state)!;

    // (100 · 40 + 80) · 1.1 · 1.1
    expect(result.attackerPoints).toBe(Math.round(4080 * 1.1 * 1.1));
  });

  test('rams lower the wall in a normal attack but not in a raid', () => {
    const state = createState();
    state.attacker.troops = [
      { unitId: 'IMPERIAN', amount: 2000, smithyImprovementLevel: 0 },
      { unitId: 'ROMAN_RAM', amount: 200, smithyImprovementLevel: 0 },
    ];
    state.defender.village.wallLevel = 20;

    expect(simulateCombat(state)!.wallLevelAfter).toBeLessThan(20);
    expect(
      simulateCombat({ ...state, combatMode: 'raid' })!.wallLevelAfter,
    ).toBeNull();
  });
});
