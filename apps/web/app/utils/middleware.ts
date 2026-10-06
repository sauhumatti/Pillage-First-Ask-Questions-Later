import type { RouterContextProvider } from 'react-router';
import { isGameServerMode, listServerGameWorlds } from 'app/utils/game-server';

export const isGameWorldLocked = async (
  context: Readonly<RouterContextProvider>,
  serverSlug: string,
): Promise<boolean> => {
  // On the game server a world can be open on several devices and tabs at once
  if (isGameServerMode) {
    return false;
  }

  const { sessionContext } = await import('app/context/session');

  const { sessionId } = context.get(sessionContext);

  const lockManager = await window.navigator.locks.query();

  const lock = lockManager.held!.find((lock) =>
    lock?.name?.startsWith(serverSlug),
  );

  if (!lock) {
    return false;
  }

  const [, lockSessionId] = lock.name!.split(':');

  if (!lockSessionId || lockSessionId === sessionId) {
    return false;
  }

  return true;
};

export const doesGameWorldExist = async (
  serverSlug: string,
): Promise<boolean> => {
  if (isGameServerMode) {
    try {
      const worlds = await listServerGameWorlds();
      return worlds.some(({ slug }) => slug === serverSlug);
    } catch {
      return false;
    }
  }

  try {
    const root = await navigator.storage.getDirectory();
    const rootHandle = await root.getDirectoryHandle(
      'pillage-first-ask-questions-later',
    );

    await rootHandle.getDirectoryHandle(serverSlug);
    return true;
  } catch {
    return false;
  }
};
