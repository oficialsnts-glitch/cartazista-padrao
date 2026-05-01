/* =====================================================================
   CARTAZISTA PRO 20.0 — APP LOGIC
   - Firebase anonymous auth (per-user data)
   - Bug-free undo/redo with debounced history
   - AI generation (/api/ai/*)
   - CSV batch, WhatsApp share, preview, zoom, snap guides,
     multi-select align, rich templates, DE/POR pricing, etc.
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// ---------- Firebase ----------
const firebaseConfig = {
  apiKey: "AIzaSyDWbWeGNAfhwcmRm31oS58oo0wUKFS1wVo",
  authDomain: "cartazista-web.firebaseapp.com",
  projectId: "cartazista-web",
  storageBucket: "cartazista-web.firebasestorage.app",
  messagingSenderId: "838926325456",
  appId: "1:838926325456:web:e7cc86c71410272878b0d5",
};
const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);

let uid = null;
let sessionRef = null;
let modelosRef = null;

// ---------- API ----------
const API = ((window.CARTAZISTA_CONFIG && window.CARTAZISTA_CONFIG.API_BASE) || "").replace(/\/$/, "") + "/api";

// ---------- Constants ----------
const SCHEMA_VERSION = 2;
const TIPOS_PROTEGIDOS = ["head", "desc", "marca", "peso", "preco", "precoDe", "economia"];

// ---------- State ----------
const state = {
  cartazes: [],
  layout: "grid-4",
  sel: null,           // { data, el, cartaz }
  multiSel: [],        // array of {data, el, cartaz}
  zoom: 1,
  history: [],
  redo: [],
  modelos: [],
  dragging: false,
  dragStart: null,
  offset: { x: 0, y: 0 },
  dirty: false,
  lastAISuggestions: null,
  clipboard: null,
};

// ---------- Utilities ----------
const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid_ = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const deepClone = (o) => JSON.parse(JSON.stringify(o));

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toast(msg, kind = "info", ms = 2600) {
  const c = $("toastContainer");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  const icon = kind === "success" ? "fa-circle-check" : kind === "error" ? "fa-triangle-exclamation" : "fa-circle-info";
  el.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
  el.querySelector("span").textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateX(20%)"; }, ms - 300);
  setTimeout(() => el.remove(), ms);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- History (debounced, snapshot-based) ----------
function snapshot() {
  state.history.push(JSON.stringify({ cartazes: state.cartazes, layout: state.layout }));
  if (state.history.length > 50) state.history.shift();
  state.redo = [];
}
const snapshotDebounced = debounce(snapshot, 400);

function undo() {
  if (state.history.length < 1) return toast("Nada para desfazer", "info");
  state.redo.push(JSON.stringify({ cartazes: state.cartazes, layout: state.layout }));
  const prev = JSON.parse(state.history.pop());
  state.cartazes = prev.cartazes;
  state.layout = prev.layout;
  $("selectLayout").value = state.layout;
  state.sel = null; state.multiSel = [];
  closeEditor();
  render();
  save();
}
function redoAction() {
  if (state.redo.length < 1) return toast("Nada para refazer", "info");
  state.history.push(JSON.stringify({ cartazes: state.cartazes, layout: state.layout }));
  const next = JSON.parse(state.redo.pop());
  state.cartazes = next.cartazes;
  state.layout = next.layout;
  $("selectLayout").value = state.layout;
  render();
  save();
}

// ---------- Firebase persistence ----------
async function save() {
  if (!sessionRef) return;
  try {
    await setDoc(sessionRef, {
      schemaVersion: SCHEMA_VERSION,
      cartazes: state.cartazes,
      layout: state.layout,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("save error", e);
  }
}
const saveDebounced = debounce(save, 600);

async function load() {
  if (!sessionRef) return;
  try {
    const snap = await getDoc(sessionRef);
    if (snap.exists()) {
      const d = snap.data();
      state.cartazes = migrateCartazes(d.cartazes || [], d.schemaVersion || 1);
      state.layout = d.layout || "grid-4";
      $("selectLayout").value = state.layout;
    }
    if (state.cartazes.length === 0) adicionarCartaz(true);
    render();
  } catch (e) {
    console.error("load error", e);
    adicionarCartaz(true);
    render();
  }
}

async function loadModelos() {
  if (!modelosRef) return;
  try {
    const snap = await getDoc(modelosRef);
    if (snap.exists()) state.modelos = snap.data().modelos || [];
    renderModelosSelect();
  } catch (e) { console.error(e); }
}

async function saveModelos() {
  if (!modelosRef) return;
  await setDoc(modelosRef, { modelos: state.modelos });
}

// Schema migration: add any new fields with defaults
function migrateCartazes(arr, fromVersion) {
  if (!Array.isArray(arr)) return [];
  return arr.map(c => {
    c.itens = (c.itens || []).map(it => ({
      shadow: false, shadowCol: "#000", shadowBlur: 8,
      stroke: false, strokeCol: "#ffffff", strokeWidth: 2,
      gradient: false, gradC1: "#ff5252", gradC2: "#ffeaa7", gradDir: "to bottom",
      w: 0, h: 0, rot: 0,
      ...it,
    }));
    return c;
  });
}

// ---------- Cartazes / itens ----------
function makeItem(tipo, val, x, y, size, font, col, extra = {}) {
  return {
    id: `${tipo}-${uid_()}`,
    tipo, val, x, y, size, font, col,
    w: 0, h: 0, rot: 0,
    shadow: false, shadowCol: "#000", shadowBlur: 8,
    stroke: false, strokeCol: "#ffffff", strokeWidth: 2,
    gradient: false, gradC1: "#ff5252", gradC2: "#ffeaa7", gradDir: "to bottom",
    ...extra,
  };
}

function cartazBase() {
  return cartazFromAI({
    chamada: "SUPER OFERTA",
    produto: "PRODUTO",
    marca: "MARCA",
    peso: "1 kg",
    preco: "9,99",
    preco_de: "",
    paleta: ["#d63031", "#ffffff", "#1e272e"],
  });
}

/**
 * Cria cartaz "premium" a partir de dados da IA — layout profissional sem overlap.
 * Dimensões alvo: ~397×561 (grid-4), funciona escalado em grid-2 e grid-1.
 *
 * Estrutura:
 *  - Tarja superior colorida (chamada centralizada, branca)
 *  - Slot de imagem do produto (esquerda)  +  Texto produto/marca/peso (direita)
 *  - Bloco inferior do preço com fundo claro destacado
 *  - Badge diagonal de desconto (canto superior direito)
 *
 * @param {object} s - { chamada, produto, marca, peso, preco, preco_de, paleta[] }
 */
function cartazFromAI(s) {
  const id = uid_();
  const pal = (s.paleta && s.paleta.length >= 3)
    ? s.paleta
    : ["#d63031", "#ffffff", "#1e272e"];
  const cPrim = pal[0];
  const cText = pal[2] || "#1e272e";
  // bloco do preço sempre claro pra contraste
  const cPriceBg = "#f5f6f8";

  // Calcula desconto
  let pctOff = 0;
  if (s.preco_de) {
    const de = parseFloat(String(s.preco_de).replace(",", "."));
    const por = parseFloat(String(s.preco).replace(",", "."));
    if (de > 0 && por > 0 && de > por) pctOff = Math.round(((de - por) / de) * 100);
  }

  const itens = [];

  // ===== HEADER: TARJA TOPO =====
  itens.push({ ...makeItem("bg", "", 0, 0, 0, "", cPrim), w: 397, h: 70 });
  // Pequena faixa de acento embaixo da tarja
  itens.push({ ...makeItem("bg", "", 0, 70, 0, "", cText), w: 397, h: 4 });

  // CHAMADA (branca, centralizada na tarja)
  itens.push(makeItem(
    "head", s.chamada || "OFERTA",
    20, 16, 36, "'Anton'", "#ffffff",
    { shadow: true, shadowCol: "rgba(0,0,0,0.45)", shadowBlur: 4 }
  ));

  // ===== AREA PRODUTO (esquerda: slot imagem 140x140 / direita: texto) =====
  // Card placeholder atrás da imagem (somente aparece quando há imagem real)
  itens.push({ ...makeItem("bg", "", 15, 90, 0, "", "#f0f1f4"), w: 140, h: 140, _isImagePlaceholder: true });

  // Texto produto à direita do slot imagem (recentraliza se não tiver imagem)
  itens.push(makeItem(
    "desc", s.produto || "PRODUTO",
    170, 100, 32, "'Anton'", cText,
    { stroke: false, shadow: false, _centerWhenNoImg: true, _altX: 20, _altW: 357 }
  ));

  // Marca pequena
  itens.push(makeItem(
    "marca", s.marca || "",
    170, 175, 18, "'Bebas Neue'", "#666666",
    { _centerWhenNoImg: true, _altX: 20, _altW: 357 }
  ));

  // Peso/volume colorido (acento primário)
  itens.push(makeItem(
    "peso", s.peso || "",
    170, 200, 22, "'Bebas Neue'", cPrim,
    { _centerWhenNoImg: true, _altX: 20, _altW: 357 }
  ));

  // ===== BLOCO PREÇO inferior =====
  itens.push({ ...makeItem("bg", "", 0, 255, 0, "", cPriceBg), w: 397, h: 280 });
  // Faixa de acento no topo do bloco preço
  itens.push({ ...makeItem("bg", "", 0, 255, 0, "", cPrim), w: 397, h: 5 });

  // PRECO DE (struck, pequeno em cima)
  itens.push(makeItem(
    "precoDe", s.preco_de || "",
    25, 275, 22, "'Bebas Neue'", "#999999"
  ));

  // PRECO GIGANTE com stroke + sombra para impacto
  itens.push(makeItem(
    "preco", s.preco || "0,00",
    20, 310, 130, "'Anton'", cText,
    {
      stroke: true,
      strokeCol: "#ffffff",
      strokeWidth: 2,
      shadow: true,
      shadowCol: "rgba(0,0,0,0.25)",
      shadowBlur: 10,
    }
  ));

  // ECONOMIA (calculada no render)
  itens.push(makeItem(
    "economia", "",
    25, 490, 22, "'Bebas Neue'", cPrim
  ));

  // ===== BADGE DESCONTO =====
  if (pctOff > 0) {
    itens.push(makeItem(
      "tagBadge", `-${pctOff}%`,
      300, 88, 28, "'Anton'", "#ffffff",
      { bgCol: cPrim, rot: -15, w: 0, h: 0 }
    ));
  }

  return { id, itens, _imgSlot: { x: 25, y: 100, w: 120, h: 120 } };
}

/**
 * Tenta gerar imagem do produto via Nano Banana e adicionar ao cartaz.
 * Falha silenciosamente (não bloqueia o cartaz se quota estourou).
 */
async function tentarGerarImagemProduto(cartaz, produto, marca = "") {
  if (!cartaz._imgSlot) return;
  try {
    const r = await fetch(`${API}/ai/generate-product-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ produto, marca, estilo: "produto" }),
    });
    if (!r.ok) return; // 429/quota etc — fica sem imagem
    const data = await r.json();
    if (!data.imagem_data_url) return;
    const slot = cartaz._imgSlot;
    cartaz.itens.push({
      ...makeItem("img", data.imagem_data_url, slot.x, slot.y, 0, "", ""),
      w: slot.w, h: slot.h,
    });
    render(); save();
  } catch (e) {
    console.warn("Imagem nano banana falhou (ok, segue sem):", e.message);
  }
}

function adicionarCartaz(skipHistory = false) {
  if (!skipHistory) snapshot();
  state.cartazes.push(cartazBase());
  render();
  save();
}

function duplicarCartaz() {
  if (!state.sel) return toast("Selecione um cartaz (clique nele).", "info");
  snapshot();
  const clone = deepClone(state.sel.cartaz);
  clone.id = uid_();
  clone.itens.forEach(it => it.id = `${it.tipo}-${uid_()}`);
  state.cartazes.push(clone);
  render();
  save();
  toast("Cartaz duplicado", "success");
}

function excluirCartaz(cartazId) {
  if (!confirm("Excluir este cartaz?")) return;
  snapshot();
  state.cartazes = state.cartazes.filter(c => c.id !== cartazId);
  if (state.sel && state.sel.cartaz.id === cartazId) closeEditor();
  if (state.cartazes.length === 0) adicionarCartaz(true);
  render();
  save();
}

function excluirItemSelecionado() {
  if (!state.sel) return;
  if (TIPOS_PROTEGIDOS.includes(state.sel.data.tipo)) {
    return toast("Item protegido. Limpe o texto para ocultar.", "error");
  }
  snapshot();
  const c = state.sel.cartaz;
  c.itens = c.itens.filter(i => i.id !== state.sel.data.id);
  state.sel = null;
  closeEditor();
  render();
  save();
}

// ---------- Render (multi-página) ----------
const PER_PAGE = { "grid-1": 1, "grid-2": 2, "grid-4": 4 };

function render() {
  const host = $("paginas");
  host.innerHTML = "";

  const perPage = PER_PAGE[state.layout] || 4;
  const totalPages = Math.max(1, Math.ceil(state.cartazes.length / perPage));

  for (let p = 0; p < totalPages; p++) {
    const pagina = document.createElement("div");
    pagina.className = "pagina " + state.layout;
    pagina.dataset.page = p;

    const label = document.createElement("div");
    label.className = "pagina-label";
    label.textContent = `Página ${p + 1} de ${totalPages}`;
    pagina.appendChild(label);

    const slice = state.cartazes.slice(p * perPage, (p + 1) * perPage);
    slice.forEach((c, idxLocal) => {
      const globalIdx = p * perPage + idxLocal;
      const area = buildCartazArea(c, globalIdx);
      pagina.appendChild(area);
    });

    host.appendChild(pagina);
  }

  // apply current zoom
  qsa(".pagina", host).forEach(pg => pg.style.transform = `scale(${state.zoom})`);

  // Refresh editor inputs if selected
  if (state.sel) {
    const stillExists = state.cartazes.find(c => c.id === state.sel.cartaz.id)?.itens.find(i => i.id === state.sel.data.id);
    if (stillExists) {
      state.sel.el = document.getElementById(state.sel.data.id);
      if (state.sel.el) state.sel.el.classList.add("selected");
      mostrarNoPainel(state.sel.data, state.sel.cartaz);
    } else {
      closeEditor();
    }
  }

  const ecoInput = $("inEconomia");
  if (ecoInput) {
    const c = state.sel?.cartaz;
    const eco = c?.itens.find(i => i.tipo === "economia");
    ecoInput.value = eco?.val || "";
  }
}

function buildCartazArea(c, idx) {
  const area = document.createElement("div");
  area.className = "cartaz-area";
  area.dataset.cartazId = c.id;
  if (state.sel && state.sel.cartaz.id === c.id) area.classList.add("ativo");

  const num = document.createElement("div");
  num.className = "cartaz-num";
  num.textContent = `#${idx + 1}`;
  area.appendChild(num);

  const del = document.createElement("button");
  del.className = "cartaz-header";
  del.innerHTML = '<i class="fa-solid fa-trash"></i>';
  del.title = "Excluir cartaz";
  del.onclick = (e) => { e.stopPropagation(); excluirCartaz(c.id); };
  area.appendChild(del);

  // Pre-compute economia label
  const precoIt = c.itens.find(i => i.tipo === "preco");
  const precoDeIt = c.itens.find(i => i.tipo === "precoDe");
  const economiaIt = c.itens.find(i => i.tipo === "economia");
  if (precoDeIt && precoIt && economiaIt) {
    const d = parseFloat((precoDeIt.val || "").replace(",", "."));
    const p = parseFloat((precoIt.val || "").replace(",", "."));
    if (!isNaN(d) && !isNaN(p) && d > p) {
      const diff = (d - p).toFixed(2).replace(".", ",");
      const perc = Math.round(((d - p) / d) * 100);
      economiaIt.val = `ECONOMIZE R$ ${diff} (-${perc}%)`;
    } else {
      economiaIt.val = "";
    }
  }

  const hasImage = c.itens.some(i => i.tipo === "img");
  // Wrapper de design (397×561) — escala via CSS para preencher a célula da grade
  const content = document.createElement("div");
  content.className = "cartaz-content";
  area.appendChild(content);

  c.itens.forEach(it => {
    // Esconde placeholder cinza se não houver imagem real no cartaz
    if (it._isImagePlaceholder && !hasImage) return;
    const el = buildItem(it, c);
    // Recentraliza textos que normalmente ficam ao lado da imagem
    if (!hasImage && it._centerWhenNoImg) {
      el.style.left = (it._altX ?? 0) + "px";
      // Aplica largura padrão (centralizada) APENAS se o usuário não definiu uma largura customizada
      if (!it.w && it._altW) el.style.width = it._altW + "px";
    }
    content.appendChild(el);
    if (it.tipo === "qr") enqueueQR(el, it);
  });

  bindCartazDragHandlers(area, c.id);
  return area;
}

function buildItem(it, c) {
  let el;
  if (it.tipo === "img") {
    el = document.createElement("img");
    el.src = it.val || "";
  } else if (it.tipo === "qr") {
    el = document.createElement("div");
  } else {
    el = document.createElement("div");
  }

  el.id = it.id;
  el.className = "item";
  if (it.tipo === "bg") el.classList.add("tarja");
  if (state.sel?.data.id === it.id) el.classList.add("selected");
  if (state.multiSel.some(m => m.data.id === it.id)) el.classList.add("multi-selected");

  // z-index
  if (it.tipo === "bg") el.style.zIndex = "5";
  else if (it.tipo === "img" || it.tipo === "qr") el.style.zIndex = "10";
  else el.style.zIndex = "20";
  if (it.zOverride != null) el.style.zIndex = it.zOverride;

  el.style.left = (it.x || 0) + "px";
  el.style.top = (it.y || 0) + "px";
  el.style.transform = `rotate(${it.rot || 0}deg)`;
  el.style.color = it.col || "#000";

  if (it.tipo === "bg") {
    el.style.backgroundColor = it.col || "#f1c40f";
    el.style.width = (it.w || 300) + "px";
    el.style.height = (it.h || 60) + "px";
  } else if (it.tipo === "img" || it.tipo === "qr") {
    el.style.width = (it.w || 200) + "px";
    el.style.height = (it.h || 200) + "px";
  } else if (it.tipo === "tagBadge") {
    el.classList.add("tag-diagonal");
    el.textContent = it.val || "OFERTA";
    el.style.backgroundColor = it.bgCol || "#d63031";
    el.style.color = it.col || "#fff";
    el.style.fontSize = (it.size || 22) + "px";
    el.style.fontFamily = it.font || "'Anton'";
    el.style.transform = `rotate(${it.rot || -15}deg)`;
  } else {
    el.style.fontSize = (it.size || 40) + "px";
    el.style.fontFamily = it.font || "'Bebas Neue'";

    // Effects
    applyTextEffects(el, it);

    // precoDe gets strikethrough
    if (it.tipo === "precoDe") {
      el.classList.add("preco-risco");
      if (!it.val) el.style.visibility = "hidden";
    }
    if (it.tipo === "economia" && !it.val) el.style.visibility = "hidden";

    if (it.tipo === "preco") {
      const v = (it.val || "0,00").replace(",", ".").split(".");
      // safe innerHTML (values escaped)
      const int = escapeHtml(v[0] || "0");
      const cents = escapeHtml(v[1] ? v[1].slice(0, 2).padEnd(2, "0") : "00");
      el.innerHTML = `<small style="font-size:0.38em">R$</small>${int}<small style="font-size:0.58em; border-bottom:7px solid currentColor">,${cents}</small>`;
    } else if (it.tipo === "precoDe") {
      if (it.val) {
        el.innerHTML = `<span>R$ ${escapeHtml(it.val)}</span>`;
      } else el.innerHTML = "";
    } else {
      el.textContent = it.val || "";
    }
    // Permite largura/altura explícita em itens de texto (usado em templates)
    if (it.w) el.style.width = it.w + "px";
    if (it.h) el.style.height = it.h + "px";
  }

  bindItemEvents(el, it, c);
  return el;
}

function applyTextEffects(el, it) {
  // shadow
  if (it.shadow) {
    el.style.textShadow = `3px 3px ${it.shadowBlur || 8}px ${it.shadowCol || "#000"}`;
  } else {
    el.style.textShadow = "none";
  }
  // stroke via webkit
  if (it.stroke) {
    el.style.webkitTextStrokeWidth = (it.strokeWidth || 2) + "px";
    el.style.webkitTextStrokeColor = it.strokeCol || "#fff";
  } else {
    el.style.webkitTextStrokeWidth = "0";
  }
  // gradient text via background-clip
  if (it.gradient) {
    el.style.backgroundImage = `linear-gradient(${it.gradDir || "to bottom"}, ${it.gradC1}, ${it.gradC2})`;
    el.style.webkitBackgroundClip = "text";
    el.style.backgroundClip = "text";
    el.style.color = "transparent";
    el.style.webkitTextFillColor = "transparent";
  } else {
    el.style.backgroundImage = "none";
    el.style.webkitTextFillColor = it.col || "#000";
  }
}

function enqueueQR(container, it) {
  setTimeout(() => {
    try {
      container.innerHTML = "";
      new QRCode(container, {
        text: it.val || "https://exemplo.com",
        width: it.w || 140,
        height: it.h || 140,
        colorDark: "#000000",
        colorLight: "#ffffff",
      });
    } catch (e) { console.warn("QR err", e); }
  }, 40);
}

// ---------- Drag + Snap ----------
// Escala visual aplicada ao .cartaz-content por layout (preenche a célula).
function getLayoutScale() {
  if (state.layout === "grid-1") return { x: 2, y: 2 };
  if (state.layout === "grid-2") return { x: 2, y: 1 };
  return { x: 1, y: 1 };
}

function bindItemEvents(el, it, c) {
  el.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    const isMulti = e.shiftKey;

    if (isMulti) {
      if (!state.multiSel.some(m => m.data.id === it.id)) {
        state.multiSel.push({ data: it, el, cartaz: c });
      } else {
        state.multiSel = state.multiSel.filter(m => m.data.id !== it.id);
      }
      qsa(".item").forEach(e2 => e2.classList.remove("multi-selected"));
      state.multiSel.forEach(m => document.getElementById(m.data.id)?.classList.add("multi-selected"));
      return;
    } else {
      state.multiSel = [];
      qsa(".item").forEach(e2 => e2.classList.remove("multi-selected"));
    }

    snapshot(); // snapshot BEFORE drag
    state.sel = { data: it, el, cartaz: c };
    state.dragging = true;
    state.dragStart = { x: it.x, y: it.y };
    qsa(".item").forEach(e2 => e2.classList.remove("selected"));
    el.classList.add("selected");
    const sc = getLayoutScale();
    state.offset.x = e.clientX - el.offsetLeft * state.zoom * sc.x;
    state.offset.y = e.clientY - el.offsetTop * state.zoom * sc.y;
    mostrarNoPainel(it, c);
    qsa(".cartaz-area").forEach(a => a.classList.remove("ativo"));
    el.closest(".cartaz-area")?.classList.add("ativo");
  });

  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    state.sel = { data: it, el, cartaz: c };
    showCtxMenu(e.clientX, e.clientY);
  });

  el.addEventListener("dblclick", () => {
    if (it.tipo === "bg") return;
    if (it.tipo === "qr") {
      const nv = prompt("Novo conteúdo do QR Code:", it.val);
      if (nv) { snapshot(); it.val = nv; render(); save(); }
      return;
    }
    if (it.tipo === "img") {
      pickImage((dataUrl) => { snapshot(); it.val = dataUrl; render(); save(); });
      return;
    }
    const nv = prompt("Novo texto:", it.val);
    if (nv !== null) { snapshot(); it.val = nv; render(); save(); }
  });
}

document.addEventListener("mousemove", (e) => {
  if (!state.dragging || !state.sel) return;
  const sc = getLayoutScale();
  const rawX = (e.clientX - state.offset.x) / (state.zoom * sc.x);
  const rawY = (e.clientY - state.offset.y) / (state.zoom * sc.y);

  // snap (bounds = cartaz-content design canvas)
  const content = state.sel.el.closest(".cartaz-content") || state.sel.el.closest(".cartaz-area");
  const snap = computeSnap(rawX, rawY, state.sel, content);
  state.sel.data.x = snap.x;
  state.sel.data.y = snap.y;
  state.sel.el.style.left = snap.x + "px";
  state.sel.el.style.top = snap.y + "px";
});

document.addEventListener("mouseup", () => {
  if (state.dragging) {
    state.dragging = false;
    clearSnapGuides();
    save();
  }
});

function computeSnap(x, y, selObj, area) {
  const tol = 6;
  clearSnapGuides();
  if (!area) return { x, y };

  const cartaz = selObj.cartaz;
  const el = selObj.el;
  const w = el.offsetWidth, h = el.offsetHeight;
  const areaW = area.offsetWidth, areaH = area.offsetHeight;

  let sx = x, sy = y;

  // center
  const cx = (areaW - w) / 2;
  const cy = (areaH - h) / 2;
  if (Math.abs(x - cx) < tol) { sx = cx; addGuide("v", area, cx + w / 2); }
  if (Math.abs(y - cy) < tol) { sy = cy; addGuide("h", area, cy + h / 2); }

  // align to other items
  cartaz.itens.forEach(other => {
    if (other.id === selObj.data.id) return;
    const oEl = document.getElementById(other.id);
    if (!oEl) return;
    const oX = other.x, oY = other.y;
    if (Math.abs(x - oX) < tol) { sx = oX; addGuide("v", area, oX); }
    if (Math.abs(y - oY) < tol) { sy = oY; addGuide("h", area, oY); }
  });

  return { x: sx, y: sy };
}

function addGuide(dir, area, pos) {
  const g = document.createElement("div");
  g.className = `snap-guide ${dir}`;
  if (dir === "h") g.style.top = pos + "px";
  else g.style.left = pos + "px";
  area.appendChild(g);
}
function clearSnapGuides() { qsa(".snap-guide").forEach(g => g.remove()); }

// ---------- Editor panel ----------
function mostrarNoPainel(it, c) {
  $("editor").classList.add("open");
  $("editorBadge").textContent = (it.tipo || "ITEM").toUpperCase();
  $("editorTitle").textContent = "Editor";

  // Conteúdo
  $("inHead").value   = c.itens.find(i => i.tipo === "head")?.val   || "";
  $("inDesc").value   = c.itens.find(i => i.tipo === "desc")?.val   || "";
  $("inMarca").value  = c.itens.find(i => i.tipo === "marca")?.val  || "";
  $("inPeso").value   = c.itens.find(i => i.tipo === "peso")?.val   || "";
  $("inPreco").value  = c.itens.find(i => i.tipo === "preco")?.val  || "";
  $("inPrecoDe").value = c.itens.find(i => i.tipo === "precoDe")?.val || "";
  $("inEconomia").value = c.itens.find(i => i.tipo === "economia")?.val || "";

  // Estilo
  $("inFont").value = it.font || "'Bebas Neue'";
  $("inSize").value = it.size || 40;
  $("inColor").value = /^#/.test(it.col) ? it.col : "#000000";
  $("inW").value = it.w || 0;
  $("inH").value = it.h || 0;
  $("inRot").value = it.rot || 0;
  // Tamanho (largura/altura) agora disponível para QUALQUER item — edição livre
  $("secaoFundo").style.display = "block";
  // Atualiza proporção base quando troca de item
  if ((it.tipo === "img" || it.tipo === "qr") && it.w && it.h) {
    aspectRatio = it.w / it.h;
  }
  $("labelEdit").textContent = `Editando: ${(it.tipo || "ITEM").toUpperCase()}`;

  // Efeitos
  $("inShadow").checked = !!it.shadow;
  $("inShadowColor").value = it.shadowCol || "#000000";
  $("inShadowBlur").value = it.shadowBlur ?? 8;
  $("inStroke").checked = !!it.stroke;
  $("inStrokeColor").value = it.strokeCol || "#ffffff";
  $("inStrokeWidth").value = it.strokeWidth || 2;
  $("inGradient").checked = !!it.gradient;
  $("inGradC1").value = it.gradC1 || "#ff5252";
  $("inGradC2").value = it.gradC2 || "#ffeaa7";
  $("inGradientDir").value = it.gradDir || "to bottom";

  // highlight color-box
  qsa(".color-box").forEach(b => b.classList.remove("active"));
  qsa(".color-box").forEach(b => { if (b.dataset.col?.toLowerCase() === (it.col || "").toLowerCase()) b.classList.add("active"); });
}

function closeEditor() {
  state.sel = null;
  $("editor").classList.remove("open");
  qsa(".item").forEach(i => i.classList.remove("selected"));
  qsa(".cartaz-area").forEach(a => a.classList.remove("ativo"));
}

function atualizarCampoTexto(tipo) {
  if (!state.sel) return;
  const c = state.sel.cartaz;
  const it = c.itens.find(i => i.tipo === tipo);
  if (!it) return;
  snapshotDebounced();
  const elInput = $("in" + tipo.charAt(0).toUpperCase() + tipo.slice(1));
  it.val = elInput.value;
  render();
  saveDebounced();
}

// ---------- State auxiliar ----------
let aspectLocked = false;
let aspectRatio = 1; // w/h ratio quando travado

function toggleAspectLock() {
  if (!state.sel) return;
  aspectLocked = !aspectLocked;
  const btn = $("btnLockAspect");
  const hint = $("lockAspectHint");
  if (aspectLocked) {
    const w = state.sel.data.w || parseInt($("inW").value) || 1;
    const h = state.sel.data.h || parseInt($("inH").value) || 1;
    aspectRatio = w / h;
    btn.innerHTML = '<i class="fa-solid fa-link"></i>';
    btn.style.background = "var(--accent)";
    btn.style.color = "#fff";
    if (hint) hint.textContent = `Proporção travada (W/H = ${aspectRatio.toFixed(2)})`;
  } else {
    btn.innerHTML = '<i class="fa-solid fa-link-slash"></i>';
    btn.style.background = "";
    btn.style.color = "";
    if (hint) hint.textContent = "W e H independentes";
  }
}

function atualizarEstilo() {
  if (!state.sel) return;
  const d = state.sel.data;
  snapshotDebounced();
  d.font = $("inFont").value;
  d.size = parseInt($("inSize").value) || 40;
  d.col = $("inColor").value;
  // Width / Height com aspect-ratio opcional
  const newW = parseInt($("inW").value);
  const newH = parseInt($("inH").value);
  if (aspectLocked && (d.tipo === "img" || d.tipo === "qr")) {
    // se W mudou, atualiza H proporcional, e vice-versa
    if (!isNaN(newW) && newW !== d.w) {
      d.w = newW;
      d.h = Math.max(10, Math.round(newW / aspectRatio));
      $("inH").value = d.h;
    } else if (!isNaN(newH) && newH !== d.h) {
      d.h = newH;
      d.w = Math.max(10, Math.round(newH * aspectRatio));
      $("inW").value = d.w;
    }
  } else {
    if (!isNaN(newW)) d.w = newW;
    if (!isNaN(newH)) d.h = newH;
  }
  d.rot = parseFloat($("inRot").value) || 0;
  d.shadow = $("inShadow").checked;
  d.shadowCol = $("inShadowColor").value;
  d.shadowBlur = parseInt($("inShadowBlur").value) || 8;
  d.stroke = $("inStroke").checked;
  d.strokeCol = $("inStrokeColor").value;
  d.strokeWidth = parseInt($("inStrokeWidth").value) || 2;
  d.gradient = $("inGradient").checked;
  d.gradC1 = $("inGradC1").value;
  d.gradC2 = $("inGradC2").value;
  d.gradDir = $("inGradientDir").value;
  render();
  saveDebounced();
}

function setCorRapida(cor) {
  if (!state.sel) return toast("Selecione um item primeiro.", "info");
  $("inColor").value = cor;
  atualizarEstilo();
}

// ---------- Alinhamentos ----------
function alignar(tipo) {
  if (!state.sel) return toast("Selecione um item.", "info");
  snapshot();
  const bounds = state.sel.el.closest(".cartaz-content") || state.sel.el.closest(".cartaz-area");
  const w = state.sel.el.offsetWidth, h = state.sel.el.offsetHeight;
  const W = bounds.offsetWidth, H = bounds.offsetHeight;
  if (tipo === "L") state.sel.data.x = 0;
  if (tipo === "R") state.sel.data.x = W - w;
  if (tipo === "CH") state.sel.data.x = (W - w) / 2;
  if (tipo === "T") state.sel.data.y = 0;
  if (tipo === "B") state.sel.data.y = H - h;
  if (tipo === "CV") state.sel.data.y = (H - h) / 2;
  render();
  save();
}

// ---------- Toolbar handlers: add image / QR / tarja / badge ----------
function pickImage(cb) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => cb(ev.target.result);
    r.readAsDataURL(f);
  };
  input.click();
}

function ensureCartaz() {
  if (!state.sel) {
    if (state.cartazes.length) {
      const c = state.cartazes[0];
      state.sel = { cartaz: c, data: c.itens[0], el: null };
    } else return null;
  }
  return state.sel.cartaz;
}

function adicionarImagem() {
  const c = ensureCartaz(); if (!c) return toast("Crie um cartaz primeiro.", "error");
  pickImage((url) => {
    snapshot();
    c.itens.push({ ...makeItem("img", url, 50, 50, 0, "", ""), w: 220, h: 180 });
    render(); save();
  });
}

function adicionarQR() {
  const c = ensureCartaz(); if (!c) return;
  const texto = prompt("Texto ou URL do QR Code:", "https://exemplo.com");
  if (!texto) return;
  snapshot();
  c.itens.push({ ...makeItem("qr", texto, 180, 180, 0, "", ""), w: 140, h: 140 });
  render(); save();
}

function adicionarTarja() {
  const c = ensureCartaz(); if (!c) return;
  snapshot();
  const tarja = { ...makeItem("bg", "", 35, 170, 0, "", "#f1c40f"), w: 470, h: 92 };
  const texto = makeItem("custom", "CHAMADA EXTRA", 45, 185, 45, "'Bebas Neue'", "#1e272e", { shadow: true, shadowCol: "#fff" });
  c.itens.unshift(tarja);
  c.itens.unshift(texto);
  render(); save();
  // select the text
  setTimeout(() => {
    const el = document.getElementById(texto.id);
    if (el) {
      state.sel = { data: texto, el, cartaz: c };
      qsa(".item").forEach(e => e.classList.remove("selected"));
      el.classList.add("selected");
      mostrarNoPainel(texto, c);
    }
  }, 80);
}

function adicionarBadge() {
  const c = ensureCartaz(); if (!c) return;
  snapshot();
  const badge = makeItem("tagBadge", "-20%", 300, 20, 28, "'Anton'", "#ffffff", { bgCol: "#d63031", rot: -15, w: 0, h: 0 });
  c.itens.push(badge);
  render(); save();
}

// ---------- Galeria de ícones (Iconify) ----------
const ICON_CATEGORIAS = [
  { id: "tudo", nome: "Tudo", icons: null },
  { id: "hortifruti", nome: "Hortifruti", icons: ["mdi:apple","mdi:food-apple-outline","noto:banana","noto:grapes","noto:watermelon","noto:strawberry","noto:avocado","noto:carrot","noto:tomato","noto:broccoli","noto:onion","noto:potato","noto:leafy-green","noto:pineapple","noto:mango","noto:lemon","noto:cherries","noto:corn","noto:hot-pepper","noto:eggplant"] },
  { id: "acougue", nome: "Açougue", icons: ["noto:cut-of-meat","noto:poultry-leg","noto:bacon","noto:cooked-rice","mdi:cow","mdi:pig","game-icons:chicken-leg","game-icons:steak","mdi:food-steak","emojione:poultry-leg"] },
  { id: "padaria", nome: "Padaria", icons: ["noto:baguette-bread","noto:bread","noto:croissant","noto:bagel","noto:pretzel","noto:pancakes","noto:birthday-cake","noto:cupcake","noto:cookie","noto:doughnut","noto:pie","noto:shortcake"] },
  { id: "bebidas", nome: "Bebidas", icons: ["noto:tropical-drink","noto:beer-mug","noto:beverage-box","noto:bottle-with-popping-cork","noto:wine-glass","noto:cup-with-straw","noto:hot-beverage","noto:teacup-without-handle","noto:clinking-beer-mugs","noto:glass-of-milk","noto:cup","fa6-solid:bottle-water"] },
  { id: "laticinios", nome: "Laticínios", icons: ["noto:glass-of-milk","noto:cheese-wedge","noto:butter","noto:egg","noto:ice-cream","mdi:cheese"] },
  { id: "limpeza", nome: "Limpeza", icons: ["mdi:spray-bottle","mdi:broom","mdi:bottle-tonic","mdi:washing-machine","mdi:soap","mdi:bucket","mdi:bottle-wine","fa6-solid:bottle-droplet","mdi:toilet-paper"] },
  { id: "higiene", nome: "Higiene", icons: ["mdi:toothbrush","mdi:shampoo","mdi:hair-dryer","mdi:soap","mdi:mirror","mdi:diaper-outline","mdi:baby-bottle","mdi:tooth"] },
  { id: "mercearia", nome: "Mercearia", icons: ["noto:canned-food","mdi:rice","mdi:pasta","mdi:noodles","mdi:popcorn","noto:honey-pot","noto:salt","noto:jar","mdi:coffee-bean","mdi:corn"] },
  { id: "promo", nome: "Promo", icons: ["mdi:sale","mdi:tag","mdi:tag-outline","mdi:percent","mdi:cart","mdi:star","mdi:fire","mdi:clock-fast","mdi:gift","mdi:medal","mdi:crown","mdi:lightning-bolt","mdi:thumb-up"] },
];
let iconCatAtual = "tudo";
let iconSearch = "";

function renderIconGrid() {
  const grid = $("iconGrid");
  grid.innerHTML = "";
  const cor = encodeURIComponent($("iconColor").value || "#000");

  let toShow = [];
  if (iconCatAtual === "tudo") {
    ICON_CATEGORIAS.forEach(c => { if (c.icons) c.icons.forEach(i => toShow.push({ id: i, cat: c.nome })); });
  } else {
    const cat = ICON_CATEGORIAS.find(c => c.id === iconCatAtual);
    if (cat?.icons) cat.icons.forEach(i => toShow.push({ id: i, cat: cat.nome }));
  }

  if (iconSearch) {
    const q = iconSearch.toLowerCase();
    toShow = toShow.filter(x => x.id.toLowerCase().includes(q) || x.cat.toLowerCase().includes(q));
  }

  toShow.slice(0, 200).forEach(x => {
    const cell = document.createElement("div");
    cell.className = "icon-cell";
    cell.title = x.id;
    const iconName = x.id;
    const url = `https://api.iconify.design/${iconName}.svg?color=%23${cor.replace(/^%23/, "")}`;
    const img = document.createElement("img");
    img.src = url;
    img.alt = x.id;
    img.loading = "lazy";
    cell.appendChild(img);
    const nome = document.createElement("div");
    nome.className = "nome";
    nome.textContent = iconName.split(":").pop().replace(/-/g, " ");
    cell.appendChild(nome);
    cell.onclick = () => adicionarIcone(iconName, $("iconColor").value);
    grid.appendChild(cell);
  });
  if (toShow.length === 0) grid.innerHTML = '<div class="small" style="padding:20px">Nenhum ícone encontrado.</div>';
}

function renderIconCategorias() {
  const host = $("iconCategorias");
  host.innerHTML = "";
  ICON_CATEGORIAS.forEach(cat => {
    const chip = document.createElement("div");
    chip.className = "chip" + (cat.id === iconCatAtual ? " active" : "");
    chip.textContent = cat.nome;
    chip.onclick = () => { iconCatAtual = cat.id; renderIconCategorias(); renderIconGrid(); };
    host.appendChild(chip);
  });
}

async function adicionarIcone(iconName, cor) {
  const c = ensureCartaz();
  if (!c) return toast("Crie um cartaz primeiro.", "error");
  const corEnc = encodeURIComponent(cor || "#000").replace("#", "%23");
  const url = `https://api.iconify.design/${iconName}.svg?color=${corEnc}`;
  try {
    const r = await fetch(url);
    const svg = await r.text();
    const b64 = btoa(unescape(encodeURIComponent(svg)));
    const dataUrl = `data:image/svg+xml;base64,${b64}`;
    snapshot();
    c.itens.push({ ...makeItem("img", dataUrl, 80, 80, 0, "", ""), w: 180, h: 180 });
    render(); save();
    toast("Ícone adicionado", "success");
    closeModal("modalIcones");
  } catch (e) {
    toast("Erro ao carregar ícone", "error");
  }
}

// ---------- EAN lookup ----------
let eanResultado = null;
async function buscarEAN() {
  const ean = ($("eanInput").value || "").replace(/\D/g, "");
  if (ean.length < 8) return toast("Digite um EAN válido (8-14 dígitos)", "error");
  const btn = $("btnEANBuscar");
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Buscando...';
  try {
    const r = await fetch(`${API}/ean/${ean}`);
    const data = await r.json();
    eanResultado = data;
    if (data.found) {
      $("eanResultado").innerHTML = `
        <div class="ean-card">
          ${data.imagem_data_url ? `<img src="${data.imagem_data_url}" alt="${escapeHtml(data.produto)}" />` : ""}
          <div class="info">
            <b>${escapeHtml(data.produto)}</b>
            Marca: ${escapeHtml(data.marca) || "—"}<br>
            Peso/Volume: ${escapeHtml(data.peso) || "—"}<br>
            ${data.categoria ? `Categoria: ${escapeHtml(data.categoria)}<br>` : ""}
            <small style="opacity:.6">Fonte: ${escapeHtml(data.fonte)}</small>
          </div>
        </div>
        <div class="campo mt-10">
          <label>Preço a anunciar</label>
          <input type="text" id="eanPreco" placeholder="ex: 9,99" />
        </div>
        <div class="campo">
          <label>Preço anterior (opcional, riscado)</label>
          <input type="text" id="eanPrecoDe" placeholder="ex: 12,90" />
        </div>`;
      $("btnEANAplicar").classList.remove("hidden");
      toast("Produto encontrado!", "success");
    } else {
      $("eanResultado").innerHTML = `<div class="ai-result-card"><b>Produto não encontrado.</b><br>Tente cadastrá-lo manualmente via IA Gerar ou preencher os campos.</div>`;
      $("btnEANAplicar").classList.add("hidden");
    }
  } catch (e) {
    toast("Erro: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Buscar';
  }
}

function aplicarEAN() {
  if (!eanResultado?.found) return;
  const preco = ($("eanPreco")?.value || "0,00").replace(".", ",");
  const precoDe = ($("eanPrecoDe")?.value || "").replace(".", ",");
  snapshot();
  const c = cartazFromAI({
    chamada: "OFERTA",
    produto: eanResultado.produto,
    marca: eanResultado.marca || "",
    peso: eanResultado.peso || "",
    preco: preco,
    preco_de: precoDe,
    paleta: ["#d63031", "#ffffff", "#1e272e"],
  });
  // Imagem do produto à direita (se houver)
  if (eanResultado.imagem_data_url) {
    c.itens.push({ ...makeItem("img", eanResultado.imagem_data_url, 240, 95, 0, "", ""), w: 140, h: 140 });
  }
  state.cartazes.push(c);
  render(); save();
  closeModal("modalEAN");
  $("eanInput").value = ""; $("eanResultado").innerHTML = "";
  $("btnEANAplicar").classList.add("hidden");
  eanResultado = null;
  toast("Cartaz criado a partir do EAN", "success");
}

// ---------- Remoção de fundo (@imgly/background-removal via CDN) ----------
let imglyModule = null;
async function loadImgly() {
  if (imglyModule) return imglyModule;
  toast("Carregando modelo de remoção de fundo...", "info", 4000);
  imglyModule = await import("https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.6.0/+esm");
  return imglyModule;
}

async function removerFundoItem() {
  if (!state.sel || state.sel.data.tipo !== "img") {
    return toast("Selecione uma imagem primeiro", "error");
  }
  const it = state.sel.data;
  const btn = $("btnRemoverBg");
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Processando...';
  try {
    const imgly = await loadImgly();
    const removeBg = imgly.default || imgly.removeBackground;
    btn.innerHTML = '<span class="loader"></span> Removendo fundo...';
    const blob = await removeBg(it.val, {
      output: { format: "image/png", quality: 0.9 },
    });
    const dataUrl = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
    snapshot();
    it.val = dataUrl;
    render(); save();
    toast("Fundo removido!", "success");
  } catch (e) {
    console.error(e);
    toast("Erro: " + (e.message || "falha ao remover fundo"), "error", 4000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

// ---------- Drag & drop de cartazes entre páginas ----------
let dragCartazId = null;

function bindCartazDragHandlers(area, cartazId) {
  const handle = document.createElement("div");
  handle.className = "cartaz-drag-handle";
  handle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
  handle.title = "Arraste para reordenar";
  handle.draggable = true;
  area.appendChild(handle);

  handle.addEventListener("dragstart", (e) => {
    dragCartazId = cartazId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cartazId);
    area.classList.add("dragging");
    // preview translúcido
    const preview = area.cloneNode(true);
    preview.style.width = area.offsetWidth + "px";
    preview.style.height = area.offsetHeight + "px";
    preview.style.transform = "scale(0.5)";
    preview.style.position = "absolute";
    preview.style.top = "-9999px";
    document.body.appendChild(preview);
    e.dataTransfer.setDragImage(preview, 20, 20);
    setTimeout(() => preview.remove(), 0);
  });

  handle.addEventListener("dragend", () => {
    dragCartazId = null;
    qsa(".cartaz-area").forEach(a => a.classList.remove("dragging", "drop-target"));
  });

  area.addEventListener("dragover", (e) => {
    if (!dragCartazId || dragCartazId === cartazId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    area.classList.add("drop-target");
  });
  area.addEventListener("dragleave", () => area.classList.remove("drop-target"));
  area.addEventListener("drop", (e) => {
    e.preventDefault();
    area.classList.remove("drop-target");
    if (!dragCartazId || dragCartazId === cartazId) return;
    const fromIdx = state.cartazes.findIndex(c => c.id === dragCartazId);
    const toIdx = state.cartazes.findIndex(c => c.id === cartazId);
    if (fromIdx < 0 || toIdx < 0) return;
    snapshot();
    const [moved] = state.cartazes.splice(fromIdx, 1);
    state.cartazes.splice(toIdx, 0, moved);
    render(); save();
    toast("Cartaz reordenado", "success");
  });
}
function novaPagina() {
  snapshot();
  const perPage = PER_PAGE[state.layout] || 4;
  // completa a página atual até múltiplo de perPage
  const faltam = (perPage - (state.cartazes.length % perPage)) % perPage;
  for (let i = 0; i < faltam; i++) state.cartazes.push(cartazBase());
  // adiciona perPage cartazes para a nova página
  for (let i = 0; i < perPage; i++) state.cartazes.push(cartazBase());
  render(); save();
  toast(`Nova página adicionada (+${perPage} cartazes)`, "success");
  // scroll para a última página
  setTimeout(() => {
    const ultima = qsa(".pagina").slice(-1)[0];
    ultima?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 100);
}

// ---------- Templates ----------
// Cada template é um BUILDER que monta seu próprio cartaz com identidade visual
// ÚNICA, INDEPENDENTE do cartazFromAI (não é uma "cópia" do layout da IA).
// Canvas alvo: 397×561 px (grid-4). Funciona escalado em grid-2 e grid-1.
//
// IMPORTANTE: todo template DEVE conter os 7 tipos protegidos
// (head, desc, marca, peso, preco, precoDe, economia) para o editor funcionar.
const TEMPLATES = {
  // ---------- 1. PROMO — Mercado de Bairro (vermelho/amarelo clássico) ----------
  promo: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#FFFFFF"), w:397, h:561 });
    i.push({ ...makeItem("bg","",0,0,0,"","#E63946"), w:397, h:90 });
    i.push({ ...makeItem("bg","",0,90,0,"","#FFD000"), w:397, h:8 });
    i.push(makeItem("head","OFERTA ESPECIAL",0,22,46,"'Archivo Black'","#FFFFFF",{ w:397, shadow:true, shadowCol:"rgba(0,0,0,.35)", shadowBlur:6 }));
    i.push(makeItem("desc","PRODUTO SELECIONADO",0,128,30,"'Anton'","#1e272e",{ w:397 }));
    i.push(makeItem("marca","MARCA",0,172,22,"'Bebas Neue'","#666666",{ w:397 }));
    i.push(makeItem("peso","1 KG",0,202,24,"'Bebas Neue'","#E63946",{ w:397 }));
    i.push({ ...makeItem("bg","",0,260,0,"","#FFD000"), w:397, h:301 });
    i.push({ ...makeItem("bg","",0,260,0,"","#1e272e"), w:397, h:6 });
    i.push(makeItem("precoDe","",0,278,24,"'Bebas Neue'","#1e272e",{ w:397 }));
    i.push(makeItem("preco","9,99",0,310,160,"'Anton'","#1e272e",{ w:397, stroke:true, strokeCol:"#FFFFFF", strokeWidth:3 }));
    i.push(makeItem("economia","",0,520,22,"'Bebas Neue'","#E63946",{ w:397 }));
    return { id: uid_(), itens: i };
  },

  // ---------- 2. PREÇO GIGANTE (amarelo absoluto, preço enorme) ----------
  preco: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#FFD60A"), w:397, h:561 });
    i.push({ ...makeItem("bg","",0,0,0,"","#000000"), w:397, h:50 });
    i.push({ ...makeItem("bg","",0,511,0,"","#000000"), w:397, h:50 });
    i.push(makeItem("head","SÓ HOJE",0,10,30,"'Bebas Neue'","#FFD60A",{ w:397 }));
    i.push(makeItem("desc","APROVEITE!",0,72,42,"'Archivo Black'","#000000",{ w:397 }));
    i.push(makeItem("marca","",0,128,22,"'Bebas Neue'","#000000",{ w:397 }));
    i.push(makeItem("peso","",0,158,24,"'Bebas Neue'","#000000",{ w:397 }));
    i.push(makeItem("precoDe","",0,190,28,"'Bebas Neue'","#666666",{ w:397 }));
    i.push(makeItem("preco","4,99",0,225,210,"'Anton'","#E63946",{ w:397, stroke:true, strokeCol:"#000000", strokeWidth:5, shadow:true, shadowCol:"rgba(0,0,0,.3)", shadowBlur:6 }));
    i.push(makeItem("economia","",0,470,22,"'Bebas Neue'","#000000",{ w:397 }));
    i.push(makeItem("custom","BAIXOU O PREÇO!",0,521,30,"'Bebas Neue'","#FFD60A",{ w:397 }));
    return { id: uid_(), itens: i };
  },

  // ---------- 3. MARCA — Premium dourado (preto + dourado) ----------
  marca: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#0A0A0A"), w:397, h:561 });
    i.push({ ...makeItem("bg","",0,0,0,"","#D4AF37"), w:397, h:4 });
    i.push({ ...makeItem("bg","",0,557,0,"","#D4AF37"), w:397, h:4 });
    i.push({ ...makeItem("bg","",0,0,0,"","#D4AF37"), w:4, h:561 });
    i.push({ ...makeItem("bg","",393,0,0,"","#D4AF37"), w:4, h:561 });
    i.push(makeItem("head","CHEGOU NA LOJA",0,40,22,"'Bebas Neue'","#D4AF37",{ w:397 }));
    i.push(makeItem("marca","MARCA TOP",0,80,68,"'Abril Fatface'","#D4AF37",{ w:397, shadow:true, shadowCol:"rgba(212,175,55,0.45)", shadowBlur:18 }));
    i.push({ ...makeItem("bg","",173,178,0,"","#D4AF37"), w:50, h:2 });
    i.push(makeItem("desc","Qualidade Premium",0,205,26,"'Abril Fatface'","#FFFFFF",{ w:397 }));
    i.push(makeItem("peso","500 G",0,250,20,"'Bebas Neue'","#D4AF37",{ w:397 }));
    i.push(makeItem("precoDe","",0,300,22,"'Bebas Neue'","#888888",{ w:397 }));
    i.push(makeItem("preco","12,90",0,335,130,"'Bebas Neue'","#FFFFFF",{ w:397, shadow:true, shadowCol:"rgba(212,175,55,0.3)", shadowBlur:18 }));
    i.push(makeItem("economia","",0,485,18,"'Bebas Neue'","#D4AF37",{ w:397 }));
    i.push(makeItem("custom","E X C L U S I V O",0,528,16,"'Inter'","#D4AF37",{ w:397 }));
    return { id: uid_(), itens: i };
  },

  // ---------- 4. AÇOUGUE — Frescor (vermelho sangue + preto + branco) ----------
  acougue: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#8B0000"), w:397, h:561 });
    i.push({ ...makeItem("bg","",0,0,0,"","#0A0A0A"), w:397, h:62 });
    i.push(makeItem("custom","AÇOUGUE",0,12,40,"'Anton'","#FFFFFF",{ w:397 }));
    i.push({ ...makeItem("bg","",20,80,0,"","#FFFFFF"), w:357, h:55 });
    i.push(makeItem("head","CORTE NOBRE",0,90,38,"'Archivo Black'","#8B0000",{ w:397 }));
    i.push(makeItem("desc","PICANHA PREMIUM",0,158,40,"'Anton'","#FFFFFF",{ w:397, stroke:true, strokeCol:"#000000", strokeWidth:1 }));
    i.push(makeItem("marca","",0,210,18,"'Bebas Neue'","#FFFFFF",{ w:397 }));
    i.push(makeItem("peso","1 KG",0,235,30,"'Bebas Neue'","#FFD000",{ w:397 }));
    i.push(makeItem("tagBadge","FRESCO\nHOJE",290,250,18,"'Anton'","#FFFFFF",{ bgCol:"#000000", rot:-12, w:0, h:0 }));
    i.push({ ...makeItem("bg","",0,310,0,"","#FFFFFF"), w:397, h:251 });
    i.push({ ...makeItem("bg","",0,310,0,"","#FFD000"), w:397, h:8 });
    i.push(makeItem("precoDe","",0,330,26,"'Bebas Neue'","#999999",{ w:397 }));
    i.push(makeItem("preco","69,90",0,360,160,"'Anton'","#8B0000",{ w:397, stroke:true, strokeCol:"#000000", strokeWidth:3 }));
    i.push(makeItem("economia","",0,530,22,"'Bebas Neue'","#8B0000",{ w:397 }));
    return { id: uid_(), itens: i };
  },

  // ---------- 5. HORTIFRUTI — Direto do Sítio (verde + amarelo) ----------
  hortifruti: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#FFFBEA"), w:397, h:561 });
    i.push({ ...makeItem("bg","",0,0,0,"","#1B7F3A"), w:397, h:78 });
    i.push({ ...makeItem("bg","",0,78,0,"","#2EB14C"), w:397, h:8 });
    i.push({ ...makeItem("bg","",0,86,0,"","#FFD60A"), w:397, h:4 });
    i.push(makeItem("head","DIRETO DO SÍTIO",0,18,34,"'Archivo Black'","#FFFFFF",{ w:397 }));
    i.push(makeItem("tagBadge","100%\nNATURAL",302,100,16,"'Anton'","#1B7F3A",{ bgCol:"#FFD60A", rot:12, w:0, h:0 }));
    i.push(makeItem("desc","BANANA PRATA",0,118,40,"'Alfa Slab One'","#1B7F3A",{ w:397 }));
    i.push(makeItem("marca","",0,180,18,"'Bebas Neue'","#666666",{ w:397 }));
    i.push(makeItem("peso","KG",0,210,32,"'Bebas Neue'","#E67E22",{ w:397 }));
    i.push({ ...makeItem("bg","",30,275,0,"","#FFD60A"), w:337, h:240 });
    i.push({ ...makeItem("bg","",30,275,0,"","#1B7F3A"), w:337, h:6 });
    i.push({ ...makeItem("bg","",30,509,0,"","#1B7F3A"), w:337, h:6 });
    i.push(makeItem("precoDe","",0,295,24,"'Bebas Neue'","#666666",{ w:397 }));
    i.push(makeItem("preco","4,99",0,330,150,"'Bebas Neue'","#1B7F3A",{ w:397, stroke:true, strokeCol:"#FFFFFF", strokeWidth:2 }));
    i.push(makeItem("economia","",0,500,22,"'Bebas Neue'","#1B7F3A",{ w:397 }));
    i.push(makeItem("custom","FRESQUINHO TODO DIA",0,532,18,"'Bebas Neue'","#1B7F3A",{ w:397 }));
    return { id: uid_(), itens: i };
  },

  // ---------- 6. PADARIA — Forno Quente (marrom kraft + creme) ----------
  padaria: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#F5E6CC"), w:397, h:561 });
    i.push({ ...makeItem("bg","",0,0,0,"","#6B3410"), w:397, h:90 });
    i.push(makeItem("custom","Padaria",0,16,42,"'Abril Fatface'","#F5E6CC",{ w:397 }));
    i.push(makeItem("custom","artesanal",0,62,18,"'Bebas Neue'","#FFD89E",{ w:397 }));
    i.push(makeItem("head","QUENTINHO!",0,108,52,"'Alfa Slab One'","#6B3410",{ w:397, shadow:true, shadowCol:"rgba(0,0,0,.18)", shadowBlur:8 }));
    i.push(makeItem("desc","Pão Francês",0,180,44,"'Abril Fatface'","#A0522D",{ w:397 }));
    i.push(makeItem("marca","",0,238,18,"'Bebas Neue'","#6B3410",{ w:397 }));
    i.push(makeItem("peso","KG",0,260,30,"'Bebas Neue'","#6B3410",{ w:397 }));
    i.push({ ...makeItem("bg","",40,308,0,"","#FFFFFF"), w:317, h:210 });
    i.push({ ...makeItem("bg","",40,308,0,"","#6B3410"), w:317, h:5 });
    i.push({ ...makeItem("bg","",40,513,0,"","#6B3410"), w:317, h:5 });
    i.push(makeItem("precoDe","",0,322,22,"'Bebas Neue'","#999999",{ w:397 }));
    i.push(makeItem("preco","14,90",0,355,140,"'Abril Fatface'","#6B3410",{ w:397 }));
    i.push(makeItem("economia","",0,528,22,"'Bebas Neue'","#6B3410",{ w:397 }));
    return { id: uid_(), itens: i };
  },

  // ---------- 7. BEBIDAS — Geladíssima (azul gelo) ----------
  bebidas: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#0B5394"), w:397, h:561 });
    i.push({ ...makeItem("bg","",0,150,0,"","#1E88E5"), w:397, h:200 });
    i.push({ ...makeItem("bg","",0,350,0,"","#64B5F6"), w:397, h:211 });
    i.push(makeItem("head","GELADA!",0,28,72,"'Bungee'","#FFFFFF",{ w:397, rot:-6, shadow:true, shadowCol:"rgba(0,0,0,.45)", shadowBlur:10 }));
    i.push(makeItem("custom","* * congelada na hora * *",0,118,18,"'Bebas Neue'","#B3E5FC",{ w:397 }));
    i.push(makeItem("desc","REFRIGERANTE",0,165,38,"'Anton'","#FFFFFF",{ w:397 }));
    i.push(makeItem("marca","COCA-COLA",0,212,30,"'Bebas Neue'","#FFEB3B",{ w:397 }));
    i.push(makeItem("peso","2 LITROS",0,250,26,"'Bebas Neue'","#FFFFFF",{ w:397 }));
    i.push({ ...makeItem("bg","",30,300,0,"","#FFFFFF"), w:337, h:225 });
    i.push({ ...makeItem("bg","",30,300,0,"","#E63946"), w:337, h:8 });
    i.push(makeItem("precoDe","",0,318,24,"'Bebas Neue'","#999999",{ w:397 }));
    i.push(makeItem("preco","9,99",0,350,150,"'Anton'","#0B5394",{ w:397 }));
    i.push(makeItem("economia","",0,510,22,"'Bebas Neue'","#0B5394",{ w:397 }));
    i.push(makeItem("custom","O F E R T Ã O",0,536,20,"'Bebas Neue'","#FFFFFF",{ w:397 }));
    return { id: uid_(), itens: i };
  },

  // ---------- 8. RELÂMPAGO (amarelo neon + preto, fonte Bungee) ----------
  relampago: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#FFE600"), w:397, h:561 });
    i.push({ ...makeItem("bg","",-50,200,0,"","#000000"), w:500, h:90, rot:-8 });
    i.push(makeItem("custom","RAIO! RAIO!",0,15,30,"'Bungee'","#000000",{ w:397 }));
    i.push(makeItem("head","RELÂMPAGO",0,55,66,"'Bungee'","#000000",{ w:397, rot:-3, stroke:true, strokeCol:"#FFE600", strokeWidth:2 }));
    i.push(makeItem("custom","SÓ POR 2 HORAS!",0,135,30,"'Anton'","#FFE600",{ w:397, rot:-3 }));
    i.push(makeItem("desc","SÓ HOJE",0,260,38,"'Anton'","#FFE600",{ w:397, stroke:true, strokeCol:"#000000", strokeWidth:2 }));
    i.push(makeItem("marca","CORRE!",0,302,32,"'Bebas Neue'","#000000",{ w:397 }));
    i.push(makeItem("peso","",0,338,22,"'Bebas Neue'","#000000",{ w:397 }));
    i.push(makeItem("precoDe","",0,358,26,"'Bebas Neue'","#666666",{ w:397 }));
    i.push(makeItem("preco","9,99",0,388,160,"'Bungee'","#E63946",{ w:397, stroke:true, strokeCol:"#000000", strokeWidth:4 }));
    i.push(makeItem("economia","",0,538,20,"'Anton'","#000000",{ w:397 }));
    return { id: uid_(), itens: i };
  },

  // ---------- 9. LEVE 3 PAGUE 2 (roxo + laranja) ----------
  leve3: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#FFFFFF"), w:397, h:561 });
    i.push({ ...makeItem("bg","",0,0,0,"","#7B2CBF"), w:397, h:135 });
    i.push({ ...makeItem("bg","",0,135,0,"","#FF6B35"), w:397, h:6 });
    i.push(makeItem("head","LEVE 3",0,18,80,"'Archivo Black'","#FFFFFF",{ w:397, shadow:true, shadowCol:"rgba(0,0,0,.3)", shadowBlur:8 }));
    i.push({ ...makeItem("bg","",90,160,0,"","#FF6B35"), w:217, h:60 });
    i.push(makeItem("custom","PAGUE 2",0,170,42,"'Anton'","#FFFFFF",{ w:397 }));
    i.push(makeItem("desc","PRODUTO",0,250,32,"'Anton'","#7B2CBF",{ w:397 }));
    i.push(makeItem("marca","MARCA",0,295,22,"'Bebas Neue'","#666666",{ w:397 }));
    i.push(makeItem("peso","",0,325,18,"'Bebas Neue'","#7B2CBF",{ w:397 }));
    i.push({ ...makeItem("bg","",0,360,0,"","#7B2CBF"), w:397, h:201 });
    i.push(makeItem("custom","CADA UNIDADE",0,372,20,"'Bebas Neue'","#FFD60A",{ w:397 }));
    i.push(makeItem("precoDe","",0,395,24,"'Bebas Neue'","#FFB3D9",{ w:397 }));
    i.push(makeItem("preco","19,99",0,420,140,"'Archivo Black'","#FFFFFF",{ w:397, stroke:true, strokeCol:"#FF6B35", strokeWidth:2 }));
    i.push(makeItem("economia","",0,540,18,"'Bebas Neue'","#FFD60A",{ w:397 }));
    return { id: uid_(), itens: i };
  },

  // ---------- 10. BLACK FRIDAY (preto absoluto + amarelo) ----------
  blackfriday: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#000000"), w:397, h:561 });
    i.push({ ...makeItem("bg","",0,80,0,"","#F1C40F"), w:397, h:90 });
    i.push(makeItem("custom","MEGA OFERTA",0,32,28,"'Inter'","#F1C40F",{ w:397 }));
    i.push(makeItem("head","BLACK FRIDAY",0,95,52,"'Archivo Black'","#000000",{ w:397 }));
    i.push(makeItem("desc","PRODUTO",0,200,38,"'Anton'","#FFFFFF",{ w:397 }));
    i.push(makeItem("marca","MARCA",0,250,22,"'Bebas Neue'","#F1C40F",{ w:397 }));
    i.push(makeItem("peso","",0,280,20,"'Bebas Neue'","#FFFFFF",{ w:397 }));
    i.push(makeItem("tagBadge","-50%",290,210,32,"'Anton'","#000000",{ bgCol:"#F1C40F", rot:-15, w:0, h:0 }));
    i.push(makeItem("precoDe","",0,330,28,"'Bebas Neue'","#888888",{ w:397 }));
    i.push(makeItem("preco","99,00",0,365,170,"'Anton'","#F1C40F",{ w:397, stroke:true, strokeCol:"#000000", strokeWidth:3, shadow:true, shadowCol:"rgba(241,196,15,.4)", shadowBlur:18 }));
    i.push(makeItem("economia","",0,540,20,"'Bebas Neue'","#F1C40F",{ w:397 }));
    return { id: uid_(), itens: i };
  },

  // ---------- 11. NATAL (verde escuro + dourado + vermelho) ----------
  natal: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#0F4C28"), w:397, h:561 });
    i.push({ ...makeItem("bg","",0,0,0,"","#D4AF37"), w:397, h:8 });
    i.push({ ...makeItem("bg","",0,553,0,"","#D4AF37"), w:397, h:8 });
    i.push({ ...makeItem("bg","",30,30,0,"","#C8201E"), w:337, h:90 });
    i.push(makeItem("head","FELIZ NATAL",0,52,46,"'Abril Fatface'","#FFFFFF",{ w:397, shadow:true, shadowCol:"rgba(0,0,0,.45)", shadowBlur:8 }));
    i.push(makeItem("custom","* Especial Natal *",0,140,22,"'Bebas Neue'","#D4AF37",{ w:397 }));
    i.push(makeItem("desc","CEIA COMPLETA",0,170,36,"'Anton'","#FFFFFF",{ w:397 }));
    i.push(makeItem("marca","",0,222,20,"'Bebas Neue'","#D4AF37",{ w:397 }));
    i.push(makeItem("peso","",0,252,22,"'Bebas Neue'","#FFFFFF",{ w:397 }));
    i.push({ ...makeItem("bg","",30,300,0,"","#FDF6E3"), w:337, h:220 });
    i.push({ ...makeItem("bg","",30,300,0,"","#C8201E"), w:337, h:5 });
    i.push({ ...makeItem("bg","",30,515,0,"","#C8201E"), w:337, h:5 });
    i.push(makeItem("precoDe","",0,316,22,"'Bebas Neue'","#999999",{ w:397 }));
    i.push(makeItem("preco","24,90",0,348,150,"'Abril Fatface'","#C8201E",{ w:397 }));
    i.push(makeItem("economia","",0,535,20,"'Abril Fatface'","#D4AF37",{ w:397 }));
    return { id: uid_(), itens: i };
  },

  // ---------- 12. PÁSCOA (pastel rosa + roxo + amarelo) ----------
  pascoa: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#FFF0F8"), w:397, h:561 });
    i.push({ ...makeItem("bg","",0,0,0,"","#F8B4D9"), w:397, h:92 });
    i.push({ ...makeItem("bg","",0,92,0,"","#FFD6E8"), w:397, h:6 });
    i.push(makeItem("head","PÁSCOA FELIZ",0,28,42,"'Abril Fatface'","#7C3AED",{ w:397, shadow:true, shadowCol:"rgba(124,58,237,.25)", shadowBlur:6 }));
    i.push(makeItem("custom","Doce Páscoa",0,118,24,"'Abril Fatface'","#E879F9",{ w:397 }));
    i.push(makeItem("desc","OVO DE CHOCOLATE",0,160,32,"'Anton'","#7C3AED",{ w:397 }));
    i.push(makeItem("marca","",0,212,20,"'Bebas Neue'","#999999",{ w:397 }));
    i.push(makeItem("peso","250G",0,242,26,"'Bebas Neue'","#E879F9",{ w:397 }));
    i.push({ ...makeItem("bg","",30,290,0,"","#FFD89E"), w:337, h:230 });
    i.push({ ...makeItem("bg","",30,290,0,"","#7C3AED"), w:337, h:6 });
    i.push({ ...makeItem("bg","",30,514,0,"","#7C3AED"), w:337, h:6 });
    i.push(makeItem("precoDe","",0,308,22,"'Bebas Neue'","#999999",{ w:397 }));
    i.push(makeItem("preco","39,90",0,338,150,"'Abril Fatface'","#7C3AED",{ w:397 }));
    i.push(makeItem("economia","",0,535,20,"'Abril Fatface'","#E879F9",{ w:397 }));
    return { id: uid_(), itens: i };
  },

  // ---------- 13. NOVO — Lançamento (azul vibrante + amarelo) ----------
  novo: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#FFFFFF"), w:397, h:561 });
    i.push({ ...makeItem("bg","",0,0,0,"","#0066FF"), w:397, h:165 });
    i.push({ ...makeItem("bg","",0,165,0,"","#FFD60A"), w:397, h:8 });
    i.push({ ...makeItem("bg","",-50,80,0,"","#FFD60A"), w:300, h:20, rot:-12 });
    i.push(makeItem("custom","LANÇAMENTO",0,28,30,"'Bebas Neue'","#FFD60A",{ w:397 }));
    i.push(makeItem("head","NOVIDADE!",0,68,68,"'Archivo Black'","#FFFFFF",{ w:397, shadow:true, shadowCol:"rgba(0,0,0,.4)", shadowBlur:10 }));
    i.push(makeItem("tagBadge","NOVO",290,185,28,"'Anton'","#0066FF",{ bgCol:"#FFD60A", rot:12, w:0, h:0 }));
    i.push(makeItem("desc","PRODUTO NOVO",0,210,36,"'Anton'","#0066FF",{ w:397 }));
    i.push(makeItem("marca","MARCA",0,260,22,"'Bebas Neue'","#666666",{ w:397 }));
    i.push(makeItem("peso","",0,290,20,"'Bebas Neue'","#0066FF",{ w:397 }));
    i.push({ ...makeItem("bg","",0,340,0,"","#0066FF"), w:397, h:221 });
    i.push(makeItem("precoDe","",0,355,24,"'Bebas Neue'","#B3D9FF",{ w:397 }));
    i.push(makeItem("preco","19,99",0,385,150,"'Archivo Black'","#FFD60A",{ w:397, stroke:true, strokeCol:"#FFFFFF", strokeWidth:2 }));
    i.push(makeItem("economia","",0,545,18,"'Bebas Neue'","#FFD60A",{ w:397 }));
    return { id: uid_(), itens: i };
  },

  // ---------- 14. ÚLTIMAS UNIDADES (vermelho urgência + zebra) ----------
  ultimas: () => {
    const i = [];
    i.push({ ...makeItem("bg","",0,0,0,"","#1A0000"), w:397, h:561 });
    i.push({ ...makeItem("bg","",0,0,0,"","#E63946"), w:397, h:60 });
    i.push({ ...makeItem("bg","",0,90,0,"","#E63946"), w:397, h:8 });
    i.push({ ...makeItem("bg","",0,503,0,"","#E63946"), w:397, h:8 });
    i.push({ ...makeItem("bg","",0,540,0,"","#E63946"), w:397, h:21 });
    i.push(makeItem("custom","ATENÇÃO!",0,12,30,"'Bungee'","#FFFFFF",{ w:397 }));
    i.push(makeItem("head","ÚLTIMAS UNIDADES",0,118,34,"'Archivo Black'","#E63946",{ w:397, shadow:true, shadowCol:"rgba(230,57,70,.55)", shadowBlur:18, stroke:true, strokeCol:"#FFFFFF", strokeWidth:1 }));
    i.push(makeItem("custom","NÃO PERCA ESSA!",0,170,22,"'Bebas Neue'","#FFD60A",{ w:397 }));
    i.push(makeItem("desc","GARANTA JÁ",0,212,36,"'Anton'","#FFFFFF",{ w:397 }));
    i.push(makeItem("marca","",0,265,20,"'Bebas Neue'","#FFD60A",{ w:397 }));
    i.push(makeItem("peso","",0,295,22,"'Bebas Neue'","#E63946",{ w:397 }));
    i.push({ ...makeItem("bg","",30,330,0,"","#FFD60A"), w:337, h:170 });
    i.push(makeItem("precoDe","",0,343,24,"'Bebas Neue'","#666666",{ w:397 }));
    i.push(makeItem("preco","29,99",0,375,115,"'Anton'","#1A0000",{ w:397 }));
    i.push(makeItem("economia","",0,510,20,"'Bebas Neue'","#FFFFFF",{ w:397 }));
    return { id: uid_(), itens: i };
  },
};

function carregarTemplate(tipo) {
  const builder = TEMPLATES[tipo];
  if (typeof builder !== "function") return;
  snapshot();
  const cartaz = builder();
  state.cartazes.push(cartaz);
  render(); save();
  toast(`Template "${tipo}" carregado`, "success");
}

// ---------- Paletas temáticas ----------
const PALETAS = [
  { nome: "Açougue", cores: ["#d63031", "#ffffff", "#000000"] },
  { nome: "Hortifruti", cores: ["#00b894", "#fdcb6e", "#2d3436"] },
  { nome: "Padaria", cores: ["#a0522d", "#fff3e0", "#5d2e12"] },
  { nome: "Black Friday", cores: ["#000000", "#f1c40f", "#ffffff"] },
  { nome: "Natal", cores: ["#2ecc71", "#c0392b", "#ffffff"] },
  { nome: "Páscoa", cores: ["#e67e22", "#fdcb6e", "#8e44ad"] },
  { nome: "Clássica", cores: ["#0984e3", "#d63031", "#f1c40f"] },
  { nome: "Premium", cores: ["#1e272e", "#d4af37", "#ffffff"] },
];

function renderPalettePresets() {
  const host = $("palettePresets");
  host.innerHTML = "";
  PALETAS.forEach(p => {
    const el = document.createElement("div");
    el.className = "palette-preset";
    el.title = `Aplicar paleta: ${p.nome}`;
    el.innerHTML = `<div class="swatches">${p.cores.map(c => `<span style="background:${c}"></span>`).join("")}</div> ${p.nome}`;
    el.onclick = () => aplicarPaleta(p.cores);
    host.appendChild(el);
  });
}

function aplicarPaleta(cores) {
  if (!state.sel) return toast("Selecione um cartaz.", "info");
  snapshot();
  const c = state.sel.cartaz;
  const [c1, c2, c3] = cores;
  const head = c.itens.find(i => i.tipo === "head"); if (head) head.col = c1;
  const preco = c.itens.find(i => i.tipo === "preco"); if (preco) preco.col = c3 || "#000";
  const marca = c.itens.find(i => i.tipo === "marca"); if (marca) marca.col = c3 || "#000";
  const desc = c.itens.find(i => i.tipo === "desc"); if (desc) desc.col = c3 || "#000";
  const peso = c.itens.find(i => i.tipo === "peso"); if (peso) peso.col = c2 || c1;
  render(); save();
  toast("Paleta aplicada", "success");
}

function renderColorPalette() {
  const cores = [
    "#000000","#ffffff","#d63031","#f1c40f","#0984e3","#00b894","#e67e22","#8e44ad",
    "#2d3436","#ffeaa7","#ff7675","#74b9ff","#55efc4","#fd79a8","#fdcb6e","#636e72"
  ];
  const host = $("colorPalette");
  host.innerHTML = "";
  cores.forEach(cor => {
    const b = document.createElement("div");
    b.className = "color-box";
    b.style.background = cor;
    b.dataset.col = cor;
    b.title = cor;
    b.onclick = () => setCorRapida(cor);
    host.appendChild(b);
  });
}

// ---------- Export PNG / PDF ----------
async function exportarPNG() {
  const prevZoom = state.zoom;
  setZoom(1);
  await new Promise(r => setTimeout(r, 80));

  const paginas = qsa(".pagina");
  if (state.layout === "grid-1") {
    // 1 cartaz por página → cada cartaz seu próprio arquivo
    for (let i = 0; i < paginas.length; i++) {
      const area = qs(".cartaz-area", paginas[i]);
      if (!area) continue;
      const canvas = await html2canvas(area, { scale: 3, useCORS: true, backgroundColor: "#fff" });
      triggerDownload(canvas.toDataURL("image/png"), `cartaz_${i + 1}.png`);
    }
  } else {
    // Uma imagem por página (folha inteira)
    for (let i = 0; i < paginas.length; i++) {
      const canvas = await html2canvas(paginas[i], { scale: 3, useCORS: true, backgroundColor: "#fff" });
      triggerDownload(canvas.toDataURL("image/png"), `folha_${i + 1}.png`);
    }
  }
  setZoom(prevZoom);
  toast(`PNG exportado (${paginas.length} arquivo(s))`, "success");
}

async function exportarPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const prevZoom = state.zoom;
  setZoom(1);
  await new Promise(r => setTimeout(r, 80));

  const paginas = qsa(".pagina");
  for (let i = 0; i < paginas.length; i++) {
    const canvas = await html2canvas(paginas[i], { scale: 2, useCORS: true, backgroundColor: "#fff" });
    const img = canvas.toDataURL("image/png");
    if (i > 0) doc.addPage();
    doc.addImage(img, "PNG", 0, 0, 210, 297);
  }
  doc.save("cartazes.pdf");
  setZoom(prevZoom);
  toast(`PDF exportado (${paginas.length} página(s))`, "success");
}

function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
}

// ---------- WhatsApp share ----------
let whatsFormat = "square";
async function gerarImagemWhats() {
  const area = qs(".cartaz-area.ativo") || qs(".cartaz-area");
  if (!area) return toast("Nenhum cartaz disponível", "error");

  const prevZoom = state.zoom;
  setZoom(1);
  await new Promise(r => setTimeout(r, 80));

  const cartCanvas = await html2canvas(area, { scale: 3, useCORS: true, backgroundColor: "#fff" });

  let W, H;
  if (whatsFormat === "square") { W = 1080; H = 1080; }
  else if (whatsFormat === "story") { W = 1080; H = 1920; }
  else { W = cartCanvas.width; H = cartCanvas.height; }

  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const ctx = out.getContext("2d");
  // fill background (soft)
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#1a2029"); grad.addColorStop(1, "#0f1419");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  // fit cartaz centered
  const ratio = Math.min((W * 0.88) / cartCanvas.width, (H * 0.80) / cartCanvas.height);
  const w = cartCanvas.width * ratio, h = cartCanvas.height * ratio;
  const x = (W - w) / 2, y = (H - h) / 2 - (whatsFormat === "story" ? 60 : 0);
  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
  ctx.drawImage(cartCanvas, x, y, w, h);
  ctx.shadowBlur = 0;

  // caption
  ctx.fillStyle = "#fff";
  ctx.font = "700 36px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("CARTAZISTA PRO", W / 2, whatsFormat === "story" ? H - 100 : H - 40);

  triggerDownload(out.toDataURL("image/png"), `cartaz_whatsapp_${whatsFormat}.png`);
  setZoom(prevZoom);
  toast("Imagem gerada", "success");
}

// ---------- AI ----------
async function iaGerarCartaz() {
  const desc = $("iaDesc").value.trim();
  if (!desc) return toast("Descreva o produto", "error");
  const tom = qs(".chip.active", $("iaTomRow"))?.dataset.tom || "promocional";

  const btn = $("btnIAExecutar");
  btn.innerHTML = '<span class="loader"></span> Gerando...';
  btn.disabled = true;
  try {
    const r = await fetch(`${API}/ai/generate-poster`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descricao: desc, tom }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    state.lastAISuggestions = data;
    $("iaResultado").innerHTML = `
      <div class="ai-result-card">
        <div class="row"><b>Chamada</b><span>${escapeHtml(data.chamada)}</span></div>
        <div class="row"><b>Produto</b><span>${escapeHtml(data.produto)}</span></div>
        <div class="row"><b>Marca</b><span>${escapeHtml(data.marca)}</span></div>
        <div class="row"><b>Peso</b><span>${escapeHtml(data.peso)}</span></div>
        <div class="row"><b>Preço</b><span>R$ ${escapeHtml(data.preco)}${data.preco_de ? " <small>de R$ " + escapeHtml(data.preco_de) + "</small>" : ""}</span></div>
        ${data.paleta?.length ? `<div class="row"><b>Paleta</b><span>${data.paleta.map(c => `<span style="display:inline-block;width:18px;height:18px;background:${c};border-radius:4px;vertical-align:middle;margin:0 2px"></span>`).join("")}</span></div>` : ""}
      </div>
    `;
    $("btnIAAplicar").classList.remove("hidden");
    toast("IA pronta! Clique em Aplicar.", "success");
  } catch (e) {
    toast("Erro ao gerar: " + e.message, "error");
  } finally {
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Gerar';
    btn.disabled = false;
  }
}

function aplicarIA() {
  const s = state.lastAISuggestions;
  if (!s) return;
  snapshot();
  const c = cartazFromAI(s);
  state.cartazes.push(c);
  render(); save();
  closeModal("modalIA");
  $("iaDesc").value = "";
  $("iaResultado").innerHTML = "";
  $("btnIAAplicar").classList.add("hidden");
  toast("Cartaz criado pela IA — gerando imagem...", "success");
  // Tenta gerar foto do produto via Nano Banana (não bloqueia)
  tentarGerarImagemProduto(c, s.produto, s.marca);
}

async function iaSugerirChamadas() {
  const produto = $("inDesc").value || $("inHead").value || "produto";
  const btn = $("btnSugerirChamadas");
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Buscando...';
  try {
    const r = await fetch(`${API}/ai/suggest-headlines`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ produto, quantidade: 5 }),
    });
    const data = await r.json();
    const opts = data.chamadas || [];
    if (opts.length === 0) throw new Error("vazio");
    const lista = opts.map((c, i) => `${i + 1}) ${c}`).join("\n");
    const escolhido = prompt(`Chamadas sugeridas pela IA:\n\n${lista}\n\nDigite o número (1-${opts.length}) ou cole seu próprio texto:`);
    if (escolhido) {
      const num = parseInt(escolhido);
      const val = (num && opts[num - 1]) ? opts[num - 1] : escolhido.toUpperCase();
      snapshot();
      const c = state.sel?.cartaz || state.cartazes[0];
      const head = c?.itens.find(i => i.tipo === "head");
      if (head) { head.val = val; render(); save(); toast("Chamada aplicada", "success"); }
    }
  } catch (e) {
    toast("Erro: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Sugerir chamadas com IA';
  }
}

// ---------- CSV Batch ----------
let csvParsed = [];
async function csvAnalisar() {
  const texto = $("csvInput").value.trim();
  if (!texto) return toast("Cole sua lista", "error");
  const btn = $("btnCSVAnalisar");
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Analisando...';
  try {
    const r = await fetch(`${API}/ai/parse-csv`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    });
    const data = await r.json();
    csvParsed = data.linhas || [];
    $("csvPreview").innerHTML = csvParsed.length
      ? `<div class="ai-result-card"><b>${csvParsed.length} produto(s) identificado(s):</b><ul style="margin:6px 0 0 18px; font-size:12px">${csvParsed.map(l => `<li>${escapeHtml(l.produto)} — R$ ${escapeHtml(l.preco)}${l.preco_de ? " <small>(de R$ " + escapeHtml(l.preco_de) + ")</small>" : ""}</li>`).join("")}</ul></div>`
      : `<div class="ai-result-card">Nenhum produto encontrado.</div>`;
    if (csvParsed.length) $("btnCSVGerar").classList.remove("hidden");
    toast(`${csvParsed.length} produtos identificados`, "success");
  } catch (e) {
    toast("Erro: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Analisar';
  }
}

function csvGerar() {
  if (!csvParsed.length) return;
  snapshot();
  // Paletas variadas pra cada cartaz não ficar tudo igual
  const PALETAS_AUTO = [
    ["#d63031", "#ffffff", "#1e272e"],   // vermelho clássico
    ["#0984e3", "#ffffff", "#2d3436"],   // azul
    ["#00b894", "#ffeaa7", "#2d3436"],   // verde hortifruti
    ["#fdcb6e", "#ffffff", "#6c3a00"],   // amarelo padaria
    ["#8e44ad", "#ffffff", "#1e272e"],   // roxo
    ["#e17055", "#ffeaa7", "#2d3436"],   // laranja
  ];
  csvParsed.forEach((l, i) => {
    const c = cartazFromAI({
      chamada: "OFERTA",
      produto: l.produto,
      marca: l.marca,
      peso: l.peso,
      preco: l.preco,
      preco_de: l.preco_de || "",
      paleta: PALETAS_AUTO[i % PALETAS_AUTO.length],
    });
    state.cartazes.push(c);
  });
  render(); save();
  closeModal("modalCSV");
  $("csvInput").value = ""; $("csvPreview").innerHTML = "";
  $("btnCSVGerar").classList.add("hidden");
  csvParsed = [];
  toast(`Cartazes gerados com estilos variados!`, "success");
}

// ---------- Modelos salvos ----------
async function salvarModeloAtual() {
  const nome = prompt("Nome do modelo:", "Modelo " + new Date().toLocaleDateString("pt-BR"));
  if (!nome) return;
  state.modelos.unshift({ nome: nome.trim(), layout: state.layout, dados: deepClone(state.cartazes), timestamp: Date.now() });
  if (state.modelos.length > 30) state.modelos.pop();
  await saveModelos();
  renderModelosSelect();
  toast("Modelo salvo!", "success");
}

function renderModelosSelect() {
  const sel = $("selectModelos");
  sel.innerHTML = '<option value="">Modelos salvos</option>';
  state.modelos.forEach((m, i) => {
    const o = document.createElement("option");
    o.value = `load_${i}`;
    o.textContent = m.nome;
    sel.appendChild(o);
    const d = document.createElement("option");
    d.value = `del_${i}`;
    d.textContent = `  ✕ excluir "${m.nome}"`;
    sel.appendChild(d);
  });
}

async function handleModeloSelect(v) {
  if (!v) return;
  if (v.startsWith("load_")) {
    const i = parseInt(v.slice(5));
    const m = state.modelos[i];
    if (!m) return;
    if (confirm(`Carregar "${m.nome}"? Isso substitui os cartazes atuais.`)) {
      snapshot();
      state.cartazes = migrateCartazes(deepClone(m.dados), 1);
      state.layout = m.layout || "grid-4";
      $("selectLayout").value = state.layout;
      render(); save();
      toast(`"${m.nome}" carregado`, "success");
    }
  } else if (v.startsWith("del_")) {
    const i = parseInt(v.slice(4));
    const m = state.modelos[i]; if (!m) return;
    if (confirm(`Excluir "${m.nome}"?`)) {
      state.modelos.splice(i, 1);
      await saveModelos();
      renderModelosSelect();
      toast("Excluído", "success");
    }
  }
  $("selectModelos").value = "";
}

// ---------- Zoom ----------
function setZoom(z) {
  state.zoom = Math.max(0.25, Math.min(2, z));
  qsa(".pagina").forEach(pg => pg.style.transform = `scale(${state.zoom})`);
  $("zoomVal").textContent = Math.round(state.zoom * 100) + "%";
}
function zoomFit() {
  const ws = $("workspace");
  const pagina = qs(".pagina");
  if (!pagina) return;
  const ratio = Math.min((ws.clientWidth - 80) / pagina.offsetWidth, (ws.clientHeight - 80) / pagina.offsetHeight);
  setZoom(Math.max(0.25, Math.min(1, ratio)));
}

// ---------- Context menu ----------
function showCtxMenu(x, y) {
  const m = $("ctxMenu");
  m.classList.add("open");
  m.style.left = x + "px"; m.style.top = y + "px";
  // "Remover fundo (IA)" só aparece em imagens
  const isImg = state.sel?.data?.tipo === "img";
  const removeBtn = $("ctxRemoverFundo");
  if (removeBtn) {
    if (isImg) removeBtn.classList.remove("hidden");
    else removeBtn.classList.add("hidden");
  }
}
function hideCtxMenu() { $("ctxMenu").classList.remove("open"); }

// ---------- Preview ----------
async function abrirPreview() {
  const host = $("paginas");
  const clone = host.cloneNode(true);
  qsa(".pagina", clone).forEach(pg => pg.style.transform = "scale(1)");
  qsa(".cartaz-header, .cartaz-num, .snap-guide, .pagina-label", clone).forEach(e => e.remove());
  qsa(".item.selected, .item.multi-selected", clone).forEach(e => e.classList.remove("selected", "multi-selected"));
  const content = $("previewContent");
  content.innerHTML = "";
  content.appendChild(clone);
  $("previewOverlay").classList.add("open");
}

// ---------- Modals ----------
function openModal(id) { $(id).classList.add("open"); }
function closeModal(id) { $(id).classList.remove("open"); }

// ---------- Keyboard shortcuts ----------
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  else if (ctrl && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); redoAction(); }
  else if (ctrl && e.key.toLowerCase() === "n") { e.preventDefault(); adicionarCartaz(); }
  else if (ctrl && e.key.toLowerCase() === "d") { e.preventDefault(); duplicarCartaz(); }
  else if (ctrl && e.key.toLowerCase() === "c" && state.sel) { state.clipboard = deepClone(state.sel.data); toast("Copiado", "info"); }
  else if (ctrl && e.key.toLowerCase() === "v" && state.clipboard && state.sel) {
    snapshot();
    const novo = deepClone(state.clipboard);
    novo.id = `${novo.tipo}-${uid_()}`;
    novo.x += 20; novo.y += 20;
    state.sel.cartaz.itens.push(novo);
    render(); save();
  }
  else if (e.key === "Delete" && state.sel) { e.preventDefault(); excluirItemSelecionado(); }
  else if (e.key === "Escape") { closeEditor(); hideCtxMenu(); qsa(".modal-backdrop.open").forEach(m => m.classList.remove("open")); $("previewOverlay").classList.remove("open"); }
  else if (e.key === "f" || e.key === "F") { abrirPreview(); }
  else if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key) && state.sel) {
    e.preventDefault();
    snapshotDebounced();
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp") state.sel.data.y -= step;
    if (e.key === "ArrowDown") state.sel.data.y += step;
    if (e.key === "ArrowLeft") state.sel.data.x -= step;
    if (e.key === "ArrowRight") state.sel.data.x += step;
    render(); saveDebounced();
  }
});

// ---------- Zoom wheel ----------
$("workspace")?.addEventListener("wheel", (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setZoom(state.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });

// ---------- Attach all handlers ----------
function wire() {
  $("btnNovo").onclick = () => adicionarCartaz();
  $("btnDuplicar").onclick = duplicarCartaz;
  $("btnImagem").onclick = adicionarImagem;
  $("btnRemoverBg").onclick = removerFundoItem;
  $("btnIcones").onclick = () => { openModal("modalIcones"); renderIconCategorias(); renderIconGrid(); };
  $("btnEAN").onclick = () => openModal("modalEAN");
  $("btnNovaPagina").onclick = novaPagina;
  $("btnQR").onclick = adicionarQR;
  $("btnTarja").onclick = adicionarTarja;
  $("btnBadge").onclick = adicionarBadge;
  $("btnUndo").onclick = undo;
  $("btnRedo").onclick = redoAction;
  $("btnPNG").onclick = exportarPNG;
  $("btnPDF").onclick = exportarPDF;
  $("btnImprimir").onclick = () => window.print();
  $("btnPreview").onclick = abrirPreview;
  $("closePreview").onclick = () => $("previewOverlay").classList.remove("open");
  $("btnSalvarModelo").onclick = salvarModeloAtual;
  $("selectModelos").onchange = (e) => handleModeloSelect(e.target.value);

  $("selectLayout").onchange = (e) => {
    snapshot(); state.layout = e.target.value; render(); save();
  };
  $("selectTemplate").onchange = (e) => { if (e.target.value) { carregarTemplate(e.target.value); e.target.value = ""; } };

  $("btnIAGerar").onclick = () => openModal("modalIA");
  $("btnIALote").onclick = () => openModal("modalCSV");
  $("btnWhats").onclick = () => openModal("modalWhats");

  $("btnIAExecutar").onclick = iaGerarCartaz;
  $("btnIAAplicar").onclick = aplicarIA;
  $("btnCSVAnalisar").onclick = csvAnalisar;
  $("btnCSVGerar").onclick = csvGerar;
  $("btnSugerirChamadas").onclick = iaSugerirChamadas;

  $("btnWhatsBaixar").onclick = gerarImagemWhats;
  $("btnEANBuscar").onclick = buscarEAN;
  $("btnEANAplicar").onclick = aplicarEAN;
  $("eanInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); buscarEAN(); } });
  $("iconSearch")?.addEventListener("input", (e) => { iconSearch = e.target.value; renderIconGrid(); });
  $("iconColor")?.addEventListener("change", () => renderIconGrid());
  qsa("#modalWhats .chip").forEach(c => c.onclick = () => {
    qsa("#modalWhats .chip").forEach(x => x.classList.remove("active"));
    c.classList.add("active"); whatsFormat = c.dataset.share;
  });
  qsa("#iaTomRow .chip").forEach(c => c.onclick = () => {
    qsa("#iaTomRow .chip").forEach(x => x.classList.remove("active"));
    c.classList.add("active");
  });

  // Tabs
  qsa(".tab").forEach(t => t.onclick = () => {
    qsa(".tab").forEach(x => x.classList.remove("active"));
    qsa(".tab-panel").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    $("panel-" + t.dataset.tab).classList.add("active");
  });

  // Conteúdo inputs
  ["head", "desc", "marca", "peso", "preco", "precoDe"].forEach(tipo => {
    const id = "in" + tipo.charAt(0).toUpperCase() + tipo.slice(1);
    $(id)?.addEventListener("input", () => atualizarCampoTexto(tipo));
  });

  // Estilo inputs
  ["inFont","inSize","inColor","inW","inH","inRot",
   "inShadow","inShadowColor","inShadowBlur",
   "inStroke","inStrokeColor","inStrokeWidth",
   "inGradient","inGradC1","inGradC2","inGradientDir"].forEach(id => {
    $(id)?.addEventListener("input", atualizarEstilo);
    $(id)?.addEventListener("change", atualizarEstilo);
  });

  // Align
  $("alignL").onclick = () => alignar("L");
  $("alignR").onclick = () => alignar("R");
  $("alignCH").onclick = () => alignar("CH");
  $("alignT").onclick = () => alignar("T");
  $("alignB").onclick = () => alignar("B");
  $("alignCV").onclick = () => alignar("CV");

  $("btnLockAspect")?.addEventListener("click", toggleAspectLock);

  $("btnExcluirItem").onclick = excluirItemSelecionado;
  $("btnFecharEditor").onclick = closeEditor;

  // Zoom
  $("zoomIn").onclick = () => setZoom(state.zoom + 0.1);
  $("zoomOut").onclick = () => setZoom(state.zoom - 0.1);
  $("zoomFit").onclick = zoomFit;

  // Modals close
  qsa("[data-close]").forEach(b => b.onclick = (e) => {
    const m = e.target.closest(".modal-backdrop");
    if (m) m.classList.remove("open");
  });
  qsa(".modal-backdrop").forEach(m => m.onclick = (e) => {
    if (e.target === m) m.classList.remove("open");
  });

  // Click outside item deselects
  $("workspace").addEventListener("mousedown", (e) => {
    if (!e.target.closest(".item") && !e.target.closest(".cartaz-header") && !e.target.closest(".cartaz-num")) {
      // click em area do cartaz: marca ativo
      const area = e.target.closest(".cartaz-area");
      if (area) {
        const cId = area.dataset.cartazId;
        const c = state.cartazes.find(x => x.id === cId);
        if (c) state.sel = { cartaz: c, data: c.itens[0], el: null };
        qsa(".cartaz-area").forEach(a => a.classList.remove("ativo"));
        area.classList.add("ativo");
        mostrarNoPainel(c.itens[0], c);
      } else {
        closeEditor();
      }
    }
  });

  // Context menu
  document.addEventListener("click", (e) => { if (!e.target.closest(".context-menu")) hideCtxMenu(); });
  $("ctxDuplicate").onclick = () => {
    if (!state.sel) return;
    snapshot();
    const n = deepClone(state.sel.data);
    n.id = `${n.tipo}-${uid_()}`;
    n.x += 20; n.y += 20;
    state.sel.cartaz.itens.push(n);
    render(); save(); hideCtxMenu();
  };
  $("ctxFront").onclick = () => {
    if (!state.sel) return;
    snapshot();
    state.sel.data.zOverride = 999;
    // Reorder: move to end of items array (renderiza por último -> fica em cima)
    const c = state.sel.cartaz;
    const idx = c.itens.findIndex(i => i.id === state.sel.data.id);
    if (idx >= 0) {
      const [it] = c.itens.splice(idx, 1);
      c.itens.push(it);
    }
    render(); save(); hideCtxMenu();
    toast("Trazido para frente", "success");
  };
  $("ctxBack").onclick = () => {
    if (!state.sel) return;
    snapshot();
    state.sel.data.zOverride = 1;
    // Reorder: move to start of items array (renderiza primeiro -> fica atrás)
    const c = state.sel.cartaz;
    const idx = c.itens.findIndex(i => i.id === state.sel.data.id);
    if (idx >= 0) {
      const [it] = c.itens.splice(idx, 1);
      c.itens.unshift(it);
    }
    render(); save(); hideCtxMenu();
    toast("Enviado para trás", "success");
  };
  $("ctxRemoverFundo").onclick = () => {
    hideCtxMenu();
    removerFundoItem();
  };
  $("ctxDelete").onclick = () => { excluirItemSelecionado(); hideCtxMenu(); };
}

// ---------- Boot ----------
function dismissSplash() {
  const s = $("splash");
  if (!s) return;
  s.style.opacity = "0";
  setTimeout(() => { s.style.display = "none"; }, 600);
}

async function boot() {
  // Splash sempre desaparece, mesmo que algo abaixo falhe
  setTimeout(dismissSplash, 1200);
  // Segurança extra: se algo trava, força em 5s
  setTimeout(dismissSplash, 5000);

  try { wire(); } catch (e) { console.error("wire() erro:", e); }
  try { renderColorPalette(); } catch (e) { console.error("palette erro:", e); }
  try { renderPalettePresets(); } catch (e) { console.error("presets erro:", e); }

  // Firebase anonymous auth
  try {
    await signInAnonymously(auth);
    await new Promise((resolve) => {
      onAuthStateChanged(auth, (user) => {
        if (user) {
          uid = user.uid;
          sessionRef = doc(db, "users", uid, "data", "session");
          modelosRef = doc(db, "users", uid, "data", "modelos");
          resolve();
        }
      });
    });
  } catch (e) {
    console.warn("Auth falhou, usando doc global (fallback):", e);
    sessionRef = doc(db, "projeto", "sessao_atual");
    modelosRef = doc(db, "projeto", "modelos_salvos");
  }

  await load();
  await loadModelos();

  // Register SW
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

boot();
