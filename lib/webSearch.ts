import { search, SafeSearchType } from "duck-duck-scrape";

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export type WebSearchResult = SearchResult;

export async function searchWeb(query: string, timeoutMs: number = 5000): Promise<SearchResult[]> {
  try {
    const results = await search(query, {
      safeSearch: SafeSearchType.STRICT,
      time: "y",
    });

    if (!results || !Array.isArray(results.results) || results.results.length === 0) {
      return [];
    }

    return results.results.slice(0, 3).map((r) => ({
      title: r.title || "Tanpa Judul",
      snippet: r.description || (r as any).snippet || "Tidak ada deskripsi.",
      url: r.url || "",
    }));
  } catch (error) {
    console.error("[WebSearch] Gagal mencari:", (error as Error).message);
    return [];
  }
}

/**
 * Deteksi apakah pesan chat biasa membutuhkan pencarian fakta real-time di internet
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
 * Format snippet teratas menjadi teks ringkas untuk prompt AI
 */
export function formatWebSearchSnippets(results: SearchResult[]): string {
  if (!results || results.length === 0) return "";
  return results
    .slice(0, 3)
    .map((r, i) => `[${i + 1}] Judul: ${r.title}\nRingkasan: ${r.snippet}\nSumber: ${r.url}`)
    .join("\n\n");
}
