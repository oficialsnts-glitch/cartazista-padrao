"""Cartazista Pro — Backend API (FastAPI)
Fornece endpoints de IA para gerar textos de cartazes de preço de supermercado.
"""
import base64
import json
import os
import re
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]

app = FastAPI(title="Cartazista Pro API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = FastAPI()  # sub-app for /api routes


# ---------- Schemas ----------
class GeneratePosterRequest(BaseModel):
    descricao: str = Field(..., description="Descrição livre do produto, ex: 'Leite Ninho 400g R$ 18,90'")
    tom: str = Field(default="promocional", description="promocional | elegante | divertido | agressivo")


class GeneratePosterResponse(BaseModel):
    chamada: str
    produto: str
    marca: str
    peso: str
    preco: str
    preco_de: str = ""
    paleta: list[str] = []


class SuggestHeadlinesRequest(BaseModel):
    produto: str
    quantidade: int = 5


class SuggestHeadlinesResponse(BaseModel):
    chamadas: list[str]


class ParseCsvRequest(BaseModel):
    texto: str = Field(..., description="Texto CSV ou colado da planilha")


class CsvLinha(BaseModel):
    produto: str
    marca: str = ""
    peso: str = ""
    preco: str
    preco_de: str = ""


class ParseCsvResponse(BaseModel):
    linhas: list[CsvLinha]


# ---------- Helpers ----------
def _extract_json(text: str) -> dict:
    """Extrai o primeiro JSON válido de um texto retornado pela LLM."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"Nenhum JSON encontrado em: {text[:200]}")
    return json.loads(match.group(0))


async def _ask_gemini(system: str, user: str) -> str:
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=str(uuid.uuid4()),
        system_message=system,
    ).with_model("gemini", "gemini-2.5-flash")
    return await chat.send_message(UserMessage(text=user))


# ---------- Endpoints ----------
@api.get("/health")
async def health():
    return {"status": "ok"}


@api.post("/ai/generate-poster", response_model=GeneratePosterResponse)
async def generate_poster(req: GeneratePosterRequest):
    system = (
        "Voce e um copywriter especialista em cartazes de PRECO de supermercado brasileiro. "
        "Receba a descricao do produto e retorne APENAS um JSON valido com os campos: "
        "chamada (string curta chamativa em MAIUSCULAS, 2-4 palavras, ex: 'OFERTA DA SEMANA'), "
        "produto (nome do produto em MAIUSCULAS, max 3 linhas curtas), "
        "marca (marca em MAIUSCULAS), "
        "peso (peso/volume, ex: '400 g', '1 L', '12 un'), "
        "preco (apenas o numero com virgula, ex: '18,90'), "
        "preco_de (preco anterior se houver, senao string vazia), "
        "paleta (array de 3 cores HEX combinando com o produto, ex: ['#d63031','#ffffff','#000000']). "
        "Sem markdown, sem explicacoes, SO o JSON."
    )
    user = f"Tom: {req.tom}\nDescricao: {req.descricao}"
    try:
        raw = await _ask_gemini(system, user)
        data = _extract_json(raw)
        return GeneratePosterResponse(
            chamada=str(data.get("chamada", "OFERTA")).upper(),
            produto=str(data.get("produto", "")).upper(),
            marca=str(data.get("marca", "")).upper(),
            peso=str(data.get("peso", "")),
            preco=str(data.get("preco", "0,00")).replace("R$", "").strip(),
            preco_de=str(data.get("preco_de", "")).replace("R$", "").strip(),
            paleta=[c for c in data.get("paleta", []) if isinstance(c, str)][:3],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao gerar cartaz: {e}")


@api.post("/ai/suggest-headlines", response_model=SuggestHeadlinesResponse)
async def suggest_headlines(req: SuggestHeadlinesRequest):
    system = (
        "Voce cria chamadas curtas para cartazes de supermercado (2-4 palavras, MAIUSCULAS). "
        "Retorne APENAS um JSON valido: {\"chamadas\": [\"...\", \"...\"]}. Sem markdown."
    )
    user = f"Produto: {req.produto}\nQuantidade: {req.quantidade} chamadas diferentes e criativas."
    try:
        raw = await _ask_gemini(system, user)
        data = _extract_json(raw)
        chamadas = [str(c).upper() for c in data.get("chamadas", [])][: req.quantidade]
        return SuggestHeadlinesResponse(chamadas=chamadas or ["OFERTA IMPERDIVEL"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao sugerir: {e}")


@api.post("/ai/parse-csv", response_model=ParseCsvResponse)
async def parse_csv(req: ParseCsvRequest):
    """Converte texto colado (CSV, planilha, lista livre) em linhas estruturadas."""
    system = (
        "Voce converte texto livre ou CSV de produtos de supermercado em JSON estruturado. "
        "Retorne APENAS: {\"linhas\": [{\"produto\": \"...\", \"marca\": \"...\", \"peso\": \"...\", "
        "\"preco\": \"9,99\", \"preco_de\": \"\"}]} em MAIUSCULAS para produto e marca. "
        "preco sempre com virgula como decimal. preco_de opcional. Sem markdown."
    )
    user = f"Texto:\n{req.texto[:4000]}"
    try:
        raw = await _ask_gemini(system, user)
        data = _extract_json(raw)
        linhas = []
        for item in data.get("linhas", []):
            linhas.append(
                CsvLinha(
                    produto=str(item.get("produto", "")).upper(),
                    marca=str(item.get("marca", "")).upper(),
                    peso=str(item.get("peso", "")),
                    preco=str(item.get("preco", "0,00")).replace("R$", "").strip(),
                    preco_de=str(item.get("preco_de", "")).replace("R$", "").strip(),
                )
            )
        return ParseCsvResponse(linhas=linhas)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao parsear CSV: {e}")


# ---------- EAN / Barcode lookup (Open Food Facts - free) ----------
class EanResponse(BaseModel):
    found: bool
    ean: str
    produto: str = ""
    marca: str = ""
    peso: str = ""
    imagem_data_url: str = ""
    categoria: str = ""
    fonte: str = ""


@api.get("/ean/{ean}", response_model=EanResponse)
async def lookup_ean(ean: str):
    ean = re.sub(r"\D", "", ean)
    if len(ean) < 8:
        raise HTTPException(status_code=400, detail="EAN inválido")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # 1) Open Food Facts (cobertura internacional + Brasil)
            r = await client.get(
                f"https://world.openfoodfacts.org/api/v0/product/{ean}.json"
            )
            data = r.json()
            if data.get("status") == 1:
                p = data.get("product", {})
                produto = (
                    p.get("product_name_pt")
                    or p.get("product_name")
                    or p.get("generic_name_pt")
                    or p.get("generic_name")
                    or ""
                )
                marca = (p.get("brands") or "").split(",")[0].strip()
                peso = p.get("quantity", "") or ""
                img_url = (
                    p.get("image_front_small_url")
                    or p.get("image_front_url")
                    or p.get("image_url")
                    or ""
                )
                categoria = (p.get("categories") or "").split(",")[0].strip()

                img_data = ""
                if img_url:
                    try:
                        img_resp = await client.get(img_url, timeout=8)
                        if img_resp.status_code == 200:
                            mime = img_resp.headers.get("content-type", "image/jpeg")
                            b64 = base64.b64encode(img_resp.content).decode("ascii")
                            img_data = f"data:{mime};base64,{b64}"
                    except Exception:
                        pass

                if produto:
                    return EanResponse(
                        found=True,
                        ean=ean,
                        produto=produto.upper(),
                        marca=marca.upper(),
                        peso=peso,
                        imagem_data_url=img_data,
                        categoria=categoria,
                        fonte="Open Food Facts",
                    )
    except Exception as e:
        print(f"EAN lookup error: {e}")

    # Fallback: tenta LLM inferir pela estrutura do EAN
    return EanResponse(found=False, ean=ean, fonte="não encontrado")


app.mount("/api", api)


@app.get("/")
async def root():
    return {"service": "Cartazista Pro API", "status": "ok"}
