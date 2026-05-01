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
