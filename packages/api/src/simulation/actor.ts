let playerId = 1;
export const getActingPlayerId = (): number => playerId;
// Scoped synchronous engine execution: never keep an actor bound across an await.
export const withActingPlayer = <T>(id: number, action: () => T): T => {
  const previous = playerId;
  playerId = id;
  try {
    return action();
  } finally {
    playerId = previous;
  }
};
