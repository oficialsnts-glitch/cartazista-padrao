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
const API = "/api";

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
  const id = uid_();
  return {
    id,
    itens: [
      makeItem("head",    "OFERTA IMPERDÍVEL",   60, 25,  48,  "'Bebas Neue'", "#d63031"),
      makeItem("desc",    "PRODUTO EM DESTAQUE", 40, 95,  58,  "'Bebas Neue'", "#000000"),
      makeItem("marca",   "MARCA PREMIUM",       60, 165, 34,  "'Bebas Neue'", "#1e272e"),
      makeItem("peso",    "1 kg",                60, 210, 30,  "'Bebas Neue'", "#d63031"),
      makeItem("preco",   "9,99",                40, 250, 145, "'Anton'",      "#000000"),
      makeItem("precoDe", "",                    40, 230, 26,  "'Bebas Neue'", "#777777"),
      makeItem("economia","",                    40, 390, 22,  "'Bebas Neue'", "#d63031"),
    ],
  };
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

  c.itens.forEach(it => {
    const el = buildItem(it, c);
    area.appendChild(el);
    if (it.tipo === "qr") enqueueQR(el, it);
  });

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
    state.offset.x = e.clientX - el.offsetLeft * state.zoom;
    state.offset.y = e.clientY - el.offsetTop * state.zoom;
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
  const rawX = (e.clientX - state.offset.x) / state.zoom;
  const rawY = (e.clientY - state.offset.y) / state.zoom;

  // snap
  const area = state.sel.el.closest(".cartaz-area");
  const snap = computeSnap(rawX, rawY, state.sel, area);
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
  $("secaoFundo").style.display = (it.tipo === "bg" || it.tipo === "img" || it.tipo === "qr") ? "block" : "none";
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

function atualizarEstilo() {
  if (!state.sel) return;
  const d = state.sel.data;
  snapshotDebounced();
  d.font = $("inFont").value;
  d.size = parseInt($("inSize").value) || 40;
  d.col = $("inColor").value;
  d.w = parseInt($("inW").value) || 0;
  d.h = parseInt($("inH").value) || 0;
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
  const area = state.sel.el.closest(".cartaz-area");
  const w = state.sel.el.offsetWidth, h = state.sel.el.offsetHeight;
  const W = area.offsetWidth, H = area.offsetHeight;
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
  const c = cartazBase();
  c.itens.find(i => i.tipo === "head").val = "OFERTA";
  c.itens.find(i => i.tipo === "desc").val = eanResultado.produto;
  c.itens.find(i => i.tipo === "marca").val = eanResultado.marca || "";
  c.itens.find(i => i.tipo === "peso").val = eanResultado.peso || "";
  c.itens.find(i => i.tipo === "preco").val = preco;
  c.itens.find(i => i.tipo === "precoDe").val = precoDe;
  if (eanResultado.imagem_data_url) {
    c.itens.push({ ...makeItem("img", eanResultado.imagem_data_url, 280, 80, 0, "", ""), w: 180, h: 180 });
  }
  state.cartazes.push(c);
  render(); save();
  closeModal("modalEAN");
  $("eanInput").value = ""; $("eanResultado").innerHTML = "";
  $("btnEANAplicar").classList.add("hidden");
  eanResultado = null;
  toast("Cartaz criado a partir do EAN", "success");
}

// ---------- Nova página ----------
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
const TEMPLATES = {
  promo: { chamada: "OFERTA ESPECIAL", desc: "PRODUTO SELECIONADO", marca: "MARCA", peso: "1 kg", preco: "7,49", corChamada: "#d63031", corPreco: "#000", precoSize: 135 },
  preco: { chamada: "PREÇO BAIXO", desc: "APROVEITE", marca: "", peso: "", preco: "4,99", corChamada: "#f1c40f", corPreco: "#d63031", precoSize: 180 },
  marca: { chamada: "CHEGOU", desc: "QUALIDADE", marca: "MARCA TOP", peso: "500 g", preco: "12,90", corChamada: "#0984e3", corPreco: "#000", precoSize: 120, marcaSize: 42 },
  acougue: { chamada: "AÇOUGUE DO MÊS", desc: "PICANHA PREMIUM", marca: "", peso: "1 kg", preco: "69,90", corChamada: "#d63031", corPreco: "#000", fundo: "#b71c1c", textoFundo: "FRESQUINHO" },
  hortifruti: { chamada: "DIRETO DO SÍTIO", desc: "BANANA PRATA", marca: "", peso: "kg", preco: "4,99", corChamada: "#00b894", corPreco: "#2d3436" },
  padaria: { chamada: "QUENTINHO!", desc: "PÃO FRANCÊS", marca: "", peso: "kg", preco: "14,90", corChamada: "#a0522d", corPreco: "#5d2e12" },
  bebidas: { chamada: "GELADA", desc: "REFRIGERANTE", marca: "COCA-COLA", peso: "2 L", preco: "9,99", corChamada: "#0984e3", corPreco: "#d63031" },
  relampago: { chamada: "OFERTA RELÂMPAGO", desc: "SÓ HOJE", marca: "CORRE!", peso: "", preco: "9,99", corChamada: "#f7b733", corPreco: "#d63031", precoSize: 160 },
  leve3: { chamada: "LEVE 3", desc: "PAGUE 2", marca: "", peso: "", preco: "19,99", corChamada: "#8e44ad", corPreco: "#000" },
  blackfriday: { chamada: "BLACK FRIDAY", desc: "MEGA OFERTA", marca: "", peso: "", preco: "99,00", corChamada: "#000", corPreco: "#f1c40f", fundo: "#000", textoFundo: "BLACK FRIDAY" },
  natal: { chamada: "FELIZ NATAL", desc: "OFERTA ESPECIAL", marca: "", peso: "", preco: "24,90", corChamada: "#2ecc71", corPreco: "#c0392b" },
  pascoa: { chamada: "PÁSCOA FELIZ", desc: "OVO DE CHOCOLATE", marca: "", peso: "250 g", preco: "39,90", corChamada: "#e67e22", corPreco: "#8e44ad" },
  novo: { chamada: "NOVIDADE!", desc: "PRODUTO NOVO", marca: "", peso: "", preco: "19,99", corChamada: "#00b894", corPreco: "#000" },
  ultimas: { chamada: "ÚLTIMAS UNIDADES", desc: "GARANTA JÁ", marca: "", peso: "", preco: "29,99", corChamada: "#d63031", corPreco: "#000" },
};

function carregarTemplate(tipo) {
  const t = TEMPLATES[tipo];
  if (!t) return;
  snapshot();
  const c = cartazBase();
  c.itens.find(i => i.tipo === "head").val = t.chamada;
  c.itens.find(i => i.tipo === "head").col = t.corChamada || "#d63031";
  c.itens.find(i => i.tipo === "desc").val = t.desc;
  c.itens.find(i => i.tipo === "marca").val = t.marca || "";
  if (t.marcaSize) c.itens.find(i => i.tipo === "marca").size = t.marcaSize;
  c.itens.find(i => i.tipo === "peso").val = t.peso || "";
  c.itens.find(i => i.tipo === "preco").val = t.preco;
  c.itens.find(i => i.tipo === "preco").col = t.corPreco || "#000";
  if (t.precoSize) c.itens.find(i => i.tipo === "preco").size = t.precoSize;

  if (t.fundo) {
    c.itens.unshift({ ...makeItem("bg", "", 0, 0, 0, "", t.fundo), w: 493, h: 65 });
    c.itens.unshift(makeItem("custom", t.textoFundo || "", 60, 12, 36, "'Anton'", "#fff", { shadow: true, shadowCol: "#000" }));
  }
  state.cartazes.push(c);
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
  const c = cartazBase();
  c.itens.find(i => i.tipo === "head").val = s.chamada;
  c.itens.find(i => i.tipo === "desc").val = s.produto;
  c.itens.find(i => i.tipo === "marca").val = s.marca;
  c.itens.find(i => i.tipo === "peso").val = s.peso;
  c.itens.find(i => i.tipo === "preco").val = s.preco;
  c.itens.find(i => i.tipo === "precoDe").val = s.preco_de || "";
  if (s.paleta && s.paleta.length >= 2) {
    c.itens.find(i => i.tipo === "head").col = s.paleta[0];
    const prcItem = c.itens.find(i => i.tipo === "preco");
    prcItem.col = s.paleta[2] || s.paleta[0];
  }
  state.cartazes.push(c);
  render(); save();
  closeModal("modalIA");
  $("iaDesc").value = "";
  $("iaResultado").innerHTML = "";
  $("btnIAAplicar").classList.add("hidden");
  toast("Cartaz criado pela IA", "success");
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
  csvParsed.forEach(l => {
    const c = cartazBase();
    c.itens.find(i => i.tipo === "head").val = "OFERTA";
    c.itens.find(i => i.tipo === "desc").val = l.produto;
    c.itens.find(i => i.tipo === "marca").val = l.marca;
    c.itens.find(i => i.tipo === "peso").val = l.peso;
    c.itens.find(i => i.tipo === "preco").val = l.preco;
    c.itens.find(i => i.tipo === "precoDe").val = l.preco_de || "";
    state.cartazes.push(c);
  });
  render(); save();
  closeModal("modalCSV");
  $("csvInput").value = ""; $("csvPreview").innerHTML = "";
  $("btnCSVGerar").classList.add("hidden");
  csvParsed = [];
  toast(`Cartazes gerados!`, "success");
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
  $("ctxFront").onclick = () => { if (!state.sel) return; snapshot(); state.sel.data.zOverride = 999; render(); save(); hideCtxMenu(); };
  $("ctxBack").onclick = () => { if (!state.sel) return; snapshot(); state.sel.data.zOverride = 1; render(); save(); hideCtxMenu(); };
  $("ctxDelete").onclick = () => { excluirItemSelecionado(); hideCtxMenu(); };
}

// ---------- Boot ----------
async function boot() {
  wire();
  renderColorPalette();
  renderPalettePresets();

  // splash dismiss 1.2s
  setTimeout(() => {
    const s = $("splash");
    s.style.opacity = "0";
    setTimeout(() => s.style.display = "none", 600);
  }, 1200);

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
