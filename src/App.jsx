import { useState, useEffect, useRef, useCallback } from "react";

// ─── STORAGE KEY ───────────────────────────────────────────────────────────
const STORAGE_KEY = "mercadomap_v1";

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { receipts: [], products: {}, entries: [] };
}
function saveDB(db) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch {}
  // also try window.storage (Claude artifact persistent storage)
  try { window.storage?.set(STORAGE_KEY, JSON.stringify(db)); } catch {}
}

async function loadDBFromStorage() {
  try {
    const result = await window.storage?.get(STORAGE_KEY);
    if (result?.value) return JSON.parse(result.value);
  } catch {}
  return null;
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
function calcUnitPrice(price, qty, unit) {
  if (!qty || qty <= 0) return { up: price, label: "R$/un" };
  if (unit === "g")  return { up: (price / qty) * 1000, label: "R$/kg" };
  if (unit === "kg") return { up: price / qty,           label: "R$/kg" };
  if (unit === "ml") return { up: (price / qty) * 1000,  label: "R$/L"  };
  if (unit === "l")  return { up: price / qty,           label: "R$/L"  };
  return { up: price / qty, label: "R$/un" };
}

function fmt(v) {
  return "R$ " + Number(v).toFixed(2).replace(".", ",");
}
function fmtUnit(v, label) {
  return fmt(v) + " " + label;
}
function productKey(name, brand) {
  return (name + "|" + (brand || "")).toLowerCase().replace(/\s+/g, "_");
}

// ─── FILE → BASE64 ─────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ─── CALL CLAUDE API ───────────────────────────────────────────────────────
async function callClaude(messages, system, maxTokens = 4000) {
  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    system,
    messages,
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content.map((c) => c.text || "").join("");
}

async function analyzeReceipt(base64, mimeType, knownProducts) {
  const knownStr = Object.values(knownProducts)
    .map((p) => `${p.name} | ${p.brand} | ${p.type} | ${p.qty}${p.unit}`)
    .join("\n");

  const system = `Você é um sistema especializado em ler notas fiscais brasileiras.
Retorne APENAS um JSON array válido, sem texto adicional, sem markdown, sem backticks.
Cada objeto do array deve ter:
  name: string (nome limpo e legível do produto, sem códigos)
  brand: string (marca, ou "" se não visível)
  category: string (ex: Grãos, Laticínios, Bebidas, Higiene, Limpeza, Hortifruti, Carnes, Padaria, Frios, Snacks, etc)
  type: "embalagem" | "granel" | "unidade"
  qty: number (quantidade da embalagem em g/ml/kg/L; para granel = peso em kg comprado; para unidade sem peso = 1)
  unit: "g" | "kg" | "ml" | "l" | "un"
  price: number (VI Total da nota = valor total pago pelo item incluindo todas as unidades)
  qty_packs: number (coluna Qtde da nota = quantas unidades/embalagens foram compradas)
  confidence: "high" | "low"

Produtos já conhecidos:
${knownStr || "(nenhum ainda)"}

Regras IMPORTANTES:
- price = VI Total (não VI Unit)
- qty_packs = coluna Qtde
- Granel (Un=KG): type="granel", unit="kg", qty=peso Qtde, qty_packs=1
- Para embalagem: detecte g/ml/kg/L na descrição
- confidence="low" se incerto
- Inclua TODOS os itens sem exceção`;

  const isPdf = mimeType === "application/pdf";
  const mediaBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } };

  const content = [
    mediaBlock,
    { type: "text", text: "Analise esta nota fiscal e retorne o JSON array com TODOS os itens." },
  ];

  const text = await callClaude([{ role: "user", content }], system, 4000);
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("A IA não retornou um JSON válido. Tente novamente.");
  return JSON.parse(match[0]);
}


// ─── COLORS ────────────────────────────────────────────────────────────────
const C = {
  bg: "#0c0c0d",
  surface: "#141416",
  surface2: "#1c1c1f",
  surface3: "#242428",
  border: "#2c2c31",
  accent: "#d4f53c",
  green: "#3cf5a0",
  red: "#f53c3c",
  yellow: "#f5c43c",
  text: "#f0f0ee",
  muted: "#60605a",
  muted2: "#9a9a92",
};

// ─── STYLE HELPERS ─────────────────────────────────────────────────────────
const s = {
  badge: (color) => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 20,
    fontSize: 10,
    fontWeight: 700,
    background: color + "18",
    color,
    letterSpacing: "0.5px",
    textTransform: "uppercase",
  }),
  btn: (variant = "primary") => {
    const variants = {
      primary: { background: C.accent, color: "#000", border: "none" },
      ghost:   { background: "transparent", color: C.muted2, border: `1px solid ${C.border}` },
      danger:  { background: C.red + "18", color: C.red, border: `1px solid ${C.red}44` },
    };
    return {
      padding: "8px 16px",
      borderRadius: 8,
      cursor: "pointer",
      fontFamily: "inherit",
      fontWeight: 700,
      fontSize: 12,
      letterSpacing: "0.3px",
      transition: "all .15s",
      ...variants[variant],
    };
  },
  input: {
    background: C.surface2,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "9px 12px",
    color: C.text,
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
  },
  label: {
    fontSize: 10,
    color: C.muted2,
    textTransform: "uppercase",
    letterSpacing: "0.8px",
    fontWeight: 700,
    marginBottom: 4,
    display: "block",
  },
  card: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 20,
  },
  th: {
    padding: "8px 12px",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "1px",
    color: C.muted,
    fontWeight: 700,
    borderBottom: `1px solid ${C.border}`,
    textAlign: "left",
  },
  td: {
    padding: "10px 12px",
    fontSize: 13,
    borderBottom: `1px solid ${C.border}18`,
    verticalAlign: "middle",
  },
};

// ─── TOAST ─────────────────────────────────────────────────────────────────
function Toast({ msg, type }) {
  if (!msg) return null;
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 999,
      background: C.surface3, border: `1px solid ${type === "error" ? C.red : C.green}`,
      borderRadius: 10, padding: "12px 18px", fontSize: 13, color: C.text,
      boxShadow: "0 8px 32px #00000080",
      animation: "slideIn .3s ease",
    }}>
      {type === "error" ? "❌" : "✅"} {msg}
    </div>
  );
}

// ─── MODAL CONFIRM ITEM ────────────────────────────────────────────────────
function ItemModal({ item, onConfirm, onSkip }) {
  const [form, setForm] = useState(item || {});
  useEffect(() => setForm(item || {}), [item]);
  if (!item) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div style={{
      position: "fixed", inset: 0, background: "#00000090",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 200, backdropFilter: "blur(6px)",
    }}>
      <div style={{ ...s.card, width: "100%", maxWidth: 500, padding: 28 }}>
        <div style={{ marginBottom: 4, fontSize: 18, fontWeight: 800 }}>🔍 Confirmar Item</div>
        <div style={{ fontSize: 13, color: C.muted2, marginBottom: 20 }}>
          {item.confidence === "low"
            ? "A IA teve baixa confiança neste item. Verifique os dados:"
            : "Produto novo! Confirme as informações para salvar no catálogo:"}
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Nome" value={form.name || ""} onChange={(v) => set("name", v)} />
            <Field label="Marca" value={form.brand || ""} onChange={(v) => set("brand", v)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Categoria" value={form.category || ""} onChange={(v) => set("category", v)} />
            <div>
              <label style={s.label}>Tipo</label>
              <select style={s.input} value={form.type || "embalagem"} onChange={(e) => set("type", e.target.value)}>
                <option value="embalagem">Embalagem</option>
                <option value="granel">Granel</option>
                <option value="unidade">Unidade</option>
              </select>
            </div>
            <div>
              <label style={s.label}>Unidade</label>
              <select style={s.input} value={form.unit || "g"} onChange={(e) => set("unit", e.target.value)}>
                {["g","kg","ml","l","un"].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={form.type === "granel" ? "Peso (kg)" : "Quantidade"} type="number" value={form.qty || ""} onChange={(v) => set("qty", parseFloat(v))} />
            <Field label="Preço Pago (R$)" type="number" value={form.price || ""} onChange={(v) => set("price", parseFloat(v))} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button style={s.btn("ghost")} onClick={onSkip}>Pular</button>
          <button style={s.btn("primary")} onClick={() => onConfirm(form)}>✅ Confirmar</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <div>
      <label style={s.label}>{label}</label>
      <input
        style={s.input} type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// Styled date picker — wraps native <input type="date"> with custom look
function DateInput({ label, value, onChange, style: extraStyle = {} }) {
  return (
    <div style={extraStyle}>
      {label && <label style={s.label}>{label}</label>}
      <div style={{ position: "relative" }}>
        <input
          type="date"
          value={value || ""}
          onChange={e => onChange(e.target.value)}
          style={{
            ...s.input,
            colorScheme: "dark",
            cursor: "pointer",
            paddingRight: 32,
          }}
        />
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, pointerEvents: "none", color: C.muted2 }}>📅</span>
      </div>
    </div>
  );
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────
export default function App() {
  const [db, setDB] = useState(loadDB);
  const [tab, setTab] = useState("scan");
  const [toast, setToast] = useState(null);

  // On mount, try to load from window.storage (artifact persistent storage)
  useEffect(() => {
    loadDBFromStorage().then(data => {
      if (data) setDB(data);
    });
  }, []);

  // Scan state
  const [scanMarket, setScanMarket] = useState("");
  const [scanDate, setScanDate] = useState(new Date().toISOString().split("T")[0]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState("");
  const [scannedItems, setScannedItems] = useState([]);

  // Modal state
  const [modalItem, setModalItem] = useState(null);
  const modalResolveRef = useRef(null);

  // Manual state
  const [manualMarket, setManualMarket] = useState("");
  const [manualDate, setManualDate] = useState(new Date().toISOString().split("T")[0]);
  const [manualForm, setManualForm] = useState({ name:"", brand:"", category:"", type:"embalagem", qty:"", unit:"g", price:"", qty_packs:"1" });
  const [manualItems, setManualItems] = useState([]);

  // Compare search
  const [compareSearch, setCompareSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productSort, setProductSort] = useState({ col: "date", dir: "desc" });
  const [bestSearch, setBestSearch] = useState("");
  const [editingBestKey, setEditingBestKey] = useState(null);
  const [bestEditForm, setBestEditForm] = useState({});
  const [editingRowIdx, setEditingRowIdx] = useState(null);   // index in db.entries
  const [rowEditForm, setRowEditForm] = useState({});
  const [resumoMonth, setResumoMonth] = useState(() => new Date().toISOString().slice(0, 7));

  // Receipt viewer/editor
  const [expandedReceiptId, setExpandedReceiptId] = useState(null);
  const [editingEntries, setEditingEntries] = useState({});
  const [editingMeta, setEditingMeta] = useState({});

  // Merge duplicates
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeSelected, setMergeSelected] = useState([]); // array of productKeys selected
  const [mergeFinal, setMergeFinal] = useState({ name:"", brand:"", category:"", type:"", qty:"", unit:"g" });

  const [showSettings, setShowSettings] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const persist = useCallback((newDB) => {
    setDB(newDB);
    saveDB(newDB);
  }, []);

  const clearAllData = () => {
    const empty = { receipts: [], products: {}, entries: [] };
    setDB(empty);
    saveDB(empty);
    try { localStorage.removeItem("mercadomap_v1"); } catch {}
    try { window.storage?.delete("mercadomap_v1"); } catch {}
    setShowSettings(false);
    setConfirmClear(false);
    showToast("Todos os dados foram apagados.");
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const markets = [...new Set(db.receipts.map((r) => r.market))];

  // ── MODAL HELPER ──
  function askModal(item) {
    return new Promise((resolve) => {
      modalResolveRef.current = resolve;
      setModalItem(item);
    });
  }

  function handleModalConfirm(confirmed) {
    setModalItem(null);
    if (modalResolveRef.current) { modalResolveRef.current(confirmed); modalResolveRef.current = null; }
  }
  function handleModalSkip() {
    setModalItem(null);
    if (modalResolveRef.current) { modalResolveRef.current(null); modalResolveRef.current = null; }
  }

  // ── SCAN ──
  async function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!scanMarket.trim() || !scanDate) {
      showToast("Informe o supermercado e a data antes!", "error"); return;
    }
    setScanning(true); setScanProgress(10); setScanStatus("Lendo arquivo...");
    try {
      const base64 = await fileToBase64(file);
      setScanProgress(30); setScanStatus("Enviando para análise com IA...");
      const items = await analyzeReceipt(base64, file.type, db.products);
      setScanProgress(90); setScanStatus(`${items.length} itens encontrados!`);
      setScannedItems(items);
    } catch (err) {
      showToast("Erro ao analisar: " + err.message, "error");
    } finally {
      setScanning(false); setScanProgress(0); setScanStatus("");
    }
  }

  async function saveScannedItems() {
    if (!scannedItems.length) return;
    const items = [...scannedItems];
    const receiptId = Date.now();
    const newDB = { ...db, products: { ...db.products }, entries: [...db.entries], receipts: [...db.receipts] };

    const receiptItems = items.map((item) => {
      const key = productKey(item.name, item.brand);
      if (!newDB.products[key]) {
        newDB.products[key] = { key, name: item.name, brand: item.brand, category: item.category, type: item.type, qty: item.qty, unit: item.unit, count: 0 };
      }
      newDB.products[key].count++;
      const totalQty = (item.qty || 1) * (item.qty_packs || 1);
      const { up, label } = calcUnitPrice(item.price, totalQty, item.unit);
      const entry = { receiptId, productKey: key, market: scanMarket, date: scanDate, price: item.price, qty: item.qty, unit: item.unit, qty_packs: item.qty_packs || 1, unitPrice: up, unitLabel: label };
      newDB.entries.push(entry);
      return entry;
    });

    newDB.receipts.push({ id: receiptId, market: scanMarket, date: scanDate, items: receiptItems });
    persist(newDB);
    setScannedItems([]);
    showToast(`Nota salva com ${receiptItems.length} itens!`);
  }

  // ── MANUAL ──
  function setMF(k, v) { setManualForm((f) => ({ ...f, [k]: v })); }

  function handleNameChange(val) {
    setMF("name", val);
    const key = productKey(val, manualForm.brand);
    const known = db.products[key] || Object.values(db.products).find(p => p.name.toLowerCase() === val.toLowerCase());
    if (known) {
      setManualForm(f => ({ ...f, name: val, brand: known.brand || f.brand, category: known.category || f.category, type: known.type, qty: String(known.qty), unit: known.unit }));
      showToast("✨ Produto reconhecido automaticamente!");
    }
  }

  function addManualItem() {
    const { name, brand, category, type, qty, unit, price, qty_packs } = manualForm;
    if (!name.trim() || !price) { showToast("Informe nome e preço!", "error"); return; }
    const totalQty = (parseFloat(qty) || 1) * (parseInt(qty_packs) || 1);
    const { up, label } = calcUnitPrice(parseFloat(price), totalQty, unit);
    setManualItems(items => [...items, { name, brand, category, type, qty: parseFloat(qty) || 1, unit, price: parseFloat(price), qty_packs: parseInt(qty_packs) || 1, unitPrice: up, unitLabel: label }]);
    setManualForm(f => ({ ...f, name: "", brand: "", category: "", qty: "", price: "", qty_packs: "1" }));
  }

  function saveManualReceipt() {
    if (!manualMarket.trim() || !manualDate) { showToast("Informe supermercado e data!", "error"); return; }
    if (!manualItems.length) { showToast("Adicione pelo menos um item!", "error"); return; }
    const receiptId = Date.now();
    const newDB = { ...db, products: { ...db.products }, entries: [...db.entries], receipts: [...db.receipts] };
    const receiptItems = manualItems.map((item) => {
      const key = productKey(item.name, item.brand);
      if (!newDB.products[key]) newDB.products[key] = { key, name: item.name, brand: item.brand, category: item.category, type: item.type, qty: item.qty, unit: item.unit, count: 0 };
      newDB.products[key].count++;
      const entry = { receiptId, productKey: key, market: manualMarket, date: manualDate, price: item.price, qty: item.qty, unit: item.unit, qty_packs: item.qty_packs, unitPrice: item.unitPrice, unitLabel: item.unitLabel };
      newDB.entries.push(entry);
      return entry;
    });
    newDB.receipts.push({ id: receiptId, market: manualMarket, date: manualDate, items: receiptItems });
    persist(newDB);
    setManualItems([]);
    showToast(`Nota com ${receiptItems.length} itens salva!`);
  }

  // ── COMPARE ──
  // Group by normalized product NAME only (ignoring brand), so
  // "Arroz Branco Tio João" and "Arroz Branco Namorado" are compared together.
  const compareData = (() => {
    const q = compareSearch.toLowerCase();

    // nameKey → list of { entry, product }
    const byName = {};
    db.entries.forEach((e) => {
      const prod = db.products[e.productKey];
      if (!prod) return;
      const nameKey = prod.name.toLowerCase().replace(/\s+/g, "_");
      if (!byName[nameKey]) byName[nameKey] = { name: prod.name, rows: [] };
      byName[nameKey].rows.push({ entry: e, prod });
    });

    return Object.values(byName)
      .filter(({ name, rows }) => {
        if (q && !name.toLowerCase().includes(q)) return false;
        // show if there are at least 2 distinct (market+brand) combos
        const combos = new Set(rows.map(r => r.entry.market + "|" + (r.prod.brand || "")));
        return combos.size >= 2;
      })
      .map(({ name, rows }) => {
        // Build one row per (market, brand) combo, picking the best (lowest) unitPrice
        const comboMap = {};
        rows.forEach(({ entry: e, prod }) => {
          const key = e.market + "|" + (prod.brand || "");
          if (!comboMap[key] || e.unitPrice < comboMap[key].unitPrice) {
            comboMap[key] = { market: e.market, brand: prod.brand || "", unitPrice: e.unitPrice, unitLabel: e.unitLabel, date: e.date };
          }
        });
        const lines = Object.values(comboMap).sort((a, b) => a.unitPrice - b.unitPrice);
        const category = rows[0].prod.category || "";
        return { name, category, lines };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  })();

  // ── RENDER ──
  const navItems = [
    { id: "scan",     label: "Escanear NF",      icon: "📸" },
    { id: "manual",   label: "Inserir Manual",    icon: "✏️" },
    { id: "resumo",   label: "Resumo Mensal",     icon: "📅" },
    { id: "best",     label: "Melhores Preços",   icon: "🏆" },
    { id: "compare",  label: "Comparar",          icon: "📊" },
    { id: "receipts", label: "Notas Fiscais",     icon: "🧾" },
    { id: "products", label: "Compras",           icon: "📦" },
    { id: "merge",    label: "Mesclar Duplicatas",icon: "🔀" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700&family=Syne:wght@600;700;800&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        input, select { font-family: inherit !important; }
        @keyframes slideIn { from { transform: translateX(40px); opacity:0 } to { transform: translateX(0); opacity:1 } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
        .row-hover:hover { background: ${C.surface2} !important; }
        .btn-hover:hover { filter: brightness(1.1); transform: translateY(-1px); }
      `}</style>

      {/* SIDEBAR */}
      <aside style={{ background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh", overflow: "hidden" }}>
        <div style={{ padding: "22px 18px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, letterSpacing: "-0.5px" }}>
            Mercado<span style={{ color: C.accent }}>Map</span>
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 3, letterSpacing: "1.2px", textTransform: "uppercase" }}>Comparador de preços</div>
        </div>
        <nav style={{ flex: 1, padding: "10px 0" }}>
          {navItems.map((n) => (
            <div key={n.id} onClick={() => setTab(n.id)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", cursor: "pointer",
              fontSize: 13, fontFamily: "'Syne', sans-serif", fontWeight: 700,
              color: tab === n.id ? C.accent : C.muted2,
              background: tab === n.id ? C.accent + "0c" : "transparent",
              borderLeft: `2px solid ${tab === n.id ? C.accent : "transparent"}`,
              transition: "all .15s",
            }}>
              <span style={{ fontSize: 15 }}>{n.icon}</span> {n.label}
            </div>
          ))}
        </nav>
        <div style={{ padding: 14, borderTop: `1px solid ${C.border}`, display: "grid", gap: 8 }}>
          {[["Produtos", Object.keys(db.products).length, C.accent], ["Notas", db.receipts.length, C.green]].map(([l, v, c]) => (
            <div key={l} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "1px" }}>{l}</div>
              <div style={{ fontSize: 22, fontFamily: "'Syne',sans-serif", fontWeight: 800, color: c }}>{v}</div>
            </div>
          ))}
        </div>
      </aside>

      {/* MAIN */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "auto" }}>
        {/* TOP BAR */}
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800 }}>
            {navItems.find(n => n.id === tab)?.icon} {navItems.find(n => n.id === tab)?.label}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn-hover" style={s.btn("ghost")} onClick={() => {
              const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
              const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
              a.download = `mercadomap-${new Date().toISOString().split("T")[0]}.json`; a.click();
              showToast("Dados exportados!");
            }}>⬇ Exportar</button>
            <button
              onClick={() => setShowSettings(v => !v)}
              title="Configurações"
              style={{ background: showSettings ? C.accent+"22" : "none", border: `1px solid ${showSettings ? C.accent+"44" : C.border}`, borderRadius: 8, width: 36, height: 36, cursor: "pointer", fontSize: 16, color: showSettings ? C.accent : C.muted, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s" }}
            >⚙️</button>
          </div>
        </div>

        {/* SETTINGS PANEL */}
        {showSettings && (
          <div style={{ background: C.surface2, borderBottom: `1px solid ${C.border}`, padding: "20px 24px", animation: "fadeIn .2s ease" }}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, marginBottom: 16 }}>⚙️ Configurações</div>
            <div style={{ display: "grid", gap: 12, maxWidth: 480 }}>

              {/* Stats */}
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: C.muted2, padding: "10px 14px", background: C.surface3, borderRadius: 8 }}>
                <span>📦 {Object.keys(db.products).length} produtos</span>
                <span>🧾 {db.receipts.length} notas</span>
                <span>📋 {db.entries.length} registros</span>
              </div>

              {/* Export */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: C.surface3, borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Exportar dados</div>
                  <div style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>Baixar backup completo em JSON</div>
                </div>
                <button className="btn-hover" style={s.btn("ghost")} onClick={() => {
                  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
                  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `mercadomap-${new Date().toISOString().split("T")[0]}.json`; a.click();
                  showToast("Dados exportados!");
                }}>⬇ Exportar</button>
              </div>

              {/* Danger zone */}
              <div style={{ padding: "12px 14px", background: C.red+"10", border: `1px solid ${C.red}33`, borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: C.red, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 10 }}>⚠️ Zona de perigo</div>
                {!confirmClear ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Zerar todos os dados</div>
                      <div style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>Remove notas, produtos e histórico de preços</div>
                    </div>
                    <button className="btn-hover" style={{ ...s.btn("danger"), padding: "8px 14px" }} onClick={() => setConfirmClear(true)}>
                      🗑 Zerar tudo
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 10 }}>
                      Tem certeza? Isso apaga TUDO e não pode ser desfeito.
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={{ ...s.btn("ghost"), flex: 1 }} onClick={() => setConfirmClear(false)}>Cancelar</button>
                      <button className="btn-hover" style={{ ...s.btn("danger"), flex: 1, fontWeight: 700 }} onClick={clearAllData}>
                        ✓ Sim, apagar tudo
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        <div style={{ padding: 24, flex: 1, animation: "fadeIn .25s ease" }}>

          {/* ─── SCAN TAB ─── */}
          {tab === "scan" && (
            <div style={{ display: "grid", gap: 16 }}>
              <div style={s.card}>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, marginBottom: 14 }}>📍 Informações da Compra</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div>
                    <label style={s.label}>Supermercado</label>
                    <input style={s.input} value={scanMarket} onChange={e => setScanMarket(e.target.value)} placeholder="Ex: Extra, Carrefour..." list="mlist" />
                    <datalist id="mlist">{markets.map(m => <option key={m} value={m} />)}</datalist>
                  </div>
                  <DateInput label="Data" value={scanDate} onChange={setScanDate} />
                </div>
              </div>

              <div style={s.card}>
                <label htmlFor="file-upload" style={{
                  display: "block", border: `2px dashed ${C.border}`, borderRadius: 12,
                  padding: "40px 24px", textAlign: "center", cursor: "pointer", transition: "all .2s",
                }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>📷</div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
                    {scanning ? "Analisando..." : "Envie a foto da nota fiscal"}
                  </div>
                  <div style={{ fontSize: 13, color: C.muted }}>Clique aqui para selecionar imagem ou PDF</div>
                  <input id="file-upload" type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={handleFile} />
                </label>

                {scanning && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ height: 4, background: C.surface3, borderRadius: 2, overflow: "hidden", marginBottom: 8 }}>
                      <div style={{ height: "100%", width: scanProgress + "%", background: C.accent, borderRadius: 2, transition: "width .4s ease" }} />
                    </div>
                    <div style={{ fontSize: 12, color: C.muted2, fontFamily: "'Space Mono',monospace" }}>{scanStatus}</div>
                  </div>
                )}

                {scannedItems.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13 }}>✅ {scannedItems.length} itens — <span style={{ color: C.muted2, fontWeight: 400, fontSize: 12 }}>clique em qualquer célula para editar</span></div>
                      <button className="btn-hover" style={s.btn("primary")} onClick={saveScannedItems}>💾 Salvar Nota</button>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead><tr>
                          {["Produto","Marca","Cat.","Tipo","Qtd","Un","Embal.","Preço Total","Preço/Unid",""].map(h => <th key={h} style={s.th}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {scannedItems.map((item, i) => {
                            const totalQty = (item.qty || 1) * (item.qty_packs || 1);
                            const { up, label } = calcUnitPrice(item.price, totalQty, item.unit);
                            const known = db.products[productKey(item.name, item.brand)];
                            const isNew = !known || item.confidence === "low";

                            // all known product names and brands for datalist autocomplete
                            const allNames = [...new Set(Object.values(db.products).map(p => p.name))];
                            const allBrands = [...new Set(Object.values(db.products).map(p => p.brand).filter(Boolean))];
                            const allCats = [...new Set(Object.values(db.products).map(p => p.category).filter(Boolean))];

                            const setField = (field, value) => {
                              setScannedItems(prev => {
                                const next = [...prev];
                                next[i] = { ...next[i], [field]: value };

                                // autocomplete: when name changes, fill known product fields
                                if (field === "name") {
                                  const match = Object.values(db.products).find(
                                    p => p.name.toLowerCase() === value.toLowerCase()
                                  );
                                  if (match) {
                                    next[i] = {
                                      ...next[i],
                                      brand: match.brand || next[i].brand,
                                      category: match.category || next[i].category,
                                      type: match.type || next[i].type,
                                      qty: match.qty || next[i].qty,
                                      unit: match.unit || next[i].unit,
                                      confidence: "high",
                                    };
                                  }
                                }
                                // autocomplete: when brand changes with known name+brand combo
                                if (field === "brand") {
                                  const match = Object.values(db.products).find(
                                    p => p.name.toLowerCase() === next[i].name.toLowerCase()
                                      && p.brand.toLowerCase() === value.toLowerCase()
                                  );
                                  if (match) {
                                    next[i] = {
                                      ...next[i],
                                      category: match.category || next[i].category,
                                      type: match.type || next[i].type,
                                      qty: match.qty || next[i].qty,
                                      unit: match.unit || next[i].unit,
                                      confidence: "high",
                                    };
                                  }
                                }
                                return next;
                              });
                            };

                            const cellInput = (field, value, listId, listOptions, type="text", width=90) => (
                              <td style={{ ...s.td, padding: "4px 6px" }}>
                                {listId && (
                                  <datalist id={`dl-${i}-${listId}`}>
                                    {listOptions.map(o => <option key={o} value={o} />)}
                                  </datalist>
                                )}
                                <input
                                  type={type}
                                  value={value ?? ""}
                                  list={listId ? `dl-${i}-${listId}` : undefined}
                                  onChange={e => setField(field, type === "number" ? parseFloat(e.target.value) || 0 : e.target.value)}
                                  style={{
                                    ...s.input,
                                    width,
                                    padding: "5px 7px",
                                    fontSize: 12,
                                    fontFamily: type === "number" ? "'Space Mono',monospace" : "inherit",
                                    background: isNew && ["name","brand"].includes(field) ? C.yellow + "12" : C.surface3,
                                    border: `1px solid ${isNew && ["name","brand"].includes(field) ? C.yellow + "44" : C.border}`,
                                  }}
                                />
                              </td>
                            );

                            return (
                              <tr key={i} style={{ borderBottom: `1px solid ${C.border}22` }}>
                                {cellInput("name",     item.name,     "names",  allNames,  "text", 140)}
                                {cellInput("brand",    item.brand||"","brands", allBrands, "text", 100)}
                                {cellInput("category", item.category||"","cats",allCats,   "text", 90)}
                                <td style={{ ...s.td, padding: "4px 6px" }}>
                                  <select value={item.type||"embalagem"} onChange={e => setField("type", e.target.value)}
                                    style={{ ...s.input, width: 100, padding: "5px 7px", fontSize: 12 }}>
                                    <option value="embalagem">Embalagem</option>
                                    <option value="granel">Granel</option>
                                    <option value="unidade">Unidade</option>
                                  </select>
                                </td>
                                {cellInput("qty",      item.qty||"",  null, [], "number", 65)}
                                <td style={{ ...s.td, padding: "4px 6px" }}>
                                  <select value={item.unit||"g"} onChange={e => setField("unit", e.target.value)}
                                    style={{ ...s.input, width: 65, padding: "5px 7px", fontSize: 12 }}>
                                    {["g","kg","ml","l","un"].map(u => <option key={u} value={u}>{u}</option>)}
                                  </select>
                                </td>
                                {cellInput("qty_packs",item.qty_packs||1,null,[],"number",50)}
                                {cellInput("price",    item.price||"", null, [], "number", 80)}
                                <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 12, color: C.accent, whiteSpace: "nowrap" }}>
                                  {fmtUnit(up, label)}
                                </td>
                                <td style={{ ...s.td, padding: "4px 6px" }}>
                                  <button style={{ ...s.btn("danger"), padding: "4px 8px", fontSize: 11 }}
                                    onClick={() => setScannedItems(prev => prev.filter((_, j) => j !== i))}>✕</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── MANUAL TAB ─── */}
          {tab === "manual" && (
            <div style={{ display: "grid", gap: 16 }}>
              <div style={s.card}>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, marginBottom: 14 }}>📍 Informações da Compra</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div>
                    <label style={s.label}>Supermercado</label>
                    <input style={s.input} value={manualMarket} onChange={e => setManualMarket(e.target.value)} placeholder="Nome do supermercado" list="mlist2" />
                    <datalist id="mlist2">{markets.map(m => <option key={m} value={m} />)}</datalist>
                  </div>
                  <DateInput label="Data" value={manualDate} onChange={setManualDate} />
                </div>
              </div>

              <div style={s.card}>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, marginBottom: 14 }}>➕ Adicionar Item</div>
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={s.label}>Nome do Produto</label>
                      <input style={s.input} value={manualForm.name} onChange={e => handleNameChange(e.target.value)} placeholder="Ex: Arroz..." list="prodlist" />
                      <datalist id="prodlist">{Object.values(db.products).map(p => <option key={p.key} value={p.name} />)}</datalist>
                    </div>
                    <Field label="Marca" value={manualForm.brand} onChange={v => setMF("brand", v)} placeholder="Ex: Camil..." />
                    <Field label="Categoria" value={manualForm.category} onChange={v => setMF("category", v)} placeholder="Ex: Grãos..." />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={s.label}>Tipo</label>
                      <select style={s.input} value={manualForm.type} onChange={e => setMF("type", e.target.value)}>
                        <option value="embalagem">Embalagem</option>
                        <option value="granel">Granel</option>
                        <option value="unidade">Unidade</option>
                      </select>
                    </div>
                    <Field label={manualForm.type === "granel" ? "Peso (kg)" : "Quantidade"} type="number" value={manualForm.qty} onChange={v => setMF("qty", v)} placeholder="Ex: 1000" />
                    <div>
                      <label style={s.label}>Unidade</label>
                      <select style={s.input} value={manualForm.unit} onChange={e => setMF("unit", e.target.value)}>
                        {["g","kg","ml","l","un"].map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <Field label="Preço (R$)" type="number" value={manualForm.price} onChange={v => setMF("price", v)} placeholder="0,00" />
                    <Field label="Qtd embal." type="number" value={manualForm.qty_packs} onChange={v => setMF("qty_packs", v)} />
                  </div>
                </div>
                <button className="btn-hover" style={{ ...s.btn("primary"), marginTop: 14 }} onClick={addManualItem}>➕ Adicionar Item</button>
              </div>

              {manualItems.length > 0 && (
                <div style={s.card}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13 }}>🛒 {manualItems.length} itens</div>
                    <button className="btn-hover" style={s.btn("primary")} onClick={saveManualReceipt}>💾 Salvar Nota</button>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>
                      {["Produto","Marca","Tipo","Qtd","Preço","Preço/Unid",""].map(h => <th key={h} style={s.th}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {manualItems.map((item, i) => (
                        <tr key={i} className="row-hover">
                          <td style={s.td}><strong>{item.name}</strong></td>
                          <td style={s.td}>{item.brand || "—"}</td>
                          <td style={s.td}><span style={s.badge(item.type === "granel" ? C.green : C.accent)}>{item.type}</span></td>
                          <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 12 }}>{item.qty} {item.unit}</td>
                          <td style={{ ...s.td, fontFamily: "'Space Mono',monospace" }}>{fmt(item.price)}</td>
                          <td style={{ ...s.td, fontFamily: "'Space Mono',monospace" }}>{fmtUnit(item.unitPrice, item.unitLabel)}</td>
                          <td style={s.td}><button style={s.btn("danger")} onClick={() => setManualItems(items => items.filter((_, j) => j !== i))}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}


          {/* ─── RESUMO MENSAL TAB ─── */}
          {tab === "resumo" && (() => {
            // Available months from entries
            const allMonths = [...new Set(db.entries.map(e => e.date?.slice(0, 7)).filter(Boolean))].sort().reverse();
            const monthEntries = db.entries.filter(e => e.date?.startsWith(resumoMonth));

            // Cross-check: also sum from receipts of this month for verification
            const monthReceipts = db.receipts.filter(r => r.date?.startsWith(resumoMonth));
            const totalFromReceipts = monthReceipts.reduce((s, r) => s + r.items.reduce((rs, i) => rs + (i.price || 0), 0), 0);
            const entriesWithoutDate = db.entries.filter(e => !e.date).length;

            // ── Gastos por categoria — use receipts as source of truth ──
            const byCategory = {};
            // Collect all items from month receipts, resolved via db.products
            const allMonthItems = monthReceipts.flatMap(r =>
              r.items.map(item => {
                // find matching entry for this item
                const entry = db.entries.find(e => e.productKey === item.productKey && e.receiptId === r.id) || item;
                const p = db.products[item.productKey] || {};
                return { ...entry, price: item.price || entry.price || 0, productKey: item.productKey, p };
              })
            );
            allMonthItems.forEach(({ price, qty_packs, p }) => {
              const cat = p.category || "Sem categoria";
              if (!byCategory[cat]) byCategory[cat] = { total: 0, items: 0 };
              byCategory[cat].total += price || 0;
              byCategory[cat].items += qty_packs || 1;
            });
            const totalGasto = totalFromReceipts;
            const catRows = Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total);

            // ── Consumo por produto ──
            const byProduct = {};
            allMonthItems.forEach(item => {
              const { productKey: pk, price, qty_packs, qty, unit, p } = item;
              if (!byProduct[pk]) byProduct[pk] = { name: p.name || pk, brand: p.brand || "", category: p.category || "", unit: unit || p.unit || "un", type: p.type || "", totalQty: 0, totalPacks: 0, totalSpent: 0, purchases: 0 };
              const packs = qty_packs || 1;
              const qtyPerPack = qty || p.qty || 1;
              byProduct[pk].totalQty   += qtyPerPack * packs;
              byProduct[pk].totalPacks += packs;
              byProduct[pk].totalSpent += price || 0;
              byProduct[pk].purchases  += 1;
            });
            const productRows = Object.values(byProduct).sort((a, b) => b.totalSpent - a.totalSpent);

            // Group product rows by category
            const prodByCategory = {};
            productRows.forEach(r => {
              const cat = r.category || "Sem categoria";
              if (!prodByCategory[cat]) prodByCategory[cat] = [];
              prodByCategory[cat].push(r);
            });
            const prodCats = Object.keys(prodByCategory).sort();

            // Human-friendly quantity display
            const fmtQty = (qty, unit) => {
              if (unit === "g" && qty >= 1000)  return `${(qty/1000).toFixed(2).replace(/\.?0+$/, "")} kg`;
              if (unit === "ml" && qty >= 1000) return `${(qty/1000).toFixed(2).replace(/\.?0+$/, "")} L`;
              return `${Number(qty.toFixed(2)).toString()} ${unit}`;
            };

            const monthLabel = resumoMonth ? new Date(resumoMonth + "-15").toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "—";

            return (
              <div style={{ display: "grid", gap: 20 }}>

                {/* Month picker */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18, textTransform: "capitalize" }}>{monthLabel}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {allMonths.map(m => {
                      const label = new Date(m + "-15").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
                      return (
                        <button key={m} onClick={() => setResumoMonth(m)}
                          style={{ ...s.btn(m === resumoMonth ? "primary" : "ghost"), padding: "4px 12px", fontSize: 12, textTransform: "capitalize" }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {monthEntries.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>📅</div>
                    <div>Nenhuma compra registrada em {monthLabel}.</div>
                  </div>
                ) : (
                  <>
                    {/* Summary cards */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
                      {[
                        { label: "Total gasto", value: fmt(totalFromReceipts), color: C.accent },
                        { label: "Notas fiscais", value: monthReceipts.length, color: C.text },
                        { label: "Categorias", value: catRows.length, color: C.muted2 },
                        { label: "Produtos únicos", value: productRows.length, color: C.muted2 },
                      ].map(card => (
                        <div key={card.label} style={{ ...s.card, textAlign: "center", padding: "16px 12px" }}>
                          <div style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 20, color: card.color }}>{card.value}</div>
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{card.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Warning if entries lack dates */}
                    {entriesWithoutDate > 0 && (
                      <div style={{ padding: "10px 14px", borderRadius: 8, background: C.yellow+"18", border: `1px solid ${C.yellow}44`, fontSize: 12, color: C.yellow }}>
                        ⚠️ {entriesWithoutDate} entrada{entriesWithoutDate > 1 ? "s" : ""} sem data — podem estar faltando no resumo. Edite-as na aba Compras para corrigir.
                      </div>
                    )}

                    {/* Gastos por categoria */}
                    <div style={s.card}>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, marginBottom: 14 }}>💰 Gastos por categoria</div>
                      <div style={{ display: "grid", gap: 8 }}>
                        {catRows.map(([cat, data]) => {
                          const pct = totalGasto > 0 ? (data.total / totalGasto) * 100 : 0;
                          return (
                            <div key={cat}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{cat}</span>
                                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                  <span style={{ fontSize: 11, color: C.muted2 }}>{pct.toFixed(1)}%</span>
                                  <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 13, fontWeight: 700, color: C.accent }}>{fmt(data.total)}</span>
                                </div>
                              </div>
                              <div style={{ height: 6, background: C.surface3, borderRadius: 3, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${pct}%`, background: C.accent, borderRadius: 3, transition: "width .4s ease" }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Consumo por produto, agrupado por categoria */}
                    <div style={s.card}>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, marginBottom: 14 }}>📦 Consumo mensal por produto</div>
                      <div style={{ display: "grid", gap: 24 }}>
                        {prodCats.map(cat => (
                          <div key={cat}>
                            {/* category divider */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                              <div style={{ height: 1, flex: 1, background: C.border }} />
                              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.2px", color: C.accent, fontWeight: 700, background: C.accent+"12", padding: "2px 10px", borderRadius: 20 }}>{cat}</div>
                              <div style={{ height: 1, flex: 1, background: C.border }} />
                            </div>
                            <div style={{ overflowX: "auto" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                  <tr>
                                    {["Produto","Marca","Tipo","Qtd consumida","Pacotes","Gasto","% do total"].map(h => <th key={h} style={s.th}>{h}</th>)}
                                  </tr>
                                </thead>
                                <tbody>
                                  {prodByCategory[cat].map((r, i) => {
                                    const pct = totalGasto > 0 ? (r.totalSpent / totalGasto) * 100 : 0;
                                    return (
                                      <tr key={i} className="row-hover">
                                        <td style={s.td}><strong>{r.name}</strong></td>
                                        <td style={{ ...s.td, color: C.muted2, fontSize: 12 }}>{r.brand || "—"}</td>
                                        <td style={s.td}><span style={s.badge(r.type === "granel" ? C.green : r.type === "unidade" ? C.yellow : C.accent)}>{r.type || "—"}</span></td>
                                        <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 12, color: C.accent, fontWeight: 700 }}>
                                          {fmtQty(r.totalQty, r.unit)}
                                        </td>
                                        <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 12 }}>
                                          {r.totalPacks}× {r.purchases > 1 ? <span style={{ fontSize: 10, color: C.muted }}>{r.purchases} compras</span> : null}
                                        </td>
                                        <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 12 }}>{fmt(r.totalSpent)}</td>
                                        <td style={{ ...s.td, fontSize: 12 }}>
                                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <div style={{ width: 40, height: 4, background: C.surface3, borderRadius: 2, overflow: "hidden" }}>
                                              <div style={{ height: "100%", width: `${pct}%`, background: C.accent, borderRadius: 2 }} />
                                            </div>
                                            <span style={{ color: C.muted2 }}>{pct.toFixed(1)}%</span>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* ─── BEST PRICES TAB ─── */}
          {tab === "best" && (() => {
            const byName = {};
            db.entries.forEach(e => {
              const p = db.products[e.productKey];
              if (!p || !e.unitPrice) return;
              const key = p.name.toLowerCase().replace(/\s+/g, "_");
              if (!byName[key]) byName[key] = { name: p.name, brand: p.brand || "", category: p.category || "", type: p.type || "", records: [] };
              byName[key].records.push({
                market: e.market, date: e.date,
                unitPrice: e.unitPrice, unitLabel: e.unitLabel,
                price: e.price,           // total paid
                qty: e.qty,               // qty per pack
                unit: e.unit,
                qty_packs: e.qty_packs || 1,
                brand: p.brand || "",
              });
            });

            const q = bestSearch.toLowerCase();
            const items = Object.values(byName)
              .filter(item => !q || item.name.toLowerCase().includes(q) || item.brand.toLowerCase().includes(q) || item.category.toLowerCase().includes(q))
              .map(item => {
                const sorted = [...item.records].sort((a, b) => a.unitPrice - b.unitPrice);
                const best = sorted[0];
                const worst = sorted[sorted.length - 1];
                const avg = item.records.reduce((s, r) => s + r.unitPrice, 0) / item.records.length;
                return { ...item, best, worst, avg, nRecords: item.records.length };
              })
              .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

            const byCategory = {};
            items.forEach(item => {
              const cat = item.category || "Sem categoria";
              if (!byCategory[cat]) byCategory[cat] = [];
              byCategory[cat].push(item);
            });

            const cats = Object.keys(byCategory).sort();
            const thStyle = { ...s.th, whiteSpace: "nowrap" };

            // format pack size label e.g. "500g" or "1L" or "2 un"
            const packLabel = (qty, unit, qty_packs) => {
              if (!qty) return "—";
              const packStr = `${qty}${unit}`;
              return qty_packs > 1 ? `${qty_packs}× ${packStr}` : packStr;
            };

            return (
              <div>
                <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center" }}>
                  <div style={{ flex: 1, position: "relative" }}>
                    <input
                      style={{ ...s.input, paddingLeft: 36 }}
                      value={bestSearch}
                      onChange={e => setBestSearch(e.target.value)}
                      placeholder="Buscar produto, marca, categoria..."
                    />
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 14 }}>🔍</span>
                  </div>
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", fontSize: 12, color: C.muted2, whiteSpace: "nowrap" }}>
                    <span style={{ color: C.accent, fontWeight: 700, fontFamily: "'Space Mono',monospace" }}>{items.length}</span> produtos · <span style={{ color: C.accent, fontWeight: 700, fontFamily: "'Space Mono',monospace" }}>{cats.length}</span> categorias
                  </div>
                </div>

                {items.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>🏆</div>
                    <div style={{ fontSize: 14 }}>Nenhum produto encontrado.</div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 28 }}>
                    {cats.map(cat => (
                      <div key={cat}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                          <div style={{ height: 1, flex: 1, background: C.border }} />
                          <div style={{
                            fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 11,
                            textTransform: "uppercase", letterSpacing: "1.5px",
                            color: C.accent, padding: "3px 12px",
                            background: C.accent + "12", borderRadius: 20,
                            border: `1px solid ${C.accent}30`,
                          }}>
                            {cat} <span style={{ color: C.muted, fontWeight: 400 }}>({byCategory[cat].length})</span>
                          </div>
                          <div style={{ height: 1, flex: 1, background: C.border }} />
                        </div>

                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr>
                                <th style={thStyle}>Produto</th>
                                <th style={thStyle}>Marca</th>
                                <th style={thStyle}>Tipo</th>
                                <th style={{ ...thStyle, color: C.accent }}>🏆 Melhor Preço/Un</th>
                                <th style={{ ...thStyle, color: C.accent }}>Embalagem</th>
                                <th style={{ ...thStyle, color: C.accent }}>Preço Embal.</th>
                                <th style={{ ...thStyle, color: C.accent }}>Supermercado</th>
                                <th style={{ ...thStyle, color: C.accent }}>Data</th>
                                <th style={{ ...thStyle, color: C.muted }}>Preço Médio/Un</th>
                                <th style={{ ...thStyle, color: C.red }}>Maior Preço/Un</th>
                                <th style={{ ...thStyle, color: C.red }}>Supermercado</th>
                                <th style={thStyle}>Compras</th>
                              </tr>
                            </thead>
                            <tbody>
                              {byCategory[cat].map((item, i) => {
                                const savings = item.worst.unitPrice - item.best.unitPrice;
                                const savingsPct = item.worst.unitPrice > 0 ? ((savings / item.worst.unitPrice) * 100).toFixed(0) : 0;
                                // pack price = price / qty_packs (price per single pack)
                                const bestPackPrice = item.best.qty_packs > 1
                                  ? item.best.price / item.best.qty_packs
                                  : item.best.price;
                                return (
                                  <tr key={i} className="row-hover">
                                    <td style={s.td}><strong>{item.name}</strong></td>
                                    <td style={{ ...s.td, color: C.muted2, fontSize: 12 }}>{item.brand || "—"}</td>
                                    <td style={s.td}>
                                      <span style={s.badge(item.type === "granel" ? C.green : item.type === "unidade" ? C.yellow : C.accent)}>
                                        {item.type || "—"}
                                      </span>
                                    </td>
                                    {/* Best unit price */}
                                    <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontWeight: 700, color: C.accent }}>
                                      {fmtUnit(item.best.unitPrice, item.best.unitLabel)}
                                    </td>
                                    {/* Pack size */}
                                    <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 11, color: C.muted2 }}>
                                      {packLabel(item.best.qty, item.best.unit, item.best.qty_packs)}
                                    </td>
                                    {/* Pack price */}
                                    <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 12, color: C.text }}>
                                      {item.best.price ? fmt(bestPackPrice) : "—"}
                                    </td>
                                    {/* Best market */}
                                    <td style={{ ...s.td, fontSize: 12 }}>
                                      <span style={{ background: C.accent + "12", color: C.accent, padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                                        {item.best.market}
                                      </span>
                                    </td>
                                    <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 11, color: C.muted2 }}>
                                      {item.best.date ? new Date(item.best.date + "T12:00:00").toLocaleDateString("pt-BR") : "—"}
                                    </td>
                                    {/* Avg */}
                                    <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 12, color: C.muted2 }}>
                                      {fmtUnit(item.avg, item.best.unitLabel)}
                                    </td>
                                    {/* Worst */}
                                    <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 12, color: item.nRecords > 1 ? C.red : C.muted2 }}>
                                      {item.nRecords > 1 ? fmtUnit(item.worst.unitPrice, item.worst.unitLabel) : "—"}
                                    </td>
                                    <td style={{ ...s.td, fontSize: 12 }}>
                                      {item.nRecords > 1 ? (
                                        <span style={{ background: C.red + "12", color: C.red, padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                                          {item.worst.market}
                                        </span>
                                      ) : "—"}
                                    </td>
                                    <td style={{ ...s.td, fontSize: 11 }}>
                                      <div style={{ fontFamily: "'Space Mono',monospace", color: C.muted2 }}>{item.nRecords}×</div>
                                      {item.nRecords > 1 && savings > 0 && (
                                        <div style={{ color: C.green, fontSize: 10, marginTop: 2 }}>-{savingsPct}%</div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ─── COMPARE TAB ─── */}
          {tab === "compare" && (
            <div>
              <input style={{ ...s.input, marginBottom: 20 }} value={compareSearch} onChange={e => setCompareSearch(e.target.value)} placeholder="🔍 Buscar produto para comparar..." />
              {compareData.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
                  <div style={{ fontSize: 14, marginBottom: 8 }}>Nenhuma comparação disponível ainda.</div>
                  <div style={{ fontSize: 12 }}>Adicione o mesmo produto (mesmo nome) comprado em supermercados ou marcas diferentes.</div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
                  {compareData.map(({ name, category, lines }) => {
                    const diff = lines[lines.length - 1].unitPrice - lines[0].unitPrice;
                    const pct = lines[lines.length - 1].unitPrice > 0
                      ? ((diff / lines[lines.length - 1].unitPrice) * 100).toFixed(0)
                      : 0;
                    return (
                      <div key={name} style={{ ...s.card, borderColor: C.accent + "33" }}>
                        <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 15 }}>{name}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>{category}</div>
                        {/* header row */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 6, padding: "0 4px" }}>
                          {["Supermercado","Marca","Preço/Unid"].map(h => (
                            <div key={h} style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.8px", color: C.muted, fontWeight: 700 }}>{h}</div>
                          ))}
                        </div>
                        <div style={{ display: "grid", gap: 5 }}>
                          {lines.map((line, i) => {
                            const isBest  = i === 0;
                            const isWorst = i === lines.length - 1 && lines.length > 1;
                            return (
                              <div key={line.market + line.brand + i} style={{
                                display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, alignItems: "center",
                                padding: "8px 10px", borderRadius: 8,
                                background: isBest ? C.accent + "10" : isWorst ? C.red + "10" : C.surface2,
                                border: `1px solid ${isBest ? C.accent + "30" : isWorst ? C.red + "30" : C.border}`,
                              }}>
                                <span style={{ fontSize: 12, color: C.muted2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {isBest ? "🏆 " : isWorst ? "💸 " : ""}{line.market}
                                </span>
                                <span style={{ fontSize: 12, color: C.muted2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {line.brand || <span style={{ color: C.muted }}>—</span>}
                                </span>
                                <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, fontWeight: 700, color: isBest ? C.accent : isWorst ? C.red : C.text, textAlign: "right" }}>
                                  {fmtUnit(line.unitPrice, line.unitLabel)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        {diff > 0 && (
                          <div style={{ marginTop: 10, fontSize: 11, color: C.muted2, display: "flex", justifyContent: "space-between" }}>
                            <span>Economia potencial</span>
                            <span><strong style={{ color: C.accent }}>{fmt(diff)}</strong> <span style={{ color: C.muted }}>({pct}%)</span></span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ─── RECEIPTS TAB ─── */}
          {tab === "receipts" && (
            <div style={{ display: "grid", gap: 10 }}>
              {db.receipts.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>🧾</div><div>Nenhuma nota fiscal salva ainda.</div>
                </div>
              ) : [...db.receipts].reverse().map((r) => {
                const total = r.items.reduce((s, i) => s + i.price, 0);
                const isOpen = expandedReceiptId === r.id;
                // editingEntries[r.id] holds mutable copy; fall back to saved items
                const editItems = editingEntries[r.id] || r.items.map(entry => {
                  const prod = db.products[entry.productKey] || {};
                  return { ...entry, name: prod.name || "", brand: prod.brand || "", category: prod.category || "", type: prod.type || "embalagem", qty: prod.qty || entry.qty || 1, unit: prod.unit || entry.unit || "un" };
                });

                const setEntryField = (idx, field, value) => {
                  setEditingEntries(prev => {
                    const arr = [...(prev[r.id] || editItems)];
                    arr[idx] = { ...arr[idx], [field]: value };
                    // recalc unitPrice when price/qty/unit/qty_packs changes
                    if (["price","qty","unit","qty_packs"].includes(field)) {
                      const ei = arr[idx];
                      const totalQty = (ei.qty || 1) * (ei.qty_packs || 1);
                      const { up, label } = calcUnitPrice(ei.price, totalQty, ei.unit);
                      arr[idx] = { ...arr[idx], unitPrice: up, unitLabel: label };
                    }
                    // autocomplete by name
                    if (field === "name") {
                      const match = Object.values(db.products).find(p => p.name.toLowerCase() === value.toLowerCase());
                      if (match) arr[idx] = { ...arr[idx], brand: match.brand || arr[idx].brand, category: match.category || arr[idx].category, type: match.type || arr[idx].type, qty: match.qty || arr[idx].qty, unit: match.unit || arr[idx].unit };
                    }
                    return { ...prev, [r.id]: arr };
                  });
                };

                const saveEdits = () => {
                  const edits = editingEntries[r.id];
                  const metaEdits = editingMeta[r.id];
                  const newDB = { ...db, products: { ...db.products }, entries: [...db.entries], receipts: [...db.receipts] };
                  const newMarket = metaEdits?.market ?? r.market;
                  const newDate   = metaEdits?.date   ?? r.date;

                  if (edits) {
                    edits.forEach(entry => {
                      const key = entry.productKey;
                      if (newDB.products[key]) {
                        newDB.products[key] = { ...newDB.products[key], name: entry.name, brand: entry.brand, category: entry.category, type: entry.type, qty: entry.qty, unit: entry.unit };
                      }
                    });
                    const receiptEntryKeys = r.items.map(e => e.productKey + e.market + e.date);
                    newDB.entries = newDB.entries.map(e => {
                      const k = e.productKey + e.market + e.date;
                      const idx = receiptEntryKeys.indexOf(k);
                      if (idx >= 0 && edits[idx]) {
                        return { ...e, ...edits[idx], market: newMarket, date: newDate };
                      }
                      return e;
                    });
                  } else if (metaEdits) {
                    // only market/date changed — update entries
                    const receiptEntryKeys = new Set(r.items.map(e => e.productKey + e.market + e.date));
                    newDB.entries = newDB.entries.map(e => {
                      if (receiptEntryKeys.has(e.productKey + e.market + e.date)) {
                        return { ...e, market: newMarket, date: newDate };
                      }
                      return e;
                    });
                  }

                  const rIdx = newDB.receipts.findIndex(x => x.id === r.id);
                  if (rIdx >= 0) {
                    newDB.receipts[rIdx] = {
                      ...newDB.receipts[rIdx],
                      market: newMarket,
                      date: newDate,
                      ...(edits ? { items: edits } : {}),
                    };
                  }
                  persist(newDB);
                  setEditingEntries(prev => { const n = {...prev}; delete n[r.id]; return n; });
                  setEditingMeta(prev => { const n = {...prev}; delete n[r.id]; return n; });
                  showToast("Nota atualizada!");
                };

                const deleteReceipt = () => {
                  if (!confirm("Excluir esta nota? Os itens serão removidos do histórico de preços.")) return;
                  const newDB = {
                    ...db,
                    // remove all entries that belong to this receipt by receiptId
                    entries: db.entries.filter(e => e.receiptId !== r.id),
                    receipts: db.receipts.filter(x => x.id !== r.id),
                    products: { ...db.products },
                  };
                  // decrement product counts
                  r.items.forEach(entry => {
                    if (newDB.products[entry.productKey]) {
                      newDB.products[entry.productKey] = {
                        ...newDB.products[entry.productKey],
                        count: Math.max(0, (newDB.products[entry.productKey].count || 1) - 1),
                      };
                    }
                  });
                  persist(newDB);
                  setExpandedReceiptId(null);
                  showToast("Nota excluída.");
                };

                const allNames = [...new Set(Object.values(db.products).map(p => p.name))];
                const allBrands = [...new Set(Object.values(db.products).map(p => p.brand).filter(Boolean))];
                const allCats = [...new Set(Object.values(db.products).map(p => p.category).filter(Boolean))];
                const meta = editingMeta[r.id] || { market: r.market, date: r.date };
                const setMeta = (field, value) => setEditingMeta(prev => ({ ...prev, [r.id]: { ...(prev[r.id] || { market: r.market, date: r.date }), [field]: value } }));
                const hasMetaEdits = !!editingMeta[r.id];
                const hasEdits = !!editingEntries[r.id] || hasMetaEdits;

                return (
                  <div key={r.id} style={{ ...s.card, padding: 0, overflow: "hidden", border: `1px solid ${isOpen ? C.accent + "44" : C.border}`, transition: "border-color .2s" }}>
                    {/* Header row */}
                    <div
                      onClick={() => setExpandedReceiptId(isOpen ? null : r.id)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", cursor: "pointer", background: isOpen ? C.accent + "06" : "transparent", transition: "background .15s" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 14, transition: "transform .2s", display: "inline-block", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", color: C.muted }}>▶</span>
                        <div>
                          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14 }}>🏪 {r.market}</div>
                          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                            {new Date(r.date + "T12:00:00").toLocaleDateString("pt-BR")} · {r.items.length} itens
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, color: C.accent }}>{fmt(total)}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>total</div>
                      </div>
                    </div>

                    {/* Expanded body */}
                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${C.border}`, padding: "16px 18px" }}>

                        {/* Editable meta: market + date */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18, padding: "14px 16px", background: C.surface2, borderRadius: 10, border: `1px solid ${C.border}` }}>
                          <div>
                            <label style={s.label}>Supermercado</label>
                            <input
                              value={meta.market}
                              onChange={e => setMeta("market", e.target.value)}
                              list={`markets-${r.id}`}
                              style={{ ...s.input }}
                              onClick={e => e.stopPropagation()}
                            />
                            <datalist id={`markets-${r.id}`}>{markets.map(m => <option key={m} value={m} />)}</datalist>
                          </div>
                          <DateInput
                            label="Data"
                            value={meta.date}
                            onChange={v => setMeta("date", v)}
                          />
                        </div>

                        <div style={{ fontSize: 11, color: C.muted2, marginBottom: 10 }}>
                          Clique em qualquer célula para editar. Autocomplete ativo para produtos já cadastrados.
                        </div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead><tr>
                              {["Produto","Marca","Cat.","Tipo","Qtd","Un","Embal.","Preço Total","Preço/Unid",""].map(h => <th key={h} style={s.th}>{h}</th>)}
                            </tr></thead>
                            <tbody>
                              {editItems.map((entry, idx) => {
                                const { up, label } = calcUnitPrice(entry.price, (entry.qty||1)*(entry.qty_packs||1), entry.unit);

                                const cell = (field, val, listId, listOpts, type="text", w=100) => (
                                  <td style={{ ...s.td, padding: "3px 5px" }}>
                                    {listId && <datalist id={`re-${r.id}-${idx}-${listId}`}>{listOpts.map(o=><option key={o} value={o}/>)}</datalist>}
                                    <input
                                      type={type}
                                      value={val ?? ""}
                                      list={listId ? `re-${r.id}-${idx}-${listId}` : undefined}
                                      onChange={e => setEntryField(idx, field, type==="number" ? parseFloat(e.target.value)||0 : e.target.value)}
                                      style={{ ...s.input, width: w, padding: "4px 6px", fontSize: 12, fontFamily: type==="number"?"'Space Mono',monospace":"inherit", background: C.surface3, border: `1px solid ${C.border}` }}
                                    />
                                  </td>
                                );

                                return (
                                  <tr key={idx} style={{ borderBottom: `1px solid ${C.border}22` }}>
                                    {cell("name",      entry.name,       "n",  allNames,  "text",   140)}
                                    {cell("brand",     entry.brand||"",  "b",  allBrands, "text",   100)}
                                    {cell("category",  entry.category||"","c", allCats,   "text",   90)}
                                    <td style={{ ...s.td, padding: "3px 5px" }}>
                                      <select value={entry.type||"embalagem"} onChange={e=>setEntryField(idx,"type",e.target.value)}
                                        style={{ ...s.input, width: 100, padding: "4px 6px", fontSize: 12 }}>
                                        <option value="embalagem">Embalagem</option>
                                        <option value="granel">Granel</option>
                                        <option value="unidade">Unidade</option>
                                      </select>
                                    </td>
                                    {cell("qty",       entry.qty||"",    null, [], "number", 60)}
                                    <td style={{ ...s.td, padding: "3px 5px" }}>
                                      <select value={entry.unit||"un"} onChange={e=>setEntryField(idx,"unit",e.target.value)}
                                        style={{ ...s.input, width: 60, padding: "4px 6px", fontSize: 12 }}>
                                        {["g","kg","ml","l","un"].map(u=><option key={u} value={u}>{u}</option>)}
                                      </select>
                                    </td>
                                    {cell("qty_packs", entry.qty_packs||1,null,[],  "number", 50)}
                                    {cell("price",     entry.price||"",  null, [], "number", 75)}
                                    <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 12, color: C.accent, whiteSpace: "nowrap" }}>
                                      {fmtUnit(up, label)}
                                    </td>
                                    <td style={{ ...s.td, padding: "3px 5px" }}>
                                      <button style={{ ...s.btn("danger"), padding: "3px 7px", fontSize: 10 }}
                                        onClick={() => setEditingEntries(prev => {
                                          const arr = [...(prev[r.id] || editItems)];
                                          arr.splice(idx, 1);
                                          return { ...prev, [r.id]: arr };
                                        })}>✕</button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "space-between" }}>
                          <button style={s.btn("danger")} onClick={deleteReceipt}>🗑 Excluir Nota</button>
                          <div style={{ display: "flex", gap: 8 }}>
                            {hasEdits && <button style={s.btn("ghost")} onClick={() => {
                              setEditingEntries(prev => { const n={...prev}; delete n[r.id]; return n; });
                              setEditingMeta(prev => { const n={...prev}; delete n[r.id]; return n; });
                            }}>↩ Descartar</button>}
                            {hasEdits && <button className="btn-hover" style={s.btn("primary")} onClick={saveEdits}>💾 Salvar Edições</button>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ─── PRODUCTS TAB ─── */}
          {tab === "products" && (() => {
            const allNames   = [...new Set(Object.values(db.products).map(p => p.name))];
            const allBrands  = [...new Set(Object.values(db.products).map(p => p.brand).filter(Boolean))];
            const allCats    = [...new Set(Object.values(db.products).map(p => p.category).filter(Boolean))];
            const allMarkets = [...new Set(db.receipts.map(r => r.market))];

            // Build flat rows with original entry index so we can save back
            const rows = db.entries.map((e, entryIndex) => {
              const p = db.products[e.productKey] || {};
              return {
                entryIndex,
                productKey: e.productKey,
                date: e.date,
                market: e.market,
                name: p.name || e.productKey,
                brand: p.brand || "",
                category: p.category || "",
                type: p.type || "",
                qty: e.qty,
                unit: e.unit,
                qty_packs: e.qty_packs || 1,
                price: e.price,
                unitPrice: e.unitPrice,
                unitLabel: e.unitLabel,
              };
            });

            const q = productSearch.toLowerCase();
            const filtered = rows.filter(r =>
              !q ||
              r.name.toLowerCase().includes(q) ||
              r.brand.toLowerCase().includes(q) ||
              r.market.toLowerCase().includes(q) ||
              r.category.toLowerCase().includes(q)
            );

            const { col, dir } = productSort;
            const sorted = [...filtered].sort((a, b) => {
              let av = a[col], bv = b[col];
              if (col === "date") { av = av || ""; bv = bv || ""; }
              if (typeof av === "number") return dir === "asc" ? av - bv : bv - av;
              return dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
            });

            const toggleSort = (c) => setProductSort(prev =>
              prev.col === c ? { col: c, dir: prev.dir === "asc" ? "desc" : "asc" } : { col: c, dir: "asc" }
            );

            const openEdit = (row) => {
              setEditingRowIdx(row.entryIndex);
              setRowEditForm({ ...row });
            };

            const setREF = (k, v) => setRowEditForm(f => {
              const next = { ...f, [k]: v };
              // recalc unit price live
              if (["price","qty","unit","qty_packs"].includes(k)) {
                const totalQty = (parseFloat(next.qty)||1) * (parseInt(next.qty_packs)||1);
                const { up, label } = calcUnitPrice(parseFloat(next.price)||0, totalQty, next.unit);
                next.unitPrice = up; next.unitLabel = label;
              }
              // autocomplete by name
              if (k === "name") {
                const match = Object.values(db.products).find(p => p.name.toLowerCase() === v.toLowerCase());
                if (match) { next.brand = match.brand || next.brand; next.category = match.category || next.category; next.type = match.type || next.type; next.qty = match.qty || next.qty; next.unit = match.unit || next.unit; }
              }
              return next;
            });

            const saveRow = () => {
              const f = rowEditForm;
              const newDB = { ...db, entries: [...db.entries], products: { ...db.products } };
              // update entry
              const totalQty = (parseFloat(f.qty)||1) * (parseInt(f.qty_packs)||1);
              const { up, label } = calcUnitPrice(parseFloat(f.price)||0, totalQty, f.unit);
              newDB.entries[f.entryIndex] = {
                ...newDB.entries[f.entryIndex],
                market: f.market, date: f.date,
                price: parseFloat(f.price)||0,
                qty: parseFloat(f.qty)||1,
                unit: f.unit, qty_packs: parseInt(f.qty_packs)||1,
                unitPrice: up, unitLabel: label,
              };
              // update product metadata
              const key = f.productKey;
              if (newDB.products[key]) {
                newDB.products[key] = { ...newDB.products[key], name: f.name, brand: f.brand, category: f.category, type: f.type, qty: parseFloat(f.qty)||1, unit: f.unit };
              }
              persist(newDB);
              setEditingRowIdx(null);
              showToast("Compra atualizada!");
            };

            const deleteRow = (entryIndex) => {
              if (!confirm("Remover esta compra do histórico?")) return;
              const newDB = { ...db, entries: db.entries.filter((_, i) => i !== entryIndex) };
              persist(newDB);
              if (editingRowIdx === entryIndex) setEditingRowIdx(null);
              showToast("Compra removida.");
            };

            const SortTh = ({ col: c, label, align = "left" }) => {
              const active = productSort.col === c;
              return (
                <th onClick={() => toggleSort(c)} style={{ ...s.th, cursor: "pointer", textAlign: align, userSelect: "none", color: active ? C.accent : C.muted, whiteSpace: "nowrap" }}>
                  {label} <span style={{ opacity: active ? 1 : 0.3 }}>{active ? (productSort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
                </th>
              );
            };

            // shared input style for edit row
            const ei = { ...s.input, padding: "4px 6px", fontSize: 12, background: C.surface3, border: `1px solid ${C.accent}44` };

            return (
              <div>
                <input style={{ ...s.input, marginBottom: 16 }} value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="🔍 Buscar por produto, marca, supermercado..." />
                {sorted.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>📦</div>
                    <div>{db.entries.length === 0 ? "Nenhuma compra registrada." : "Nenhum resultado."}</div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
                      {sorted.length} registro{sorted.length !== 1 ? "s" : ""} — clique ✏️ para editar · cabeçalhos para ordenar
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <th style={{ ...s.th, width: 32 }} />
                            <SortTh col="date"      label="Data" />
                            <SortTh col="market"    label="Supermercado" />
                            <SortTh col="name"      label="Produto" />
                            <SortTh col="brand"     label="Marca" />
                            <SortTh col="category"  label="Categoria" />
                            <SortTh col="type"      label="Tipo" />
                            <SortTh col="qty"       label="Qtd" align="right" />
                            <SortTh col="qty_packs" label="Embal." align="right" />
                            <SortTh col="price"     label="Total" align="right" />
                            <SortTh col="unitPrice" label="Preço/Unid" align="right" />
                            <th style={s.th} />
                          </tr>
                        </thead>
                        <tbody>
                          {sorted.map((r) => {
                            const isEditing = editingRowIdx === r.entryIndex;
                            const f = rowEditForm;

                            if (isEditing) {
                              const { up: liveUp, label: liveLabel } = calcUnitPrice(parseFloat(f.price)||0, (parseFloat(f.qty)||1)*(parseInt(f.qty_packs)||1), f.unit);
                              return (
                                <tr key={r.entryIndex} style={{ background: C.accent + "08", borderBottom: `1px solid ${C.accent}33` }}>
                                  <td style={{ ...s.td, padding: "6px 4px" }}>
                                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent, margin: "0 auto" }} />
                                  </td>
                                  {/* date */}
                                  <td style={{ ...s.td, padding: "4px 5px" }}>
                                    <input type="date" value={f.date||""} onChange={e => setREF("date", e.target.value)} style={{ ...ei, width: 130, colorScheme: "dark" }} />
                                  </td>
                                  {/* market */}
                                  <td style={{ ...s.td, padding: "4px 5px" }}>
                                    <input value={f.market||""} onChange={e => setREF("market", e.target.value)} list="re-markets" style={{ ...ei, width: 120 }} />
                                    <datalist id="re-markets">{allMarkets.map(m => <option key={m} value={m}/>)}</datalist>
                                  </td>
                                  {/* name */}
                                  <td style={{ ...s.td, padding: "4px 5px" }}>
                                    <input value={f.name||""} onChange={e => setREF("name", e.target.value)} list="re-names" style={{ ...ei, width: 140 }} />
                                    <datalist id="re-names">{allNames.map(n => <option key={n} value={n}/>)}</datalist>
                                  </td>
                                  {/* brand */}
                                  <td style={{ ...s.td, padding: "4px 5px" }}>
                                    <input value={f.brand||""} onChange={e => setREF("brand", e.target.value)} list="re-brands" style={{ ...ei, width: 100 }} />
                                    <datalist id="re-brands">{allBrands.map(b => <option key={b} value={b}/>)}</datalist>
                                  </td>
                                  {/* category */}
                                  <td style={{ ...s.td, padding: "4px 5px" }}>
                                    <input value={f.category||""} onChange={e => setREF("category", e.target.value)} list="re-cats" style={{ ...ei, width: 90 }} />
                                    <datalist id="re-cats">{allCats.map(c => <option key={c} value={c}/>)}</datalist>
                                  </td>
                                  {/* type */}
                                  <td style={{ ...s.td, padding: "4px 5px" }}>
                                    <select value={f.type||"embalagem"} onChange={e => setREF("type", e.target.value)} style={{ ...ei, width: 100 }}>
                                      <option value="embalagem">Embalagem</option>
                                      <option value="granel">Granel</option>
                                      <option value="unidade">Unidade</option>
                                    </select>
                                  </td>
                                  {/* qty */}
                                  <td style={{ ...s.td, padding: "4px 5px", textAlign: "right" }}>
                                    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                                      <input type="number" value={f.qty||""} onChange={e => setREF("qty", e.target.value)} style={{ ...ei, width: 60, fontFamily: "'Space Mono',monospace", textAlign: "right" }} />
                                      <select value={f.unit||"g"} onChange={e => setREF("unit", e.target.value)} style={{ ...ei, width: 55 }}>
                                        {["g","kg","ml","l","un"].map(u => <option key={u} value={u}>{u}</option>)}
                                      </select>
                                    </div>
                                  </td>
                                  {/* qty_packs */}
                                  <td style={{ ...s.td, padding: "4px 5px", textAlign: "right" }}>
                                    <input type="number" value={f.qty_packs||1} onChange={e => setREF("qty_packs", e.target.value)} style={{ ...ei, width: 50, fontFamily: "'Space Mono',monospace", textAlign: "right" }} />
                                  </td>
                                  {/* price */}
                                  <td style={{ ...s.td, padding: "4px 5px", textAlign: "right" }}>
                                    <input type="number" value={f.price||""} onChange={e => setREF("price", e.target.value)} step="0.01" style={{ ...ei, width: 75, fontFamily: "'Space Mono',monospace", textAlign: "right" }} />
                                  </td>
                                  {/* live unit price */}
                                  <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 12, textAlign: "right", color: C.accent }}>
                                    {fmtUnit(liveUp, liveLabel)}
                                  </td>
                                  {/* actions */}
                                  <td style={{ ...s.td, padding: "4px 5px" }}>
                                    <div style={{ display: "flex", gap: 4 }}>
                                      <button style={{ ...s.btn("primary"), padding: "4px 10px", fontSize: 11 }} onClick={saveRow}>✓</button>
                                      <button style={{ ...s.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={() => setEditingRowIdx(null)}>✕</button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }

                            return (
                              <tr key={r.entryIndex} className="row-hover">
                                <td style={{ ...s.td, padding: "6px 4px", textAlign: "center" }}>
                                  <button
                                    onClick={() => openEdit(r)}
                                    title="Editar"
                                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: C.muted, padding: 2, borderRadius: 4, transition: "color .15s" }}
                                    onMouseEnter={e => e.target.style.color = C.accent}
                                    onMouseLeave={e => e.target.style.color = C.muted}
                                  >✏️</button>
                                </td>
                                <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 11, whiteSpace: "nowrap", color: C.muted2 }}>
                                  {r.date ? new Date(r.date + "T12:00:00").toLocaleDateString("pt-BR") : "—"}
                                </td>
                                <td style={{ ...s.td, fontSize: 12, whiteSpace: "nowrap" }}>{r.market || "—"}</td>
                                <td style={s.td}><strong style={{ fontSize: 13 }}>{r.name}</strong></td>
                                <td style={{ ...s.td, fontSize: 12, color: C.muted2 }}>{r.brand || "—"}</td>
                                <td style={{ ...s.td, fontSize: 12, color: C.muted2 }}>{r.category || "—"}</td>
                                <td style={s.td}>
                                  <span style={s.badge(r.type === "granel" ? C.green : r.type === "unidade" ? C.yellow : C.accent)}>
                                    {r.type || "—"}
                                  </span>
                                </td>
                                <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 11, textAlign: "right" }}>{r.qty} {r.unit}</td>
                                <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 11, textAlign: "right" }}>{r.qty_packs}</td>
                                <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 12, textAlign: "right" }}>{fmt(r.price)}</td>
                                <td style={{ ...s.td, fontFamily: "'Space Mono',monospace", fontSize: 12, textAlign: "right", color: C.accent }}>
                                  {r.unitPrice ? fmtUnit(r.unitPrice, r.unitLabel) : "—"}
                                </td>
                                <td style={{ ...s.td, padding: "6px 4px", textAlign: "center" }}>
                                  <button
                                    onClick={() => deleteRow(r.entryIndex)}
                                    title="Remover"
                                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.muted, padding: 2, borderRadius: 4, transition: "color .15s" }}
                                    onMouseEnter={e => e.target.style.color = C.red}
                                    onMouseLeave={e => e.target.style.color = C.muted}
                                  >🗑</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* ─── MERGE TAB ─── */}
          {tab === "merge" && (() => {
            const allProds = Object.values(db.products);

            const norm = str => str.toLowerCase().trim().replace(/\s+/g, " ");
            const similarity = (a, b) => {
              a = norm(a); b = norm(b);
              if (a === b) return 1;
              const trigrams = str => { const t = new Set(); for (let i = 0; i < str.length - 2; i++) t.add(str.slice(i, i+3)); return t; };
              const ta = trigrams(a), tb = trigrams(b);
              const inter = [...ta].filter(x => tb.has(x)).length;
              const union = new Set([...ta, ...tb]).size;
              return union === 0 ? 0 : inter / union;
            };

            const suggestions = [];
            const seen = new Set();
            for (let i = 0; i < allProds.length; i++) {
              for (let j = i + 1; j < allProds.length; j++) {
                const a = allProds[i], b = allProds[j];
                // Skip if both have brands and they differ — different products, not duplicates
                const aBrand = norm(a.brand || "");
                const bBrand = norm(b.brand || "");
                if (aBrand && bBrand && aBrand !== bBrand) continue;
                const score = similarity(a.name, b.name);
                if (score >= 0.4) {
                  const pairKey = [a.key, b.key].sort().join("||");
                  if (!seen.has(pairKey)) { seen.add(pairKey); suggestions.push({ a, b, score }); }
                }
              }
            }
            suggestions.sort((x, y) => y.score - x.score);

            const q = mergeSearch.toLowerCase();
            const filteredProds = allProds.filter(p => !q || norm(p.name).includes(q) || norm(p.brand||"").includes(q));

            const toggleSelect = (key) => {
              setMergeSelected(prev => {
                const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
                // pre-fill name from first selected
                if (next.length > 0) {
                  const first = db.products[next[0]];
                  if (first) setMergeFinal({ name: first.name });
                }
                return next;
              });
            };

            const doMerge = () => {
              if (mergeSelected.length < 2) { showToast("Selecione pelo menos 2 produtos.", "error"); return; }
              const finalName = mergeFinal.name.trim();
              if (!finalName) { showToast("Informe o nome final.", "error"); return; }

              const newProducts = { ...db.products };
              const newKeys = {}; // oldKey → newKey
              const changed = [];

              // Pass 1: rename each product, keep brand intact
              mergeSelected.forEach(oldKey => {
                const p = db.products[oldKey];
                if (!p) return;
                const newKey = productKey(finalName, p.brand);
                newKeys[oldKey] = newKey;
                if (newKey !== oldKey) changed.push(`"${p.name}" → "${finalName}"`);
                if (!newProducts[newKey] || newKey === oldKey) {
                  newProducts[newKey] = { ...p, key: newKey, name: finalName };
                } else {
                  newProducts[newKey] = { ...newProducts[newKey], count: (newProducts[newKey].count||0) + (p.count||0) };
                }
              });

              // Pass 2: delete old keys that changed
              mergeSelected.forEach(oldKey => {
                const newKey = newKeys[oldKey];
                if (newKey && newKey !== oldKey) delete newProducts[oldKey];
              });

              const newDB = {
                ...db,
                products: newProducts,
                entries: db.entries.map(e => newKeys[e.productKey] ? { ...e, productKey: newKeys[e.productKey] } : e),
                receipts: db.receipts.map(r => ({ ...r, items: r.items.map(item => newKeys[item.productKey] ? { ...item, productKey: newKeys[item.productKey] } : item) })),
              };

              persist(newDB);
              setMergeSelected([]);
              setMergeFinal({ name: "" });
              if (changed.length > 0) {
                showToast(`✅ Renomeados: ${changed.join(", ")}`);
              } else {
                showToast(`✅ ${mergeSelected.length} produtos já com o nome "${finalName}" — nenhuma alteração necessária.`);
              }
            };

            const pct = n => Math.round(n * 100);

            return (
              <div style={{ display: "grid", gap: 20 }}>

                {/* Auto-detected suggestions */}
                {suggestions.length > 0 && (
                  <div style={s.card}>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, marginBottom: 4 }}>🤖 Possíveis duplicatas detectadas</div>
                    <div style={{ fontSize: 12, color: C.muted2, marginBottom: 14 }}>Clique em "Selecionar ambos" para pré-selecionar e mesclar.</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {suggestions.map(({ a, b, score }) => (
                        <div key={a.key+b.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 8, background: C.surface2, border: `1px solid ${C.border}`, gap: 12, flexWrap: "wrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700, fontSize: 13 }}>{a.name}</span>
                            {a.brand && <span style={{ fontSize: 11, color: C.muted2 }}>{a.brand}</span>}
                            <span style={{ color: C.muted, fontSize: 16 }}>↔</span>
                            <span style={{ fontWeight: 700, fontSize: 13 }}>{b.name}</span>
                            {b.brand && <span style={{ fontSize: 11, color: C.muted2 }}>{b.brand}</span>}
                            <span style={{ ...s.badge(score > 0.7 ? C.red : score > 0.55 ? C.yellow : C.accent), fontSize: 10 }}>
                              {pct(score)}% similar
                            </span>
                          </div>
                          <button style={{ ...s.btn("primary"), whiteSpace: "nowrap", flexShrink: 0 }}
                            onClick={() => {
                              setMergeSelected([a.key, b.key]);
                              setMergeFinal({ name: a.name, brand: a.brand||"", category: a.category||"", type: a.type||"embalagem", qty: String(a.qty||""), unit: a.unit||"g" });
                            }}>
                            Selecionar ambos
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {suggestions.length === 0 && mergeSelected.length === 0 && (
                  <div style={{ ...s.card, textAlign: "center", padding: "32px 20px" }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>✨</div>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, marginBottom: 6 }}>Nenhuma duplicata óbvia encontrada</div>
                    <div style={{ fontSize: 13, color: C.muted2 }}>Você ainda pode selecionar produtos manualmente abaixo para mesclar.</div>
                  </div>
                )}

                {/* Manual picker */}
                <div style={s.card}>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, marginBottom: 4 }}>📋 Selecionar manualmente</div>
                  <div style={{ fontSize: 12, color: C.muted2, marginBottom: 12 }}>Clique para selecionar 2 ou mais produtos a unificar.</div>
                  <input style={{ ...s.input, marginBottom: 12 }} value={mergeSearch} onChange={e => setMergeSearch(e.target.value)} placeholder="🔍 Filtrar produtos..." />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 6, maxHeight: 280, overflowY: "auto" }}>
                    {filteredProds.map(p => {
                      const selected = mergeSelected.includes(p.key);
                      const entryCount = db.entries.filter(e => e.productKey === p.key).length;
                      return (
                        <div key={p.key} onClick={() => toggleSelect(p.key)} style={{ padding: "8px 12px", borderRadius: 8, cursor: "pointer", border: `1px solid ${selected ? C.accent : C.border}`, background: selected ? C.accent+"12" : C.surface2, transition: "all .15s" }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: selected ? C.accent : C.text }}>{p.name}</div>
                          {p.brand && <div style={{ fontSize: 11, color: C.muted2 }}>{p.brand}</div>}
                          <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{entryCount} compra{entryCount !== 1 ? "s" : ""}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Merge form */}
                {mergeSelected.length >= 2 && (
                  <div style={{ ...s.card, border: `1px solid ${C.accent}44` }}>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, marginBottom: 4, color: C.accent }}>
                      🔀 {mergeSelected.length} produtos selecionados
                    </div>
                    <div style={{ fontSize: 12, color: C.muted2, marginBottom: 14 }}>
                      Apenas o <strong style={{ color: C.text }}>nome</strong> será alterado. Marca, embalagem, preços e histórico de cada compra são preservados.
                    </div>

                    {/* chips showing selected */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                      {mergeSelected.map(k => {
                        const p = db.products[k];
                        return p ? (
                          <div key={k} style={{ display: "flex", alignItems: "center", gap: 5, background: C.surface3, border: `1px solid ${C.accent}44`, borderRadius: 20, padding: "3px 10px 3px 8px", fontSize: 12 }}>
                            <span style={{ color: C.accent }}>✓</span>
                            <span>{p.name}</span>
                            {p.brand && <span style={{ color: C.muted2 }}>· {p.brand}</span>}
                            <button onClick={() => toggleSelect(k)} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 15, lineHeight: 1, padding: "0 0 0 4px" }}>×</button>
                          </div>
                        ) : null;
                      })}
                    </div>

                    <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
                      <div style={{ flex: 1 }}>
                        <label style={s.label}>Novo nome para todos ✱</label>
                        <input
                          style={{ ...s.input, borderColor: C.accent + "66", fontSize: 15 }}
                          value={mergeFinal.name || ""}
                          onChange={e => setMergeFinal({ name: e.target.value })}
                          placeholder="Ex: Biscoito Recheado"
                          autoFocus
                        />
                      </div>
                    </div>

                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 16, padding: "8px 12px", background: C.surface2, borderRadius: 8 }}>
                      ℹ️ Cada produto mantém sua marca e dados originais. Produtos com mesma marca serão automaticamente unificados no catálogo.
                    </div>

                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                      <button style={s.btn("ghost")} onClick={() => { setMergeSelected([]); setMergeFinal({ name: "" }); }}>✕ Cancelar</button>
                      <button className="btn-hover" style={s.btn("primary")} onClick={doMerge}>🔀 Renomear e mesclar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

        </div>
      </div>

      {/* MODAL */}
      <ItemModal item={modalItem} onConfirm={handleModalConfirm} onSkip={handleModalSkip} />

      {/* TOAST */}
      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}
