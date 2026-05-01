# Cartazista Pro 21.0 — PRD

## Problem Statement Original
"refactor completo para Vercel (frontend) + Render (backend) com SDKs oficiais e sua própria chave Gemini api AIzaSyBjL2b-072c40mMH0j9YhB16G-3dzMr25Q"

## Arquitetura (21.0)
- **Frontend**: Site estático HTML/CSS/JS em `/app/frontend/public/` → deploy **Vercel** via `vercel.json`. API base configurável em `config.js` (sem rebuild).
- **Backend**: FastAPI em `/app/backend/server.py` → deploy **Render** via `render.yaml`. Usa **SDK oficial `google-genai`** (`gemini-2.5-flash`).
- **IA**: chave Gemini própria do usuário (`GEMINI_API_KEY` em env vars).
- **Sem MongoDB** — storage via Firebase Firestore client-side (mantido da v20).

## Arquivos-chave do refactor
- `backend/server.py` — migrou de `emergentintegrations` → `from google import genai`
- `backend/requirements.txt` — `google-genai>=1.0.0` substitui `emergentintegrations`
- `backend/.env` — `GEMINI_API_KEY`, `GEMINI_MODEL`, `CORS_ORIGINS`
- `frontend/public/config.js` — runtime config com `API_BASE` para cross-origin
- `render.yaml` — Blueprint de deploy
- `vercel.json` — serve `frontend/public/`
- `README.md` — guia passo-a-passo de deploy nas duas plataformas

## Implementado (Jan/2026 — iteração de refactor)
- ✅ Migração completa para SDK oficial `google-genai`
- ✅ `response_mime_type="application/json"` para parse estável
- ✅ CORS parametrizado por env var
- ✅ Frontend desacoplado do backend via `config.js`
- ✅ Health check `/api/health` testado → retorna `{"status":"ok","model":"gemini-2.5-flash"}`
- ✅ Blueprints de deploy (`render.yaml`, `vercel.json`) prontos
- ✅ README com instruções end-to-end

## Status dos endpoints
- `GET /api/health` → **OK**
- `GET /api/ean/{ean}` → **OK** (Open Food Facts, não usa Gemini)
- `POST /api/ai/generate-poster` → **código OK**, chave Gemini compartilhada foi revogada pelo Google (leaked) — precisa nova chave do usuário
- `POST /api/ai/suggest-headlines` → idem
- `POST /api/ai/parse-csv` → idem

## ⚠️ Ação necessária do usuário
A chave `AIzaSyBjL2b-072c40mMH0j9YhB16G-3dzMr25Q` foi automaticamente **revogada pelo Google** porque foi publicada em texto público. Gere uma nova em <https://aistudio.google.com/app/apikey> e:
- **Local**: edite `/app/backend/.env` → `GEMINI_API_KEY=...`
- **Render**: painel → Environment → atualize `GEMINI_API_KEY`

## Backlog (mantido da v20)
### P1
- Busca EAN via cosmo.bluesoft.com.br (complemento ao Open Food Facts)
- Colaboração em tempo real
- Dark/light theme toggle
- Tradução automática IA (EN/ES)

### P2
- Multi-usuário SaaS
- Calendário de ofertas
- QR analytics
- Modo TV
- Bin-packing A4
