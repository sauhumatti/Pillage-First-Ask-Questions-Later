// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PLAYER_ID } from '@pillage-first/game-assets/player';
import type { Tile } from '@pillage-first/types/models/tile';
import { Dialog } from 'app/components/ui/dialog';
import { TileDialog } from '../tile-modal';

vi.mock(
  'app/(game)/(village-slug)/hooks/current-village/use-current-village',
  () => ({
    useCurrentVillage: () => ({
      currentVillage: { tileId: 1, coordinates: { x: 0, y: 0 } },
    }),
  }),
);
vi.mock('app/(game)/(village-slug)/hooks/routes/use-game-navigation', () => ({
  useGameNavigation: () => ({ getVillageBasePath: () => '/village' }),
}));
vi.mock('app/(game)/(village-slug)/hooks/use-reputations', () => ({
  useReputations: () => ({
    getReputation: () => ({ reputationLevel: 'neutral' }),
  }),
}));
vi.mock('app/(game)/(village-slug)/(map)/hooks/use-oasis-bonuses', () => ({
  useOasisBonuses: () => ({ oasisBonuses: [] }),
}));
vi.mock('app/(game)/(village-slug)/(map)/hooks/use-tile-troops', () => ({
  useTileTroops: () => ({ tileTroops: [] }),
}));
vi.mock(
  'app/(game)/(village-slug)/(village)/(...building-field-id)/components/building-tabs/marketplace/hooks/use-marketplace-merchants',
  () => ({
    useMarketplaceMerchants: () => ({
      marketplaceLevel: 0,
      availableMerchantAmount: 0,
    }),
  }),
);
vi.mock('app/components/icon', () => ({ Icon: () => null }));

const owner = {
  id: PLAYER_ID + 1,
  name: 'Opponent',
  slug: 'opponent',
  tribe: 'gauls',
  faction: 'player',
} as const;
const village = {
  id: 2,
  name: 'Opponent village',
  slug: 'v-2',
  population: 20,
};
const location = { id: 2, coordinates: { x: 1, y: 0 } };
const enemyVillage: Tile = {
  ...location,
  type: 'free',
  attributes: { resourceFieldComposition: '4446' },
  owner,
  ownerVillage: village,
};
const oasis: Tile = {
  ...location,
  type: 'oasis',
  attributes: { oasisGraphics: 1, bonusType: 1 },
  owner: null,
  ownerVillage: null,
};

const renderTile = (tile: Tile) => {
  const attack = vi.fn();
  render(
    <MemoryRouter>
      <Dialog open>
        <TileDialog
          tile={tile}
          mapMarkers={[]}
          createMapMarker={vi.fn()}
          deleteMapMarker={vi.fn()}
          onAttackOrRaid={attack}
          onFoundNewVillage={vi.fn()}
          onReinforceVillage={vi.fn()}
          onSendResources={vi.fn()}
        />
      </Dialog>
    </MemoryRouter>,
  );
  return attack;
};

afterEach(cleanup);

describe('map offensive actions', () => {
  test('opens an attack against an enemy village', () => {
    const attack = renderTile(enemyVillage);
    fireEvent.click(screen.getByRole('button', { name: 'Attack or raid' }));
    expect(attack).toHaveBeenCalledWith(enemyVillage);
  });
  test('does not offer an attack against your own village', () => {
    renderTile({ ...enemyVillage, owner: { ...owner, id: PLAYER_ID } });
    expect(screen.queryByRole('button', { name: 'Attack or raid' })).toBeNull();
  });
  test.each([oasis, { ...oasis, owner, ownerVillage: village }])(
    'opens a raid against an unoccupied or enemy oasis',
    (tile) => {
      const attack = renderTile(tile);
      fireEvent.click(screen.getByRole('button', { name: 'Raid oasis' }));
      expect(attack).toHaveBeenCalledWith(tile);
    },
  );
  test('does not offer a raid against your own oasis', () => {
    renderTile({
      ...oasis,
      owner: { ...owner, id: PLAYER_ID },
      ownerVillage: village,
    });
    expect(screen.queryByRole('button', { name: 'Raid oasis' })).toBeNull();
  });
  test('does not offer a raid against wilderness', () => {
    renderTile({ ...oasis, attributes: { oasisGraphics: 1, bonusType: null } });
    expect(screen.queryByRole('button', { name: 'Raid oasis' })).toBeNull();
  });
});
