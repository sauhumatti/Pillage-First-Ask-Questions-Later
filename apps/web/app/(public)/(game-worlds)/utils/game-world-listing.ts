import type { Server } from '@pillage-first/types/models/server';
import { availableServerCacheKey } from 'app/(public)/constants/query-keys';
import { isGameServerMode, listServerGameWorlds } from 'app/utils/game-server';

export const getGameWorldListing = async (): Promise<Server[]> => {
  if (typeof window === 'undefined') {
    return [];
  }

  if (isGameServerMode) {
    return listServerGameWorlds();
  }

  try {
    return JSON.parse(
      window.localStorage.getItem(availableServerCacheKey) ?? '[]',
    );
  } catch {
    return [];
  }
};
