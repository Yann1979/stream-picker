// server/index.js — FR-only + providers par type (fix Apple TV+ sur discover movie/tv)
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

const TMDB_TOKEN = process.env.TMDB_BEARER_TOKEN;
const WATCH_REGION = (process.env.WATCH_REGION || 'FR').toUpperCase();
const LANG = process.env.LANG || 'fr-FR';
const IMG_BASE = 'https://image.tmdb.org/t/p/';

if (!TMDB_TOKEN) {
  console.error('❌ TMDB_BEARER_TOKEN manquant dans .env');
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
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${url}`);
    return res.json();
  }
};

// ---------- Providers FR, séparés par type ----------
let MOVIE_PROVIDERS_BY_NAME = new Map(); // name -> { ids:[...], logo }
let TV_PROVIDERS_BY_NAME    = new Map();
let PROVIDERS_CACHE = null; // pour /api/providers-list (agrégé)

async function loadProvidersFR() {
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

  // Pour l’UI : on fusionne proprement (movie ∪ tv) pour afficher la liste FR
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
  if (!PROVIDERS_CACHE) await loadProvidersFR();
}

// UI : liste des plateformes FR
app.get('/api/providers-list', async (req, res) => {
  try {
    await ensureProviders();
    res.json(PROVIDERS_CACHE);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'providers_list_failed' });
  }
});

// Providers par titre (FR-only)
app.get('/api/providers/:type/:id', async (req, res) => {
  const { type, id } = req.params; // movie | tv
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

// Discover FR-only
function mapPoster(p){ return p ? `${IMG_BASE}w342${p}` : null; }
function mapBackdrop(p){ return p ? `${IMG_BASE}w780${p}` : null; }

function pickProviderMapForType(type) {
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
    with_watch_monetization_types: 'flatrate' // uniquement catalogue abo FR
  };

  // providers => utilise UNIQUEMENT les IDs FR du type demandé (fix Apple TV+)
  if (q.providers) {
    const byName = pickProviderMapForType(type);
    const names = q.providers.split(',').map(s=>s.trim()).filter(Boolean);
    const ids = [];
    for (const name of names) {
      const entry = byName.get(name);
      if (entry?.ids?.length) ids.push(...entry.ids);
    }
    if (ids.length) {
      // OR logique entre providers
      params.with_watch_providers = ids.join('|');
    }
  }

  // langue originale
  if (q.original_language && q.original_language !== 'any') {
    params.with_original_language = q.original_language;
  }

  // bornes années
  if (q.year_from) params[isMovie ? 'primary_release_date.gte' : 'first_air_date.gte'] = `${q.year_from}-01-01`;
  if (q.year_to)   params[isMovie ? 'primary_release_date.lte' : 'first_air_date.lte'] = `${q.year_to}-12-31`;

  // durée (films)
  if (q.duration && isMovie) {
    if (q.duration === 'court') params['with_runtime.lte'] = '60';
    if (q.duration === 'moyen') { params['with_runtime.gte'] = '60'; params['with_runtime.lte'] = '120'; }
    if (q.duration === 'long')  params['with_runtime.gte'] = '120';
  }

  // genres pass-through (si tu passes des ids)
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
    await ensureProviders(); // garantit les maps FR par type
    const type = (req.query.type === 'série' || req.query.type === 'tv') ? 'tv' : 'movie';
    const params = buildDiscoverParams(type, req.query);
    const data = await TMDB.get(`/discover/${type}`, params);

    res.json({
      region: WATCH_REGION,
      results: (data.results || []).map(it => mapResult(type, it)),
      page: data.page,
      total_pages: data.total_pages,
      debug: {
        type,
        params // utile pour vérifier les IDs Apple TV+ (350) envoyés
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'search_failed' });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT} (FR-only, providers par type)`);
});
