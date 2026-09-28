"""Cartazista Pro — Backend API (FastAPI)

App enxuto: as funções de IA (gerar cartaz, sugerir chamadas, lote CSV,
código de barras e geração de imagem) foram removidas a pedido do usuário.
O frontend é 100% estático e não depende mais de nenhuma rota de IA.

Rodar em:
  - Local:  uvicorn server:app --port 8001
  - Render: Web Service (Python) — comando: uvicorn server:app --host 0.0.0.0 --port $PORT
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]

app = FastAPI(title="Cartazista Pro API", version="22.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,  # com "*" precisa ser False
    allow_methods=["*"],
    allow_headers=["*"],
)

api = FastAPI()  # sub-app montado em /api


@api.get("/health")
async def health():
    return {"status": "ok"}


app.mount("/api", api)


@app.get("/")
async def root():
    return {"service": "Cartazista Pro API", "status": "ok", "version": "22.0"}
