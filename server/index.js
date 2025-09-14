// server/index.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config FR par défaut
const TMDB_BEARER = process.env.TMDB_BEARER_TOKEN || process.env.TMDB_BEARER || "";
const REGION = process.env.WATCH_REGION || "FR";
const LANG = process.env.LANG || "fr-FR";
const IMG = "https://image.tmdb.org/t/p/";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("web"));

if (!TMDB_BEARER) {
  console.warn("⚠️  TMDB_BEARER_TOKEN manquant dans .env");
}

// Helper d’appel TMDB (injecte langue + région si absents)
async function TMDB(pathname, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${pathname}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  if (!url.searchParams.has("language")) url.searchParams.set("language", LANG);
  if (!url.searchParams.has("watch_region")) url.searchParams.set("watch_region", REGION);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${TMDB_BEARER}`,
      "Content-Type": "application/json;charset=utf-8",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TMDB ${res.status}: ${text}`);
  }
  return res.json();
}

// --------- Routes API ---------

// Health
app.get("/api/health", (req, res) => {
  res.json({ ok: true, region: REGION, lang: LANG, token_present: Boolean(TMDB_BEARER) });
});

// Liste de providers FR (fusion movie + tv + dédup)
app.get("/api/providers", async (req, res) => {
  try {
    const [pm, pt] = await Promise.all([
      TMDB("/watch/providers/movie", { watch_region: REGION }),
      TMDB("/watch/providers/tv", { watch_region: REGION }),
    ]);
    const map = new Map();
    const pushAll = (obj) => obj?.results?.forEach((p) => { if (!map.has(p.provider_id)) map.set(p.provider_id, p); });
    pushAll(pm); pushAll(pt);

    const providers = Array.from(map.values()).map((p) => ({
      id: p.provider_id,
      name: p.provider_name,
      logo: p.logo_path ? `${IMG}w45${p.logo_path}` : null,
      cname: p.provider_name.toLowerCase().replace(/\+/g, "plus").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    })).sort((a, b) => a.name.localeCompare(b.name));

    res.json({ region: REGION, providers });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "providers_failed", details: e.message });
  }
});

// Genres (FR)
app.get("/api/genres", async (req, res) => {
  try {
    const type = req.query.type === "tv" ? "tv" : "movie";
    const data = await TMDB(`/genre/${type}/list`, { language: LANG });
    res.json({ type, genres: data.genres || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "genres_failed", details: e.message });
  }
});

// Recherche FR — garde uniquement type + genre + providers
app.get("/api/search", async (req, res) => {
  try {
    const type = req.query.type === "tv" ? "tv" : "movie";
    const with_genres = req.query.with_genres || "";
    const providersCsv = req.query.with_watch_providers || "";
    const page = Number(req.query.page || 1);

    const params = {
      language: LANG,
      watch_region: REGION,
      sort_by: "popularity.desc",
      include_adult: "false",
      page,
    };
    if (with_genres) params.with_genres = with_genres;
    if (providersCsv) {
      params.with_watch_providers = providersCsv;
      params.with_watch_monetization_types = "flatrate";
    }

    const data = await TMDB(type === "tv" ? "/discover/tv" : "/discover/movie", params);

    const results = (data.results || []).map((r) => ({
      type,
      id: r.id,
      title: type === "tv" ? r.name : r.title,
      overview: r.overview,
      poster: r.poster_path ? `${IMG}w342${r.poster_path}` : null,
      backdrop: r.backdrop_path ? `${IMG}w780${r.backdrop_path}` : null,
      rating: r.vote_average ? Math.round(r.vote_average * 100) / 100 : null,
    }));

    res.json({ region: REGION, results, page: data.page, total_pages: data.total_pages, debug: { type, params } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "search_failed", details: e.message });
  }
});

// Providers pour un titre + lien FR
app.get("/api/providers/:type/:id", async (req, res) => {
  const { type, id } = req.params;
  try {
    const data = await TMDB(`/${type}/${id}/watch/providers`, { language: LANG });
    const fr = data.results?.[REGION] || null;
    const mapEntry = (arr) =>
      Array.isArray(arr)
        ? arr.map((x) => ({ name: x.provider_name, logo: x.logo_path ? `${IMG}w45${x.logo_path}` : null }))
        : [];
    res.json({
      region: REGION,
      link: fr?.link || null,
      flatrate: mapEntry(fr?.flatrate),
      buy: mapEntry(fr?.buy),
      rent: mapEntry(fr?.rent),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "providers_failed", details: e.message });
  }
});

// Aléatoire (respecte type + plateformes cochées) — pioche vraiment au hasard
app.get("/api/random", async (req, res) => {
  try {
    const type = req.query.type === "tv" ? "tv" : "movie";
    const providersCsv = req.query.with_watch_providers || ""; // "8|350|…"

    // 1) première page pour connaître total_pages
    const baseParams = {
      language: LANG,
      watch_region: REGION,
      sort_by: "popularity.desc", // point d’entrée
      include_adult: "false",
      page: 1,
    };
    if (providersCsv) {
      baseParams.with_watch_providers = providersCsv;
      baseParams.with_watch_monetization_types = "flatrate";
    }

    const first = await TMDB(type === "tv" ? "/discover/tv" : "/discover/movie", baseParams);
    const total = Math.max(1, Math.min(first.total_pages || 1, 500)); // limite API

    // 2) tirage d’une page aléatoire suffisamment loin pour varier
    const randomPage = Math.floor(Math.random() * total) + 1;
    const pageData = await TMDB(type === "tv" ? "/discover/tv" : "/discover/movie", { ...baseParams, page: randomPage });

    const results = pageData.results || [];
    if (!results.length) return res.json({ result: null });

    const pick = results[Math.floor(Math.random() * results.length)];
    const result = {
      type,
      id: pick.id,
      title: type === "tv" ? pick.name : pick.title,
      overview: pick.overview,
      poster: pick.poster_path ? `${IMG}w342${pick.poster_path}` : null,
      backdrop: pick.backdrop_path ? `${IMG}w780${pick.backdrop_path}` : null,
      rating: pick.vote_average ? Math.round(pick.vote_average * 100) / 100 : null,
    };
    res.json({ result, debug: { type, randomPage, total_pages: total } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "random_failed", details: e.message });
  }
});

// --------- SPA fallback ---------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "web", "index.html"));
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`✅ Server on http://localhost:${PORT}`);
});
