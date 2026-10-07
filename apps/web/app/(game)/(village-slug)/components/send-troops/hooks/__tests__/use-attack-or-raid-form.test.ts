// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { beforeEach, expect, test, vi } from 'vitest';
import type { z } from 'zod';
import type { attackOrRaidFormSchema } from '../../utils/schema';
import { useAttackOrRaidForm } from '../use-attack-or-raid-form';

type FormValues = z.infer<typeof attackOrRaidFormSchema>;
const mocks = vi.hoisted(() => ({ sendTroops: vi.fn(), validate: vi.fn() }));
vi.mock('app/(game)/(village-slug)/hooks/use-village-troops', () => ({
  useVillageTroops: () => ({ sendTroops: mocks.sendTroops }),
}));
vi.mock('app/(game)/(village-slug)/hooks/use-server', () => ({
  useServer: () => ({ mapSize: 100 }),
}));
vi.mock('app/(game)/(village-slug)/hooks/use-tribe', () => ({
  useTribe: () => 'gauls',
}));
vi.mock('../use-catapult-targets', () => ({
  useCatapultTargets: () => ({
    catapultTargetBuildingIds: [],
    getCatapultConfirmationOption: () => null,
  }),
}));
vi.mock('../use-troop-form', () => ({
  useTroopForm: () => {
    const form = useForm<FormValues>();
    return {
      form,
      resetForm: () => form.reset(),
      validateTroopMovementAsync: mocks.validate,
      getBaseEventArgs: (data: FormValues) => ({
        troops: data.units
          .filter((u) => u.selected > 0)
          .map((u) => ({
            unitId: u.unitId,
            amount: u.selected,
            tileId: 1,
            sourceTileId: 1,
          })),
        targetTileId: data.target.tileId,
      }),
    };
  },
}));
const values: FormValues = {
  action: 'attack',
  target: { tileId: 2 },
  units: [
    {
      unitId: 'PHALANX',
      selected: 3,
      available: 3,
      tier: 'tier-1',
      category: 'infantry',
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.validate.mockResolvedValue(true);
});

test.each(['attack', 'raid'] as const)(
  'validates and confirms a %s before dispatching troops',
  async (action) => {
    const { result } = renderHook(() => useAttackOrRaidForm());
    act(() => result.current.form.reset({ ...values, action }));
    await act(async () =>
      result.current.onFormSubmit(result.current.form.getValues()),
    );
    expect(mocks.validate).toHaveBeenCalledWith(
      expect.objectContaining({ action }),
      action,
    );
    expect(result.current.isConfirmationStepOpen).toBe(true);
    expect(mocks.sendTroops).not.toHaveBeenCalled();
    act(() => result.current.onConfirm());
    expect(mocks.sendTroops).toHaveBeenCalledWith(
      {
        type: action === 'attack' ? 'troopMovementAttack' : 'troopMovementRaid',
        targetTileId: 2,
        troops: [{ unitId: 'PHALANX', amount: 3, tileId: 1, sourceTileId: 1 }],
      },
      expect.any(Object),
    );
  },
);
test('does not allow confirmation when destination validation fails', async () => {
  mocks.validate.mockResolvedValue(false);
  const { result } = renderHook(() => useAttackOrRaidForm());
  act(() => result.current.form.reset(values));
  await act(async () => result.current.onFormSubmit(values));
  expect(result.current.isConfirmationStepOpen).toBe(false);
  act(() => result.current.onConfirm());
  expect(mocks.sendTroops).not.toHaveBeenCalled();
});
test('a hero raiding an oasis is not offered the unsupported test capture action', async () => {
  const { result } = renderHook(() =>
    useAttackOrRaidForm({ action: 'raid', isTargetUnoccupiedOasis: true }),
  );
  const data: FormValues = {
    ...values,
    action: 'raid',
    units: [
      {
        unitId: 'HERO',
        selected: 1,
        available: 1,
        tier: 'hero',
        category: 'hero',
      },
    ],
  };
  act(() => result.current.form.reset(data));
  await act(async () => result.current.onFormSubmit(data));
  expect(result.current.confirmationOption).toBeNull();
  expect(
    result.current.formData.current?.heroOasisAnimalAction,
  ).toBeUndefined();
});
