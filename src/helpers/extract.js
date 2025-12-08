
/**
 * Extrai dados do cartão/listagem de imóvel.
 * Otimizado para Zap Imóveis e Viva Real
 */
export async function extractListings(page, portal) {
  const items = [];
  
  let cards;
  if (portal === 'zapimoveis') {
    // Seletores específicos para Zap Imóveis
    cards = page.locator('a[data-testid="property-card"], [data-testid="search-result"], .property-card');
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
        // Zap Imóveis - estrutura específica
        title = await card.locator('[data-testid="property-card-title"], h2, h3').first().textContent().catch(() => null);
        price = await card.locator('[data-testid*="price"], span:has-text("R$")').first().textContent().catch(() => null);
        address = await card.locator('[data-testid*="address"], .property-card__address, p').first().textContent().catch(() => null);
        
        // Características (quarto, banheiro, vaga, m²)
        const features = await card.locator('[data-testid*="feature"], .property-card__features li, span[data-testid*="text"]').allTextContents().catch(() => []);
        const featureText = features.join(' ');
        
        rooms = featureText.match(/(\d+)\s*quarto/i)?.[1] || null;
        baths = featureText.match(/(\d+)\s*banhe/i)?.[1] || null;
        parking = featureText.match(/(\d+)\s*vag/i)?.[1] || null;
        area = featureText.match(/(\d+)\s*m²/i)?.[1] || null;

        detailUrl = await card.getAttribute('href').catch(() => null);
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
    .replace(/[^\w\s,.-]/g, '') // Remove caracteres especiais
    .trim() || null;
}

function normalizeUrl(href, portal) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  const base = portal === 'vivareal' ? 'https://www.vivareal.com.br' : 'https://www.zapimoveis.com.br';
  return href.startsWith('/') ? `${base}${href}` : `${base}/${href}`;
}
