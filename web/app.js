// web/app.js — Auto-cocher favoris par défaut, alias, messages d'erreur, openWatch

const $ = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

const form = $("#prefsForm");
const grid = $("#resultsGrid");
const emptyMsg = $("#emptyMsg");
const providersChips = $("#providersChips");
const errorBar = $("#errorBar");

const LS_KEY = "tmut:prefs:v6";
const LS_FAV = "tmut:favorites";
const LS_SEEN = "tmut:seen";

function loadSet(key){ try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set(); } }
function saveSet(key, set){ localStorage.setItem(key, JSON.stringify(Array.from(set))); }
const favs = loadSet(LS_FAV);
const seen = loadSet(LS_SEEN);

// ---------- Aliases & favoris ----------
const ALIASES = {
  "Amazon Prime Video": "Prime Video",
  "Prime Video": "Prime Video",
  "Disney Plus": "Disney+",
  "Disney+": "Disney+",
  "HBO Max": "HBO Max",
  "Max": "HBO Max",
  "Apple TV Plus": "Apple TV+",
  "Apple TV+": "Apple TV+",
  "Canal": "Canal+",
  "Canal+": "Canal+",
  "Paramount Plus": "Paramount+",
  "Paramount+": "Paramount+",
  "Netflix": "Netflix"
};

const FAVORITES = [
  "Netflix",
  "Apple TV+",
  "Disney+",
  "Prime Video",
  "Canal+",
  "Paramount+",
  "HBO Max"
];
const FAVORITES_SET = new Set(FAVORITES);

function canon(name){
  if (!name) return "";
  return ALIASES[name] || name;
}

// ---------- Providers dynamiques ----------
let ALL_PROVIDERS = []; // {name, ids[], logo}

async function loadProvidersUI() {
  if (!providersChips) return;
  providersChips.innerHTML = `<span class="muted">Chargement des plateformes…</span>`;
  try {
    const res = await fetch('/api/providers-list');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    ALL_PROVIDERS = (data.providers || []).map(p => ({...p, cname: canon(p.name)}));

    const favsArr = [];
    const others = [];
    for (const p of ALL_PROVIDERS) {
      (FAVORITES_SET.has(p.cname) ? favsArr : others).push(p);
    }
    favsArr.sort((a,b)=> FAVORITES.indexOf(a.cname) - FAVORITES.indexOf(b.cname));
    others.sort((a,b)=> a.name.localeCompare(b.name,'fr'));

    const renderChip = (p)=>`
      <label class="chip">
        <input type="checkbox" name="providers" value="${p.name}">
        ${p.logo ? `<img src="${p.logo}" alt="" width="18" height="18" style="border-radius:.2rem">` : ""} ${p.name}
      </label>`;

    providersChips.innerHTML = `
      <div class="fav-providers" style="display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.5rem">
        ${favsArr.map(renderChip).join("")}
      </div>
      <details>
        <summary class="chip" style="list-style:none;display:inline-flex;cursor:pointer">Autres plateformes</summary>
        <div style="margin-top:.5rem;display:flex;flex-wrap:wrap;gap:.5rem">
          ${others.map(renderChip).join("")}
        </div>
      </details>
    `;

    // Si aucune préférence existante, cocher par défaut tous les favoris et sauvegarder
    const saved = getSavedPrefs();
    const hasSavedProviders = Array.isArray(saved?.providers) && saved.providers.length > 0;

    const inputs = document.querySelectorAll(".chip input[name='providers']");
    if (!hasSavedProviders) {
      inputs.forEach(inp => {
        const cname = canon(inp.value);
        if (FAVORITES_SET.has(cname)) inp.checked = true;
      });
      const p = getPrefs();
      savePrefs(p);
    } else {
      inputs.forEach(inp => { inp.checked = saved.providers.includes(inp.value); });
    }
  } catch (err) {
    console.error("loadProvidersUI error:", err);
    providersChips.innerHTML = `<span class="muted">Impossible de charger les plateformes.</span>`;
  }
}

// ---------- Préférences ----------
function getSavedPrefs(){
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}
function getPrefs() {
  const providers = $$(".chip input[name='providers']:checked").map(i=>i.value);
  const genres = $$(".chip input[name='genres']:checked").map(i=>i.value);
  const type = form?.elements?.['type']?.value || 'film';
  const mood = form?.elements?.['mood']?.value || 'populaire';
  const duration = form?.elements?.['duration']?.value || '';
  const olang = form?.elements?.['olang']?.value || "any";
  const year_from = form?.elements?.['year_from']?.value || "";
  const year_to = form?.elements?.['year_to']?.value || "";
  return { providers, type, genres, mood, duration, olang, year_from, year_to };
}
function savePrefs(p){ localStorage.setItem(LS_KEY, JSON.stringify(p)); }
function loadPrefs(){
  const p = getSavedPrefs();
  if (!p) return;
  $$(".chip input[name='genres']").forEach(inp => inp.checked = p.genres?.includes(inp.value) || false);
  if (form?.elements?.['type'] && p.type) form.elements['type'].value = p.type;
  if (form?.elements?.['mood'] && p.mood) form.elements['mood'].value = p.mood;
  if (form?.elements?.['duration'] && p.duration) form.elements['duration'].value = p.duration;
  if (form?.elements?.['olang'] && p.olang) form.elements['olang'].value = p.olang;
  if (form?.elements?.['year_from'] && p.year_from) form.elements['year_from'].value = p.year_from;
  if (form?.elements?.['year_to'] && p.year_to) form.elements['year_to'].value = p.year_to;
}

// ---------- Cache providers par titre ----------
const providersCache = new Map();

function providerDeepLink(name, title) {
  const q = encodeURIComponent(title);
  const n = (name || "").toLowerCase();
  if (n.includes('netflix'))   return `https://www.netflix.com/search?q=${q}`;
  if (n.includes('prime') || n.includes('amazon')) return `https://www.primevideo.com/search?phrase=${q}`;
  if (n.includes('disney'))    return `https://www.disneyplus.com/search?q=${q}`;
  if (n.includes('canal'))     return `https://www.canalplus.com/recherche?query=${q}`;
  if (n.includes('paramount')) return `https://www.paramountplus.com/search/?q=${q}`;
  if (n.includes('apple'))     return `https://tv.apple.com/fr/search?term=${q}`;
  if (n === 'max' || n.includes('hbo')) return `https://play.max.com/search?q=${q}`;
  return null;
}

function showError(msg) {
  if (!errorBar) { console.error(msg); return; }
  errorBar.textContent = msg;
  errorBar.hidden = false;
}
function clearError() {
  if (!errorBar) return;
  errorBar.textContent = '';
  errorBar.hidden = true;
}

function render(results) {
  grid.innerHTML = "";
  if (!results.length) { emptyMsg.hidden = false; return; }
  emptyMsg.hidden = true;
  for (const r of results) {
    const id = `${r.type}-${r.id}`;
    const isFav = favs.has(id);
    const isSeen = seen.has(id);
    const el = document.createElement("article");
    el.className = "card";
    el.innerHTML = `
      <img class="card__media open-watch" src="${r.poster || ''}" alt="Affiche de ${r.title}" data-type="${r.type}" data-id="${r.id}" data-title="${r.title}">
      <div class="card__body">
        <h3 class="open-watch" data-type="${r.type}" data-id="${r.id}" data-title="${r.title}" style="cursor:pointer">${r.title}</h3>
        <div class="meta">${r.type} · ${r.year || "—"} · ⭐ ${r.rating?.toFixed?.(1) ?? "—"}</div>
        <div class="badges providers" data-type="${r.type}" data-id="${r.id}" hidden></div>
        <p class="muted">${r.overview ? r.overview.slice(0,140) + (r.overview.length>140 ? "…" : "") : ""}</p>
      </div>
      <div class="card__actions">
        <button class="btn mini open-watch" data-type="${r.type}" data-id="${r.id}" data-title="${r.title}">Regarder</button>
        <button class="btn btn--ghost mini show-providers" data-type="${r.type}" data-id="${r.id}">Plateformes</button>
        <button class="btn btn--ghost mini toggle fav-btn ${isFav ? "active":""}" data-id="${id}">${isFav ? "★ Favori" : "☆ Favori"}</button>
        <button class="btn btn--ghost mini toggle seen-btn ${isSeen ? "active":""}" data-id="${id}">${isSeen ? "✔ Déjà vu" : "Marquer vu"}</button>
      </div>`;
    grid.appendChild(el);
  }

  $$(".fav-btn", grid).forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (favs.has(id)) favs.delete(id); else favs.add(id);
      saveSet(LS_FAV, favs);
      btn.classList.toggle("active");
      btn.textContent = btn.classList.contains("active") ? "★ Favori" : "☆ Favori";
    });
  });
  $$(".seen-btn", grid).forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (seen.has(id)) seen.delete(id); else seen.add(id);
      saveSet(LS_SEEN, seen);
      btn.classList.toggle("active");
      btn.textContent = btn.classList.contains("active") ? "✔ Déjà vu" : "Marquer vu";
    });
  });
  $$(".show-providers", grid).forEach(btn => {
    btn.addEventListener("click", () => showProviders(btn.dataset.type, btn.dataset.id, btn.closest(".card")));
  });
  $$(".open-watch", grid).forEach(el => {
    el.addEventListener("click", () => openWatch(el.dataset.type, el.dataset.id, el.dataset.title));
  });
}

async function fetchProviders(type, id) {
  const key = `${type}-${id}`;
  if (providersCache.has(key)) return providersCache.get(key);
  const res = await fetch(`/api/providers/${encodeURIComponent(type)}/${id}`);
  if (!res.ok) throw new Error(`Providers HTTP ${res.status}`);
  const data = await res.json();
  providersCache.set(key, data);
  return data;
}

async function showProviders(type, id, cardEl) {
  const container = cardEl.querySelector(".providers");
  container.hidden = false;
  container.innerHTML = `<span class="badge">Chargement…</span>`;
  try {
    const data = await fetchProviders(type, id);
    const flat = data.flatrate || [];
    if (!flat.length) {
      container.innerHTML = `<span class="badge">Non dispo en abonnement (FR)</span>`;
    } else {
      container.innerHTML = flat.map(p =>
        `<span class="badge">${p.logo ? `<img src="${p.logo}" alt="" width="18" height="18">` : ""}${p.name}</span>`
      ).join("");
    }
  } catch (e) {
    container.innerHTML = `<span class="badge">Erreur de chargement</span>`;
  }
  container.scrollIntoView({behavior:"smooth", block:"nearest"});
}

async function openWatch(type, id, title) {
  try {
    const data = await fetchProviders(type, id);
    const flat = data.flatrate || [];
    if (flat.length) {
      const link = providerDeepLink(flat[0].name, title);
      if (link) { window.open(link, "_blank"); return; }
    }
    if (data.link) { window.open(data.link, "_blank"); return; }
    const q = encodeURIComponent(`${title} streaming`);
    window.open(`https://www.google.com/search?q=${q}`, "_blank");
  } catch {
    const q = encodeURIComponent(`${title} streaming`);
    window.open(`https://www.google.com/search?q=${q}`, "_blank");
  }
}

function savePrefsAndQuery(overrides) {
  const p = overrides || getPrefs();
  savePrefs(p);
  return query(p);
}

async function query(prefsOverride) {
  clearError();
  const p = prefsOverride || getPrefs();
  const qs = new URLSearchParams();
  qs.set("type", p.type);
  if (p.providers?.length) qs.set("providers", p.providers.join(","));
  if (p.genres?.length) qs.set("genres", p.genres.join(","));
  if (p.mood) qs.set("mood", p.mood);
  if (p.duration) qs.set("duration", p.duration);
  if (p.olang && p.olang !== "any") qs.set("original_language", p.olang);
  if (p.year_from) qs.set("year_from", p.year_from);
  if (p.year_to) qs.set("year_to", p.year_to);

  try {
    const res = await fetch(`/api/search?${qs.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      showError(data?.message || "Recherche indisponible (serveur).");
      render([]);
      return;
    }
    render(data.results || []);
    window.__lastQueryDebug = data.debug || null;
  } catch (e) {
    showError("Impossible d’atteindre le serveur.");
    render([]);
  }
}

// "J'ai X minutes"
document.addEventListener("click", (e) => {
  const b = e.target.closest(".chip--btn");
  if (!b) return;
  const mins = parseInt(b.dataset.mins, 10);
  if (mins <= 30) { form.elements['duration'].value = "court"; form.elements['type'].value = "série"; }
  else if (mins <= 60) { form.elements['duration'].value = "moyen"; form.elements['type'].value = "série"; }
  else if (mins >= 120) { form.elements['duration'].value = "long"; form.elements['type'].value = "film"; }
  savePrefsAndQuery();
});

$("#shuffleBtn")?.addEventListener("click", async () => {
  await savePrefsAndQuery();
  const cards = $$(".card", grid);
  if (cards.length) {
    const idx = Math.floor(Math.random() * Math.min(12, cards.length));
    cards[idx].scrollIntoView({ behavior: "smooth", block: "center" });
    cards[idx].classList.add("active");
    setTimeout(()=>cards[idx].classList.remove("active"), 1200);
  }
});

(function init(){
  const y = new Date().getFullYear();
  const span = document.querySelector("#year");
  if (span) span.textContent = y;

  loadProvidersUI()
    .then(() => { loadPrefs(); return query(); })
    .catch(() => { loadPrefs(); return query(); });

  form?.addEventListener("submit", (e)=>{ e.preventDefault(); savePrefsAndQuery(); });
  $("#resetBtn")?.addEventListener("click", ()=>{ 
    localStorage.removeItem(LS_KEY); 
    form?.reset(); 
    $$(".chip input:checked").forEach(i=>i.checked=false); 
    query(); 
  });
})();
