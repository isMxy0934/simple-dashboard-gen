import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('migration finalization removes legacy transition entrypoints', async () => {
  assert.equal(await fileExists('src/server/request-context.ts'), false);
  assert.equal(await fileExists('src/web/auth/auth-session.ts'), false);

  const files = [
    'src/server/dashboards/service.ts',
    'src/server/authoring/editing-session-service.ts',
    'src/server/authoring/chat-request.ts',
  ];

  for (const file of files) {
    const source = await read(file);
    assert.doesNotMatch(source, /resolveServerRequestContext/);
    assert.doesNotMatch(source, /@\/server\/request-context/);
  }
});

test('migration finalization docs are archived and have completed status', async () => {
  await access(path.join(root, 'docs/archive/migration-2026-q2.md'));
  await access(path.join(root, 'docs/operations.md'));
  await access(path.join(root, 'docs/audit/dashboard-usage.md'));

  const architecture = await read('docs/architecture.md');
  assert.doesNotMatch(architecture, /🟡|🔴/);

  const routeInventory = await read('docs/audit/route-inventory.md');
  assert.doesNotMatch(routeInventory, /\[ \]/);
  assert.match(
    routeInventory,
    /\| `\/api\/query\/execute-batch` \| POST \| session\.workspaceId \| dashboard\.read \| \[x\] \|/,
  );
});

test('migration finalization exposes required automation scripts', async () => {
  const packageJson = JSON.parse(await read('package.json'));

  assert.equal(packageJson.scripts['script:check-i18n'], 'node scripts/check-i18n.mjs');
  assert.equal(packageJson.scripts['audit:dashboard-usage'], 'node scripts/audit-dashboard-usage.mjs');
  assert.equal(packageJson.scripts['check:final'], 'node scripts/check-final-acceptance.mjs');
  assert.equal(packageJson.scripts['test:contract'], 'node scripts/run-contract-tests.mjs');
});
