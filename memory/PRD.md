# Cartazista Pro — PRD

## Visão geral
App estático (HTML/CSS/JS puro, servido via `serve` na porta 3000) para criar cartazes de preço em folha A4 (1/2/4 por folha), com editor de texto/estilo/efeitos, ícones, QR, tarjas, selos, modelos salvos (Firebase), exportação PNG/PDF e impressão. Backend FastAPI mínimo (apenas /api/health).

## Arquitetura
- Frontend: `/app/frontend/public/` — `index.html`, `app.js` (ES module + Firebase), `style.css`, `config.js`, `sw.js`.
- Persistência: Firebase Firestore/Auth (config em app.js). Impressão via `window.print()` + `@media print`.
- Backend: `/app/backend/server.py` (FastAPI, sem lógica de negócio relevante ao frontend).

## Implementado
### 2026-06 — Etiqueta de Gôndola (10 × 3 cm) [NOVO]
- Botão na toolbar: **Gôndola** (`btn-gondola`).
- Modal `#modalGondola`: lista de etiquetas (Produto + Preço), adicionar/remover linhas, contador de folhas, controles globais (Fonte, Cor do preço, Linha de corte).
- Layout A4: grid 100mm × 30mm, 2 colunas × 9 linhas = **18 etiquetas por folha**; múltiplas folhas quando >18.
- Ações: **Visualizar folha** (overlay) e **Imprimir folha** (`window.print()` com `body.printing-gondola` isolando só as folhas de etiqueta).
- Preço exibe prefixo "R$ " automático se não digitado.
- **Nome da loja**: campo `gond-loja` que aparece no topo de cada etiqueta.
- **Pré-visualização em tempo real**: `#gondLivePreview` mostra as etiquetas em miniatura, atualizando a cada digitação/alteração de estilo/loja.
- Funções em app.js: `openGondolaModal`, `renderGondolaRows`, `addGondolaRow`, `makeGondLabel`, `buildGondolaSheetsInto`, `renderGondolaLivePreview`, `previewGondola`, `imprimirGondola`.

## Observações de teste
- No sandbox de preview, o navegador headless não alcança o CDN do Firebase (gstatic), então o app fica na splash e a ferramenta de screenshot retornou imagem em cache — verificação visual e2e não foi possível aqui. Sintaxe validada e arquivos servidos corretamente. Testar na produção/ambiente do usuário.

## Backlog / P1
- Permitir personalização por etiqueta (cor/fonte individual).
- Importar lista de produtos via colar/CSV para preencher etiquetas em massa.
- Ajuste fino de tamanho de fonte automático quando o nome do produto é longo.
