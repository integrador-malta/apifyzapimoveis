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
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    build,
    uniqueListings,
    pagesProcessed: seeds.reduce((sum, seed) => sum + Object.keys(seed.pages).length, 0),
    completeSeeds: seeds.filter((seed) => seed.status === 'complete').length,
    emptySeeds: seeds.filter((seed) => seed.status === 'empty').length,
    incompleteSeeds: seeds.filter((seed) => !['complete', 'empty'].includes(seed.status)).length,
    seeds,
  };
}
