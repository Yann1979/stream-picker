// server/index.js — Express + TMDB (FR)
// - Filtres plateformes/genres/durée/langue/années
// - /api/providers-list : liste toutes les plateformes FR (movie/tv)
// - /api/providers/:type/:id : plateformes pour un titre (FR)
// - /api/search : recherche avec filtres

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const TMDB_URL = 'https://api.themoviedb.org/3';
const REGION = process.env.WATCH_REGION || 'FR';
const LANG = process.env.LANG || 'fr-FR';
const AUTH = `Bearer ${process.env.TMDB_BEARER_TOKEN}`;

async function tmdb(pathname, params = {}) {
  const url = new URL(TMDB_URL + pathname);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`TMDB ${res.status} ${res.statusText}: ${msg}`);
  }
  return res.json();
}

// ---- Cache mémoire simple (TTL) ----
const cache = new Map();
function memo(key, ttlMs, fn) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return Promise.resolve(hit.val);
  return fn().then(val => { cache.set(key, { val, exp: now + ttlMs }); return val; });
}

// ---- Providers (FR) ----
async function getProviders(kind /* 'movie' | 'tv' */) {
  return memo(`prov_${kind}_${REGION}_${LANG}`, 24*60*60*1000, async () => {
    const data = await tmdb(`/watch/providers/${kind}`, { watch_region: REGION, language: LANG });
    return (data.results || []).map(p => ({
      id: p.provider_id,
      name: p.provider_name,
      logo: p.logo_path ? `https://image.tmdb.org/t/p/w45${p.logo_path}` : null
    }));
  });
}
function normalizeName(n) {
  const s = (n || '').toLowerCase();
  if (s.includes('netflix')) return 'Netflix';
  if (s.includes('amazon') || s.includes('prime')) return 'Prime Video';
  if (s.includes('disney')) return 'Disney+';
  if (s.includes('canal')) return 'Canal+';
  if (s.includes('paramount')) return 'Paramount+';
  if (s.includes('apple')) return 'Apple TV+';
  if (s.includes('ocs')) return 'OCS';
  if (s.includes('salto')) return 'SALTO';
  return n; // fallback nom officiel TMDB
}

// Liste unifiée FR (movie ∪ tv), triée
app.get('/api/providers-list', async (req, res) => {
  try {
    const [mv, tv] = await Promise.all([getProviders('movie'), getProviders('tv')]);
    const map = new Map();
    for (const p of [...mv, ...tv]) {
      const key = normalizeName(p.name);
      if (!map.has(key)) map.set(key, { name: key, ids: new Set(), logo: p.logo });
      map.get(key).ids.add(p.id);
      if (!map.get(key).logo && p.logo) map.get(key).logo = p.logo;
    }
    const list = Array.from(map.values()).map(x => ({ name: x.name, ids: Array.from(x.ids), logo: x.logo }));
    list.sort((a,b)=> a.name.localeCompare(b.name, 'fr'));
    res.json({ region: REGION, providers: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Genres FR -> IDs TMDB ----
const GENRES_MOVIE = {
  "action": 28, "aventure": 12, "animation": 16, "comédie": 35, "crime": 80,
  "documentaire": 99, "drame": 18, "famille": 10751, "fantastique": 14, "histoire": 36,
  "horreur": 27, "musique": 10402, "mystère": 9648, "romance": 10749,
  "science-fiction": 878, "thriller": 53, "guerre": 10752, "western": 37,
  "biopic": 36, "historique": 36, "sf": 878
};
const GENRES_TV = {
  "action": 10759, "aventure": 10759, "animation": 16, "comédie": 35, "crime": 80,
  "documentaire": 99, "drame": 18, "famille": 10751, "fantastique": 10765,
  "mystère": 9648, "science-fiction": 10765, "guerre": 10768, "western": 37,
  "réalité": 10764, "talk-show": 10767, "enfants": 10762
};
function genreIds(kind, list) {
  const base = (kind === 'movie' ? GENRES_MOVIE : GENRES_TV);
  return list.map(g => base[g.toLowerCase()]).filter(Boolean);
}
function moodExtraGenres(mood) {
  if (!mood || mood === 'peu importe') return [];
  if (mood === 'léger') return ['comédie','animation','famille'];
  if (mood === 'intense') return ['drame','thriller','crime','historique'];
  return [];
}
function runtimeParams(duration, kind) {
  if (!duration || duration === 'peu importe') return {};
  if (kind === 'movie') {
    if (duration === 'court') return { 'with_runtime.lte': 90 };
    if (duration === 'moyen') return { 'with_runtime.gte': 90, 'with_runtime.lte': 130 };
    if (duration === 'long')  return { 'with_runtime.gte': 130 };
  } else {
    if (duration === 'court') return { 'with_runtime.lte': 30 };
    if (duration === 'moyen') return { 'with_runtime.gte': 30, 'with_runtime.lte': 60 };
    if (duration === 'long')  return { 'with_runtime.gte': 60 };
  }
  return {};
}
function yearParams(from, to, kind) {
  if (!from && !to) return {};
  if (kind === 'movie') {
    const p = {};
    if (from) p['primary_release_date.gte'] = `${from}-01-01`;
    if (to)   p['primary_release_date.lte'] = `${to}-12-31`;
    return p;
  } else {
    const p = {};
    if (from) p['first_air_date.gte'] = `${from}-01-01`;
    if (to)   p['first_air_date.lte'] = `${to}-12-31`;
    return p;
  }
}

// /api/search — filtres principaux
app.get('/api/search', async (req, res) => {
  try {
    const typeParam = (req.query.type || 'any').toLowerCase();
    const kinds = typeParam === 'film' ? ['movie']
                : (typeParam === 'série' || typeParam === 'serie') ? ['tv']
                : ['movie','tv'];

    const providers = (req.query.providers || '').toString().split(',').map(s => s.trim()).filter(Boolean);
    const genres = (req.query.genres || '').toString().split(',').map(s => s.trim()).filter(Boolean);
    const mood = (req.query.mood || 'peu importe').toString();
    const duration = (req.query.duration || 'peu importe').toString();
    const olang = (req.query.original_language || '').toString().trim();
    const yearFrom = (req.query.year_from || '').toString().trim();
    const yearTo   = (req.query.year_to || '').toString().trim();

    // transformer noms -> IDs selon movie/tv
    const [mvList, tvList] = await Promise.all([getProviders('movie'), getProviders('tv')]);
    const toIdMovie = new Map(mvList.map(p => [normalizeName(p.name).toLowerCase(), p.id]));
    const toIdTv    = new Map(tvList.map(p => [normalizeName(p.name).toLowerCase(), p.id]));
    const providerIdsMovie = providers.map(p => toIdMovie.get(normalizeName(p).toLowerCase())).filter(Boolean);
    const providerIdsTv    = providers.map(p => toIdTv.get(normalizeName(p).toLowerCase())).filter(Boolean);

    async function discover(kind) {
      const gAll = [...new Set([...genres, ...moodExtraGenres(mood)])];
      const gIds = genreIds(kind, gAll);
      const params = {
        language: LANG,
        watch_region: REGION,
        with_watch_monetization_types: 'flatrate|free|ads',
        sort_by: 'popularity.desc',
        page: 1,
        ...runtimeParams(duration, kind),
        ...yearParams(yearFrom, yearTo, kind)
      };
      if (gIds.length) params.with_genres = gIds.join(',');
      if (olang) params.with_original_language = olang;
      const provIds = (kind === 'movie') ? providerIdsMovie : providerIdsTv;
      if (provIds.length) params.with_watch_providers = provIds.join('|');

      const path = kind === 'movie' ? '/discover/movie' : '/discover/tv';
      const data = await tmdb(path, params);
      return (data.results || []).map(r => ({
        id: r.id,
        type: kind === 'movie' ? 'film' : 'série',
        title: r.title || r.name,
        year: (r.release_date || r.first_air_date || '').slice(0,4),
        poster: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : null,
        rating: r.vote_average,
        overview: r.overview
      }));
    }

    let results = [];
    if (kinds.length === 1) results = await discover(kinds[0]);
    else {
      const [a,b] = await Promise.all([discover('movie'), discover('tv')]);
      results = [...a, ...b].sort((x,y) => (y.rating||0) - (x.rating||0));
    }
    res.json({ region: REGION, language: LANG, count: results.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// /api/providers/:type/:id — plateformes pour un titre (FR)
app.get('/api/providers/:type/:id', async (req, res) => {
  try {
    const t = req.params.type.toLowerCase();
    const id = parseInt(req.params.id, 10);
    const kind = (t === 'film') ? 'movie' : (t === 'série' || t === 'serie') ? 'tv' : null;
    if (!kind || !id) return res.status(400).json({ error: 'Paramètres invalides' });

    const data = await tmdb(`/${kind}/${id}/watch/providers`, {});
    const fr = data?.results?.[REGION];
    const flatrate = Array.isArray(fr?.flatrate) ? fr.flatrate : [];
    const buy = Array.isArray(fr?.buy) ? fr.buy : [];
    const rent = Array.isArray(fr?.rent) ? fr.rent : [];
    const link = fr?.link || null; // page TMDB "watch"

    const mapProv = arr => arr.map(p => ({
      id: p.provider_id,
      name: normalizeName(p.provider_name),
      logo: p.logo_path ? `https://image.tmdb.org/t/p/w45${p.logo_path}` : null
    }));
    res.json({ region: REGION, link, flatrate: mapProv(flatrate), buy: mapProv(buy), rent: mapProv(rent) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Servir le front ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/', express.static(path.join(__dirname, '..', 'web')));

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`✅ Serveur sur http://localhost:${PORT}`));
