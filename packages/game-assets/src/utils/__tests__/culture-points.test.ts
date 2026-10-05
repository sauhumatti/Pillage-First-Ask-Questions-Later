import { describe, expect, test } from 'vitest';
import { calculateExpansionSlotsForResidenceLevel } from '../culture-points';

describe(calculateExpansionSlotsForResidenceLevel, () => {
  test.each([
    [0, 0],
    [9, 0],
    [10, 1],
    [19, 1],
    [20, 2],
  ])('residence level %i gives %i slots', (level, slots) => {
    expect(calculateExpansionSlotsForResidenceLevel(level)).toBe(slots);
  });
});
