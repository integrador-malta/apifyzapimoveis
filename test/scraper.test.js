import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { addTimeoutToPromise, tryCancel } from '@apify/timeout';
import { extractListings, normalizeListing, readListingDocument, waitForListings } from '../src/helpers/extract.js';
import { getPageNumber, pageSignature, resolvePagination, validateInput, validateSearchNavigation } from '../src/helpers/pagination.js';
import { createSummary, ListingOutput } from '../src/helpers/output.js';

const seed = 'https://www.zapimoveis.com.br/venda/apartamentos/mg+belo-horizonte++barreiro/?tipos=apartamento_residencial';
const raw = { href: '/imovel/venda-apartamento-barreiro-id-123/', title: 'Barreiro', price: 'R$ 100.000' };
const item = normalizeListing(raw, seed);
let browser;
let context;

before(async () => {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ javaScriptEnabled: false });
  await context.route('**/*', (route) => route.abort());
});
after(async () => {
  await context?.close();
  await browser?.close();
});

async function withPage(html, run) {
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    // The fixture is offline; production extraction uses the actual navigation URL.
    const snapshot = await page.evaluate(readListingDocument, 'zapimoveis');
    const report = await extractListings({ url: () => seed }, 'zapimoveis', snapshot);
    await run(report, page);
  } finally {
    await page.close();
  }
}

for (const [file, expectedCards, expectedTotal] of [
  ['../zap.html', 30, 76],
  ['../src/helpers/teste.html', 11, 11],
]) {
  test(`extracts saved HTML ${file} without waiting for absent fields`, async () => {
    const html = await readFile(new URL(file, import.meta.url), 'utf8');
    await withPage(html, async (report, page) => {
      const start = performance.now();
      const snapshot = await page.evaluate(readListingDocument, 'zapimoveis');
      assert.ok(performance.now() - start < 2000, 'DOM extraction must take less than two seconds');
      assert.equal(report.cardCount, expectedCards);
      assert.equal(report.items.length, expectedCards);
      assert.equal(report.rejectedCards, 0);
      assert.equal(report.totalCount, expectedTotal);
      assert.ok(report.items.every((record) => record.listingId && record.price && record.url.includes('/imovel/')));
      assert.ok(report.items.every((record) => record.imobiliaria));
      assert.equal(snapshot.rawItems.filter((record) => record.anunciosAgrupados != null).length, 1);
      const currentUrl = report.paginationLinks.find((link) => link.active)?.href || seed;
      const pagination = resolvePagination(report, currentUrl, 1);
      assert.equal(pagination.nextUrl ? getPageNumber(pagination.nextUrl) : null, expectedCards === 30 ? 2 : null);
    });
  });
}

test('optional fields do not prevent extraction and advertiser uses a semantic link', async () => {
  await withPage(`<li data-cy="rp-property-cd">
    <a href="#"><span>Favorite</span></a>
    <a href="/imobiliaria/7/"><img alt="Agency"></a>
    <a href="${raw.href}"><span data-cy="rp-cardProperty-location-txt">Barreiro</span></a>
  </li>`, (report) => {
    assert.equal(report.items.length, 1);
    assert.equal(report.items[0].listingId, '123');
    assert.equal(report.items[0].imobiliaria, 'Agency');
    assert.equal(report.items[0].anunciosAgrupados, null);
    assert.equal(report.items[0].parking, null);
  });
});

test('structured fallback requires corroborated IDs and supports split flight chunks', async () => {
  const html = `<li data-cy="rp-property-cd"><a href="${raw.href}">
      <span data-cy="rp-cardProperty-location-txt">Barreiro</span></a></li>
    <li data-cy="rp-property-cd"><span data-cy="rp-cardProperty-location-txt">Grouped</span>
      <button data-cy="listing-card-deduplicated-button">Ver os 2 anuncios</button></li>`;
  const state = `5:${JSON.stringify({ listings: [
    { id: '123', href: raw.href, advertiser: { name: 'First Agency' } },
    { id: '456', href: '/imovel/venda-apartamento-id-456/', advertiser: { name: 'Second Agency' } },
  ], totalCount: 2 })}\n`;
  const split = Math.floor(state.length / 2);
  const script = (chunk) => `<script>self.__next_f.push(${JSON.stringify([1, chunk])})</script>`;
  await withPage(html + script(state.slice(0, split)) + script(state.slice(split)), (report) => {
    assert.equal(report.items.length, 2);
    assert.equal(report.items[1].listingId, '456');
    assert.equal(report.items[1].imobiliaria, 'Second Agency');
  });
  await withPage(html + script(state.replace('"id":"123"', '"id":"999"')), (report) => {
    assert.equal(report.items.length, 1);
    assert.equal(report.rejectedCards, 1);
  });
});

test('empty and wrong-link cards are rejected explicitly', async () => {
  await withPage(`<li data-cy="rp-property-cd"></li>
    <li data-cy="rp-property-cd"><a href="/imobiliaria/7/">
    <span data-cy="rp-cardProperty-location-txt">Barreiro</span></a></li>`, (report) => {
    assert.equal(report.items.length, 0);
    assert.equal(report.rejectedCards, 2);
    assert.equal(report.empty, false);
  });
});

test('normalization validates host, ID and minimum data and removes tracking', () => {
  const record = normalizeListing({ ...raw, href: `${raw.href}?source=ranking#test` }, seed);
  assert.equal(record.url, `https://www.zapimoveis.com.br${raw.href}`);
  assert.equal(record.negocio, 'venda');
  assert.equal(normalizeListing({ ...raw, href: 'https://example.com/imovel/id-123/' }, seed), null);
  assert.equal(normalizeListing({ ...raw, href: '/#' }, seed), null);
  assert.equal(normalizeListing({ href: raw.href }, seed), null);
  assert.equal(normalizeListing({ ...raw, href: '/imovel/aluguel-apartamento-id-123/' }, seed).negocio, 'aluguel');
});

test('31 cards paginate using the actual href, independent of item count', () => {
  const snapshot = {
    items: Array.from({ length: 31 }, (_, index) => ({ listingId: String(index) })),
    paginationLinks: [{ href: `${seed}&page=2`, label: 'pr\u00f3xima p\u00e1gina', disabled: false }],
    pagerPresent: true, statePage: 1,
  };
  assert.equal(resolvePagination(snapshot, seed, 1).nextUrl, `${seed}&page=2`);
  snapshot.items = snapshot.items.slice(0, 5);
  assert.equal(resolvePagination(snapshot, seed, 1).nextUrl, `${seed}&page=2`);
});

test('fallback uses filtered totalCount and page, never unrelated total statistics', () => {
  const snapshot = { paginationLinks: [], pagerPresent: false, statePage: 1, totalCount: 76, pageSize: 30 };
  const next = resolvePagination(snapshot, seed, 1);
  assert.equal(new URL(next.nextUrl).searchParams.get('page'), '2');
  assert.equal(new URL(next.nextUrl).searchParams.has('pagina'), false);
  assert.equal(resolvePagination({ ...snapshot, statePage: 3 }, `${seed}&page=3`, 3).verifiedEnd, true);
  assert.throws(() => resolvePagination({ ...snapshot, totalCount: null }, seed, 1), /confirmar/);
});

test('redirected, repeated and filter-changing pagination fails rather than succeeding', () => {
  const snapshot = {
    paginationLinks: [{ href: 'https://example.com/?page=2', label: 'next', disabled: false }],
    pagerPresent: true, statePage: 1,
  };
  assert.throws(() => resolvePagination(snapshot, seed, 1), /inconsistente/);
  assert.throws(() => resolvePagination({ ...snapshot, statePage: 1 }, `${seed}&page=2`, 2), /repetida/);
  assert.throws(() => validateSearchNavigation(seed, `${seed.split('?')[0]}?page=2`), /Filtro tipos/);
  assert.equal(pageSignature([{ listingId: '2' }, { listingId: '1' }, { listingId: '2' }]), '1,2');
  assert.throws(() => resolvePagination({ paginationLinks: [], pagerPresent: true }, seed, 1), /Paginacao incompleta/);
  assert.throws(() => resolvePagination({
    paginationLinks: [{ active: true, href: `${seed}&page=1` }],
    pagerPresent: true, totalCount: 76, pageSize: 30,
  }, seed, 1), /Paginacao incompleta/);
});

test('no cards is not empty unless evidence is present; blocked pages are distinguished', async () => {
  await withPage('<article>Footer only</article>', async (report) => {
    assert.equal(report.empty, false);
    assert.equal(report.blocked, false);
    const mock = { evaluate: async () => report };
    await assert.rejects(waitForListings(mock, () => {}, 20), /nao sera tratada como pesquisa vazia/);
  });
  await withPage('<h1>Nenhum im\u00f3vel encontrado</h1>', async (report) => {
    assert.equal(report.empty, true);
    assert.equal(resolvePagination(report, seed, 1).verifiedEnd, true);
  });
  await withPage('<h1>Access denied</h1>', (report) => assert.equal(report.blocked, true));
});

test('filtered total zero is an explicit empty search even without an empty-message selector', async () => {
  const payload = JSON.stringify([1, '5:{"totalCount":0,"pagination":{"page":1,"size":30}}']);
  await withPage(`<script>self.__next_f.push(${payload})</script>`, async (report) => {
    assert.equal(report.empty, true);
    assert.equal(report.totalCount, 0);
    assert.equal(await waitForListings({ evaluate: async () => report }, () => {}, 20), report);
  });
});

test('closed page errors and cancellation propagate without null-shaped success', async () => {
  await assert.rejects(extractListings({ evaluate: async () => { throw new Error('Page closed'); } }), /Page closed/);
  await assert.rejects(waitForListings({ evaluate: async () => ({}) }, () => { throw new Error('Canceled'); }), /Canceled/);
});

test('input preserves supplied limit, validates types and rejects unsupported/late seeds', () => {
  assert.equal(validateInput({ links: [seed], maxPagesPorBairro: 100 }).maxPagesPorBairro, 100);
  assert.equal(validateInput({ links: [seed, seed] }).links.length, 1);
  for (const input of [
    { links: [] }, { links: [seed], maxPagesPorBairro: 0 }, { links: [seed], maxPagesPorBairro: 1.5 },
    { links: [seed], usarProxy: 'true' }, { links: [seed], failOnIncomplete: 'false' },
    { links: [`${seed}&page=2`] }, { links: ['https://example.com/venda/'] },
  ]) assert.throws(() => validateInput(input));
  assert.throws(() => getPageNumber(`${seed}&page=abc`), /Pagina invalida/);
});

function memoryDataset() {
  const rows = [];
  return {
    rows,
    async getData({ offset, limit }) { return { items: rows.slice(offset, offset + limit), total: rows.length }; },
    async pushData(records) { rows.push(...records); },
  };
}

test('output deduplicates retries, overlapping seeds and a restored run', async () => {
  const dataset = memoryDataset();
  const output = new ListingOutput(dataset);
  await output.restore();
  assert.equal(await output.save([item, item], { seedUrl: seed, pageNum: 1 }, () => {}), 1);
  assert.equal(await output.save([item], { seedUrl: 'another-seed', pageNum: 1 }, () => {}), 0);
  const restored = new ListingOutput(dataset);
  await restored.restore();
  assert.equal(await restored.save([item], {}, () => {}), 0);
  assert.equal(dataset.rows.length, 1);
});

test('partial append failure reconciles actual dataset before retry', async () => {
  const dataset = memoryDataset();
  let failed = false;
  dataset.pushData = async (records) => {
    if (!failed) {
      failed = true;
      dataset.rows.push(records[0]);
      throw new Error('Network response lost after append');
    }
    dataset.rows.push(...records);
  };
  const output = new ListingOutput(dataset);
  const second = { ...item, listingId: '456', url: item.url.replace('123', '456') };
  await assert.rejects(output.save([item, second], {}, () => {}), /Network response lost/);
  assert.equal(await output.save([item, second], {}, () => {}), 1);
  assert.deepEqual(dataset.rows.map((record) => record.listingId), ['123', '456']);
});

test('cancellation before writing cannot publish records', async () => {
  const dataset = memoryDataset();
  const output = new ListingOutput(dataset);
  await assert.rejects(output.save([item], {}, () => { throw new Error('Canceled'); }), /Canceled/);
  assert.equal(dataset.rows.length, 0);
});

test('Crawlee timeout cancellation prevents a late append', async () => {
  const dataset = memoryDataset();
  const output = new ListingOutput(dataset);
  await assert.rejects(addTimeoutToPromise(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    await output.save([item], {}, tryCancel);
  }, 10, 'Handler timed out'), /Handler timed out/);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(dataset.rows.length, 0);
});

test('summary distinguishes empty, complete, failed and capped searches and keeps sources', () => {
  const state = { seeds: {
    a: { seedUrl: 'a', status: 'complete', pages: { 1: { listingIds: ['123'] } } },
    b: { seedUrl: 'b', status: 'empty', pages: { 1: { listingIds: [] } } },
    c: { seedUrl: 'c', status: 'failed', pages: {} },
    d: { seedUrl: 'd', status: 'limited', pages: { 1: { listingIds: ['123'] } } },
  } };
  const summary = createSummary(state, 1, { version: '1.1.0' });
  assert.equal(summary.uniqueListings, 1);
  assert.equal(summary.completeSeeds, 1);
  assert.equal(summary.emptySeeds, 1);
  assert.equal(summary.incompleteSeeds, 2);
  assert.equal(summary.pagesProcessed, 3);
  assert.deepEqual(summary.seeds[3].pages[1].listingIds, ['123']);
});
