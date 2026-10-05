import { describe, expect, test } from 'vitest';
import {
  calculateLoyaltyIncreaseEventDuration,
  rollChiefLoyaltyReduction,
} from '../loyalty';

describe(calculateLoyaltyIncreaseEventDuration, () => {
  test('should return 60 minutes for 1x speed', () => {
    expect(calculateLoyaltyIncreaseEventDuration(1)).toBe(60 * 60 * 1000);
  });

  test('should return 30 minutes for 2x speed', () => {
    expect(calculateLoyaltyIncreaseEventDuration(2)).toBe(30 * 60 * 1000);
  });

  test('should return 20 minutes for 3x speed', () => {
    expect(calculateLoyaltyIncreaseEventDuration(3)).toBe(20 * 60 * 1000);
  });
});

describe(rollChiefLoyaltyReduction, () => {
  test('senators remove 20 to 30 loyalty', () => {
    expect(rollChiefLoyaltyReduction('ROMAN_CHIEF', () => 0)).toBe(20);
    expect(rollChiefLoyaltyReduction('ROMAN_CHIEF', () => 0.9999)).toBe(30);
  });

  test('logades remove 15 to 30 loyalty', () => {
    expect(rollChiefLoyaltyReduction('HUN_CHIEF', () => 0)).toBe(15);
    expect(rollChiefLoyaltyReduction('HUN_CHIEF', () => 0.9999)).toBe(30);
  });

  test('other administrators remove 20 to 25 loyalty', () => {
    expect(rollChiefLoyaltyReduction('TEUTONIC_CHIEF', () => 0)).toBe(20);
    expect(rollChiefLoyaltyReduction('GAUL_CHIEF', () => 0.9999)).toBe(25);
  });
});
