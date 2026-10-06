import { Worker } from 'node:worker_threads';
import type { Server } from '@pillage-first/types/models/server';
import { deserializeError } from '@pillage-first/utils/errors';
import type {
  GameApiRequest,
  MainToWorldMessage,
  WorldToMainMessage,
  WorldWorkerData,
} from './worker-protocol';

const REQUEST_TIMEOUT_MS = 30_000;

type NotificationListener = (message: unknown) => void;

type PendingReply = {
  resolve: (message: WorldToMainMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const createWorldWorker = (data: WorldWorkerData) =>
  new Worker(new URL('./world-worker.js', import.meta.url), {
    workerData: data,
  });

// A running game world. Requests are matched to replies by id.
class RunningWorld {
  private nextId = 1;
  private readonly pending = new Map<number, PendingReply>();
  private readonly listeners = new Set<NotificationListener>();

  private readonly worker: Worker;

  constructor(worker: Worker, onExit: () => void) {
    this.worker = worker;
    worker.on('message', (message: WorldToMainMessage) => {
      if (message.type === 'notification') {
        for (const listener of this.listeners) {
          listener(message.message);
        }
        return;
      }

      if ('id' in message) {
        const reply = this.pending.get(message.id);

        if (reply) {
          clearTimeout(reply.timeout);
          this.pending.delete(message.id);
          reply.resolve(message);
        }
      }
    });

    worker.on('exit', () => {
      for (const reply of this.pending.values()) {
        clearTimeout(reply.timeout);
        reply.reject(new Error('Game world stopped'));
      }
      this.pending.clear();
      onExit();
    });
  }

  private send(
    message: Omit<MainToWorldMessage, 'id'>,
  ): Promise<WorldToMainMessage> {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Game world request timed out: ${message.type}`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage({ ...message, id } as MainToWorldMessage);
    });
  }

  async request(request: GameApiRequest): Promise<unknown> {
    const reply = await this.send({ type: 'request', ...request });

    if (reply.type === 'response-error') {
      throw deserializeError(reply.error);
    }

    return reply.type === 'response' ? reply.data : undefined;
  }

  async flush(): Promise<void> {
    await this.send({ type: 'flush' });
  }

  async close(): Promise<void> {
    await this.send({ type: 'close' });
    await this.worker.terminate();
  }

  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

// Runs a one-off worker (create or import) and waits for its result
const runTask = <T extends WorldToMainMessage['type']>(
  data: WorldWorkerData,
  resultType: T,
): Promise<Extract<WorldToMainMessage, { type: T }>> => {
  const worker = createWorldWorker(data);

  return new Promise((resolve, reject) => {
    worker.on('message', (message: WorldToMainMessage) => {
      if (message.type === resultType) {
        resolve(message as Extract<WorldToMainMessage, { type: T }>);
        void worker.terminate();
      } else if (message.type === 'init-error') {
        reject(deserializeError(message.error));
        void worker.terminate();
      }
    });
    worker.on('error', reject);
  });
};

export class WorldHost {
  private readonly worlds = new Map<Server['slug'], Promise<RunningWorld>>();

  private readonly getDatabasePath: (slug: string) => string;

  constructor(getDatabasePath: (slug: string) => string) {
    this.getDatabasePath = getDatabasePath;
  }

  open(slug: Server['slug']): Promise<RunningWorld> {
    const existing = this.worlds.get(slug);

    if (existing) {
      return existing;
    }

    const world = new Promise<RunningWorld>((resolve, reject) => {
      const worker = createWorldWorker({
        mode: 'run',
        databasePath: this.getDatabasePath(slug),
      });

      const handleStartup = (message: WorldToMainMessage) => {
        if (message.type === 'ready') {
          worker.off('message', handleStartup);
          resolve(new RunningWorld(worker, () => this.worlds.delete(slug)));
        } else if (message.type === 'init-error') {
          worker.off('message', handleStartup);
          void worker.terminate();
          reject(deserializeError(message.error));
        }
      };

      worker.on('message', handleStartup);
      worker.on('error', reject);
    });

    world.catch(() => this.worlds.delete(slug));
    this.worlds.set(slug, world);

    return world;
  }

  isOpen(slug: Server['slug']): boolean {
    return this.worlds.has(slug);
  }

  async flush(slug: Server['slug']): Promise<void> {
    const world = this.worlds.get(slug);

    if (world) {
      await (await world).flush();
    }
  }

  async close(slug: Server['slug']): Promise<void> {
    const world = this.worlds.get(slug);

    if (!world) {
      return;
    }

    this.worlds.delete(slug);

    try {
      await (await world).close();
    } catch {
      // The world failed to start or already stopped
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.worlds.keys()].map((slug) => this.close(slug)));
  }

  async create(server: Server): Promise<void> {
    await runTask(
      {
        mode: 'create',
        databasePath: this.getDatabasePath(server.slug),
        server,
      },
      'created',
    );
  }

  async import(
    databaseBuffer: Uint8Array,
    id: string,
    slug: string,
  ): Promise<Server> {
    const { server } = await runTask(
      {
        mode: 'import',
        databasePath: this.getDatabasePath(slug),
        databaseBuffer,
        id,
        slug,
      },
      'imported',
    );

    return server;
  }
}
