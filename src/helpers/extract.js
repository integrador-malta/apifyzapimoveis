
/**
 * Extrai dados do cartão/listagem de imóvel.
 * Otimizado para Zap Imóveis e Viva Real
 */
export async function extractListings(page, portal) {
  const items = [];
  
  let cards;
  if (portal === 'zapimoveis') {
    // Seletores específicos para Zap Imóveis (resultado de busca)
    cards = page.locator('li[data-cy="rp-property-cd"]');
  } else {
    // Viva Real e outros
    cards = page.locator('article, .property-card, [data-testid*="property-card"]');
  }

  const count = await cards.count();
  
  if (count === 0) {
    console.warn(`[${portal}] Nenhum card encontrado com os seletores atuais`);
    return items;
  }

  for (let i = 0; i < count; i++) {
    try {
      const card = cards.nth(i);

      // Extrair dados com fallbacks
      let title, price, address, area, rooms, baths, parking, detailUrl;

      if (portal === 'zapimoveis') {
        // Zap Imóveis - estrutura específica de ranking
        const anchor = card.locator('a[href]').first();

        title = await card
          .locator('[data-cy="rp-cardProperty-location-txt"]')
          .first()
          .innerText()
          .catch(() => null);

        price = await card
          .locator('[data-cy="rp-cardProperty-price-txt"] p')
          .first()
          .innerText()
          .catch(() => null);

        address = await card
          .locator('[data-cy="rp-cardProperty-street-txt"]')
          .first()
          .innerText()
          .catch(() => null);

        area = await card
          .locator('[data-cy="rp-cardProperty-propertyArea-txt"]')
          .first()
          .innerText()
          .catch(() => null);

        rooms = await card
          .locator('[data-cy="rp-cardProperty-bedroomQuantity-txt"]')
          .first()
          .innerText()
          .catch(() => null);

        baths = await card
          .locator('[data-cy="rp-cardProperty-bathroomQuantity-txt"]')
          .first()
          .innerText()
          .catch(() => null);

        parking = await card
          .locator('[data-cy="rp-cardProperty-parkingSpacesQuantity-txt"]')
          .first()
          .innerText()
          .catch(() => null);

        detailUrl = await anchor.getAttribute('href').catch(() => null);
      } else {
        // Viva Real e outros - seletores genéricos
        title = await card.locator('h2, h3, .property-card__title').first().textContent().catch(() => null);
        price = await card.locator('span:has-text("R$"), .price, [data-testid*="price"]').first().textContent().catch(() => null);
        address = await card.locator('.address, [data-testid*="address"], .property-card__address').first().textContent().catch(() => null);
        area = await card.locator(':text("m²"), .area, [data-testid*="area"]').first().textContent().catch(() => null);
        rooms = await card.locator(':text("quarto"), :text("quartos")').first().textContent().catch(() => null);
        baths = await card.locator(':text("banheiro"), :text("banheiros")').first().textContent().catch(() => null);
        parking = await card.locator(':text("vaga"), :text("vagas")').first().textContent().catch(() => null);
        detailUrl = await card.locator('a').first().getAttribute('href').catch(() => null);
      }

      items.push({
        portal,
        title: clean(title),
        price: clean(price),
        address: clean(address),
        area: clean(area),
        rooms: clean(rooms),
        baths: clean(baths),
        parking: clean(parking),
        url: normalizeUrl(detailUrl, portal),
        extractedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`Erro ao extrair card ${i}:`, err.message);
    }
  }

  console.info(`[${portal}] Extraídos ${items.length} imóveis`);
  return items;
}

function clean(str) {
  if (!str) return null;
  // Remove múltiplos espaços e caracteres especiais
  return str
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove caracteres invisíveis
    .trim() || null;
}

function normalizeUrl(href, portal) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  const base = portal === 'vivareal' ? 'https://www.vivareal.com.br' : 'https://www.zapimoveis.com.br';
  return href.startsWith('/') ? `${base}${href}` : `${base}/${href}`;
}
