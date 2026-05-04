# Cartazista Pro 20 — PRD

## Original Problem Statement
- Sumir o placeholder cinza quando não tem imagem
- Refazer todos os 14 templates com identidades visuais ÚNICAS (não mais "cópias" do layout IA)
- Templates funcionam independentes do cartazFromAI
- Repo: https://github.com/oficialsnts-glitch/cartazista-padrao
- Live: https://cartazista-padrao.vercel.app/

## Architecture
- Frontend estático: HTML + CSS + JS vanilla servido por `serve` em `/app/frontend/public`
- Lib: html2canvas, jsPDF, qrcodejs, Firebase (auth anônimo + Firestore)
- Backend FastAPI externo (Render): `cartazista-backend.onrender.com` para IA/Nano Banana
- Renderização do cartaz: 397×561 px (grid-4), itens absolutos com `tipo` (head/desc/marca/peso/preco/precoDe/economia/bg/img/qr/tagBadge/custom)

## Personas
- Operador de PDV (papelão de promoção, supermercado/açougue/padaria)
- Gerente de loja em datas comemorativas (Black Friday, Natal, Páscoa)

## Core Requirements
- 14 templates supermercadistas + datas comemorativas, layout único cada
- Placeholder de imagem só aparece quando há imagem real
- Editor permite editar todos os textos protegidos (head/desc/marca/peso/preco/precoDe/economia)

## Implemented (Jan/2026)
### Sessão atual
- Placeholder cinza condicional: `_isImagePlaceholder` flag + filtro em `buildCartazArea` (esconde quando `cartaz.itens` não tem `tipo:"img"`)
- Recentralização: `_centerWhenNoImg` + `_altX/_altW` reposiciona desc/marca/peso para centro quando não há imagem
- `buildItem` agora respeita `it.w/it.h` em itens de texto (necessário para centralização full-width)
- 14 templates re-escritos como BUILDERS auto-contidos (sem chamar `cartazFromAI`/`cartazBase`)
- **Layout 1/folha e 2/folha agora preenchem o papel**:
  - Wrapper `.cartaz-content` (397×561) com `transform: scale` por layout
  - 4/folha: `scale(1, 1)` (perfeito)
  - 2/folha: `scale(2, 1)` → metade superior + metade inferior da A4
  - 1/folha: `scale(2, 2)` → ocupa A4 inteira
  - `getLayoutScale()` ajusta drag/snap/alignar para coordenadas de design
  1. promo — Mercado clássico vermelho/amarelo
  2. preco — Preço gigante 210pt em fundo amarelo absoluto
  3. marca — Premium dourado/preto Abril Fatface
  4. acougue — Vermelho sangue + selo "FRESCO HOJE"
  5. hortifruti — Verde sítio + selo "100% NATURAL"
  6. padaria — Kraft marrom + Abril Fatface artesanal
  7. bebidas — Gradiente azul gelo + Bungee "GELADA!"
  8. relampago — Amarelo neon + faixa preta diagonal Bungee
  9. leve3 — Roxo + laranja "LEVE 3 / PAGUE 2"
  10. blackfriday — Preto absoluto + faixa amarela + selo "-50%"
  11. natal — Verde escuro + dourado + faixa vermelha
  12. pascoa — Pastel rosa/roxo/amarelo
  13. novo — Lançamento azul vibrante + badge "NOVO"
  14. ultimas — Vermelho urgência + zebra preto/vermelho

## Backlog (P1/P2)
- Variar fontes em mais templates (atualmente Anton/Bebas/Archivo Black/Bungee/Abril Fatface)
- Adicionar templates específicos: Frios/Laticínios, Limpeza, Pet, Higiene
- Suporte a círculos verdadeiros para selos (atualmente quadrados)
- Modo "compacto" automático quando `desc` muito longo

## Next Tasks
- Aguardar feedback do usuário sobre os 14 templates
- Possíveis ajustes finos de cor/tipografia conforme preferência

## Files Changed
- `/app/frontend/public/app.js`
  - `cartazFromAI`: adicionou `_isImagePlaceholder`, `_centerWhenNoImg`, `_altX`, `_altW`
  - `buildCartazArea`: detecta `hasImage` e filtra placeholder + reposiciona texto
  - `buildItem`: respeita `it.w`/`it.h` em itens de texto
  - `TEMPLATES`: 14 builders independentes
  - `carregarTemplate`: simplificada (apenas `builder()` + push)

## Bug Fix — Jan/2026: Modelos não salvavam no Firebase
**Sintoma**: usuário relatou "só salva no localStorage em cache". Modelos apareciam na lista mas sumiam ao recarregar.

**Causa raiz**: todos os modelos eram persistidos em UM ÚNICO documento `users/{uid}/data/modelos` via `setDoc({modelos: state.modelos})`. Como cada modelo guarda `dados` (cartazes) que incluem itens `tipo:"img"` com `val` em **base64 data URL** (de busca EAN/Open Food Facts, Nano Banana, e remoção de fundo), 2-3 modelos já estouravam o **limite de 1 MiB por documento do Firestore**. O `setDoc` falhava com erro silencioso (apenas `console.error`).

**Correção** (`/app/frontend/public/app.js`):
- Refatorado para subcoleção: `users/{uid}/modelos/{id}` (1 documento por modelo) — limite passa a ser 1 MiB *por modelo* em vez de para o conjunto
- Imports adicionados: `collection, getDocs, deleteDoc, query, orderBy`
- Novas funções: `saveModeloDoc`, `deleteModeloDoc` com toast de erro visível para o usuário
- `loadModelos`: lê coleção ordenada por timestamp; **migração automática** do formato antigo (lê doc `data/modelos`, cria 1 doc por entrada, marca `migrated:true`)
- `salvarModeloAtual`: gera `id` único, valida tamanho (<950KB) antes de gravar, mostra toast claro em caso de falha
- `handleModeloSelect` (delete): usa `deleteDoc` da subcoleção
- `updateFirebaseRefs`: aponta para `modelosColRef` (coleção) + `modelosLegacyRef` (doc antigo para migração)
- `/app/frontend/public/sw.js`: cache name v2 → v3 (força usuários existentes a baixar novo `app.js`)

**Validação**: `node --check app.js` passou; rules `users/{userId}/{document=**}` já cobrem a nova subcoleção.

## Next Action Items
- Testar em produção: salvar 3+ modelos com imagens, recarregar página, verificar persistência
- Se ainda houver falha, abrir DevTools → Console para ver toast/log do erro Firebase exato
