export class ListingOutput {
  constructor(dataset) {
    this.dataset = dataset;
    this.ids = new Set();
    this.uncertainWrite = false;
  }

  async restore() {
    this.ids.clear();
    let offset = 0;
    while (true) {
      const { items, total } = await this.dataset.getData({ offset, limit: 1000 });
      for (const item of items) {
        if (item.listingId && item.portal) this.ids.add(`${item.portal}:${item.listingId}`);
      }
      offset += items.length;
      if (offset >= total) break;
      if (!items.length) throw new Error('Dataset retornou pagina vazia antes do total informado.');
    }
    this.uncertainWrite = false;
  }

  async save(items, source, assertActive) {
    assertActive();
    if (this.uncertainWrite) {
      await this.restore();
      assertActive();
    }
    const pending = new Map();
    for (const item of items) {
      const key = `${item.portal}:${item.listingId}`;
      if (!this.ids.has(key)) pending.set(key, { ...item, ...source });
    }
    if (!pending.size) return 0;
    assertActive();
    // A failed response may follow a successful append. Reconcile before retrying.
    this.uncertainWrite = true;
    await this.dataset.pushData([...pending.values()]);
    for (const key of pending.keys()) this.ids.add(key);
    this.uncertainWrite = false;
    assertActive();
    return pending.size;
  }
}

export function createSummary(state, uniqueListings, build) {
  const seeds = Object.values(state.seeds);
  const pages = seeds.flatMap((seed) => Object.values(seed.pages));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    build,
    uniqueListings,
    pagesProcessed: seeds.reduce((sum, seed) => sum + Object.keys(seed.pages).length, 0),
    partialPages: pages.filter((page) => page.rejectedCards > 0).length,
    rejectedCards: pages.reduce((sum, page) => sum + (page.rejectedCards || 0), 0),
    ignoredPromotions: pages.reduce((sum, page) => sum + (page.ignoredPromotions || 0), 0),
    completeSeeds: seeds.filter((seed) => seed.status === 'complete').length,
    emptySeeds: seeds.filter((seed) => seed.status === 'empty').length,
    incompleteSeeds: seeds.filter((seed) => !['complete', 'empty'].includes(seed.status)).length,
    seeds,
  };
}

export function seedStatus(seed, pagination, pageNum, maxPages, empty) {
  if (pagination.nextUrl) return pageNum >= maxPages ? 'limited' : 'running';
  if (seed.failures.length) return 'failed';
  if (Object.values(seed.pages).some((page) => page.rejectedCards > 0)) return 'partial';
  return empty ? 'empty' : 'complete';
}
