
/**
 * Extrai dados do cartão/listagem de imóvel.
 * Ajuste seletores conforme inspeção atual do site.
 */
export async function extractListings(page, portal) {
  const items = [];
  // Cartões comuns
  const cards = page.locator('article, .property-card, [data-testid*="property-card"]').filter({ hasText: 'R$' });

  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);

    const title = await card.locator('h2, h3, .property-card__title').first().textContent().catch(() => null);
    const price = await card.locator('span:has-text("R$"), .price, [data-testid*="price"]').first().textContent().catch(() => null);
    const address = await card.locator('.address, [data-testid*="address"], .property-card__address').first().textContent().catch(() => null);
    const area = await card.locator(':text("m²"), .area, [data-testid*="area"]').first().textContent().catch(() => null);
    const rooms = await card.locator(':text("quarto"), :text("quartos"), .rooms, [data-testid*="bedrooms"]').first().textContent().catch(() => null);
    const baths = await card.locator(':text("banheiro"), :text("banheiros"), .baths, [data-testid*="bathrooms"]').first().textContent().catch(() => null);
    const parking = await card.locator(':text("vaga"), :text("vagas"), .parking, [data-testid*="parking"]').first().textContent().catch(() => null);
    const detailUrl = await card.locator('a').first().getAttribute('href').catch(() => null);

    items.push({
      portal,
      title: title?.trim() || null,
      price: clean(price),
      address: clean(address),
      area: clean(area),
      rooms: clean(rooms),
      baths: clean(baths),
      parking: clean(parking),
      url: normalizeUrl(detailUrl, portal)
    });
  }

  return items;
}

function clean(str) {
  return str ? str.replace(/\s+/g, ' ').trim() : null;
}

function normalizeUrl(href, portal) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  const base = portal === 'vivareal' ? 'https://www.vivareal.com.br' : 'https://www.zapimoveis.com.br';
  return href.startsWith('/') ? `${base}${href}` : `${base}/${href}`;
}
