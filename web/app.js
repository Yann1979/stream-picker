// web/app.js
(() => {
  // Plateformes favorites FR : Netflix(8), Apple TV+(350), Prime(119), Canal+(381), HBO Max(1899), Paramount+(531)
  const FAVORITES = [8, 350, 119, 381, 1899, 531];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const providerCheckbox = (p) => `<label><input type="checkbox" value="${p.id}"> ${p.name}</label>`;

  function setupMoreToggle() {
    const btn = $("#toggleMore");
    const wrap = $("#moreWrap");
    wrap.style.display = "none";
    btn.addEventListener("click", () => {
      const open = wrap.style.display !== "none";
      wrap.style.display = open ? "none" : "block";
      btn.textContent = open ? "+ Afficher plus de plateformes" : "− Masquer les autres plateformes";
    });
  }

  async function loadProviders() {
    const favBox = $("#favProviders");
    const moreBox = $("#moreProviders");
    favBox.textContent = "Chargement…";
    const res = await fetch("/api/providers");
    const data = await res.json();

    const fav = data.providers.filter((p) => FAVORITES.includes(p.id));
    const others = data.providers.filter((p) => !FAVORITES.includes(p.id));

    favBox.innerHTML = fav.map(providerCheckbox).join("");
    moreBox.innerHTML = others.map(providerCheckbox).join("");

    // cocher les favorites par défaut
    $$("#favProviders input[type=checkbox]").forEach((el) => (el.checked = true));
  }

  async function loadGenres() {
    const type = $("input[name=type]:checked").value; // movie | tv
    const res = await fetch(`/api/genres?type=${type}`);
    const data = await res.json();
    $("#genres").innerHTML =
      `<option value="">Tous genres</option>` +
      (data.genres || [])
        .map((g) => `<option value="${g.id}">${g.name}</option>`)
        .join("");
  }

  function selectedProvidersCSV() {
    const ids = [
      ...$$("#favProviders input:checked").map((x) => x.value),
      ...$$("#moreProviders input:checked").map((x) => x.value),
    ];
    return ids.join("|");
  }

  async function search(page = 1) {
    const type = $("input[name=type]:checked").value; // movie | tv
    const genres = $("#genres").value || "";
    const prov = selectedProvidersCSV();

    const url =
      `/api/search?type=${type}` +
      `&page=${page}` +
      `&with_genres=${encodeURIComponent(genres)}` +
      `&with_watch_providers=${encodeURIComponent(prov)}`;

    const res = await fetch(url);
    const data = await res.json();
    renderList(data.results || []);
  }

  async function randomPick() {
    // Respecte le type sélectionné + plateformes cochées
    const type = $("input[name=type]:checked").value; // movie | tv
    const prov = selectedProvidersCSV();
    const url = `/api/random?type=${type}&with_watch_providers=${encodeURIComponent(prov)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data || !data.result) {
      $("#results").innerHTML = "<p>Aucune suggestion trouvée. Essaie d'autres plateformes.</p>";
      return;
    }
    renderList([data.result], { emphasize: true });
  }

  function renderList(list, opts = {}) {
    const zone = $("#results");
    if (!list || !list.length) {
      zone.innerHTML = "<p>Aucun résultat</p>";
      return;
    }
    zone.innerHTML = list
      .map(
        (r) => `
      <article data-type="${r.type}" data-id="${r.id}">
        <img src="${r.poster || ""}" alt="${r.title || ""}" loading="lazy">
        <div class="body">
          <div class="title">${r.title || ""}</div>
          ${r.rating ? `<div class="badge" style="width:max-content">${r.rating} ★</div>` : ""}
          <div class="desc">${r.overview ? r.overview : ""}</div>
          <div class="prov" data-prov></div>
        </div>
      </article>`
      )
      .join("");

    // Charger les providers FR par titre + lien cliquable
    $$("#results article").forEach(async (card) => {
      const type = card.dataset.type;
      const id = card.dataset.id;
      try {
        const res = await fetch(`/api/providers/${type}/${id}`);
        const p = await res.json();
        const box = $("[data-prov]", card);
        if (Array.isArray(p.flatrate) && p.flatrate.length) {
          box.innerHTML = p.flatrate
            .slice(0, 6)
            .map((pv) => `<img src="${pv.logo}" title="${pv.name}" alt="${pv.name}">`)
            .join("");
        } else {
          box.textContent = "Non dispo en abonnement";
        }
        const img = $("img", card);
        if (p.link) {
          img.style.cursor = "pointer";
          img.addEventListener("click", () => window.open(p.link, "_blank"));
        }
      } catch {}
    });

    if (opts.emphasize) {
      const first = $("#results article");
      if (first) first.style.outline = "2px solid #7c5cff";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupMoreToggle();
    loadProviders();
    loadGenres();
    $$("#filters input[name=type]").forEach((el) => el.addEventListener("change", loadGenres));
    $("#btnSearch").addEventListener("click", () => search(1));
    $("#btnRandom").addEventListener("click", randomPick); // ✅ pas de parenthèse en trop
  });
})();
