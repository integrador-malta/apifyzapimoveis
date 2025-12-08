
// src/main.js
import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { buildSearchUrl, applyFilters } from './helpers/navigation.js';
import { extractListings } from './helpers/extract.js';

await Actor.main(async () => {
  const input = await Actor.getInput();
  const {
    portal = 'vivareal',
    bairros = ['Savassi'],
    tipoImovel = 'apartamento',
    negocio = 'venda',
    precoMin = 0,
    precoMax = 0,
    quartosMin = 0,
    banheirosMin = 0,
    usarProxy = true,
    maxPagesPorBairro = 10,
    headless = true,
  } = input || {};

  log.info(`Portal: ${portal} | Negócio: ${negocio}`);
  log.info(`Bairros: ${bairros.join(', ')}`);

  const requestQueue = await Actor.openRequestQueue();

  for (const bairro of bairros) {
    const url = buildSearchUrl(portal, bairro, negocio);
    await requestQueue.addRequest({ url, userData: { label: 'LIST', bairro, pageNum: 1 } });
  }

  const crawler = new PlaywrightCrawler({
    requestQueue,
    maxConcurrency: 2,
    // Proxy do Apify via Actor:
    proxyConfiguration: usarProxy ? await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'] }) : null,
    headless,
    navigationTimeoutSecs: 45,
    browserPoolOptions: {
      useFingerprints: true,
    },
    preNavigationHooks: [
      async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
      },
    ],
    postNavigationHooks: [
      async ({ page }) => {
        for (let i = 0; i < 5; i++) {
          await page.mouse.wheel(0, 1000);
          await Actor.sleep(500);
        }
      },
    ],
    requestHandler: async ({ request, page }) => {
      const { bairro, pageNum } = request.userData;

      log.info(`Processando: ${bairro} | Página ${pageNum} | ${request.url}`);

      if (pageNum === 1) {
        await applyFilters(page, { portal, tipoImovel, precoMin, precoMax, quartosMin, banheirosMin });
      }

      const items = await extractListings(page, portal);
      log.info(`Encontrados ${items.length} itens na página ${pageNum}.`);

      for (const item of items) {
        await Actor.pushData({ ...item, bairro, pageNum });
      }

      let clicked = false;
      const nextSelectors = [
        'a[rel="next"]',
        'button:has-text("Próxima"), a:has-text("Próxima")',
        'a.pagination__next, .pagination a.next',
      ];

      for (const sel of nextSelectors) {
        const nextEl = page.locator(sel).first();
        if (await nextEl.count() > 0 && pageNum < maxPagesPorBairro) {
          await Promise.allSettled([
            nextEl.click(),
            page.waitForLoadState('networkidle', { timeout: 15000 }),
          ]);
          clicked = true;
          break;
        }
      }

      if (!clicked && pageNum < maxPagesPorBairro) {
        const nextUrl = tryBuildNextPageUrl(request.url, pageNum + 1, portal);
        if (nextUrl) {
          await requestQueue.addRequest({
            url: nextUrl,
            userData: { label: 'LIST', bairro, pageNum: pageNum + 1 },
          });
        }
      }
    },
    failedRequestHandler: async ({ request }) => {
      log.error(`Falhou: ${request.url}`);
      await Actor.pushData({ failedUrl: request.url, reason: 'failedRequest' });
    },
  });

  await crawler.run();
});

function tryBuildNextPageUrl(currentUrl, nextPageNum, portal) {
  try {
    const url = new URL(currentUrl);
    if (portal === 'vivareal' || portal === 'zapimoveis') {
      url.searchParams.set('pagina', String(nextPageNum));
    } else {
      url.searchParams.set('page', String(nextPageNum));
    }
    return url.toString();
  } catch {
    return null;
  }
}
