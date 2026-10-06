export function readListingDocument(portal) {
  const clean = (value) => value?.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim() || null;
  const text = (root, selector) => clean(root.querySelector(selector)?.textContent);
  const normalizedBody = (document.body?.innerText || document.body?.textContent || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const cardSelector = portal === 'zapimoveis'
    ? 'li[data-cy="rp-property-cd"]'
    : '.property-card, [data-testid*="property-card"]';
  const cards = [...document.querySelectorAll(cardSelector)];
  const fields = portal === 'zapimoveis' ? {
    title: '[data-cy="rp-cardProperty-location-txt"]',
    price: '[data-cy="rp-cardProperty-price-txt"] p',
    address: '[data-cy="rp-cardProperty-street-txt"]',
    area: '[data-cy="rp-cardProperty-propertyArea-txt"]',
    rooms: '[data-cy="rp-cardProperty-bedroomQuantity-txt"]',
    baths: '[data-cy="rp-cardProperty-bathroomQuantity-txt"]',
    parking: '[data-cy="rp-cardProperty-parkingSpacesQuantity-txt"]',
  } : {
    title: 'h2, h3, .property-card__title',
    price: '.price, [data-testid*="price"]',
    address: '.address, [data-testid*="address"], .property-card__address',
    area: '.area, [data-testid*="area"]',
    rooms: '[data-testid*="bedroom"], .property-card__detail-room',
    baths: '[data-testid*="bathroom"], .property-card__detail-bathroom',
    parking: '[data-testid*="parking"], .property-card__detail-garage',
  };
  const rawItems = cards.map((card) => {
    const anchors = [...card.querySelectorAll('a[href]')];
    const detailAnchor = anchors.find((anchor) => /\/imovel\/[^?#]*id-\d+/.test(anchor.getAttribute('href')));
    const advertiserAnchor = anchors.find((anchor) => /\/imobiliaria\//.test(anchor.getAttribute('href')));
    const advertiser = text(card, '[data-cy*="advertiser"], [data-testid*="advertiser-name"]')
      || clean(advertiserAnchor?.textContent)
      || clean(advertiserAnchor?.querySelector('img')?.getAttribute('alt'))
      || text(card, 'span.flex-1.min-w-0.line-clamp-1');
    const groupText = text(card, '[data-cy="listing-card-deduplicated-button"]');
    return {
      ...Object.fromEntries(Object.entries(fields).map(([key, selector]) => [key, text(card, selector)])),
      imobiliaria: advertiser,
      anunciosAgrupados: groupText?.match(/\d+/) ? Number(groupText.match(/\d+/)[0]) : null,
      href: detailAnchor?.getAttribute('href') || null,
    };
  });

  const pager = document.querySelector('.olx-core-pagination, nav[aria-label*="pagina"], nav[aria-label*="Pagina"]');
  const paginationLinks = pager ? [...pager.querySelectorAll('a[href]')].map((anchor) => ({
    href: anchor.getAttribute('href'),
    label: anchor.getAttribute('aria-label') || clean(anchor.textContent) || '',
    disabled: anchor.getAttribute('aria-disabled') === 'true',
    active: anchor.getAttribute('aria-current') === 'page'
      || anchor.classList.contains('olx-core-pagination__button--active'),
  })) : [];
  let totalCount = null;
  let statePage = null;
  let pageSize = null;
  const flightChunks = [];
  const listingStates = [];
  const collectListingStates = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.listings) && Number.isInteger(value.totalCount)) listingStates.push(value);
    for (const child of Object.values(value)) collectListingStates(child);
  };
  for (const script of document.querySelectorAll('script')) {
    const match = script.textContent.match(/^self\.__next_f\.push\((\[[\s\S]*\])\);?\s*$/);
    if (!match) continue;
    const payload = JSON.parse(match[1]);
    if (typeof payload[1] !== 'string') continue;
    flightChunks.push(payload[1]);
  }
  const state = flightChunks.map((chunk) => /^[0-9a-f]+:/i.test(chunk) ? `\n${chunk}` : chunk).join('');
  if (state) {
    const total = state.match(/"totalCount"\s*:\s*(\d+)/);
    const pagination = state.match(/"pagination"\s*:\s*\{\s*"page"\s*:\s*(\d+)\s*,\s*"size"\s*:\s*(\d+)/);
    if (total) totalCount = Number(total[1]);
    if (pagination) {
      statePage = Number(pagination[1]);
      pageSize = Number(pagination[2]);
    }
    if (state.includes('"listings"')) {
      for (const record of state.split('\n')) {
        if (!/^[0-9a-f]+:/i.test(record)) continue;
        const value = record.slice(record.indexOf(':') + 1);
        if (value.startsWith('[') || value.startsWith('{')) collectListingStates(JSON.parse(value));
      }
    }
  }
  const anchoredIds = rawItems.map((item) => item.href?.match(/id-(\d+)/)?.[1] || null);
  const alignedState = listingStates.find((state) => state.listings.length === rawItems.length
    && anchoredIds.some(Boolean)
    && state.listings.every((listing, index) => /^\d+$/.test(String(listing.id))
      && (!anchoredIds[index] || anchoredIds[index] === String(listing.id))));
  if (alignedState) {
    totalCount = alignedState.totalCount;
    rawItems.forEach((item, index) => {
      const listing = alignedState.listings[index];
      // Grouped cards have no DOM href; only use a position corroborated by the other IDs.
      if (!item.href && item.anunciosAgrupados > 1
          && typeof listing.href === 'string'
          && listing.href.match(/id-(\d+)/)?.[1] === String(listing.id)) item.href = listing.href;
      const advertiser = listing.realEstate || listing.advertiser;
      if (!item.imobiliaria && advertiser && typeof advertiser.name === 'string') {
        item.imobiliaria = clean(advertiser.name);
      }
    });
  }
  return {
    rawItems,
    cardCount: cards.length,
    paginationLinks,
    pagerPresent: Boolean(pager),
    totalCount,
    statePage,
    pageSize,
    empty: totalCount === 0 || /nenhum imovel encontrado|nao encontramos (?:nenhum )?imoveis|nao encontramos resultados/.test(normalizedBody),
    blocked: !cards.length && /captcha|access denied|acesso negado|verify you are human|verifique se voce e humano/.test(normalizedBody),
    title: document.title,
  };
}

export function normalizeListing(raw, pageUrl, portal = 'zapimoveis', extractedAt = new Date().toISOString()) {
  if (!raw.href) return null;
  const url = new URL(raw.href, pageUrl);
  const expectedHost = portal === 'vivareal' ? 'www.vivareal.com.br' : 'www.zapimoveis.com.br';
  const match = url.pathname.match(/^\/imovel\/[^/]*id-(\d+)\/?$/);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || !match
      || !(raw.title || raw.price || raw.address || raw.area)) return null;
  url.search = '';
  url.hash = '';
  const { href, ...fields } = raw;
  const negocio = (url.pathname.match(/\/(?:imovel\/)?(aluguel|venda)[/-]/i)
    || new URL(pageUrl).pathname.match(/\/(aluguel|venda)\//i))?.[1]?.toLowerCase() || null;
  return { portal, listingId: match[1], negocio, ...fields, url: url.toString(), extractedAt };
}

export async function waitForListings(page, assertActive, timeoutMs = 30000, stableMs = 1000) {
  const started = Date.now();
  let previousSignature = null;
  let stableSince = started;
  while (Date.now() - started < timeoutMs) {
    assertActive();
    const snapshot = await page.evaluate(readListingDocument, 'zapimoveis');
    assertActive();
    if (snapshot.blocked || (!snapshot.cardCount && snapshot.empty)) return snapshot;
    if (snapshot.cardCount) {
      const signature = JSON.stringify([snapshot.rawItems, snapshot.paginationLinks, snapshot.totalCount, snapshot.statePage]);
      if (signature !== previousSignature) {
        previousSignature = signature;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= stableMs) {
        return snapshot;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(0, timeoutMs - (Date.now() - started)))));
  }
  assertActive();
  throw new Error(`Listagem nao ficou pronta em ${timeoutMs / 1000} segundos; nao sera tratada como pesquisa vazia.`);
}

export async function extractListings(page, portal = 'zapimoveis', readySnapshot) {
  const snapshot = readySnapshot || await page.evaluate(readListingDocument, portal);
  const extractedAt = new Date().toISOString();
  const items = snapshot.rawItems.map((raw) => normalizeListing(raw, page.url(), portal, extractedAt)).filter(Boolean);
  return { ...snapshot, items, rejectedCards: snapshot.cardCount - items.length };
}
