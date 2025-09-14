// server/index.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("web"));

const TMDB_BEARER = process.env.TMDB_BEARER_TOKEN || process.env.TMDB_BEARER;
const REGION = process.env.WATCH_REGION || "FR";
const LANG = process.env.LANG || "fr-FR";

if (!TMDB_BEARER) {
  console.warn("⚠️  TMDB_BEARER_TOKEN manquant dans .env");
}

const TMDB = async (path, params = {}) => {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  // Défauts FR
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
};

// Health
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    region: REGION,
    lang: LANG,
    token_present: Boolean(TMDB_BEARER),
  });
});

// Providers (FR) — fusion film + série et dédup
app.get("/api/providers", async (req, res) => {
  try {
    const [pm, pt] = await Promise.all([
      TMDB("/watch/providers/movie", { watch_region: REGION, language: LANG }),
      TMDB("/watch/providers/tv", { watch_region: REGION, language: LANG }),
    ]);
    const map = new Map();
    const pushAll = (arr) => {
      arr?.results?.forEach((p) => {
        const cur = map.get(p.provider_id);
        if (!cur) map.set(p.provider_id, p);
      });
    };
    pushAll(pm);
    pushAll(pt);

    const providers = Array.from(map.values()).map((p) => ({
      id: p.provider_id,
      name: p.provider_name,
      logo: p.logo_path ? `https://image.tmdb.org/t/p/w45${p.logo_path}` : null,
      cname: p.provider_name
        .toLowerCase()
        .replace(/\+/g, "plus")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, ""),
    }));

    res.json({ region: REGION, providers: providers.sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "providers_failed", details: e.message });
  }
});

// Genres
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

// Recherche FR — uniquement type + genre + providers
app.get("/api/search", async (req, res) => {
  try {
    const type = req.query.type === "tv" ? "tv" : "movie";
    const with_genres = req.query.with_genres || "";
    const providersCsv = req.query.with_watch_providers || ""; // CSV d’IDs
    const page = Number(req.query.page || 1);

    const discoverPath = type === "tv" ? "/discover/tv" : "/discover/movie";
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

    const data = await TMDB(discoverPath, params);

    const results = (data.results || []).map((r) => ({
      type,
      id: r.id,
      title: type === "tv" ? r.name : r.title,
      overview: r.overview,
      poster: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : null,
      backdrop: r.backdrop_path ? `https://image.tmdb.org/t/p/w780${r.backdrop_path}` : null,
      // Pas de date/année affichée
      rating: r.vote_average ? Math.round(r.vote_average * 100) / 100 : null,
    }));

    res.json({
      region: REGION,
      results,
      page: data.page,
      total_pages: data.total_pages,
      debug: {
        type,
        params,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "search_failed", details: e.message });
  }
});

// SPA
app.get("*", (req, res) => {
  res.sendFile(process.cwd() + "/web/index.html");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server on http://localhost:${PORT}`);
});
