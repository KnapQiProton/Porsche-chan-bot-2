import { search, SafeSearchType } from "duck-duck-scrape";
import * as cheerio from "cheerio";
import { logger } from "../server/logger";

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
}

/**
 * Bersihkan tag HTML & batasi panjang teks agar hemat token API AI
 */
function cleanText(raw: string, maxLen: number = 250): string {
  if (!raw) return "";
  const stripped = raw
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > maxLen ? `${stripped.slice(0, maxLen - 3)}...` : stripped;
}

/**
 * Tier 2 Fallback: DuckDuckGo HTML / Lite (ketika regex VQD duck-duck-scrape gagal di server datacenter)
 */
async function fallbackDuckDuckGoHtml(query: string, timeoutMs: number): Promise<WebSearchResult[]> {
  const encoded = encodeURIComponent(query);
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const results: WebSearchResult[] = [];

  $(".result").each((_, el) => {
    if (results.length >= 3) return;
    const titleEl = $(el).find(".result__a");
    const snippetEl = $(el).find(".result__snippet");
    const title = cleanText(titleEl.text(), 120);
    const snippet = cleanText(snippetEl.text(), 250);
    let url = titleEl.attr("href") ?? "";

    if (url.includes("uddg=")) {
      const match = url.match(/uddg=([^&]+)/);
      if (match && match[1]) {
        try {
          url = decodeURIComponent(match[1]);
        } catch {}
      }
    } else if (url.startsWith("//")) {
      url = `https:${url}`;
    }

    if (title && snippet) {
      results.push({ title, snippet, url });
    }
  });

  return results;
}

/**
 * Tier 3 Fallback: Yahoo Search + Wikipedia API (100% gratis, tanpa API key, bebas blokir ISP & datacenter)
 */
async function fallbackYahooAndWikiSearch(query: string, timeoutMs: number): Promise<WebSearchResult[]> {
  const encoded = encodeURIComponent(query);
  const results: WebSearchResult[] = [];

  // A. Coba Yahoo Search HTML
  try {
    const res = await fetch(`https://search.yahoo.com/search?p=${encoded}&n=5`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);

      $("div.algo, div.dd.algo").each((_, el) => {
        if (results.length >= 3) return;
        const linkEl = $(el).find("h3.title a, a").first();
        const rawTitle = linkEl.text().trim();
        const snippetText = $(el).find(".compText, p").first().text().trim();
        let rawUrl = linkEl.attr("href") || "";

        if (rawUrl.includes("RU=")) {
          const m = rawUrl.match(/RU=([^/]+)/);
          if (m && m[1]) {
            try {
              rawUrl = decodeURIComponent(m[1]);
            } catch {}
          }
        }

        const title = cleanText(rawTitle, 120);
        const snippet = cleanText(snippetText, 250);
        if (title && snippet && rawUrl.startsWith("http")) {
          results.push({ title, snippet, url: rawUrl });
        }
      });

      if (results.length > 0) return results.slice(0, 3);
    }
  } catch {}

  // B. Fallback ke Wikipedia Search API (Indonesia & English)
  for (const lang of ["id", "en"]) {
    try {
      const wikiUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&utf8=&format=json&srlimit=3`;
      const res = await fetch(wikiUrl, {
        headers: { "User-Agent": "PorscheChanDiscordBot/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const items = data?.query?.search || [];
        for (const item of items) {
          if (results.length >= 3) break;
          const title = cleanText(item.title, 120);
          const snippet = cleanText(item.snippet, 250);
          const url = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`;
          if (title && snippet) {
            results.push({ title, snippet, url });
          }
        }
        if (results.length > 0) return results.slice(0, 3);
      }
    } catch {}
  }

  return results;
}

/**
 * Mencari informasi terkini di internet menggunakan duck-duck-scrape (dengan multi-tier fallback)
 * - Mengembalikan maksimal 3 hasil teratas (title, snippet, url) untuk menghemat token
 * - Dilengkapi strict timeout 5 detik agar bot tidak pernah hang
 * - Mengembalikan array kosong [] jika gagal
 */
export async function searchWeb(query: string, timeoutMs: number = 5000): Promise<WebSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  // 1. Primary: duck-duck-scrape dengan strict timeout 5 detik
  try {
    const ddgPromise = (async (): Promise<WebSearchResult[]> => {
      const searchResults = await search(cleanQuery, {
        safeSearch: SafeSearchType.MODERATE,
      });

      if (!searchResults || !Array.isArray(searchResults.results) || searchResults.results.length === 0) {
        return [];
      }

      return searchResults.results.slice(0, 3).map((item) => ({
        title: cleanText(item.title || "Tanpa Judul", 120),
        snippet: cleanText(item.description || "", 250),
        url: item.url || "",
      }));
    })();

    const timeoutPromise = new Promise<WebSearchResult[]>((_, reject) =>
      setTimeout(() => reject(new Error("Web search timeout (5s)")), timeoutMs)
    );

    const primaryResults = await Promise.race([ddgPromise, timeoutPromise]);
    if (primaryResults.length > 0) {
      logger.info({ query: cleanQuery, count: primaryResults.length }, "[WebSearch] Berhasil mengambil hasil via duck-duck-scrape");
      return primaryResults;
    }
  } catch (err: any) {
    logger.warn(
      { query: cleanQuery, err: err?.message || String(err) },
      "[WebSearch] duck-duck-scrape VQD/timeout, beralih ke fallback scraper..."
    );
  }

  // 2. Fallback Tier 2: DuckDuckGo HTML (untuk server luar negeri jika VQD duck-duck-scrape gagal)
  try {
    const ddgHtmlResults = await fallbackDuckDuckGoHtml(cleanQuery, 3500);
    if (ddgHtmlResults.length > 0) {
      logger.info({ query: cleanQuery, count: ddgHtmlResults.length }, "[WebSearch] Berhasil mengambil hasil via DDG HTML fallback");
      return ddgHtmlResults;
    }
  } catch {}

  // 3. Fallback Tier 3: Yahoo Search & Wikipedia (anti-blokir ISP & datacenter)
  try {
    const fallbackResults = await fallbackYahooAndWikiSearch(cleanQuery, 4500);
    if (fallbackResults.length > 0) {
      logger.info({ query: cleanQuery, count: fallbackResults.length }, "[WebSearch] Berhasil mengambil hasil via Yahoo/Wikipedia fallback");
      return fallbackResults;
    }
  } catch (fallbackErr: any) {
    logger.warn({ query: cleanQuery, err: fallbackErr?.message }, "[WebSearch] Semua tier pencarian gagal");
  }

  return [];
}

/**
 * Deteksi apakah pesan chat biasa membutuhkan pencarian fakta real-time di internet (Metode B)
 */
export function shouldAutoSearchWeb(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (lower.length < 6 || lower.length > 250) return false;

  const triggerPatterns = [
    /\bberapa\s+harga\b/i,
    /\bharga\s+[a-z0-9]/i,
    /\bkurs\s+[a-z]/i,
    /\bsiapa\s+(?:presiden|menteri|gubernur|bupati|ceo|pemilik|juara|pemenang)\b/i,
    /\bberita\s+terbaru\b/i,
    /\binfo\s+terbaru\b/i,
    /\bkabar\s+terbaru\b/i,
    /\bupdate\s+terbaru\b/i,
    /\bcuaca\s+(?:di|hari\s+ini|besok|sekarang)\b/i,
    /\bcara\s+(?:install|membuat|mengatasi|setup|pakai|menggunakan|kerja|fix|upgrade|update)\b/i,
    /\bkapan\s+(?:rilis|jadwal|libur|lebaran|puasa|pemilu|pertandingan)\b/i,
    /\bspek(?:sifikasi)?\s+[a-z0-9]/i,
    /\btahun\s+202[4-9]\b/i,
    /\bhari\s+ini\b.*\b(?:berapa|apa|siapa|dimana)\b/i,
    /\bsekarang\s+tahun\s+berapa\b/i,
  ];

  return triggerPatterns.some((regex) => regex.test(lower));
}

/**
 * Format 3 snippet teratas menjadi teks ringkas untuk disuntikkan ke prompt AI
 */
export function formatWebSearchSnippets(results: WebSearchResult[]): string {
  if (!results || results.length === 0) return "";
  return results
    .slice(0, 3)
    .map((r, i) => `[${i + 1}] Judul: ${r.title}\nRingkasan: ${r.snippet}\nSumber: ${r.url}`)
    .join("\n\n");
}
