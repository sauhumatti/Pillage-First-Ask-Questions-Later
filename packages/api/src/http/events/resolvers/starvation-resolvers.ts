import type { GameEvent } from '@pillage-first/types/models/game-event';
import {
  createTroopStarvationEvent,
  starveTroopsAt,
} from '../../../utils/starvation';
import type { Resolver } from '../resolver';

export const troopStarvationResolver: Resolver<GameEvent<'troopStarvation'>> = (
  database,
  args,
) => {
  const { resolvesAt } = args;

  const affected = starveTroopsAt(database, resolvesAt);

  createTroopStarvationEvent(database, resolvesAt);

  return affected;
};
