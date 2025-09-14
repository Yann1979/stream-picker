// web/app.js

const FAVORITES = [
  // IDs TMDB FR des plateformes favoris
  8,      // Netflix
  350,    // Apple TV+
  337,    // Disney+
  119,    // Amazon Prime Video
  381,    // Canal+
  531,    // Paramount+
  1899    // HBO Max
];

const state = {
  type: "movie",          // "movie" ou "tv"
  genres: [],             // liste des genres
  providers: [],          // liste FR
  selectedGenre: "",      // id de genre
  selectedProviders: new Set(FAVORITES), // par défaut: favoris cochés
};

const el = (sel) => document.querySelector(sel);
const els = (sel) => Array.from(document.querySelectorAll(sel));

// Init
window.addEventListener("DOMContentLoaded", async () => {
  await ensureHealth();
  await loadProviders();
  await loadGenres();
  bindUI();
  // Option: faire une première recherche auto si tu veux
  // doSearch();
});

async function ensureHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    el("#debugLine").textContent = `Région ${data.region} • Langue ${data.lang} • Token ${
      data.token_present ? "OK" : "❌"
    }`;
  } catch (e) {
    el("#debugLine").textContent = "Impossible de vérifier l'état du serveur.";
  }
}

async function loadProviders() {
  const res = await fetch("/api/providers");
  const data = await res.json();
  state.providers = data.providers || [];
  renderProviders();
}

async function loadGenres() {
  const res = await fetch(`/api/genres?type=${state.type}`);
  const data = await res.json();
  state.genres = data.genres || [];
  renderGenres();
}

function bindUI() {
  // Toggle type
  els("#typeSeg button").forEach((b) =>
    b.addEventListener("click", async () => {
      els("#typeSeg button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      state.type = b.dataset.type === "tv" ? "tv" : "movie";
      await loadGenres(); // recharge la liste de genres
      // Optionnel: vider résultats
      el("#results").innerHTML = "";
    })
  );

  // Toggle + de plateformes
  el("#toggleMore").addEventListener("click", () => {
    const more = el("#otherProviders");
    more.style.display = more.style.display === "none" ? "flex" : "none";
    el("#toggleMore").textContent =
      more.style.display === "none" ? "+ de plateformes" : "− masquer les plateformes";
  });

  // Bouton recherche
  el("#searchBtn").addEventListener("click", doSearch);

  // Sélecteur genre
  el("#genreSelect").addEventListener("change", (e) => {
    state.selectedGenre = e.target.value || "";
  });
}

function renderGenres() {
  const g = el("#genreSelect");
  g.innerHTML = `<option value="">Tous les genres</option>` + state.genres
    .map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`)
    .join("");
}

function renderProviders() {
  const favWrap = el("#favProviders");
  const otherWrap = el("#otherProviders");
  favWrap.innerHTML = "";
  otherWrap.innerHTML = "";

  const favs = [];
  const others = [];
  for (const p of state.providers) {
    if (FAVORITES.includes(p.id)) favs.push(p);
    else others.push(p);
  }

  const mkChip = (p) => {
    const checked = state.selectedProviders.has(p.id) ? "checked" : "";
    const logo = p.logo ? `<img src="${p.logo}" alt="">` : "";
    return `
      <label class="chip">
        <input type="checkbox" data-id="${p.id}" ${checked} />
        ${logo}<span>${escapeHtml(p.name)}</span>
      </label>`;
  };

  favWrap.innerHTML = favs.map(mkChip).join("");
  otherWrap.innerHTML = others.map(mkChip).join("");

  // Bind checkboxes
  els('.chip input[type="checkbox"]').forEach((inp) => {
    inp.addEventListener("change", (e) => {
      const id = Number(e.target.dataset.id);
      if (e.target.checked) state.selectedProviders.add(id);
      else state.selectedProviders.delete(id);
    });
  });
}

async function doSearch() {
  const providersCsv = Array.from(state.selectedProviders).join(",");
  const params = new URLSearchParams();
  params.set("type", state.type);
  if (state.selectedGenre) params.set("with_genres", state.selectedGenre);
  if (providersCsv) params.set("with_watch_providers", providersCsv);

  const url = `/api/search?${params.toString()}`;
  const res = await fetch(url);
  const data = await res.json();
  renderResults(data.results || []);
}

function renderResults(items) {
  const grid = el("#results");
  if (!items.length) {
    grid.innerHTML = `<div class="muted">Aucun résultat — essaie un autre genre ou ajoute des plateformes.</div>`;
    return;
  }
  grid.innerHTML = items
    .map((r) => {
      const img = r.poster || r.backdrop || "";
      const title = escapeHtml(r.title || "Sans titre");
      const rating = r.rating ? `<span class="badge">★ ${r.rating}</span>` : "";
      const overview = r.overview ? escapeHtml(r.overview) : "—";

      // 👉 On n'affiche PAS l'année/la date
      return `
        <article class="card">
          ${img ? `<img src="${img}" alt="${title}">` : ""}
          <div class="meta">
            <div class="title">${title}</div>
            <div class="desc">${overview}</div>
            <div class="actions">
              ${rating}
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
