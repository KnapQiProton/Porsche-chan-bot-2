import { search } from 'duck-duck-scrape';

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export type WebSearchResult = SearchResult;

// Small in-memory cache so follow-up questions don't hammer DuckDuckGo twice
// for the same query (also makes the "model doesn't know" retry cheap).
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 150;
const searchCache = new Map<string, { at: number; results: SearchResult[] }>();

function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function searchWeb(query: string, timeoutMs: number = 5000): Promise<SearchResult[]> {
  const cacheKey = normalizeQuery(query);
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) {
    return cached.results;
  }

  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Web search timeout')), timeoutMs);
      timer.unref?.();
    });

    const results = await Promise.race([
      search(query, {
        safeSearch: 'strict' as any,
        time: 'y',
      }),
      timeout,
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });

    const mapped = results.results.slice(0, 5).map(r => ({
      title: r.title,
      snippet: r.description || (r as any).snippet || 'Tidak ada deskripsi.',
      url: r.url
    }));

    searchCache.set(cacheKey, { at: Date.now(), results: mapped });
    if (searchCache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = searchCache.keys().next().value;
      if (oldestKey !== undefined) searchCache.delete(oldestKey);
    }

    return mapped;
  } catch (error) {
    console.error('[WebSearch] Gagal mencari:', (error as Error).message);
    return []; // Return array kosong agar bot tidak crash
  }
}

const QUESTION_START =
  /^(?:apa|apakah|siapa|siapakah|kapan|kapankah|dimana|di\s*mana|kemana|mengapa|kenapa|bagaimana|gimana|berapa|berapakah|bisakah|bolehkah|adakah|mana)\b/i;

const TIME_SENSITIVE =
  /\b(?:terbaru|terkini|sekarang|saat\s+ini|hari\s+ini|kemarin|besok|minggu\s+ini|bulan\s+ini|tahun\s+ini|tadi|baru\s+saja|update|rilis|jadwal|harga|kurs|skor|hasil|cuaca|berita|viral|tren|inflasi|saham|bitcoin|pemilu|pilpres|pertandingan|transfer|202[5-9])\b/i;

const FACTUAL_ENTITY =
  /\b(?:presiden|wakil\s+presiden|menteri|gubernur|bupati|walikota|ceo|pendiri|pemilik|juara|pemenang|rekor|film|lagu|album|game|hp|iphone|samsung|android|ios|windows|linux|nvidia|amd|intel|dolar|gempa|gunung|liga|artis|idol|kpop|anime|manga)\b/i;

const EXPLICIT_SEARCH =
  /\b(?:cari\s+tahu|cari\s+info|cek\s+di\s+google|googling|telusuri\s+di\s+internet|search\s+(?:the\s+)?web)\b/i;

export function isQuestionLike(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return lower.includes('?') || QUESTION_START.test(lower);
}

/**
 * Deteksi apakah pesan chat biasa membutuhkan pencarian fakta real-time di internet.
 * Dipakai hanya untuk chat yang memang menyebut bot, jadi boleh cukup agresif.
 */
export function shouldAutoSearchWeb(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (lower.length < 6 || lower.length > 300) return false;

  if (EXPLICIT_SEARCH.test(lower)) return true;

  // How-to questions benefit from fresh references (install, fix, setup, dll.)
  if (/\bcara\s+(?:install|membuat|mengatasi|setup|pakai|menggunakan|kerja|fix|upgrade|update|daftar|beli)\b/i.test(lower)) {
    return true;
  }

  const isQuestion = isQuestionLike(lower);
  const isTimeSensitive = TIME_SENSITIVE.test(lower);
  const mentionsEntity = FACTUAL_ENTITY.test(lower);

  if (isTimeSensitive && (isQuestion || mentionsEntity)) return true;
  if (isQuestion && mentionsEntity) return true;

  return false;
}

/**
 * Format snippet teratas menjadi teks ringkas untuk prompt AI
 */
export function formatWebSearchSnippets(results: SearchResult[]): string {
  if (!results || results.length === 0) return "";
  return results
    .slice(0, 4)
    .map((r, i) => `[${i + 1}] Judul: ${r.title}\nRingkasan: ${r.snippet}\nSumber: ${r.url}`)
    .join("\n\n");
}
