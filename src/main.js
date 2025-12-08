
import Apify, { PlaywrightCrawler, log } from 'apify';
import { buildSearchUrl, applyFilters } from './helpers/navigation.js';
import { extractListings } from './helpers/extract.js';

Apify.main(async () => {
  const input = await Apify.getInput();
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

  const requestQueue = await Apify.openRequestQueue();

  // Enfileira página inicial para cada bairro
  for (const bairro of bairros) {
    const url = buildSearchUrl(portal, bairro, negocio);
    await requestQueue.addRequest({ url, userData: { label: 'LIST', bairro, pageNum: 1 } });
  }

  const crawler = new PlaywrightCrawler({
    requestQueue,
    maxConcurrency: 2, // Ajuste conforme custo/tempo
    headless,
    proxyConfiguration: usarProxy ? await Apify.createProxyConfiguration({ groups: ['RESIDENTIAL'] }) : null,
    navigationTimeoutSecs: 45,
    browserPoolOptions: {
      useFingerprints: true,
    },
    preNavigationHooks: [
      async ({ page }) => {
        // Disfarce simples: viewport + user agent randômico
        await page.setViewportSize({ width: 1280, height: 800 });
      },
    ],
    postNavigationHooks: [
      async ({ page }) => {
        // Scroll para carregar lazy content
        for (let i = 0; i < 5; i++) {
          await page.mouse.wheel(0, 1000);
          await Apify.utils.sleep(500);
        }
      },
    ],
    handlePageFunction: async ({ request, page }) => {
      const { bairro, pageNum } = request.userData;

      log.info(`Processando: ${bairro} | Página ${pageNum} | ${request.url}`);

      // Aplica filtros na primeira página do bairro
      if (pageNum === 1) {
        await applyFilters(page, { portal, tipoImovel, precoMin, precoMax, quartosMin, banheirosMin });
      }

      // Extrai imóveis da página atual
      const items = await extractListings(page, portal);
      log.info(`Encontrados ${items.length} itens na página ${pageNum}.`);

      for (const item of items) {
        await Apify.pushData({ ...item, bairro, pageNum });
      }

      // Paginação: tentar localizar botão "Próxima" ou construir URL da próxima página
      const nextButtonCandidates = [
        'a[rel="next"]',
        'button:has-text("Próxima"), a:has-text("Próxima")',
        'a.pagination__next, .pagination a.next'
      ];

      let clicked = false;
      for (const sel of nextButtonCandidates) {
        const nextEl = page.locator(sel).first();
        if (await nextEl.count() > 0 && pageNum < maxPagesPorBairro) {
          await Promise.allSettled([
            nextEl.click(),
            page.waitForLoadState('networkidle', { timeout: 15000 })
          ]);
          clicked = true;
          break;
        }
      }

      if (!clicked && pageNum < maxPagesPorBairro) {
        // Fallback: construir próxima página por query ?pagina=2 etc.
        const nextUrl = tryBuildNextPageUrl(request.url, pageNum + 1, portal);
        if (nextUrl) {
          await requestQueue.addRequest({
            url: nextUrl,
            userData: { label: 'LIST', bairro, pageNum: pageNum + 1 }
          });
        }
      }
    },
    handleFailedRequestFunction: async ({ request }) => {
      log.error(`Falhou: ${request.url}`);
      await Apify.pushData({ failedUrl: request.url, reason: 'handleFailedRequest' });
    },
  });

  await crawler.run();
});

function tryBuildNextPageUrl(currentUrl, nextPageNum, portal) {
  try {
    const url = new URL(currentUrl);
    // Muitos portais usam "pagina" ou "page"
    if (portal === 'vivareal') {
      url.searchParams.set('pagina', String(nextPageNum));
    } else if (portal === 'zapimoveis') {
      url.searchParams.set('pagina', String(nextPageNum));
    } else {
      url.searchParams.set('page', String(nextPageNum));
    }
    return url.toString();
  } catch {
    return null;
  }
}
