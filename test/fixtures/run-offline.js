import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

const mode = process.argv[2];
const seed = 'https://www.zapimoveis.com.br/venda/apartamentos/mg+belo-horizonte++barreiro/';
const card = (id) => `<li data-cy="rp-property-cd">
  <a href="/imovel/venda-apartamento-id-${id}/"><span data-cy="rp-cardProperty-location-txt">Barreiro</span>
  <div data-cy="rp-cardProperty-price-txt"><p>R$ 100.000</p></div></a></li>`;
PlaywrightCrawler.prototype._navigationHandler = async (context, gotoOptions) => {
  await context.page.route('**/*', async (route) => {
    if (!route.request().isNavigationRequest()) return route.abort();
    const url = new URL(route.request().url());
    if (url.hostname !== 'www.zapimoveis.com.br') throw new Error('Offline test refused an unexpected navigation.');
    if (mode === 'blocked') return route.fulfill({ status: 403, contentType: 'text/html', body: '<h1>Access denied</h1>' });
    const number = Number(url.searchParams.get('page') || 1);
    if (mode === 'empty') return route.fulfill({ contentType: 'text/html', body: '<h1>Nenhum imovel encontrado</h1>' });
    const ids = number === 1 || mode === 'repeated' ? Array.from({ length: 31 }, (_, index) => index + 1) : [31, 32];
    const promotion = mode === 'promotion' ? `<li data-cy="rp-property-cd" data-type="FIXED TOP">
      <a href="/imobiliaria/827222/">Real Imobiliaria</a></li>` : '';
    const unresolved = mode === 'rejected' && number === 1 ? `<li data-cy="rp-property-cd">
      <span data-cy="rp-cardProperty-location-txt">Unresolved grouped property</span>
      <button data-cy="listing-card-deduplicated-button">Ver os 2 anuncios</button></li>` : '';
    const unknownPager = mode === 'unknown-pagination';
    const activeNumber = mode === 'wrong-page' && number === 2 ? 1 : number;
    const next = number === 1 ? `<a aria-label="pr\u00f3xima p\u00e1gina" href="${seed}?page=2">Next</a>` : '';
    return route.fulfill({
      contentType: 'text/html',
      body: `<ul>${promotion}${ids.map(card).join('')}${unresolved}</ul>${unknownPager ? '' : `<div class="olx-core-pagination">
        <a class="olx-core-pagination__button--active" href="${seed}?page=${activeNumber}">${activeNumber}</a>${next}</div>`}`,
    });
  });
  return context.page.goto(context.request.url, gotoOptions);
};

await Actor.init();
await Actor.setValue('INPUT', {
  links: [seed], usarProxy: false, maxPagesPorBairro: ['limited', 'partial'].includes(mode) ? 1 : 3,
  maxRequestsPerMinute: 60, pageReadyTimeoutSecs: 5, failOnIncomplete: mode !== 'partial',
});
await import('../../src/main.js');
