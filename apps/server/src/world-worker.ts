import {
  getGameTime,
  saveGameClock,
  startSimulation,
} from '@pillage-first/api/server';
import { decideWithOpenRouter } from './ai-provider';
// Runs one game world in its own thread, like the browser runs it in a Web Worker.
// The database lives in memory and is written to disk whenever it changes.
import 'zod/compile';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import sqlite3InitModule, {
  type Database,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm';
import { z } from 'zod';
import {
  cancelScheduling,
  createSchedulerDataSource,
  createTroopStarvationEvent,
  initScheduler,
  matchRoute,
  scheduleNextEvent,
  setNotificationPort,
  setShouldPostNotifications,
} from '@pillage-first/api/server';
import { migrateAndSeed, upgradeDb } from '@pillage-first/db';
import { serverDbSchema } from '@pillage-first/types/models/server';
import { env } from '@pillage-first/utils/env';
import {
  OutdatedDatabaseSchemaError,
  serializeError,
} from '@pillage-first/utils/errors';
import {
  createDbFacade,
  type DbFacade,
} from '@pillage-first/utils/facades/database';
import {
  encodeAppVersionToDatabaseUserVersion,
  isSupportedDatabaseUserVersion,
} from '@pillage-first/utils/version';
import type {
  MainToWorldMessage,
  WorldToMainMessage,
  WorldWorkerData,
} from './worker-protocol';

const SAVE_INTERVAL_MS = 2_000;

const port = parentPort!;
const data = workerData as WorldWorkerData;

const post = (message: WorldToMainMessage) => {
  port.postMessage(message);
};

const openInMemory = (sqlite3: Sqlite3Static, bytes?: Uint8Array): Database => {
  const database = new sqlite3.oo1.DB(':memory:', 'c');

  if (bytes) {
    // Node's Buffer subclasses Uint8Array, which SQLite's allocator doesn't recognise
    const pointer = sqlite3.wasm.allocFromTypedArray(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );

    database.checkRc(
      sqlite3.capi.sqlite3_deserialize(
        database.pointer!,
        'main',
        pointer,
        bytes.byteLength,
        bytes.byteLength,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
          sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
      ),
    );
  }

  return database;
};

// Write to a temporary file first, so a crash mid-write never corrupts the save
const writeDatabase = async (
  sqlite3: Sqlite3Static,
  database: Database,
  path: string,
) => {
  const bytes = sqlite3.capi.sqlite3_js_db_export(database.pointer!, 'main');
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, path);
};

const createWorld = async (
  sqlite3: Sqlite3Static,
  { databasePath, server }: Extract<WorldWorkerData, { mode: 'create' }>,
) => {
  const database = openInMemory(sqlite3);
  const dbFacade = createDbFacade(database, false);

  dbFacade.execMulti({
    sql: `
      PRAGMA user_version=${encodeAppVersionToDatabaseUserVersion(env.VERSION)};
      PRAGMA foreign_keys=OFF;
      PRAGMA journal_mode=OFF;
      PRAGMA synchronous=OFF;
      PRAGMA temp_store=MEMORY;
      PRAGMA cache_size=-20000;
    `,
  });

  migrateAndSeed(dbFacade, server);
  await writeDatabase(sqlite3, database, databasePath);
  dbFacade.close();
  database.close();
  post({ type: 'created' });
};

const importWorld = async (
  sqlite3: Sqlite3Static,
  {
    databasePath,
    databaseBuffer,
    id,
    slug,
  }: Extract<WorldWorkerData, { mode: 'import' }>,
) => {
  const database = openInMemory(sqlite3, databaseBuffer);

  database.exec({
    sql: 'UPDATE servers SET id = $id, slug = $slug;',
    bind: { $id: id, $slug: slug },
  });

  const serverColumns = database
    .selectObjects("SELECT name FROM pragma_table_info('servers');")
    .map(({ name }) => name);

  if (!serverColumns.includes('culture_points_requirement_speed')) {
    database.exec({
      sql: 'ALTER TABLE servers ADD COLUMN culture_points_requirement_speed INTEGER CHECK (culture_points_requirement_speed IN (1, 2, 3, 4, 5)) NOT NULL DEFAULT 1;',
    });
  }

  const server = serverDbSchema.parse(
    database.selectObject(
      'SELECT id, version, name, slug, created_at, seed, map_size, speed, culture_points_requirement_speed, player_name, player_tribe FROM servers;',
    ),
  );

  await writeDatabase(sqlite3, database, databasePath);
  database.close();
  post({ type: 'imported', server });
};

const runWorld = async (
  sqlite3: Sqlite3Static,
  { databasePath }: Extract<WorldWorkerData, { mode: 'run' }>,
) => {
  const database = openInMemory(sqlite3, await readFile(databasePath));
  const dbFacade: DbFacade = createDbFacade(database, false);

  dbFacade.execMulti({
    sql: `
      PRAGMA foreign_keys = ON;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -20000;
      PRAGMA secure_delete = OFF;
    `,
  });

  const version = dbFacade.selectValue({
    sql: 'PRAGMA user_version',
    schema: z.number(),
  })!;

  if (!isSupportedDatabaseUserVersion(version, env.VERSION)) {
    throw new OutdatedDatabaseSchemaError();
  }

  upgradeDb(dbFacade, version);

  // Notifications (events resolving, errors) are forwarded to the browsers watching this world
  setNotificationPort({
    postMessage: (message: unknown) => post({ type: 'notification', message }),
    start: () => {},
  } as unknown as MessagePort);
  setShouldPostNotifications(true);

  const getChangeCount = () =>
    dbFacade.selectValue({
      sql: 'SELECT total_changes();',
      schema: z.number(),
    })!;

  let savedChangeCount = -1;
  let savePromise: Promise<void> | null = null;

  const save = async () => {
    await savePromise;
    saveGameClock(dbFacade);
    const changeCount = getChangeCount();

    if (changeCount === savedChangeCount) {
      return;
    }

    savePromise = writeDatabase(sqlite3, database, databasePath).then(() => {
      savedChangeCount = changeCount;
    });

    try {
      await savePromise;
    } finally {
      savePromise = null;
    }
  };

  const saveInterval = setInterval(() => {
    save().catch((error) => console.error('Failed to save game world', error));
  }, SAVE_INTERVAL_MS);

  const stopSimulation = startSimulation(dbFacade, decideWithOpenRouter);
  createTroopStarvationEvent(dbFacade, getGameTime(dbFacade));

  const dataSource = createSchedulerDataSource(dbFacade);
  if (!stopSimulation) {
    initScheduler(dataSource);
    scheduleNextEvent(dataSource);
  }

  await save();

  port.on('message', async (message: MainToWorldMessage) => {
    switch (message.type) {
      case 'request': {
        try {
          const { controller, path, query, body, url } = matchRoute(
            message.url,
            message.method,
            message.body,
          );
          const result = controller(dbFacade, {
            path,
            query,
            body: body as never,
            url,
          });

          post({ type: 'response', id: message.id, data: result });
        } catch (error) {
          console.error(error);
          post({
            type: 'response-error',
            id: message.id,
            error: serializeError(error),
          });
        }
        break;
      }
      case 'flush': {
        await save();
        post({ type: 'flushed', id: message.id });
        break;
      }
      case 'close': {
        clearInterval(saveInterval);
        cancelScheduling();
        stopSimulation?.();
        await save();
        dbFacade.close();
        database.close();
        post({ type: 'closed', id: message.id });
        port.close();
        break;
      }
    }
  });

  post({ type: 'ready' });
};

const main = async () => {
  const sqlite3 = await sqlite3InitModule();

  try {
    switch (data.mode) {
      case 'create': {
        await createWorld(sqlite3, data);
        break;
      }
      case 'import': {
        await importWorld(sqlite3, data);
        break;
      }
      case 'run': {
        await runWorld(sqlite3, data);
        break;
      }
    }
  } catch (error) {
    console.error(error);
    post({ type: 'init-error', error: serializeError(error) });
  }
};

await main();
