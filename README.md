# Coleta de pesquisas do Zap Imoveis

Actor com Playwright/Crawlee para pesquisas de venda e aluguel. A versao 1.2.0
extrai os cards em lote, valida links e IDs, segue a paginacao da pagina e
separa anuncios de falhas. Nao contorna CAPTCHA nem garante acesso a paginas
bloqueadas pelo portal. Verifique as condicoes de uso e as permissoes de coleta.

## Execucao e testes locais

Requer Node.js 20 ou superior.

```powershell
npm ci
npx playwright install chromium
npm test
npm run check
```

Os testes abrem os dois HTMLs salvos em Chromium, com scripts da pagina
desativados e requisicoes externas bloqueadas. Tambem simulam falhas de
gravacao, retries, cancelamento, cards agrupados, filtros e paginacao.
Nao usam proxy nem fazem uma coleta no site.

Para executar o Actor, forneca o input pelo Apify ou pelo armazenamento local
do SDK e execute `npm start`. Use um armazenamento local separado para uma nova
coleta. Para retomar localmente, defina `CRAWLEE_PURGE_ON_START=false` e
reutilize o mesmo diretorio de armazenamento, checkpoints e fila.
Paginas parciais ja percorridas ficam no checkpoint para nao impedir o restante
da coleta. Para tentar recuperar novamente seus cards rejeitados, inicie uma
nova execucao com armazenamento novo, apos corrigir o motivo do descarte.

## Input

```json
{
  "links": ["https://www.zapimoveis.com.br/venda/apartamentos/mg+belo-horizonte++barreiro/"],
  "usarProxy": true,
  "proxyCountryCode": "BR",
  "maxPagesPorBairro": 100,
  "headless": true,
  "pageReadyTimeoutSecs": 30,
  "maxRequestsPerMinute": 10,
  "failOnIncomplete": true
}
```

- `links`: pesquisas completas, com os filtros desejados, da primeira pagina.
  Somente URLs HTTPS de pesquisa do Zap sao aceitas pelo Actor.
- `maxPagesPorBairro`: inteiro positivo; padrao 10. Se houver uma proxima pagina
  ao atingir o limite, a pesquisa fica `limited`, nao `complete`.
- `usarProxy` e `proxyCountryCode`: proxy residencial Apify, por padrao no Brasil.
  Requer acesso e saldo para esse servico. Proxy nao garante ausencia de 403.
- `pageReadyTimeoutSecs`: de 1 a 90; padrao 30. Aguarda dados estaveis durante
  um segundo, sem esperar individualmente por cada campo opcional.
- `maxRequestsPerMinute`: inteiro positivo; padrao 10, com concorrencia 1 e
  duas novas tentativas por requisicao.
- `failOnIncomplete`: padrao `true`. Qualquer pesquisa incompleta faz o Actor
  terminar com erro, mantendo todos os dados validos e diagnosticos.
  Defina `false` somente se aceitar conscientemente resultados parciais.

## Saidas e cobertura

O **dataset padrao** contem apenas anuncios validados, com `listingId`, URL
canonica sem tracking e os campos anteriores (`title`, `price`, `address`,
`area`, `rooms`, `baths`, `parking`, `imobiliaria`, `anunciosAgrupados`,
`negocio`, `portal`, `extractedAt`, `seedUrl` e `pageNum`).

O mesmo ID e gravado uma vez por portal, inclusive quando aparece em varias
pesquisas. `seedUrl`/`pageNum` no anuncio indicam sua primeira origem gravada;
as outras associacoes ficam em `SUMMARY.seeds[].pages[].listingIds`.
Campos opcionais ausentes continuam nulos, e sua frequencia e registrada no
resumo por pagina. Promocoes de imobiliarias `FIXED TOP` so sao ignoradas quando
possuem link de imobiliaria, mas nenhum link de imovel, campo de imovel ou
botao de agrupamento. Um card ambiguo continua sendo uma rejeicao, nao publicidade.

Uma pagina com anuncios nao recuperados preserva os anuncios validos e segue
para a proxima pagina se a paginacao estiver validada. Nao ha retry da pagina
inteira apenas por esse motivo. A pesquisa termina com status `partial`, mesmo
se as paginas seguintes estiverem completas; `failOnIncomplete=true` continua
fazendo o Actor terminar com erro. Paginas assim entram em `pagesProcessed`,
mas sao identificadas por `partialPages`, `rejectedCards` e pelo diagnostico.
Falhas de navegacao/paginacao continuam usando retries. Se a paginacao falhar,
os anuncios ja validados permanecem salvos, sem declarar a pagina concluida.

Cards agrupados representam **um anuncio**, com a contagem do grupo. Quando
nao ha link no DOM, o link do representante e recuperado dos dados Next
somente se a ordem e os IDs dos demais cards corroborarem a correspondencia,
apos excluir as promocoes reconhecidas. Imobiliarias podem ser recuperadas
por ID sem exigir que todo o DOM tenha a mesma quantidade de elementos.
Os anuncios internos do grupo nao sao expandidos.

No **Key-value store padrao**:

- `SCRAPE_STATE`: checkpoint de paginas, assinaturas por IDs, origens,
  tentativas e falhas.
- `SUMMARY`: versao/build/run, anuncios unicos, paginas verificadas,
  pesquisas completas/vazias/incompletas, `partialPages`, `rejectedCards`,
  `ignoredPromotions` e ID do dataset de falhas. Os checkpoints por pagina
  incluem motivos de rejeicao, promocoes ignoradas e a chave de diagnostico.
- `EXTRACTION-*`: diagnostico direcionado para paginas com rejeicoes:
  posicao original, tipo do card, links, ID quando disponivel e motivo
  (`missing_detail_link`, `grouped_link_unresolved`, `malformed_detail_url`,
  `invalid_detail_origin`, `invalid_listing_id` ou `missing_minimum_data`).
  Inclui tambem IDs/links das colecoes estruturadas e HTML de cada card
  rejeitado, limitado a 20 mil caracteres por card com indicador `truncated`.
  Isso evita depender apenas do inicio truncado do documento.
- `DIAGNOSTIC-*`: URL, status HTTP quando disponivel, titulo, sessao,
  pais do proxy, retry e erro.
- `DIAGNOSTIC-*-HTML`: trecho de ate 200 mil caracteres do HTML da falha,
  quando a pagina ainda esta acessivel. Nao inclui credenciais do proxy.

Falhas finais de requisicoes ficam no **dataset separado** `falhas-<runId>`.
Rejeicoes parciais de extracao ficam em `SUMMARY` e `EXTRACTION-*`, e nao sao
registradas como falhas de acesso ao portal. O nome local do dataset de falhas
e `falhas-local`. A ausencia de cards so indica pesquisa vazia se houver
mensagem explicita ou total filtrado zero. IDs repetidos entre paginas,
mudancas de filtros, redirecionamentos e paginacao desconhecida sao erros.

A gravacao reconcilia IDs com o dataset ao reiniciar e apos respostas de
append malsucedidas. A API de dataset nao oferece uma transacao atomica
entre fila, checkpoint e append; por isso a retomada usa reconciliacao e
nao promete exatamente-uma-vez sob qualquer falha de infraestrutura.

## Publicacao e validacao no Apify

1. Publique as alteracoes e crie **um novo build**. Usar `latest` sozinho nao
   reconstrui o Actor nem atualiza um build antigo.
2. Confirme o commit do build na console. O log inicial e `SUMMARY` devem
   mostrar versao `1.2.0` e o ID do novo build.
3. Execute primeiro duas ou tres pesquisas conhecidas, incluindo uma com
   varias paginas e uma vazia. Compare IDs, filtros e fim da paginacao com
   o navegador, observando `SUMMARY` e a taxa de bloqueios.
4. Confirme que a tarefa/agendamento usa o novo build antes de ampliar a coleta.

O Docker usa `npm ci` como `myuser` e instala explicitamente Chromium como
`root`, pois o diretorio compartilhado `/pw-browsers` da imagem base nao
permite escrita pelo usuario comum. A limpeza automatica de browsers fica
desabilitada nessa instalacao para preservar os browsers da imagem base.
Em seguida, o build volta para `myuser` e verifica se o executavel do Chromium
esta acessivel. O Actor continua executando sem privilegios de root.
O lockfile fixa as dependencias para tornar os builds reproduziveis.
Os testes locais validam os snapshots e a logica, mas nao comprovam acesso
ao portal em producao.