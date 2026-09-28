# Cartazista Pro 21 — PRD

## Original Problem Statement (sessão atual, Jan/2026)
> "Meu app cartazista tem pequenos bugs a serem corrigidos, não sei exatamente em qual
> cartaz mas identifiquei na versão 4x1 que não sai o preço em algum dos cartazes
> gerados a partir do oitavo eu acho, de início remova a opção templates, vou usar
> somente os modelos salvos que eu criei e salvei no firebase, me liste os pequenos
> bugs após remover a guia templates"

## Architecture
- Frontend estático: HTML + CSS + JS vanilla servido por `serve` em `/app/frontend/public`
- Lib: html2canvas, jsPDF, qrcodejs, Firebase (auth anônimo+email + Firestore)
- Backend FastAPI (Render): `cartazista-backend.onrender.com` para IA/Nano Banana
- Renderização: 397×561 px (grid-4), itens absolutos por `tipo` (head/desc/marca/peso/preco/precoDe/economia/bg/img/qr/tagBadge/custom)

## Personas
- Operador de PDV (mercado/açougue/padaria) que quer cartazes rápidos via modelos próprios
- Gerente de loja em datas comemorativas

## Core Requirements
- Modelos salvos no Firebase substituem totalmente a galeria de Templates fixos
- Cada cartaz deve preservar TODOS os tipos protegidos (head/desc/marca/peso/preco/precoDe/economia)
- Layout 4/folha (grid-4), 2/folha (grid-2) e 1/folha A4 (grid-1) devem renderizar
  identicamente, apenas escalando via CSS

## Implemented (Jan/2026 — sessão atual)
- **Removida a guia "Templates" da toolbar** (`index.html`): `<select id="selectTemplate">`
  com 14 opções (promo, preço, marca, açougue, hortifruti, padaria, bebidas, relâmpago,
  leve3, blackfriday, natal, páscoa, novo, ultimas) foi totalmente removida.
- **Removidos do `app.js`**: const `TEMPLATES` (~280 linhas), função `carregarTemplate`
  e o handler `$("selectTemplate").onchange` em `wire()`.
- **`sw.js` v5 → v6** para forçar atualização dos clientes existentes.
- Auditoria detalhada de bugs entregue ao usuário (ver seção abaixo).

## Bugs identificados (aguardando confirmação do usuário)
### Suspeitas para "preço some em alguns cartazes (4×1, a partir do 8º)"
1. **Limite de 1 MiB do Firestore por documento**: `save()` ainda grava TODOS os cartazes
   em um único doc `users/{uid}/data/session`. Cartazes com imagens base64 (EAN, Nano
   Banana, remoção de fundo) estouram 1 MiB com poucos cartazes → `setDoc` falha
   silenciosamente → no próximo load o estado volta truncado, sem alguns itens.
   *Mesmo padrão do bug antigo já corrigido nos Modelos salvos.*
2. **Paletas temáticas com 3ª cor branca** (`Premium`, `Black Friday`, `Natal`): em
   `aplicarPaleta()` o preço recebe `c3 || "#000"`. Se c3 = `#ffffff` e o cartaz tem
   fundo de bloco do preço `#f5f6f8` (cinza claro do `cartazFromAI`), o preço fica
   branco em fundo branco → invisível.
3. **`zOverride` no preço via menu de contexto**: "Enviar para trás" no preço seta
   `zOverride = 1`, ficando ABAIXO dos itens `bg` (z=5) → preço escondido atrás
   do fundo claro do cartaz.

### Bugs menores / inconsistências
4. **`renderModelosSelect`**: limite local de 30 modelos no dropdown silenciosamente
   esconde modelos mais antigos (permanecem no Firestore, mas o usuário não vê).
5. **Listener de `Esc` duplicado** em `wire()` (um global + um só para Esc).
6. **`updateFirebaseRefs` quando uid é null** aponta para `doc(db, "projeto", "sessao_atual")`,
   mas `firestore.rules` exige autenticação → save falha com PermissionDenied
   (mascarado por `setSyncStatus("offline")`).
7. **`buildItem` para `img` com `val=""`** cria `<img src="">` → request 404 inútil
   para `/index.html`.
8. **`aplicarPaleta`** não atualiza `tagBadge.bgCol` nem cores das tarjas (`bg`)
   → resultado visual parcial ao aplicar paleta.
9. **`migrateCartazes(arr, fromVersion)`** recebe `fromVersion` mas não usa →
   parâmetro morto.
10. **`zoomFit`** pode chamar `setZoom(NaN)` se a página ainda não renderizou
    (offsetWidth/Height = 0).

## Implemented (Jun/2026)
- **Compartilhamento por PÁGINA/MODELO (não por célula)**: o compartilhamento agora
  trata a página inteira (todos os cartazes + `layout` 1/2/4 por folha) como um único
  modelo, entregue idêntico ao criado.
  - `shares/{id}` grava `{ modelo: { cartazes[], layout }, ... }` (compat: `checkInbox`
    ainda importa o formato antigo `cartaz`). Ao receber, aplica o `layout` do modelo.
  - Painel admin "Enviar sua página": mostra miniatura da PÁGINA (`renderPageThumb`,
    respeita layout) + contagem; envia `state.cartazes`+`state.layout` como modelo.
  - "Modelos de cada usuário": 1 entrada por usuário (agrupa `collectionGroup('cartazes')`
    + lê `users/{uid}/data/session` para layout/order), com miniatura da página,
    Compartilhar (envia o modelo) e Clonar (carrega o modelo na página do admin).
  - Verificado pelo testing agent: 100% frontend, 2 usuários listados como modelos.
  - `sw.js` v11 → v12.
- **Admin Master (`oficialsnts@gmail.com`)**: allowlist `ADMIN_EMAILS` no `app.js`.
  Botão "Admin" na toolbar (só aparece para o admin). Auto-registro só desse e-mail
  no 1º login (`createUserWithEmailAndPassword`) caso não exista.
  - **Enviar cópias**: painel lista os cartazes da página + destinatários
    (Todos / Selecionar). Cada envio grava um doc em `shares/{id}` com `audience`,
    `targets[]`, `cartaz` e `fromUid`.
  - **Inbox automática**: no login, `checkInbox()` importa (cópia editável, ids novos)
    os shares destinados ao usuário (`audience=all` ou `targets` contém o uid),
    marcando importados em `users/{uid}/data/session.importedShares`.
  - **Miniatura visual**: as listas do painel admin (cartazes da página e de todos os
    usuários) mostram uma prévia real do cartaz (`renderCartazThumb`, reusa `buildItem`
    escalado 397×561 → 70px). `sw.js` v10 → v11.
  - **Ver todos os cartazes salvos**: `collectionGroup("cartazes")` lista os cartazes
    de todos os usuários (com e-mail do dono via `directory`). Cada linha tem
    **Compartilhar** (envia aquele cartaz para os destinatários selecionados via
    `enviarShareCartaz`/`adminCompartilharCartaz`) e **Clonar p/ mim**. Cartazes de
    outros usuários aparecem primeiro. `sw.js` v9 → v10.
  - **Diretório de usuários**: `upsertDirectory()` grava `directory/{uid}={email,uid}`
    em cada login com e-mail, para o admin escolher destinatários.
  - **firestore.rules** atualizadas (admin por `token.email`, collectionGroup de
    cartazes p/ admin, `directory`, `shares`). ⚠️ PRECISA DE DEPLOY manual.
  - `sw.js` v8 → v9. Verificado em Firebase real: login admin, painel, ver-todos OK.

## Implemented (Jun/2026 — Modelos salvos de TODOS os usuários no painel admin)
- **Problema**: nos "Modelos salvos" do admin devem aparecer os modelos criados por
  TODOS os usuários (agrupados por usuário/pasta), para o admin COPIAR para a sua tela,
  EDITAR e REPLICAR para todos os usuários restantes (cada usuário recebe uma cópia editável).
- **Frontend (`app.js`)**:
  - `adminVerModelosTodos()`: `getDocs(collectionGroup(db, "modelos"))` agrupa por
    `ownerUid` (path `users/{uid}/modelos/{id}`); ignora docs sem `dados[]`.
  - `renderAdminModelosList()`: renderiza PASTAS por usuário (email via `directory`),
    cada modelo com miniatura (`renderPageThumb`), nome, data, e botões **Copiar** e **Replicar**.
  - `adminCopiarModeloParaTela(i)`: substitui a tela atual pelos cartazes do modelo
    (novos ids), fecha o modal — admin edita e depois replica.
  - `replicarModeloParaUsuarios(modelo, nome)`: grava uma cópia em
    `users/{uid}/modelos/{novoId}` para cada destinatário (audience Todos = todos do
    diretório exceto o próprio admin; ou Selecionados). Respeita limite 1 MiB.
  - `adminReplicarModelo(i)`: replica um modelo salvo (como está).
  - `adminReplicarTelaAtual()`: replica a tela atual (após editar) como novo modelo p/ todos.
  - Wiring: `#btnAdminModelosTodos`, `#btnAdminReplicarTela`.
- **UI (`index.html`)**: nova seção no `#modalAdmin` "Modelos salvos de todos os usuários"
  (data-testids: `btn-admin-modelos-todos`, `admin-modelos-list`, `btn-admin-replicar-tela`).
- **CSS (`style.css`)**: `.admin-folder` / `.admin-folder-head` para as pastas por usuário.
- **firestore.rules**: adicionada regra collectionGroup `modelos` com `allow read: if isAdmin()`.
  ⚠️ **PRECISA DE DEPLOY manual** (`firebase deploy --only firestore:rules`). Sem o deploy,
  a listagem mostra erro de permissão (tratado com mensagem amigável). A ESCRITA (replicar)
  já é permitida pela regra existente `users/{userId}/{document=**}` com `isAdmin()`.
- **Verificação (testing agent, iteration_2)**: login admin OK, botão Admin visível, modal
  abre, os 3 novos elementos presentes e wired, erro de permissão tratado corretamente
  (esperado até o deploy das regras). Frontend 100%.


## Implemented (Jun/2026 — sessão anterior)
- **Padrão da posição dos centavos**: a escolha Em cima/Embaixo feita no editor é
  salva em `localStorage` (`cartazista_centsAlign`) via `setCentsAlignDefault()` e
  aplicada automaticamente a NOVOS cartazes em `cartazFromAI` (`getCentsAlignDefault()`).
  Toast confirma quando o padrão muda. Verificado em memória (novo cartaz herda o topo).
- **Correção "preço some no 4×1 (8º+)" — save por cartaz**: `save()`/`load()` refatorados
  para **1 documento por cartaz** em `users/{uid}/cartazes/{id}` (mesmo padrão dos modelos),
  com doc "meta" (`sessionRef`) guardando `layout` + `order[]`. Remove o limite de 1 MiB
  por SESSÃO (causa da truncagem silenciosa). Escrita incremental por hash
  (`state._savedHashes`) + remoção de docs excluídos (`state._cloudIds`). Migração
  automática do formato antigo (array inline) na primeira carga.
  ⚠️ Round-trip no Firestore NÃO pôde ser validado no sandbox (auth anônimo desabilitado
  neste projeto Firebase e sem conta de teste); lógica segue o padrão já provado dos modelos.
- **Posição dos centavos configurável** (sessão anterior): select `#inCentsAlign` na aba
  Estilo (só no item `preco`), aplicado via `vertical-align`. `sw.js` v6 → v8.

## Implemented (Jan/2026)

## Implemented (Jun/2026 — Bug: modelo compartilhado não aparecia em "Modelos salvos")
- **Reportado**: usuário comum recebia a NOTIFICAÇÃO de "modelo compartilhado", mas o
  modelo (ex.: HORTIFRUTI enviado pelo admin) NÃO aparecia na lista "Modelos salvos" dele.
- **RCA**: `checkInbox()` empurrava os cartazes recebidos para `state.cartazes` (a PÁGINA
  ativa do usuário) em vez de salvá-los como modelo reutilizável.
- **Fix (`app.js` checkInbox ~linha 127)**: ao receber um share (`sh.modelo` ou `sh.cartaz`),
  clona os cartazes com ids novos e SALVA como modelo em `users/{uid}/modelos/{id}` via
  `setDoc`, faz `state.modelos.unshift(modelo)` + `renderModelosSelect()`; toast
  "Você recebeu N modelo(s) em Modelos salvos!". Não altera mais a página do usuário.
- **Verificado E2E (testing agent, iteration_3, frontend 100%)**: admin "Enviar esta página"
  (audience=all) → login loja1@gestor.com → o modelo apareceu no topo de "Modelos salvos"
  imediatamente após o login, sem mexer na página atual. Funciona com as regras Firestore
  já deployadas (usuário grava seus próprios modelos + lê shares).

## Implemented (Jun/2026 — Selo "NOVO" + botão Renomear em "Modelos salvos")
- **Selo "NOVO"**: modelos recém-recebidos (compartilhados pelo admin, via `checkInbox`)
  são salvos com `isNew:true`. `renderModelosSelect()` desenha um selo verde "NOVO"
  (`.modelo-badge-new`, data-testid `modelo-badge-new-{i}`). Ao ABRIR o modelo
  (`loadModeloAtIndex`), o selo é limpo (`isNew:false`, persistido via `setDoc` merge)
  e a lista é re-renderizada na mesma sessão.
- **Botão Renomear**: cada linha ganhou um botão lápis (`.modelo-row-ren`, data-testid
  `modelo-ren-{i}`) → `renomearModeloAtIndex()` usa `prompt()` + `saveModeloDoc()`
  (não dispara o "Carregar"; `stopPropagation`).
- **Verificado E2E (testing agent, iterations 4 e 5, frontend 100%)**: selo aparece em
  modelo recebido e some ao abrir (mesma sessão, sem reload); renomear altera o nome
  e persiste no Firebase. Bug intermediário (falta de re-render ao limpar o selo)
  corrigido com `renderModelosSelect()` em `loadModeloAtIndex`.

## Implemented (Jun/2026 — Remoção de 5 funções)
- Removidas a pedido do usuário: **Gerar cartaz com IA** (btn-ia-gerar + modalIA),
  **Buscar por código de barras** (btn-ean + modalEAN), **Adicionar imagem** (btn-imagem),
  **Removedor de fundo** (btn-remover-bg + item ctxRemoverFundo no menu de contexto) e
  **Sugerir chamadas com IA** (btn-sugerir).
- `app.js`: removidas as funções `adicionarImagem`, `buscarEAN`, `aplicarEAN`,
  `loadImgly`, `removerFundoItem`, `iaGerarCartaz`, `aplicarIA`, `iaSugerirChamadas`
  e o wiring correspondente; `showCtxMenu()` não referencia mais o botão de remover fundo.
- Mantidos: Lote CSV, Galeria de ícones, QR, Modelos salvos (e o backend intacto).
- **Verificado E2E (testing agent, iteration_6, frontend 100%)**: os 5 elementos ausentes
  do DOM; recursos preservados funcionais; editor carrega sem erros; menu de contexto sem
  "Remover fundo".

## Implemented (Jun/2026 — Remoção do Lote CSV + backend enxuto)
- Removido o botão/modal **Lote CSV** (btn-ia-lote + modalCSV) e as funções
  `csvAnalisar`, `csvGerar`, `csvParsed` e a função morta `tentarGerarImagemProduto`,
  além do wiring correspondente.
- **Backend (`server.py`) reescrito enxuto**: removidas TODAS as rotas de IA/EAN
  (`/ai/generate-poster`, `/ai/suggest-headlines`, `/ai/parse-csv`,
  `/ai/generate-product-image`, `/ean/{ean}`) e a dependência do cliente Gemini/httpx.
  Restam apenas `/api/health` e `/`. Removidas deps `google-genai` e `httpx` do
  requirements. O frontend não chama mais nenhuma rota `/api` própria (só a API
  externa de ícones iconify).
- **Fix de ambiente**: conflito pydantic/pydantic_core (ImportError validate_core_schema)
  corrigido fixando `pydantic-core==2.27.2` no requirements.
- **Verificado (testing agent, iteration_7, frontend 100%; backend /api/health=200)**:
  editor estável, Lote CSV ausente, recursos preservados (ícones, QR, Modelos salvos) OK,
  menu de contexto sem "Remover fundo".

## Backlog
- Refatorar `save()`/`load()` para subcoleção `users/{uid}/cartazes/{id}` (1 doc
  por cartaz) — eleva o limite de 1 MiB para POR cartaz, mesmo padrão dos modelos.
- Pré-validação de tamanho de cartaz antes do save (toast amigável quando estourar).
- Cor de contraste automática: comparar `preco.col` com a média do `bg` mais próximo
  e avisar quando contraste < AA.
- "Enviar para trás" deve respeitar piso mínimo (z=6, acima de `bg`) para não
  esconder texto.
- Versão no rodapé/about (Backlog antigo, ainda pendente).
- Botão "Compartilhar modelo" → link público read-only Firestore para WhatsApp.

## Next Tasks
- Aguardar usuário responder sobre a auditoria + opcionalmente enviar screenshot
  do cartaz com preço sumido (para confirmar qual das 3 suspeitas é a causa real).
- Em seguida: aplicar correção definitiva ao bug confirmado (provavelmente
  refatoração de `save()` para subcoleção).

## Files Changed (sessão atual)
- `/app/frontend/public/index.html` — removido `<select id="selectTemplate">` da toolbar
- `/app/frontend/public/app.js` — removidos `TEMPLATES`, `carregarTemplate` e handler
- `/app/frontend/public/sw.js` — `CACHE_NAME` v5 → v6
