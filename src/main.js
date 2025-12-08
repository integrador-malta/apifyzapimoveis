
// src/main.js
import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { buildSearchUrl } from './helpers/navigation.js';
import { extractListings } from './helpers/extract.js';

await Actor.main(async () => {
  const input = await Actor.getInput();
  const {
    portal = 'zapimoveis',
    bairros = ['Barreiro'],
    tipoImovel = 'apartamento',
    negocio = 'venda',
    precoMin = 100000,
    precoMax = 700000,
    quartosMin = '1,2,3,4',
    banheirosMin = '1,2,3,4',
    vagasMin = '1,2,3,4',
    areaMin = 20,
    areaMax = 150,
    usarProxy = true,
    maxPagesPorBairro = 10,
    headless = true,
  } = input || {};

  log.info(`Portal: ${portal} | Negócio: ${negocio}`);
  log.info(`Bairros: ${bairros.join(', ')}`);
  log.info(`Filtros: R$ ${precoMin.toLocaleString('pt-BR')} - R$ ${precoMax.toLocaleString('pt-BR')}`);

  const requestQueue = await Actor.openRequestQueue();

  // Construir URLs com filtros via query parameters
  const filters = {
    precoMin,
    precoMax,
    quartos: quartosMin,
    banheiros: banheirosMin,
    vagas: vagasMin,
    areaMin,
    areaMax,
  };

  for (const bairro of bairros) {
    const url = buildSearchUrl(portal, bairro, negocio, filters);
    log.info(`Adicionando à fila: ${url}`);
    await requestQueue.addRequest({ url, userData: { label: 'LIST', bairro, pageNum: 1 } });
  }

  const crawler = new PlaywrightCrawler({
    requestQueue,
    maxConcurrency: 2,
    proxyConfiguration: usarProxy ? await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'] }) : null,
    headless,
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 120,
    browserPoolOptions: {
      useFingerprints: true,
    },
    preNavigationHooks: [
      async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        // User-Agent realista
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
      },
    ],
    postNavigationHooks: [
      async ({ page }) => {
        // Aguardar carregamento da página
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        
        // Scroll para trigger lazy loading
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await Actor.sleep(800);
        }
      },
    ],
    requestHandler: async ({ request, page }) => {
      const { bairro, pageNum } = request.userData;

      log.info(`Processando: ${bairro} | Página ${pageNum}`);

      try {
        // Aguardar conteúdo carregado
        await page.waitForSelector('[data-testid*="property"], article, .property-card', {
          timeout: 30000,
        }).catch(() => {
          log.warn(`Seletor não encontrado na página ${pageNum}`);
        });

        const items = await extractListings(page, portal);
        log.info(`✓ Encontrados ${items.length} imóveis na página ${pageNum}`);

        for (const item of items) {
          await Actor.pushData({ ...item, bairro, pageNum });
        }

        // Tentar próxima página
        if (pageNum < maxPagesPorBairro) {
          const nextUrl = tryBuildNextPageUrl(request.url, pageNum + 1);
          if (nextUrl) {
            await requestQueue.addRequest({
              url: nextUrl,
              userData: { label: 'LIST', bairro, pageNum: pageNum + 1 },
            });
            log.info(`➜ Adicionando página ${pageNum + 1}`);
          }
        }
      } catch (err) {
        log.error(`Erro ao processar página: ${err.message}`);
        throw err;
      }
    },
    failedRequestHandler: async ({ request, error }) => {
      log.error(`✗ Falha na URL: ${request.url} | ${error.message}`);
      await Actor.pushData({ failedUrl: request.url, reason: 'request_failed', error: error.message });
    },
  });

  await crawler.run();
  log.info('✓ Scraping concluído!');
});

function tryBuildNextPageUrl(currentUrl, nextPageNum) {
  try {
    const url = new URL(currentUrl);
    // Para Zap e Viva Real, a paginação geralmente é por query param
    url.searchParams.set('pagina', String(nextPageNum));
    return url.toString();
  } catch {
    return null;
  }
}
