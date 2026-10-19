const TYPE_LABELS = {
  APARTMENT: 'Apartamento',
  HOME: 'Casa',
  PENTHOUSE: 'Cobertura',
  CONDOMINIUM: 'Casa de Condom\u00ednio',
  BUSINESS: 'Loja / Sal\u00e3o / Ponto Comercial',
  OFFICE: 'Conjunto Comercial / Sala',
  COMMERCIAL_PROPERTY: 'Casa Comercial',
  HOTEL: 'Hotel / Motel / Pousada',
  CORPORATE_FLOOR: 'Andar / Laje Corporativa',
  BUILDING: 'Pr\u00e9dio Inteiro',
  ALLOTMENT_LAND: 'Terreno / Lote',
  WAREHOUSE: 'Galp\u00e3o / Dep\u00f3sito / Armaz\u00e9m',
  GARAGE: 'Garagem',
};

const URL_TYPES = [
  [/^(?:casa-de-condominio|casa-em-condominio|casa-condominio|condominio)(?:-|$)/, 'CONDOMINIUM'],
  [/^(?:cobertura)(?:-|$)/, 'PENTHOUSE'],
  [/^(?:casa-comercial|imovel-comercial)(?:-|$)/, 'COMMERCIAL_PROPERTY'],
  [/^(?:hotel|motel|pousada)(?:-|$)/, 'HOTEL'],
  [/^(?:andar|laje|andar-loja-corporativa)(?:-|$)/, 'CORPORATE_FLOOR'],
  [/^(?:predio|edificio)(?:-|$)/, 'BUILDING'],
  [/^(?:loja|salao|ponto-comercial)(?:-|$)/, 'BUSINESS'],
  [/^(?:sala|conjunto-comercial|escritorio)(?:-|$)/, 'OFFICE'],
  [/^(?:lote|terreno)(?:-|$)/, 'ALLOTMENT_LAND'],
  [/^(?:galpao|deposito|armazem)(?:-|$)/, 'WAREHOUSE'],
  [/^(?:garagem|box)(?:-|$)/, 'GARAGE'],
  [/^apartamento(?:-|$)/, 'APARTMENT'],
  [/^casa(?:-|$)/, 'HOME'],
];

export function propertyType(rawTypes = [], href) {
  const codes = [...new Set(rawTypes.filter((type) => typeof type === 'string').map((type) => type.toUpperCase()))];
  // Subtypes are more specific than the base APARTMENT/HOME classification.
  for (const code of ['PENTHOUSE', 'CONDOMINIUM']) {
    if (codes.includes(code)) return TYPE_LABELS[code];
  }
  const path = href && URL.canParse(href) ? new URL(href).pathname : '';
  const slug = path.replace(/^\/imovel\/(?:venda|aluguel)-/, '');
  const urlCode = path.startsWith('/imovel/') ? URL_TYPES.find(([pattern]) => pattern.test(slug))?.[1] : null;
  const known = codes.filter((code) => TYPE_LABELS[code]);
  if (known.length > 1) return null;
  if (known.length === 1) {
    const code = known[0];
    if ((code === 'APARTMENT' && urlCode === 'PENTHOUSE')
        || (code === 'HOME' && urlCode === 'CONDOMINIUM')) return TYPE_LABELS[urlCode];
    return TYPE_LABELS[code];
  }
  return urlCode ? TYPE_LABELS[urlCode] : null;
}
