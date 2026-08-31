import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('production packaging', () => {
  it('launches the TypeScript server artifact from both npm and Docker', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: { start: string };
    };
    const dockerfile = readFileSync('Dockerfile', 'utf8');
    expect(packageJson.scripts.start).toBe('node dist/src/server/index.js');
    expect(dockerfile).toContain('CMD ["node", "dist/src/server/index.js"]');
    expect(dockerfile).not.toContain('server.js"]');
  });
});
