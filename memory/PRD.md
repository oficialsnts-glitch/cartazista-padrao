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
- **Admin Master (`oficialsnts@gmail.com`)**: allowlist `ADMIN_EMAILS` no `app.js`.
  Botão "Admin" na toolbar (só aparece para o admin). Auto-registro só desse e-mail
  no 1º login (`createUserWithEmailAndPassword`) caso não exista.
  - **Enviar cópias**: painel lista os cartazes da página + destinatários
    (Todos / Selecionar). Cada envio grava um doc em `shares/{id}` com `audience`,
    `targets[]`, `cartaz` e `fromUid`.
  - **Inbox automática**: no login, `checkInbox()` importa (cópia editável, ids novos)
    os shares destinados ao usuário (`audience=all` ou `targets` contém o uid),
    marcando importados em `users/{uid}/data/session.importedShares`.
  - **Ver todos os cartazes salvos**: `collectionGroup("cartazes")` lista os cartazes
    de todos os usuários (com e-mail do dono via `directory`) e permite "Clonar p/ mim".
  - **Diretório de usuários**: `upsertDirectory()` grava `directory/{uid}={email,uid}`
    em cada login com e-mail, para o admin escolher destinatários.
  - **firestore.rules** atualizadas (admin por `token.email`, collectionGroup de
    cartazes p/ admin, `directory`, `shares`). ⚠️ PRECISA DE DEPLOY manual.
  - `sw.js` v8 → v9. Verificado em Firebase real: login admin, painel, ver-todos OK.

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
