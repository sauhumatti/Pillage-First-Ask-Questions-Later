import type { SerializedError } from '@pillage-first/types/api-events';
import type { Server } from '@pillage-first/types/models/server';

// Messages between the HTTP server (main thread) and a game world worker thread

export type WorldWorkerData =
  | { mode: 'run'; databasePath: string }
  | { mode: 'create'; databasePath: string; server: Server }
  | {
      mode: 'import';
      databasePath: string;
      databaseBuffer: Uint8Array;
      id: string;
      slug: string;
    };

export type GameApiRequest = {
  url: string;
  method: string;
  body: unknown;
};

export type MainToWorldMessage =
  | ({ type: 'request'; id: number } & GameApiRequest)
  | { type: 'flush'; id: number }
  | { type: 'close'; id: number };

export type WorldToMainMessage =
  | { type: 'ready' }
  | { type: 'init-error'; error: SerializedError }
  | { type: 'created' }
  | { type: 'imported'; server: Server }
  | { type: 'response'; id: number; data: unknown }
  | { type: 'response-error'; id: number; error: SerializedError }
  | { type: 'flushed'; id: number }
  | { type: 'closed'; id: number }
  | { type: 'notification'; message: unknown };
