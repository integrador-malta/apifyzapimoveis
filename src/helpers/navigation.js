
import { BASES } from './constants.js';

/**
 * Gera URL inicial de busca para o portal escolhido.
 * Para Zap Imóveis: usa query parameters para filtros
 * Para Viva Real: usa path + query parameters
 */
export function buildSearchUrl(portal, bairro, negocio = 'venda', filters = {}) {
  const base = BASES[portal];

  // Slug simples de bairro (substitui espaços por hifen)
  const bairroSlug = (bairro || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-');

  if (portal === 'zapimoveis') {
    // Zap Imóveis: usa path + query params
    const url = new URL(`${base}/venda/apartamentos/mg+belo-horizonte+${bairroSlug}/`);
    
    // Query parameters padrão (como na URL fornecida)
    const params = {
      transacao: 'venda',
      onde: `,Minas Gerais,Belo Horizonte,,${bairro},,neighborhood,BR>Minas Gerais>NULL>Belo Horizonte>Barios>${bairro},-19.977143,-44.014492,`,
      tipos: 'apartamento_residencial,casa_residencial',
      quartos: filters.quartos || '1,2,3,4',
      banheiros: filters.banheiros || '1,2,3,4',
      vagas: filters.vagas || '1,2,3,4',
      precoMinimo: filters.precoMin || '100000',
      precoMaximo: filters.precoMax || '700000',
      precoMinimoCondo: filters.precoMinimoCondo || '100',
      precoMaximoCondo: filters.precoMaximoCondo || '1200',
      areaMinima: filters.areaMin || '20',
      areaMaxima: filters.areaMax || '150',
    };

    // Aplicar query params
    Object.entries(params).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });

    return url.toString();
  }

  if (portal === 'vivareal') {
    const url = new URL(`${base}/venda/minas-gerais/belo-horizonte/${bairroSlug}/`);
    
    // Query params para Viva Real
    const params = {
      dormitorios: filters.quartos || '1,2,3,4',
      banheiros: filters.banheiros || '1,2,3,4',
      garagens: filters.vagas || '1,2,3,4',
      priceMin: filters.precoMin || '100000',
      priceMax: filters.precoMax || '700000',
      areaMin: filters.areaMin || '20',
      areaMax: filters.areaMax || '150',
    };

    Object.entries(params).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });

    return url.toString();
  }

  throw new Error('Portal não suportado');
}

