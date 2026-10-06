import type { Server } from '@pillage-first/types/models/server';
import { env } from '@pillage-first/utils/env';
import {
  deserializeError,
  OutdatedDatabaseSchemaError,
} from '@pillage-first/utils/errors';

// When the app is built with VITE_GAME_SERVER=true, game worlds live on the
// Pillage First! game server (apps/server) instead of in the browser's storage.
export const isGameServerMode = env.IS_GAME_SERVER;

export const LOGIN_REQUIRED_EVENT = 'pillage-first:login-required';

export const gameServerFetch = async (
  path: string,
  init: RequestInit = {},
): Promise<Response> => {
  const response = await fetch(`/api/${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'X-Pillage-First': '1',
      ...init.headers,
    },
  });

  if (response.status === 401) {
    window.dispatchEvent(new Event(LOGIN_REQUIRED_EVENT));
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);

    if (body?.error?.name === OutdatedDatabaseSchemaError.name) {
      throw new OutdatedDatabaseSchemaError();
    }

    throw body?.error
      ? deserializeError(body.error)
      : new Error(`Game server request failed (${response.status})`);
  }

  return response;
};

export const gameServerJson = async <T>(
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await gameServerFetch(path, {
    ...init,
    headers: {
      ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });

  return (response.status === 204 ? undefined : await response.json()) as T;
};

export const listServerGameWorlds = (): Promise<Server[]> =>
  gameServerJson<Server[]>('worlds');

export const createServerGameWorld = (server: Server): Promise<Server> =>
  gameServerJson<Server>('worlds', {
    method: 'POST',
    body: JSON.stringify({ server }),
  });

export const deleteServerGameWorld = async (
  slug: Server['slug'],
): Promise<void> => {
  await gameServerFetch(`worlds/${slug}`, { method: 'DELETE' });
};

export const exportServerGameWorld = async (
  slug: Server['slug'],
): Promise<ArrayBuffer> => {
  const response = await gameServerFetch(`worlds/${slug}/export`);
  return response.arrayBuffer();
};

export const importServerGameWorld = (
  databaseBuffer: ArrayBuffer | Blob,
): Promise<Server> =>
  gameServerJson<Server>('worlds/import', {
    method: 'POST',
    body: databaseBuffer,
    headers: { 'Content-Type': 'application/x-sqlite3' },
  });
