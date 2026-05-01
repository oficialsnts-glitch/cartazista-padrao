# Cartazista Pro 21.0

Editor web de cartazes de preço para supermercado, com IA Gemini.  
**Arquitetura**: frontend estático (HTML/CSS/JS) + backend FastAPI com **SDK oficial `google-genai`**.

- **Frontend** → Vercel
- **Backend** → Render
- **IA** → Google Gemini (`gemini-2.5-flash`) via chave própria

---

## 🏗️ Estrutura

```
cartazista-padrao/
├── backend/               # FastAPI + google-genai (Render)
│   ├── server.py
│   ├── requirements.txt
│   └── .env               # GEMINI_API_KEY, GEMINI_MODEL, CORS_ORIGINS
├── frontend/public/       # Site estático (Vercel)
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── config.js          # API_BASE (edite para apontar ao Render)
│   └── sw.js
├── render.yaml            # Infra-as-code do Render
├── vercel.json            # Config do Vercel
└── README.md
```

---

## 🚀 Deploy em Produção

### 1. Backend no Render

**Opção A — via `render.yaml` (Blueprints)**
1. Faça push deste repo no GitHub.
2. No Render: **New → Blueprint** → selecione o repo. O `render.yaml` será detectado.
3. No painel do serviço, vá em **Environment** e defina:
   - `GEMINI_API_KEY` = `AIzaSyBjL2b-072c40mMH0j9YhB16G-3dzMr25Q` (ou sua chave)
   - `CORS_ORIGINS` = `https://seu-projeto.vercel.app` (em produção, restrinja)
4. Deploy automático. URL final: `https://cartazista-backend.onrender.com`.

**Opção B — Web Service manual**
- **Root Directory**: `backend`
- **Build**: `pip install -r requirements.txt`
- **Start**: `uvicorn server:app --host 0.0.0.0 --port $PORT`
- **Env vars**: `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-2.5-flash`, `CORS_ORIGINS`

Teste: `curl https://SEU-BACKEND.onrender.com/api/health` → `{"status":"ok","model":"gemini-2.5-flash"}`.

### 2. Frontend no Vercel

1. **Edite** `frontend/public/config.js` e preencha:
   ```js
   window.CARTAZISTA_CONFIG = {
     API_BASE: "https://SEU-BACKEND.onrender.com",
   };
   ```
2. Commit + push.
3. No Vercel: **Add New Project** → selecione o repo. A config (`vercel.json`) serve a pasta `frontend/public` como site estático.
4. Deploy. URL final: `https://seu-projeto.vercel.app`.

> 💡 **Dica**: depois que souber a URL do Vercel, volte no Render e restrinja `CORS_ORIGINS=https://seu-projeto.vercel.app`.

---

## 💻 Rodar Localmente

### Backend
```bash
cd backend
pip install -r requirements.txt
# .env já vem com chave Gemini de exemplo — troque pela sua em produção
uvicorn server:app --reload --port 8001
```

### Frontend
Opção simples com `npx serve`:
```bash
cd frontend/public
# Edite config.js: API_BASE = "http://localhost:8001"
npx serve -l 3000
```
Abra `http://localhost:3000`.

---

## 🔑 Variáveis de ambiente (backend)

| Chave            | Descrição                                                   | Padrão                |
|------------------|-------------------------------------------------------------|-----------------------|
| `GEMINI_API_KEY` | Chave da API Gemini (obrigatória)                           | —                     |
| `GEMINI_MODEL`   | Modelo Gemini a usar                                        | `gemini-2.5-flash`    |
| `CORS_ORIGINS`   | Origens permitidas (lista separada por vírgula ou `*`)      | `*`                   |

Obter chave: <https://aistudio.google.com/app/apikey>

---

## 🔌 Endpoints

| Método | Rota                         | Função                                  |
|--------|------------------------------|-----------------------------------------|
| GET    | `/api/health`                | Ping do serviço                         |
| POST   | `/api/ai/generate-poster`    | Gera chamada + preço + paleta           |
| POST   | `/api/ai/suggest-headlines`  | N sugestões de chamadas criativas       |
| POST   | `/api/ai/parse-csv`          | Converte CSV/texto livre em lista       |
| GET    | `/api/ean/{ean}`             | Busca produto por código de barras      |

---

## 🧩 O que mudou nesta versão 21.0

- ✅ Backend migrado de `emergentintegrations` → **`google-genai` (SDK oficial)**
- ✅ Chave Gemini própria via `.env` (não depende mais do Universal Key)
- ✅ `CORS_ORIGINS` configurável (pronto para cross-origin Vercel ↔ Render)
- ✅ Frontend com `config.js` → troca de `API_BASE` sem rebuild
- ✅ `render.yaml` e `vercel.json` prontos para deploy com 1 clique
- ✅ `response_mime_type="application/json"` no Gemini para parse mais estável
