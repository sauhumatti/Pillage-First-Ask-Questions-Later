import { describe, expect, test } from 'vitest';
import {
  BASIC_VILLAGE_DEFENCE,
  type CombatUnit,
  calculateBattle,
  calculateLossExponent,
  calculateSmithyImprovedValue,
  calculateUnitLosses,
} from '../combat';

const unit = (
  attack: number,
  infantryDefence: number,
  cavalryDefence: number,
  amount: number,
  isCavalry = false,
): CombatUnit => ({
  attack,
  infantryDefence,
  cavalryDefence,
  isCavalry,
  amount,
});

const imperians = (amount: number) => unit(70, 40, 25, amount);
const legionnaires = (amount: number) => unit(40, 35, 50, amount);
const praetorians = (amount: number) => unit(30, 65, 35, amount);
const phalanxes = (amount: number) => unit(15, 40, 50, amount);
const swordsmen = (amount: number) => unit(65, 35, 20, amount);
const theutatesThunders = (amount: number) => unit(100, 25, 40, amount, true);
const haeduans = (amount: number) => unit(140, 50, 165, amount, true);

// Examples are taken from docs/game-design/COMBAT_MECHANICS.md
describe('calculateBattle', () => {
  test('normal attack, attacker wins', () => {
    const result = calculateBattle({
      attackers: [imperians(100), legionnaires(50)],
      defenders: [phalanxes(150)],
      isRaid: false,
    });

    expect(result.attackerPoints).toBe(9000);
    expect(result.defenderPoints).toBe(6000);
    expect(result.hasAttackerWon).toBe(true);
    expect(result.attackerLossRatio).toBeCloseTo(0.5443, 4);
    expect(result.defenderLossRatio).toBe(1);
    expect(calculateUnitLosses(100, result.attackerLossRatio)).toBe(54);
    expect(calculateUnitLosses(50, result.attackerLossRatio)).toBe(27);
  });

  test('raid, attacker wins', () => {
    const result = calculateBattle({
      attackers: [imperians(100)],
      defenders: [praetorians(100)],
      isRaid: true,
    });

    expect(result.hasAttackerWon).toBe(true);
    expect(result.attackerLossRatio).toBeCloseTo(0.4722, 4);
    expect(result.defenderLossRatio).toBeCloseTo(0.5278, 4);
    expect(calculateUnitLosses(100, result.attackerLossRatio)).toBe(47);
    expect(calculateUnitLosses(100, result.defenderLossRatio)).toBe(53);
  });

  test('large battles use a smaller loss exponent', () => {
    const result = calculateBattle({
      attackers: [haeduans(2000)],
      defenders: [phalanxes(1400)],
      isRaid: false,
    });

    expect(result.attackerPoints).toBe(280_000);
    expect(result.defenderPoints).toBe(70_000);
    expect(calculateUnitLosses(2000, result.attackerLossRatio)).toBe(265);
  });

  test('defence is weighted by the infantry/cavalry split of the attack', () => {
    const result = calculateBattle({
      attackers: [theutatesThunders(100), swordsmen(50)],
      defenders: [praetorians(100)],
      isRaid: false,
    });

    expect(result.attackerPoints).toBe(13_250);
    expect(result.defenderPoints).toBe(4236);
    expect(result.attackerLossRatio).toBeCloseTo(0.1808, 3);
    expect(calculateUnitLosses(100, result.attackerLossRatio)).toBe(18);
    expect(calculateUnitLosses(50, result.attackerLossRatio)).toBe(9);
  });

  test('wall bonus lets the defender win', () => {
    const result = calculateBattle({
      attackers: [swordsmen(150)],
      defenders: [praetorians(100), legionnaires(25)],
      isRaid: false,
      defenceMultiplier: 1.03 ** 15,
    });

    expect(result.hasAttackerWon).toBe(false);
    expect(result.attackerLossRatio).toBe(1);
    expect(result.defenderLossRatio).toBeCloseTo(0.7817, 3);
    expect(calculateUnitLosses(100, result.defenderLossRatio)).toBe(78);
    expect(calculateUnitLosses(25, result.defenderLossRatio)).toBe(20);
  });

  test('basic village defence kills nothing against 2 phalanxes', () => {
    const result = calculateBattle({
      attackers: [phalanxes(2)],
      defenders: [],
      isRaid: false,
      flatDefence: BASIC_VILLAGE_DEFENCE,
    });

    expect(result.hasAttackerWon).toBe(true);
    expect(calculateUnitLosses(2, result.attackerLossRatio)).toBe(0);
  });

  test('wall boosts basic village defence enough to kill a phalanx', () => {
    const result = calculateBattle({
      attackers: [phalanxes(2)],
      defenders: [],
      isRaid: false,
      flatDefence: BASIC_VILLAGE_DEFENCE,
      defenceMultiplier: 1.03 ** 5,
    });

    expect(calculateUnitLosses(2, result.attackerLossRatio)).toBe(1);
  });

  test('residence and wall bonus', () => {
    const result = calculateBattle({
      attackers: [phalanxes(15)],
      defenders: [],
      isRaid: false,
      flatDefence: BASIC_VILLAGE_DEFENCE + 2 * 6 ** 2,
      defenceMultiplier: 1.03 ** 6,
    });

    expect(result.defenderPoints).toBe(98);
    expect(calculateUnitLosses(15, result.attackerLossRatio)).toBe(4);
  });

  test('a lone weak attacker always dies', () => {
    const result = calculateBattle({
      attackers: [imperians(1)],
      defenders: [],
      isRaid: true,
      flatDefence: BASIC_VILLAGE_DEFENCE,
    });

    expect(result.hasAttackerWon).toBe(true);
    expect(result.attackerLossRatio).toBe(1);
  });

  test('a lone hero is exempt from the lone attacker rule', () => {
    const result = calculateBattle({
      attackers: [{ ...unit(80, 80, 80, 1), isHero: true }],
      defenders: [],
      isRaid: true,
      flatDefence: BASIC_VILLAGE_DEFENCE,
    });

    expect(result.attackerLossRatio).toBeLessThan(1);
  });

  test('a lone strong attacker survives an empty village', () => {
    const result = calculateBattle({
      attackers: [haeduans(1)],
      defenders: [],
      isRaid: true,
      flatDefence: BASIC_VILLAGE_DEFENCE,
    });

    expect(calculateUnitLosses(1, result.attackerLossRatio)).toBe(0);
  });

  test('attack multiplier scales offence', () => {
    const result = calculateBattle({
      attackers: [imperians(10)],
      defenders: [],
      isRaid: false,
      attackMultiplier: 1.1,
    });

    expect(result.attackerPoints).toBe(770);
  });

  test('defender wins ties', () => {
    const result = calculateBattle({
      attackers: [imperians(10)],
      defenders: [unit(0, 70, 70, 10)],
      isRaid: false,
    });

    expect(result.hasAttackerWon).toBe(false);
    expect(result.attackerLossRatio).toBe(1);
    expect(result.defenderLossRatio).toBe(1);
  });

  test('attacking with no units causes no losses', () => {
    const result = calculateBattle({
      attackers: [],
      defenders: [phalanxes(10)],
      isRaid: false,
    });

    expect(result.attackerLossRatio).toBe(0);
    expect(result.defenderLossRatio).toBe(0);
  });
});

describe('calculateLossExponent', () => {
  test('is 1.5 for small battles', () => {
    expect(calculateLossExponent(1000)).toBe(1.5);
  });

  test('matches the documented value for 3400 units', () => {
    expect(calculateLossExponent(3400)).toBeCloseTo(1.459, 3);
  });

  test('never drops below the minimum', () => {
    expect(calculateLossExponent(1e15)).toBe(1.2578);
  });
});

describe('calculateSmithyImprovedValue', () => {
  test('level 0 returns the base value', () => {
    expect(calculateSmithyImprovedValue(40, 1, 0)).toBe(40);
  });

  test('matches the documented clubswinger value at level 20', () => {
    expect(calculateSmithyImprovedValue(40, 1, 20)).toBeCloseTo(52.4048, 3);
  });
});
