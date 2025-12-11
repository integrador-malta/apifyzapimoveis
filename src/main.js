
// src/main.js
import { Actor, log } from 'apify';
import { PlaywrightCrawler, sleep } from 'crawlee';
import { extractListings } from './helpers/extract.js';

await Actor.main(async () => {
  const input = await Actor.getInput();
  const {
    bairros = ['barreiro','diamante', 'sta-helena', 'milionarios', 'tirol', 'cardoso'],
    usarProxy = true,
    maxPagesPorBairro = 10,
    headless = true,
  } = input || {};

  log.info(`Bairros: ${bairros.join(', ')}`);
  log.info(`Testando com URL fixa do Zap Imóveis`);

  const requestQueue = await Actor.openRequestQueue();

  // URL fixa para teste
  for (const bairro of bairros) {
    var testUrl = '';
    if(bairro == 'sta-helena'){
      testUrl = `https://www.zapimoveis.com.br/venda/apartamentos/mg+belo-horizonte++sta-helena/?transacao=venda&onde=%2CMinas+Gerais%2CBelo+Horizonte%2C%2CSanta+Helena%2C%2C%2Cneighborhood%2CBR%3EMinas+Gerais%3ENULL%3EBelo+Horizonte%3EBarrios%3ESanta+Helena%2C-19.977143%2C-44.014492%2C&tipos=apartamento_residencial%2Ccasa_residencial&precoMaximo=700000&precoMinimo=100000&precoMaximoCondo=1200&precoMinimoCondo=100&areaMaxima=150&areaMinima=20`;
    }else{
      
      testUrl = `https://www.zapimoveis.com.br/venda/apartamentos/mg+belo-horizonte++${bairro.toLowerCase()}/?transacao=venda&onde=%2CMinas+Gerais%2CBelo+Horizonte%2C%2C${bairro}%2C%2C%2Cneighborhood%2CBR%3EMinas+Gerais%3ENULL%3EBelo+Horizonte%3EBarrios%3E${bairro}%2C-19.977143%2C-44.014492%2C&tipos=apartamento_residencial%2Ccasa_residencial&precoMaximo=700000&precoMinimo=100000&precoMaximoCondo=1200&precoMinimoCondo=100&areaMaxima=150&areaMinima=20`;
    }
    /* const testUrl = `https://www.zapimoveis.com.br/venda/apartamentos/mg+belo-horizonte++${bairro}/?transacao=venda&onde=%2CMinas+Gerais%2CBelo+Horizonte%2C%2C${bairro}%2C%2C%2Cneighborhood%2CBR%3EMinas+Gerais%3ENULL%3EBelo+Horizonte%3EBarrios%3E${bairro}%2C-19.977143%2C-44.014492%2C&tipos=apartamento_residencial%2Ccasa_residencial&precoMaximo=700000&precoMinimo=100000&precoMaximoCondo=1200&precoMinimoCondo=100&areaMaxima=150&areaMinima=20`;
     */log.info(`Adicionando à fila: ${testUrl}`);
    await requestQueue.addRequest({ url: testUrl, userData: { label: 'LIST', bairro, pageNum: 1 } });
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
      const { bairro, pageNum } = request.userData;

      log.info(`Processando: ${bairro} | Página ${pageNum}`);

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
          await Actor.pushData({ ...item, bairro, pageNum });
        }

        // Tentar próxima página
        if (pageNum < maxPagesPorBairro) {
          const nextUrl = tryBuildNextPageUrl(request.url, pageNum + 1);
          if (nextUrl) {
            log.info(`➜ Adicionando página ${pageNum + 1}`);
            await requestQueue.addRequest({
              url: nextUrl,
              userData: { label: 'LIST', bairro, pageNum: pageNum + 1 },
            });
          }
        } else {
          log.info(`✓ Limite de ${maxPagesPorBairro} páginas atingido para ${bairro}`);
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
