# Cartazista Pro 20.0 — PRD

## Problem Statement Original
"me recomende melhorias para meu cartazista" → usuário aceitou "faça tudo na sua ordem pra economizar meus créditos". Cartazista = editor web de cartazes de preço para supermercado/loja (era single-file HTML com Firebase).

## Arquitetura
- **Frontend**: Static HTML/CSS/JS modular em `/app/frontend/public/` (index.html, style.css, app.js). Servido por `serve` (yarn) na porta 3000.
- **Backend**: FastAPI em `/app/backend/server.py` porta 8001 com endpoints de IA usando `emergentintegrations` (Gemini 2.5 Flash).
- **Storage**: Firebase Firestore (dados dos cartazes) com autenticação anônima → cada usuário tem seu `users/{uid}/data/session` e `users/{uid}/data/modelos`.

## Personas
- Cartazista de supermercado/mercearia
- Funcionário de loja fazendo ofertas semanais
- Rede de lojas (roadmap multi-usuário)

## Implementado (Jan/2026)

### 🔴 Bugs críticos corrigidos
- XSS no innerHTML do preço → escape HTML
- `saveToHistory` agora é chamado ANTES do drag (mousedown) — undo do arrasto funciona
- History com debounce 400ms → digitar não estoura stack
- PDF multi-página para grid-1 (addPage por cartaz)
- PNG em grid-1 com ordem correta (índice capturado)
- Splash reduzido de 6,5s → 1,2s
- Firebase Auth anônima + per-user data (isola usuários)
- Schema migration (schemaVersion=2)

### 🟡 UX / Produtividade
- **IA Gerar Cartaz** (modal): descreva produto em 1 linha → Gemini preenche chamada/produto/marca/peso/preço/preço-de/paleta
- **IA Lote CSV**: cole texto/CSV → gera N cartazes de uma vez
- **IA Sugerir Chamadas**: 5 opções criativas por produto
- **Preço DE/POR** com rótulo "ECONOMIZE R$ X,XX (-XX%)" automático
- **Snap guides** ao arrastar (centro + alinhamento com outros itens)
- **Multi-seleção** com Shift+click
- **6 ferramentas de alinhamento** (esq/centro-H/dir/topo/centro-V/base)
- **Zoom**: Ctrl+scroll / botões +/−/fit
- **Atalhos de teclado**: Ctrl+Z/Y/N/D/C/V, Delete, setas (1px / Shift+10px), F (preview), Esc
- **Preview fullscreen** (modo apresentação)
- **Menu de contexto** (duplicar, trazer frente/atrás, excluir)
- **Toast notifications** substituíram `alert()`
- **WhatsApp share**: gera 1080×1080, 1080×1920 ou A4 com fundo dark + marca d'água

### 🟢 Design
- Novo visual dark workspace + UI clara, Inter/Archivo Black, gradientes sutis
- **Font Awesome** no lugar de emojis nos botões
- **15+ fontes** organizadas por categoria (condensadas, impacto, divertidas)
- **16 cores rápidas** + **8 paletas temáticas** (Açougue, Hortifruti, Padaria, Black Friday, Natal, Páscoa, Clássica, Premium) — aplicam cores em 1 clique
- **14 templates** prontos (Clássicos + Setores + Campanhas)
- **Efeitos de texto**: sombra com blur, contorno (stroke) com espessura, gradiente com direção
- **Selo diagonal** (tag/badge)
- Animações de entrada, hover states, pulse no botão IA

### 🔵 Arquitetura
- Split em 3 arquivos (HTML/CSS/JS) em vez de 932 linhas num só
- ES Modules (`<script type="module">`)
- Data-testid em todos os elementos interativos
- Service Worker mantido para PWA
- Snapshot debounced no history

## Endpoints API
- `GET /api/health` → status
- `POST /api/ai/generate-poster` → {descricao, tom} → {chamada, produto, marca, peso, preco, preco_de, paleta}
- `POST /api/ai/suggest-headlines` → {produto, quantidade} → {chamadas[]}
- `POST /api/ai/parse-csv` → {texto} → {linhas[]}

## Backlog / Próximos passos (P1/P2)

### P1 (alto valor, baixo esforço)
- Busca de produto por EAN/código de barras (cosmo.bluesoft.com.br)
- Colaboração em tempo real (Firestore `onSnapshot`)
- Galeria de ícones de produtos (pão, leite, banana, carne etc.)
- Dark/light theme toggle
- Tradução automática (IA) para versões em inglês/espanhol

### P2 (features SaaS)
- Multi-usuário com "modelos da rede" (compartilhados entre lojas)
- Remoção de fundo em imagens (remove.bg ou @imgly)
- Programação de ofertas com calendário + data de validade
- QR codes dinâmicos com analytics de escaneamento
- Modo TV (loop de cartazes em tela)
- Integração impressora térmica (etiquetas menores)
- Bin-packing otimizado para economia de papel
- Dashboard de estatísticas de uso

## Credenciais
- Firebase: `cartazista-web` (já existente, apiKey pública no código — precisa config de Security Rules no Console Firebase)
- LLM: `EMERGENT_LLM_KEY` em `/app/backend/.env` (Gemini 2.5 Flash)

## Atenção para o usuário
⚠️ As **Firestore Security Rules** do projeto Firebase precisam ser ajustadas no Firebase Console para permitir leitura/escrita apenas em `users/{uid}/**` pelo próprio uid. Sem isso, apesar da auth anônima estar funcionando, qualquer um com a apiKey ainda pode acessar outros docs. Regras sugeridas:
```
match /users/{userId}/{doc=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

