import { readFile } from 'node:fs/promises';
import { Actor, log } from 'apify';
import { PlaywrightCrawler, RequestState } from 'crawlee';
import { tryCancel } from '@apify/timeout';
import { extractListings, waitForDetail, waitForListings } from './helpers/extract.js';
import { pageSignature, resolvePagination, validateInput, validateObservedPage, validateSearchNavigation } from './helpers/pagination.js';
import { createSummary, ListingOutput, seedStatus } from './helpers/output.js';

await Actor.main(async () => {
  const config = validateInput(await Actor.getInput());
  const { links, usarProxy, headless, maxPagesPorBairro, pageReadyTimeoutSecs, maxRequestsPerMinute, proxyCountryCode } = config;
  const env = Actor.getEnv();
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const build = { version, actorBuildId: env.actorBuildId, actorRunId: env.actorRunId };
  const store = await Actor.openKeyValueStore();
  const dataset = await Actor.openDataset();
  const errors = await Actor.openDataset(`falhas-${env.actorRunId || 'local'}`);
  const output = new ListingOutput(dataset);
  await output.restore();
  const state = await store.getValue('SCRAPE_STATE') || { schemaVersion: 1, seeds: {}, failures: {} };
  if (state.schemaVersion !== 1) throw new Error('Checkpoint de scraping possui versao incompativel.');
  state.enrichments ||= {};
  const persist = () => store.setValue('SCRAPE_STATE', state);
  const requestQueue = await Actor.openRequestQueue();
  const enqueue = (seedUrl, url, pageNum) => requestQueue.addRequest({
    url, uniqueKey: `${seedUrl}::${pageNum}`, userData: { seedUrl, pageNum },
  });
  const enqueueDetail = async (item, seedUrl, pageNum) => {
    const key = `${item.portal}:${item.listingId}`;
    if (output.ids.has(key) && state.enrichments[key]?.status !== 'pending') return;
    state.enrichments[key] ||= { status: 'pending', item, seedUrl, pageNum };
    const enrichment = state.enrichments[key];
    if (enrichment.status === 'pending') {
      await persist();
      await requestQueue.addRequest({
        url: enrichment.item.url, uniqueKey: `DETAIL:${key}`,
        userData: { kind: 'DETAIL', enrichmentKey: key, seedUrl: enrichment.seedUrl, pageNum: enrichment.pageNum },
      });
    }
  };
  for (const seedUrl of links) {
    state.seeds[seedUrl] ||= { seedUrl, status: 'pending', pages: {}, attempts: [], failures: [] };
    await enqueue(seedUrl, seedUrl, 1);
    for (const checkpoint of Object.values(state.seeds[seedUrl].pages)) {
      if (checkpoint.nextUrl && checkpoint.pageNum < maxPagesPorBairro) {
        const queued = await enqueue(seedUrl, checkpoint.nextUrl, checkpoint.pageNum + 1);
        if (!queued.wasAlreadyHandled && state.seeds[seedUrl].status === 'limited') state.seeds[seedUrl].status = 'running';
      }
    }
  }
  for (const enrichment of Object.values(state.enrichments)) {
    if (enrichment.status === 'pending') await enqueueDetail(enrichment.item, enrichment.seedUrl, enrichment.pageNum);
  }
  await persist();
  log.info('Iniciando coleta', { ...build, links: links.length, maxPagesPorBairro, uniqueListings: output.ids.size });

  const saveDiagnostic = async ({ request, page, session, proxyInfo }, error, final) => {
    const key = `DIAGNOSTIC-${request.id}-${request.retryCount}-${final ? 'final' : 'retry'}`;
    const diagnostic = {
      url: request.url,
      ...request.userData.lastResponse,
      extraction: request.userData.extractionDiagnostic,
      error: error.message,
      retryCount: request.retryCount,
      sessionId: session?.id,
      proxyCountryCode: proxyInfo?.countryCode,
      capturedAt: new Date().toISOString(),
      diagnosticKey: key,
    };
    if (page && !page.isClosed()) {
      let timer;
      try {
        const snapshot = await Promise.race([
          page.evaluate(() => ({
            title: document.title,
            html: document.documentElement.outerHTML.slice(0, 200000),
          })),
          new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Captura de diagnostico excedeu 5 segundos.')), 5000);
          }),
        ]);
        diagnostic.title = snapshot.title;
        await store.setValue(`${key}-HTML`, snapshot.html, { contentType: 'text/html' });
      } catch (captureError) {
        log.warning('Nao foi possivel capturar HTML de diagnostico', { error: captureError.message, url: request.url });
        diagnostic.captureError = captureError.message;
      } finally {
        clearTimeout(timer);
      }
    }
    await store.setValue(key, diagnostic);
    return diagnostic;
  };

  const crawler = new PlaywrightCrawler({
    requestQueue,
    maxConcurrency: 1,
    maxRequestsPerMinute,
    maxRequestRetries: 2,
    proxyConfiguration: usarProxy
      ? await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'], countryCode: proxyCountryCode })
      : undefined,
    headless,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 180,
    browserPoolOptions: { useFingerprints: true },
    sessionPoolOptions: { maxPoolSize: 3, sessionOptions: { maxUsageCount: 5 } },
    preNavigationHooks: [
      async ({ page, request }, gotoOptions) => {
        delete request.userData.lastResponse;
        delete request.userData.extractionDiagnostic;
        gotoOptions.waitUntil = 'domcontentloaded';
        await page.context().setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7' });
      },
    ],
    postNavigationHooks: [
      async ({ request, page, response }) => {
        request.userData.lastResponse = {
          httpStatus: response?.status(),
          loadedUrl: page.url(),
          title: await page.title(),
        };
      },
    ],
    requestHandler: async ({ request, page }) => {
      const { seedUrl, pageNum } = request.userData;
      const seed = state.seeds[seedUrl];
      const deadline = Date.now() + 170000;
      const assertActive = () => {
        tryCancel();
        if (page.isClosed() || request.state !== RequestState.REQUEST_HANDLER || Date.now() >= deadline) {
          throw new Error('Extracao cancelada ou prazo seguro de gravacao excedido.');
        }
      };
      if (request.userData.kind === 'DETAIL') {
        const enrichment = state.enrichments[request.userData.enrichmentKey];
        if (enrichment.status !== 'pending') return;
        const item = await waitForDetail(page, enrichment.item, assertActive, pageReadyTimeoutSecs * 1000);
        assertActive();
        await output.save([item], { seedUrl, pageNum }, assertActive);
        assertActive();
        enrichment.item = item;
        enrichment.status = 'complete';
        await persist();
        assertActive();
        log.info('Metadados completados no detalhe', {
          listingId: item.listingId, imobiliaria: item.imobiliaria, tipoImovel: item.tipoImovel,
        });
        return;
      }
      const checkpoint = seed.pages[pageNum];
      if (checkpoint) {
        assertActive();
        if (checkpoint.nextUrl && pageNum < maxPagesPorBairro) {
          await enqueue(seedUrl, checkpoint.nextUrl, pageNum + 1);
          assertActive();
        }
        log.info('Pagina ja gravada; checkpoint reutilizado', { seedUrl, pageNum });
        return;
      }
      log.info('Processando pesquisa', { seedUrl, pageNum, url: request.url });
      validateSearchNavigation(request.url, page.url());
      const readySnapshot = await waitForListings(page, assertActive, pageReadyTimeoutSecs * 1000);
      assertActive();
      const snapshot = await extractListings(page, 'zapimoveis', readySnapshot);
      assertActive();
      const extractionKey = `EXTRACTION-${request.id}-${request.retryCount}`;
      request.userData.extractionDiagnostic = {
        diagnosticKey: extractionKey, cards: snapshot.cardCount,
        totalElements: snapshot.totalElements, ignoredCards: snapshot.ignoredCards,
        rejectedCards: snapshot.rejectedCards, rejections: snapshot.rejections,
        structuredListings: snapshot.structuredListings,
      };
      if (snapshot.rejectedCards) {
        const rejectedHtml = await page.evaluate((indices) => {
          const cards = [...document.querySelectorAll('li[data-cy="rp-property-cd"]')];
          return indices.map((index) => ({
            index, html: cards[index]?.outerHTML.slice(0, 20000) || null,
            truncated: (cards[index]?.outerHTML.length || 0) > 20000,
          }));
        }, snapshot.rejections.map((card) => card.index));
        assertActive();
        await store.setValue(extractionKey, {
          ...request.userData.extractionDiagnostic, seedUrl, pageNum,
          url: page.url(), capturedAt: new Date().toISOString(), rejectedHtml,
        });
        assertActive();
      }
      if (snapshot.blocked) throw new Error('Pagina de bloqueio recebida sem anuncios.');
      if (!snapshot.cardCount && !snapshot.empty) throw new Error('Pagina sem cards e sem evidencia de pesquisa vazia.');
      if (snapshot.cardCount && snapshot.empty) throw new Error('Pagina apresenta cards e indicador de pesquisa vazia inconsistentes.');
      validateObservedPage(snapshot, page.url(), pageNum);
      if (snapshot.rejectedCards) {
        log.warning('Pagina parcial; anuncios validos serao preservados', {
          seedUrl, pageNum, cards: snapshot.cardCount, rejectedCards: snapshot.rejectedCards,
          diagnosticKey: extractionKey,
        });
      }
      const signature = pageSignature(snapshot.items);
      if (signature && Object.values(seed.pages).some((previous) => previous.signature === signature)) {
        throw new Error('Pagina repetida: mesmos IDs de anuncios em paginas diferentes.');
      }
      const completeItems = snapshot.items.filter((item) => item.imobiliaria && item.tipoImovel);
      const deferredItems = snapshot.items.filter((item) => !item.imobiliaria || !item.tipoImovel);
      const saved = await output.save(completeItems, { seedUrl, pageNum }, assertActive);
      assertActive();
      for (const item of completeItems) {
        const enrichment = state.enrichments[`${item.portal}:${item.listingId}`];
        if (enrichment?.status === 'pending') {
          enrichment.item = item;
          enrichment.status = 'complete';
        }
      }
      for (const item of deferredItems) {
        await enqueueDetail(item, seedUrl, pageNum);
        assertActive();
      }
      const pagination = resolvePagination(snapshot, page.url(), pageNum);
      if (pagination.nextUrl && pageNum < maxPagesPorBairro) {
        await enqueue(seedUrl, pagination.nextUrl, pageNum + 1);
        assertActive();
      }
      seed.pages[pageNum] = {
        pageNum, url: page.url(), signature, nextUrl: pagination.nextUrl,
        listingIds: [...new Set(snapshot.items.map((item) => item.listingId))],
        cardCount: snapshot.cardCount, totalCount: snapshot.totalCount, newListings: saved,
        detailRequestedIds: deferredItems.map((item) => item.listingId),
        rejectedCards: snapshot.rejectedCards, ignoredPromotions: snapshot.ignoredCards.length,
        ignoredCards: snapshot.ignoredCards,
        extractionDiagnosticKey: snapshot.rejectedCards ? extractionKey : null,
        rejectionReasons: snapshot.rejections.reduce((counts, card) => {
          counts[card.reason] = (counts[card.reason] || 0) + 1;
          return counts;
        }, {}),
        missingFields: Object.fromEntries(['price', 'address', 'area', 'rooms', 'baths', 'parking', 'imobiliaria', 'tipoImovel']
          .map((field) => [field, snapshot.items.filter((item) => !item[field]).length])),
      };
      seed.status = seedStatus(seed, pagination, pageNum, maxPagesPorBairro, snapshot.empty);
      await persist();
      assertActive();
      log.info('Pagina validada e gravada', {
        seedUrl, pageNum, cards: snapshot.cardCount, newListings: saved,
        nextUrl: pagination.nextUrl, status: seed.status,
        rejectedCards: snapshot.rejectedCards, ignoredPromotions: snapshot.ignoredCards.length,
        missingFields: seed.pages[pageNum].missingFields,
      });
    },
    errorHandler: async (context, error) => {
      const diagnostic = await saveDiagnostic(context, error, false);
      const seed = state.seeds[context.request.userData.seedUrl];
      seed.attempts.push({ ...diagnostic, pageNum: context.request.userData.pageNum });
      await persist();
      log.warning('Tentativa falhou; Crawlee aplicara retry', diagnostic);
    },
    failedRequestHandler: async (context, error) => {
      const { request } = context;
      const { seedUrl, pageNum } = request.userData;
      const diagnostic = await saveDiagnostic(context, error, true);
      const failure = { ...diagnostic, seedUrl, pageNum, reason: 'request_failed' };
      if (request.userData.kind === 'DETAIL') {
        const enrichment = state.enrichments[request.userData.enrichmentKey];
        const assertFinalizing = () => {
          tryCancel();
          if (enrichment.status !== 'pending') throw new Error('Enriquecimento ja finalizado.');
        };
        await output.save([enrichment.item], { seedUrl, pageNum }, assertFinalizing);
        await errors.pushData({
          ...failure, reason: 'detail_enrichment_failed', listingId: enrichment.item.listingId,
        });
        enrichment.status = 'failed';
        enrichment.error = error.message;
        enrichment.diagnosticKey = diagnostic.diagnosticKey;
        await persist();
        log.error('Nao foi possivel completar metadados; anuncio original preservado', {
          listingId: enrichment.item.listingId, error: error.message,
        });
        return;
      }
      if (!state.failures[request.uniqueKey]) {
        await errors.pushData(failure);
        state.failures[request.uniqueKey] = failure;
        state.seeds[seedUrl].failures.push(failure);
      }
      state.seeds[seedUrl].status = 'failed';
      await persist();
      log.error('Pesquisa incompleta apos esgotar tentativas', failure);
    },
  });

  try {
    await crawler.run();
  } finally {
    await output.restore();
    await persist();
    const summary = createSummary(state, output.ids.size, build);
    summary.errorsDatasetId = errors.id;
    await store.setValue('SUMMARY', summary);
    log.info('Resumo de cobertura', {
      uniqueListings: summary.uniqueListings, pagesProcessed: summary.pagesProcessed,
      completeSeeds: summary.completeSeeds, emptySeeds: summary.emptySeeds,
      incompleteSeeds: summary.incompleteSeeds, errorsDatasetId: errors.id,
      partialPages: summary.partialPages, rejectedCards: summary.rejectedCards,
      ignoredPromotions: summary.ignoredPromotions,
      detailEnrichments: summary.detailEnrichments,
    });
  }
  const summary = createSummary(state, output.ids.size, build);
  if ((summary.incompleteSeeds || summary.detailEnrichments.failed || summary.detailEnrichments.pending) && config.failOnIncomplete) {
    throw new Error(`Coleta incompleta: ${summary.incompleteSeeds} pesquisas; ${summary.detailEnrichments.failed} detalhes falharam; ${summary.detailEnrichments.pending} pendentes. Consulte SUMMARY e o dataset de falhas ${errors.id}.`);
  }
  if (summary.incompleteSeeds || summary.detailEnrichments.failed || summary.detailEnrichments.pending) {
    log.warning('Coleta encerrada com cobertura ou metadados parciais; consulte SUMMARY.');
  }
  else log.info('Coleta concluida com todas as pesquisas verificadas.');
});
