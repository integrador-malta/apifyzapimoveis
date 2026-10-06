import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

async function runOffline(mode, storage) {
  const env = {
    ...process.env, CRAWLEE_STORAGE_DIR: storage, CRAWLEE_PURGE_ON_START: 'false',
    APIFY_LOCAL_STORAGE_DIR: storage,
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith('APIFY_') && key !== 'APIFY_LOCAL_STORAGE_DIR') delete env[key];
    if (key.startsWith('ACTOR_')) delete env[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/run-offline.js', import.meta.url)), mode], {
      env, cwd: fileURLToPath(new URL('../', import.meta.url)),
    });
    let logs = '';
    child.stdout.on('data', (chunk) => { logs += chunk; });
    child.stderr.on('data', (chunk) => { logs += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, logs }));
  });
}

for (const mode of ['success', 'blocked', 'limited', 'repeated', 'empty', 'partial']) {
  test(`complete Actor with offline navigation: ${mode}`, { timeout: 90000 }, async () => {
    const storage = await mkdtemp(join(tmpdir(), 'zap-scraper-test-'));
    try {
      const result = await runOffline(mode, storage);
      assert.equal(result.code, ['success', 'empty', 'partial'].includes(mode) ? 0 : 91, result.logs);
      const summary = JSON.parse(await readFile(join(storage, 'key_value_stores', 'default', 'SUMMARY.json'), 'utf8'));
      assert.equal(summary.uniqueListings, ['blocked', 'empty'].includes(mode) ? 0 : mode === 'success' ? 32 : 31);
      assert.equal(summary.pagesProcessed, mode === 'blocked' ? 0 : mode === 'success' ? 2 : 1);
      assert.equal(summary.incompleteSeeds, ['success', 'empty'].includes(mode) ? 0 : 1);
      const status = { success: 'complete', blocked: 'failed', repeated: 'failed', empty: 'empty', limited: 'limited', partial: 'limited' };
      assert.equal(summary.seeds[0].status, status[mode]);
      assert.equal(summary.build.version, '1.1.0');
      if (mode === 'blocked') {
        assert.equal(summary.seeds[0].failures.length, 1);
        assert.equal(summary.seeds[0].failures[0].httpStatus, 403);
        assert.ok(summary.errorsDatasetId);
      }
      if (summary.uniqueListings) {
        const datasetPath = join(storage, 'datasets', 'default');
        const files = (await readdir(datasetPath)).filter((file) => /^\d+\.json$/.test(file));
        const rows = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(datasetPath, file), 'utf8'))));
        assert.equal(rows.length, summary.uniqueListings);
        assert.equal(new Set(rows.map((row) => row.listingId)).size, rows.length);
        assert.ok(rows.every((row) => row.url.includes('/imovel/') && row.price && !row.failedUrl));
      }
    } finally {
      await rm(storage, { recursive: true, force: true });
    }
  });
}

test('Actor resumes a capped search from checkpoints without duplicating data', { timeout: 90000 }, async () => {
  const storage = await mkdtemp(join(tmpdir(), 'zap-scraper-test-'));
  try {
    const capped = await runOffline('limited', storage);
    assert.equal(capped.code, 91, capped.logs);
    const resumed = await runOffline('success', storage);
    assert.equal(resumed.code, 0, resumed.logs);
    const summary = JSON.parse(await readFile(join(storage, 'key_value_stores', 'default', 'SUMMARY.json'), 'utf8'));
    assert.equal(summary.uniqueListings, 32);
    assert.equal(summary.pagesProcessed, 2);
    assert.equal(summary.seeds[0].pages[1].newListings, 31);
    assert.equal(summary.seeds[0].pages[2].newListings, 1);
    assert.equal(summary.incompleteSeeds, 0);
  } finally {
    await rm(storage, { recursive: true, force: true });
  }
});
