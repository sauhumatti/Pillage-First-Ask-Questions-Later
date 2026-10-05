import { describe, expect, test } from 'vitest';
import {
  calculateBreweryAttackMultiplier,
  calculateHeroBonusMultiplier,
  calculateHeroFightingStrength,
  calculateVillageDefenceModifiers,
  createCombatUnit,
  distributeTrappedUnits,
} from '../combat';

describe(calculateVillageDefenceModifiers, () => {
  test('an unfortified village only has basic defence', () => {
    expect(
      calculateVillageDefenceModifiers({
        tribe: 'romans',
        wallLevel: 0,
        residenceLevel: 0,
      }),
    ).toStrictEqual({ flatDefence: 10, defenceMultiplier: 1 });
  });

  test('uses the wall of the defending tribe', () => {
    expect(
      calculateVillageDefenceModifiers({
        tribe: 'romans',
        wallLevel: 15,
        residenceLevel: 0,
      }).defenceMultiplier,
    ).toBe(1.56);
  });

  test('residence adds 2 · level² defence', () => {
    expect(
      calculateVillageDefenceModifiers({
        tribe: 'gauls',
        wallLevel: 0,
        residenceLevel: 6,
      }).flatDefence,
    ).toBe(10 + 72);
  });
});

describe(calculateBreweryAttackMultiplier, () => {
  test('adds 1% attack per level', () => {
    expect(calculateBreweryAttackMultiplier(0)).toBe(1);
    expect(calculateBreweryAttackMultiplier(20)).toBe(1.2);
  });
});

describe(calculateHeroFightingStrength, () => {
  test('roman heroes get 100 strength per point', () => {
    expect(calculateHeroFightingStrength('romans', 10)).toBe(1100);
  });

  test('other heroes get 80 strength per point, plus item power', () => {
    expect(calculateHeroFightingStrength('gauls', 10, 500)).toBe(1380);
  });
});

describe(calculateHeroBonusMultiplier, () => {
  test('each point adds 0.2%', () => {
    expect(calculateHeroBonusMultiplier(100)).toBeCloseTo(1.2, 10);
  });
});

describe(createCombatUnit, () => {
  test('applies smithy upgrades to every stat', () => {
    const unit = createCombatUnit('CLUBSWINGER', 1, 20);

    expect(unit.attack).toBeCloseTo(52.4048, 3);
    expect(unit.isCavalry).toBe(false);
  });
});

describe(distributeTrappedUnits, () => {
  test('captures nothing without traps', () => {
    expect(
      distributeTrappedUnits([{ unitId: 'PHALANX', amount: 10 }], 0),
    ).toStrictEqual([0]);
  });

  test('cannot capture more units than attack', () => {
    expect(
      distributeTrappedUnits([{ unitId: 'PHALANX', amount: 10 }], 50),
    ).toStrictEqual([10]);
  });

  test('spreads captures across unit types and hands out the remainder', () => {
    expect(
      distributeTrappedUnits(
        [
          { unitId: 'PHALANX', amount: 10 },
          { unitId: 'SWORDSMAN', amount: 5 },
        ],
        8,
      ),
    ).toStrictEqual([6, 2]);
  });
});
