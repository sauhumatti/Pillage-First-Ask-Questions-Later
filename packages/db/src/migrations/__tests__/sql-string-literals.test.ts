import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// The browser's SQLite build treats double-quoted strings as identifiers only, while the
// SQLite used in tests also accepts them as string literals. A double-quoted table name in
// pragma_table_info() therefore passes tests but crashes game worlds on startup.
describe('SQL string literals', () => {
  test.each([
    join(import.meta.dirname, '..', 'upgrade-db.ts'),
    join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      'apps',
      'web',
      'app',
      '(public)',
      '(game-worlds)',
      '(import)',
      'workers',
      'import-game-world-worker.ts',
    ),
  ])('%s uses single-quoted table names in pragma functions', (path) => {
    expect(readFileSync(path, 'utf8')).not.toMatch(/pragma_\w+\("/);
  });
});
