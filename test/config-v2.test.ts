import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/server/config.js';

const valid = {
  NODE_ENV: 'test',
  PUBLIC_ORIGIN: 'http://localhost:3001',
  SESSION_SECRET: 'test-session-secret-that-is-at-least-32-characters',
  MANGA_TRACKER_DB_PATH: ':memory:',
};

describe('runtime configuration', () => {
  it('has no credential or session-secret defaults', () => {
    expect(() => loadConfig({})).toThrow(/PUBLIC_ORIGIN/);
    expect(() => loadConfig({ PUBLIC_ORIGIN: valid.PUBLIC_ORIGIN })).toThrow(/SESSION_SECRET/);
  });

  it('requires a strong secret and an origin without a path', () => {
    expect(() => loadConfig({ ...valid, SESSION_SECRET: 'too-short' })).toThrow(/32/);
    expect(() => loadConfig({ ...valid, PUBLIC_ORIGIN: 'https://example.com/manga' })).toThrow(
      /origin without a path/,
    );
  });

  it('accepts owner bootstrap credentials only as an explicit pair', () => {
    expect(() => loadConfig({ ...valid, OWNER_USERNAME: 'phil' })).toThrow(/OWNER_PASSWORD/);
    expect(
      loadConfig({
        ...valid,
        OWNER_USERNAME: 'phil',
        OWNER_EMAIL: 'Philippeho27@gmail.com',
        OWNER_PASSWORD: 'a-secure-owner-password',
      }).ownerBootstrap,
    ).toEqual({
      username: 'phil',
      email: 'Philippeho27@gmail.com',
      password: 'a-secure-owner-password',
    });
  });
});
