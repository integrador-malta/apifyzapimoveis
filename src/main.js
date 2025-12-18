
// src/main.js
import { Actor, log } from 'apify';
import { PlaywrightCrawler, sleep } from 'crawlee';
import { extractListings } from './helpers/extract.js';

await Actor.main(async () => {
  const input = await Actor.getInput();
  const {
    links = [],
    usarProxy = true,
    maxPagesPorBairro = 10,
    headless = true,
  } = input || {};

  if (!links.length) {
    throw new Error('Forneça ao menos um link em input.links');
  }

  log.info(`Links recebidos: ${links.length}`);

  const requestQueue = await Actor.openRequestQueue();

  for (const seedUrl of links) {
    log.info(`Adicionando à fila: ${seedUrl}`);
    await requestQueue.addRequest({ url: seedUrl, userData: { label: 'LIST', seedUrl, pageNum: 1 } });
  }

  const crawler = new PlaywrightCrawler({
    requestQueue,
    maxConcurrency: 1,
    maxRequestRetries: 2,
    proxyConfiguration: usarProxy ? await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'] }) : null,
    headless,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 180,
    browserPoolOptions: {
      useFingerprints: true,
    },
    sessionPoolOptions: {
      maxPoolSize: 3,
      sessionOptions: {
        maxUsageCount: 5,
      },
    },
    preNavigationHooks: [
      async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });

        // Define headers para reduzir bloqueios e parecer navegador real
        const context = page.context();
        await context.setExtraHTTPHeaders({
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        });
      },
    ],
    postNavigationHooks: [
      async ({ page }) => {
        log.info('Aguardando carregamento da página...');
        // Aguarda recursos críticos em vez de networkidle completo
        await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {
          log.warning('Timeout no domcontentloaded');
        });
        
        log.info('Fazendo scroll para carregar conteúdo...');
        for (let i = 0; i < 2; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await sleep(500);
        }
      },
    ],
    requestHandler: async ({ request, page }) => {
      const { seedUrl, pageNum } = request.userData;

      log.info(`Processando seed: ${seedUrl} | Página ${pageNum}`);
      log.info(`URL: ${request.url}`);

      try {
        // Verificar conteúdo da página
        const bodyText = await page.evaluate(() => document.body.innerText);
        log.info(`Tamanho do conteúdo: ${bodyText.length} caracteres`);

        // Esperar seletor aparecer (mais curto agora)
        log.info('Procurando cards de imóveis...');
        await page.waitForSelector('li[data-cy="rp-property-cd"]', {
          timeout: 15000,
        }).catch(() => {
          log.warning('Seletor rp-property-cd não encontrado (pode ser 403 ou bloqueio)');
        });

        const items = await extractListings(page, 'zapimoveis');
        log.info(`✓ Encontrados ${items.length} imóveis na página ${pageNum}`);

        if (items.length === 0) {
          log.warning('Nenhum item extraído. Verificando estrutura HTML...');
          const htmlSnapshot = await page.evaluate(() => {
            const cards = document.querySelectorAll('[data-testid*="property"], article, .property-card');
            return {
              totalElements: cards.length,
              firstCardHTML: cards[0]?.outerHTML.substring(0, 500) || 'Nenhum card encontrado',
            };
          });
          log.info(`Debug HTML: ${JSON.stringify(htmlSnapshot)}`);
        }

        for (const item of items) {
          await Actor.pushData({ ...item, seedUrl, pageNum });
        }

        // Tentar próxima página (somente se página cheia indica mais resultados)
        const hasMorePages = items.length === 30; // Zap Imóveis retorna 30 itens por página
        
        if (hasMorePages && pageNum < maxPagesPorBairro) {
          const nextUrl = tryBuildNextPageUrl(request.url, pageNum + 1);
          if (nextUrl) {
            log.info(`➜ Adicionando próxima página do seed (${pageNum + 1}) - página cheia detectada`);
            log.info(`  URL próxima página: ${nextUrl}`);
            await requestQueue.addRequest({
              url: nextUrl,
              userData: { label: 'LIST', seedUrl, pageNum: pageNum + 1 },
            });
          }
        } else if (!hasMorePages) {
          log.info(`✓ Última página atingida (${items.length} itens < 30) para o seed ${seedUrl}`);
        } else {
          log.info(`✓ Limite de ${maxPagesPorBairro} páginas atingido para o seed ${seedUrl}`);
        }
      } catch (err) {
        log.error(`Erro ao processar página: ${err.message}`);
        log.error(err.stack);
        throw err;
      }
    },
    failedRequestHandler: async ({ request, error }) => {
      const { pageNum } = request.userData;
      log.error(`✗ Falha na URL (página ${pageNum}): ${request.url}`);
      log.error(`Erro: ${error.message}`);
      // Registra falha mas não re-tenta mais (maxRequestRetries já controla)
      await Actor.pushData({ 
        failedUrl: request.url, 
        reason: 'request_failed', 
        error: error.message,
        pageNum,
        retryCount: request.retryCount,
      });
    },
  });

  await crawler.run();
  log.info('✓ Scraping concluído!');
});

function tryBuildNextPageUrl(currentUrl, nextPageNum) {
  try {
    const url = new URL(currentUrl);
    url.searchParams.set('pagina', String(nextPageNum));
    return url.toString();
  } catch {
    return null;
  }
}
