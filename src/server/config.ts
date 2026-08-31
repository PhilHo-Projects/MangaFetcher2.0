import { resolve } from 'node:path';

import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PUBLIC_ORIGIN: z.string().min(1, 'PUBLIC_ORIGIN is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  MANGA_TRACKER_DB_PATH: z.string().min(1).optional(),
  MANGA_TRACKER_DATA_DIR: z.string().min(1).optional(),
  OWNER_USERNAME: z.string().trim().min(3).optional(),
  OWNER_EMAIL: z.email().optional(),
  OWNER_PASSWORD: z.string().min(12).optional(),
});

export type OwnerBootstrap = {
  username: string;
  email: string;
  password: string;
};

export type RuntimeConfig = {
  environment: 'development' | 'test' | 'production';
  publicOrigin: string;
  sessionSecret: string;
  port: number;
  databasePath: string;
  dataDirectory: string;
  clientDirectory: string;
  sessionMaxAgeSeconds: number;
  ownerBootstrap: OwnerBootstrap | null;
};

function parseOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('PUBLIC_ORIGIN must be an origin without a path, query, credentials, or hash');
  }
  return parsed.origin;
}

export function loadConfig(environment: Record<string, string | undefined> = process.env): RuntimeConfig {
  const parsed = environmentSchema.parse(environment);
  const suppliedOwnerFields = [parsed.OWNER_USERNAME, parsed.OWNER_EMAIL, parsed.OWNER_PASSWORD];
  const suppliedCount = suppliedOwnerFields.filter((value) => value !== undefined).length;
  if (suppliedCount !== 0 && suppliedCount !== suppliedOwnerFields.length) {
    throw new Error('OWNER_USERNAME, OWNER_EMAIL, and OWNER_PASSWORD must be supplied together');
  }

  const dataDirectory = resolve(parsed.MANGA_TRACKER_DATA_DIR ?? 'data');
  const ownerBootstrap = suppliedCount === suppliedOwnerFields.length
    ? {
        username: parsed.OWNER_USERNAME as string,
        email: parsed.OWNER_EMAIL as string,
        password: parsed.OWNER_PASSWORD as string,
      }
    : null;

  return {
    environment: parsed.NODE_ENV,
    publicOrigin: parseOrigin(parsed.PUBLIC_ORIGIN),
    sessionSecret: parsed.SESSION_SECRET,
    port: parsed.PORT,
    databasePath: parsed.MANGA_TRACKER_DB_PATH === ':memory:'
      ? ':memory:'
      : resolve(parsed.MANGA_TRACKER_DB_PATH ?? resolve(dataDirectory, 'manga-tracker.db')),
    dataDirectory,
    clientDirectory: resolve('dist/client'),
    sessionMaxAgeSeconds: 30 * 24 * 60 * 60,
    ownerBootstrap,
  };
}
