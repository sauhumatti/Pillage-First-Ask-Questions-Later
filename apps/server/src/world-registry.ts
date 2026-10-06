import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Server } from '@pillage-first/types/models/server';

const SLUG_PATTERN = /^[a-z0-9-]{1,64}$/;

export const isValidSlug = (slug: string): boolean => SLUG_PATTERN.test(slug);

// Game worlds carry settings beyond the Server type (the game reads them while seeding),
// so only the fields the server relies on are checked and the rest is kept as is
export const gameWorldSchema = z.looseObject({
  id: z.string(),
  slug: z.string().regex(SLUG_PATTERN),
  name: z.string(),
  version: z.string(),
  seed: z.string(),
  createdAt: z.number(),
  configuration: z.looseObject({}),
  playerConfiguration: z.looseObject({ name: z.string(), tribe: z.string() }),
}) as unknown as z.ZodType<Server>;

// Keeps the list of game worlds and where their saves are
export class WorldRegistry {
  private readonly worldsDirectory: string;
  private readonly listingPath: string;
  private worlds: Server[];

  constructor(dataDirectory: string) {
    this.worldsDirectory = join(dataDirectory, 'worlds');
    this.listingPath = join(dataDirectory, 'worlds.json');
    mkdirSync(this.worldsDirectory, { recursive: true });

    this.worlds = existsSync(this.listingPath)
      ? z
          .array(gameWorldSchema)
          .parse(JSON.parse(readFileSync(this.listingPath, 'utf8')))
      : [];
  }

  getDatabasePath = (slug: string): string => {
    if (!isValidSlug(slug)) {
      throw new Error(`Invalid game world slug: ${slug}`);
    }

    return join(this.worldsDirectory, `${slug}.sqlite3`);
  };

  list(): Server[] {
    return this.worlds;
  }

  get(slug: string): Server | undefined {
    return this.worlds.find((world) => world.slug === slug);
  }

  private async save(): Promise<void> {
    const temporaryPath = `${this.listingPath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(this.worlds, null, 2));
    await rename(temporaryPath, this.listingPath);
  }

  async add(server: Server): Promise<void> {
    this.worlds = [
      ...this.worlds.filter(({ slug }) => slug !== server.slug),
      server,
    ];
    await this.save();
  }

  async remove(slug: string): Promise<void> {
    this.worlds = this.worlds.filter((world) => world.slug !== slug);
    await this.save();

    const databasePath = this.getDatabasePath(slug);
    await rm(databasePath, { force: true });
    await rm(`${databasePath}.tmp`, { force: true });
  }
}
