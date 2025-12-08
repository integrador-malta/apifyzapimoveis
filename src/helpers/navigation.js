
import { BASES } from './constants.js';

/**
 * Gera URL inicial de busca para o portal escolhido,
 * usando a cidade e opcionalmente o bairro no path.
 */
export function buildSearchUrl(portal, bairro, negocio = 'venda') {
  const base = BASES[portal];
  const pathByPortal = {
    vivareal: negocio === 'aluguel' ? '/aluguel' : '/venda',
    zapimoveis: negocio === 'aluguel' ? '/aluguel' : '/venda',
  };

  // Slug simples de bairro (substitui espaços por hifen)
  const bairroSlug = (bairro || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-');

  if (portal === 'vivareal') {
    return `${base}${pathByPortal[portal]}/minas-gerais/belo-horizonte/${bairroSlug}/`;
  }

  // No Zap, costuma aceitar "mg+belo-horizonte+{bairro}"
  if (portal === 'zapimoveis') {
    return `${base}${pathByPortal[portal]}/imoveis/mg+belo-horizonte+${bairroSlug}/`;
  }

  throw new Error('Portal não suportado');
}

/**
 * Aplica filtros via UI para maior robustez
 * (dependente dos seletores atuais do site).
 */
export async function applyFilters(page, { portal, tipoImovel, precoMin, precoMax, quartosMin, banheirosMin }) {
  // A estratégia aqui é:
  // 1) Esperar o carregamento da listagem
  // 2) Abrir o painel de filtros e clicar nas opções correspondentes
  // 3) Em sites com lazy load, rolar a tela

  // Exemplo genérico: você deve ajustar os seletores conforme inspeção atual.
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  // Tenta localizar um painel de filtros:
  const filterButton = await page.locator('button:has-text("Filtros"), button[aria-label*="Filtrar"]').first();
  if (await filterButton.count() > 0) {
    await filterButton.click({ timeout: 8000 }).catch(() => {});
  }

  // Tipo de imóvel
  if (tipoImovel && tipoImovel !== 'todos') {
    const tipoSel = `label:has-text("${tipoImovel}")`;
    const tipoEl = page.locator(tipoSel).first();
    if (await tipoEl.count() > 0) await tipoEl.click().catch(() => {});
  }

  // Preços
  if (precoMin && precoMin > 0) {
    const minInput = page.locator('input[placeholder*="Mín"], input[name*="min"], input[id*="min"]').first();
    if (await minInput.count() > 0) await minInput.fill(String(precoMin)).catch(() => {});
  }
  if (precoMax && precoMax > 0) {
    const maxInput = page.locator('input[placeholder*="Máx"], input[name*="max"], input[id*="max"]').first();
    if (await maxInput.count() > 0) await maxInput.fill(String(precoMax)).catch(() => {});
  }

  // Quartos / Banheiros
  if (quartosMin && quartosMin > 0) {
    const qSel = page.locator('button:has-text("Quartos"), [aria-label*="Quartos"]').first();
    if (await qSel.count() > 0) {
      await qSel.click().catch(() => {});
      const qOpt = page.locator(`button:has-text("${quartosMin}+")`).first();
      if (await qOpt.count() > 0) await qOpt.click().catch(() => {});
    }
  }

  if (banheirosMin && banheirosMin > 0) {
    const bSel = page.locator('button:has-text("Banheiros"), [aria-label*="Banheiros"]').first();
    if (await bSel.count() > 0) {
      await bSel.click().catch(() => {});
      const bOpt = page.locator(`button:has-text("${banheirosMin}+")`).first();
      if (await bOpt.count() > 0) await bOpt.click().catch(() => {});
    }
  }

  // Aplicar/confirmar filtros caso exista botão
  const applyBtn = page.locator('button:has-text("Aplicar"), button:has-text("Ver resultados")').first();
  if (await applyBtn.count() > 0) {
    await applyBtn.click().catch(() => {});
  }

  // Espera atualização
  await page.waitForLoadState('networkidle', { timeout: 20000 });
}
