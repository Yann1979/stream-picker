// server/index.js — FR-only, robuste, recherche qui retombe en "sans filtres" si providers absents/vides
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'web')));

const TMDB_TOKEN = process.env.TMDB_BEARER_TOKEN || '';
const WATCH_REGION = (process.env.WATCH_REGION || 'FR').toUpperCase();
const LANG = process.env.LANG || 'fr-FR';
const IMG_BASE = 'https://image.tmdb.org/t/p/';

if (!TMDB_TOKEN) {
  console.error('❌ TMDB_BEARER_TOKEN manquant dans .env — les appels TMDB échoueront.');
}

const TMDB = {
  async get(pathname, params = {}) {
    const url = new URL(`https://api.themoviedb.org/3${pathname}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${TMDB_TOKEN}`,
        'Accept': 'application/json'
      }
    });
    if (!res.ok) {
      const text = await res.text().catch(()=> '');
      throw new Error(`${res.status} ${res.statusText} on ${url}\n${text}`);
    }
    return res.json();
  }
};

// ---------- Providers FR séparés par type (évite bugs Apple TV+) ----------
let MOVIE_PROVIDERS_BY_NAME = new Map();
let TV_PROVIDERS_BY_NAME = new Map();
let PROVIDERS_CACHE = null;

async function loadProvidersFR() {
  // Si pas de token, renvoyer une liste vide mais ne pas planter
  if (!TMDB_TOKEN) {
    MOVIE_PROVIDERS_BY_NAME = new Map();
    TV_PROVIDERS_BY_NAME = new Map();
    PROVIDERS_CACHE = { region: WATCH_REGION, providers: [] };
    return;
  }
  const [movie, tv] = await Promise.all([
    TMDB.get('/watch/providers/movie', { language: LANG, watch_region: WATCH_REGION }),
    TMDB.get('/watch/providers/tv',    { language: LANG, watch_region: WATCH_REGION })
  ]);

  function toMap(list) {
    const byName = new Map();
    for (const p of (list.results || [])) {
      const name = p.provider_name;
      const id   = p.provider_id;
      const logo = p.logo_path ? `${IMG_BASE}w45${p.logo_path}` : null;
      const existing = byName.get(name) || { name, ids: [], logo };
      if (!existing.ids.includes(id)) existing.ids.push(id);
      if (!existing.logo && logo) existing.logo = logo;
      byName.set(name, existing);
    }
    return byName;
  }

  MOVIE_PROVIDERS_BY_NAME = toMap(movie);
  TV_PROVIDERS_BY_NAME    = toMap(tv);

  // union pour l’UI
  const union = new Map();
  for (const m of MOVIE_PROVIDERS_BY_NAME.values()) union.set(m.name, { name:m.name, ids:[...m.ids], logo:m.logo });
  for (const t of TV_PROVIDERS_BY_NAME.values()) {
    if (!union.has(t.name)) union.set(t.name, { name:t.name, ids:[...t.ids], logo:t.logo });
    else {
      const u = union.get(t.name);
      for (const id of t.ids) if (!u.ids.includes(id)) u.ids.push(id);
      if (!u.logo && t.logo) u.logo = t.logo;
    }
  }
  const providers = Array.from(union.values()).sort((a,b)=>a.name.localeCompare(b.name,'fr'));
  PROVIDERS_CACHE = { region: WATCH_REGION, providers };
}

async function ensureProviders() {
  if (!PROVIDERS_CACHE) {
    try {
      await loadProvidersFR();
    } catch (e) {
      console.error('loadProvidersFR failed:', e.message);
      // Ne bloque pas la recherche : renvoie vide
      MOVIE_PROVIDERS_BY_NAME = new Map();
      TV_PROVIDERS_BY_NAME = new Map();
      PROVIDERS_CACHE = { region: WATCH_REGION, providers: [] };
    }
  }
}

// Health + debug
app.get('/api/health', async (req,res)=>{
  res.json({
    ok: true,
    region: WATCH_REGION,
    lang: LANG,
    token_present: Boolean(TMDB_TOKEN)
  });
});

// Liste pour l’UI
app.get('/api/providers-list', async (req, res) => {
  try {
    await ensureProviders();
    res.json(PROVIDERS_CACHE);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'providers_list_failed' });
  }
});

// Providers d’un titre (FR-only)
app.get('/api/providers/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  try {
    const data = await TMDB.get(`/${type}/${id}/watch/providers`);
    const fr = data.results?.[WATCH_REGION] || null;
    const mapEntry = (x) => x ? x.map(it => ({
      name: it.provider_name,
      logo: it.logo_path ? `${IMG_BASE}w45${it.logo_path}` : null
    })) : [];
    res.json({
      region: WATCH_REGION,
      link: fr?.link || null,
      flatrate: mapEntry(fr?.flatrate),
      buy: mapEntry(fr?.buy),
      rent: mapEntry(fr?.rent)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'providers_failed' });
  }
});

// Discover FR-only (robuste si providers vides -> pas de filtre providers)
function mapPoster(p){ return p ? `${IMG_BASE}w342${p}` : null; }
function mapBackdrop(p){ return p ? `${IMG_BASE}w780${p}` : null; }

function providerMapForType(type){
  return type === 'movie' ? MOVIE_PROVIDERS_BY_NAME : TV_PROVIDERS_BY_NAME;
}

function buildDiscoverParams(type, q) {
  const isMovie = type === 'movie';
  const params = {
    language: LANG,
    include_adult: 'false',
    sort_by: 'popularity.desc',
    page: q.page || '1',
    watch_region: WATCH_REGION,
    with_watch_monetization_types: 'flatrate'
  };

  // providers => UNIQUEMENT les IDs FR du type demandé
  const namesRaw = (q.providers || '').trim();
  if (namesRaw) {
    const byName = providerMapForType(type);
    const names = namesRaw.split(',').map(s=>s.trim()).filter(Boolean);
    const ids = [];
    for (const name of names) {
      const entry = byName.get(name);
      if (entry?.ids?.length) ids.push(...entry.ids);
    }
    if (ids.length) params.with_watch_providers = ids.join('|');
  }

  if (q.original_language && q.original_language !== 'any') {
    params.with_original_language = q.original_language;
  }
  if (q.year_from) params[isMovie ? 'primary_release_date.gte' : 'first_air_date.gte'] = `${q.year_from}-01-01`;
  if (q.year_to)   params[isMovie ? 'primary_release_date.lte' : 'first_air_date.lte'] = `${q.year_to}-12-31`;

  if (q.duration && isMovie) {
    if (q.duration === 'court') params['with_runtime.lte'] = '60';
    if (q.duration === 'moyen') { params['with_runtime.gte'] = '60'; params['with_runtime.lte'] = '120'; }
    if (q.duration === 'long')  params['with_runtime.gte'] = '120';
  }

  if (q.genres) params.with_genres = q.genres;

  return params;
}

function mapResult(type, item) {
  return {
    type,
    id: item.id,
    title: type === 'movie' ? item.title : item.name,
    overview: item.overview,
    poster: mapPoster(item.poster_path),
    backdrop: mapBackdrop(item.backdrop_path),
    year: (type === 'movie' ? item.release_date : item.first_air_date)?.slice(0,4) || null,
    rating: item.vote_average
  };
}

app.get('/api/search', async (req, res) => {
  try {
    await ensureProviders();
    const type = (req.query.type === 'série' || req.query.type === 'tv') ? 'tv' : 'movie';
    const params = buildDiscoverParams(type, req.query);

    // Si token manquant -> renvoyer message clair
    if (!TMDB_TOKEN) {
      return res.status(500).json({ error: 'missing_token', message: 'TMDB_BEARER_TOKEN manquant côté serveur.' });
    }

    const data = await TMDB.get(`/discover/${type}`, params);
    res.json({
      region: WATCH_REGION,
      results: (data.results || []).map(it => mapResult(type, it)),
      page: data.page,
      total_pages: data.total_pages,
      debug: { type, params }
    });
  } catch (e) {
    console.error('search_failed:', e.message);
    res.status(500).json({ error: 'search_failed', message: e.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`✅ Server running http://localhost:${PORT} — FR-only, robust search`);
});
