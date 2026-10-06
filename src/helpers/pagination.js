export function validateInput(input) {
  const config = {
    links: [], usarProxy: true, maxPagesPorBairro: 10, headless: true,
    proxyCountryCode: 'BR', pageReadyTimeoutSecs: 30, maxRequestsPerMinute: 10, failOnIncomplete: true,
    ...input,
  };
  if (!Array.isArray(config.links) || !config.links.length) throw new Error('Forneca ao menos um link em input.links.');
  for (const key of ['maxPagesPorBairro', 'pageReadyTimeoutSecs', 'maxRequestsPerMinute']) {
    if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error(`${key} deve ser um inteiro positivo.`);
  }
  if (config.pageReadyTimeoutSecs > 90) throw new Error('pageReadyTimeoutSecs nao pode exceder 90 segundos.');
  for (const key of ['usarProxy', 'headless', 'failOnIncomplete']) {
    if (typeof config[key] !== 'boolean') throw new Error(`${key} deve ser booleano.`);
  }
  if (!/^[A-Z]{2}$/.test(config.proxyCountryCode)) throw new Error('proxyCountryCode deve ser um codigo de pais com duas letras maiusculas.');
  config.links = [...new Set(config.links.map((value) => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.zapimoveis.com.br'
        || !/^\/(venda|aluguel)\//.test(url.pathname) || url.username || url.password) {
      throw new Error(`Link de pesquisa Zap invalido: ${value}`);
    }
    url.hash = '';
    const page = getPageNumber(url.toString());
    if (page !== 1) throw new Error(`Forneca links da primeira pagina: ${value}`);
    return url.toString();
  }))];
  return config;
}

export function getPageNumber(value) {
  const url = new URL(value);
  const raw = url.searchParams.get('page') ?? url.searchParams.get('pagina') ?? '1';
  const page = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(page) || page < 1) throw new Error(`Pagina invalida na URL: ${value}`);
  return page;
}

export function resolvePagination(snapshot, currentUrl, pageNum) {
  const current = new URL(currentUrl);
  const active = snapshot.paginationLinks.find((link) => link.active);
  const observedPage = active ? getPageNumber(new URL(active.href, current).toString()) : snapshot.statePage;
  if (observedPage != null && observedPage !== pageNum) {
    throw new Error(`Pagina repetida ou redirecionada: esperada ${pageNum}, recebida ${observedPage}.`);
  }
  const next = snapshot.paginationLinks.find((link) => !link.disabled && /pr[o\u00f3]xima|next/i.test(link.label))
    || snapshot.paginationLinks.find((link) => !link.disabled && getPageNumber(new URL(link.href, current).toString()) === pageNum + 1);
  if (next) {
    const url = new URL(next.href, current);
    if (url.origin !== current.origin || url.pathname !== current.pathname
        || getPageNumber(url.toString()) !== pageNum + 1) {
      throw new Error(`Link de proxima pagina inconsistente: ${url}`);
    }
    validateSearchNavigation(current.toString(), url.toString());
    return { nextUrl: url.toString(), verifiedEnd: false };
  }
  if (snapshot.pagerPresent) {
    const hasLater = snapshot.paginationLinks.some((link) => !link.disabled
      && getPageNumber(new URL(link.href, current).toString()) > pageNum);
    if (hasLater) throw new Error('Paginacao possui paginas posteriores, mas nao permite identificar a proxima.');
    if (!active || (snapshot.totalCount != null && snapshot.pageSize > 0
        && pageNum * snapshot.pageSize < snapshot.totalCount)) {
      throw new Error('Paginacao incompleta: nao ha evidencia confiavel da ultima pagina.');
    }
    return { nextUrl: null, verifiedEnd: true };
  }
  if (snapshot.totalCount != null && snapshot.pageSize > 0) {
    if (pageNum * snapshot.pageSize >= snapshot.totalCount) return { nextUrl: null, verifiedEnd: true };
    current.searchParams.delete('pagina');
    current.searchParams.set('page', String(pageNum + 1));
    return { nextUrl: current.toString(), verifiedEnd: false };
  }
  if (snapshot.empty && pageNum === 1) return { nextUrl: null, verifiedEnd: true };
  throw new Error('Nao foi possivel confirmar a paginacao ou o fim da pesquisa.');
}

export function validateSearchNavigation(requestedUrl, loadedUrl) {
  const requested = new URL(requestedUrl);
  const loaded = new URL(loadedUrl);
  if (requested.origin !== loaded.origin || requested.pathname !== loaded.pathname) {
    throw new Error(`Pesquisa redirecionada para outra localizacao: ${loadedUrl}`);
  }
  for (const [key, value] of requested.searchParams) {
    if (['page', 'pagina', '__ab'].includes(key)) continue;
    if (!loaded.searchParams.getAll(key).includes(value)) {
      throw new Error(`Filtro ${key} foi removido ou alterado na navegacao.`);
    }
  }
}

export function pageSignature(items) {
  return [...new Set(items.map((item) => item.listingId))].sort().join(',');
}
