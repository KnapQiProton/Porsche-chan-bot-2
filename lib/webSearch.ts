import { search, SafeSearchType } from 'duck-duck-scrape';

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
        safeSearch: SafeSearchType.MODERATE,
        time: 'y',
      }),
      timeout,
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });

    const mapped = (results?.results || []).slice(0, 5).map(r => ({
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
  /^(?:apa|apakah|siapa|siapakah|kapan|kapankah|dimana|di\s*mana|kemana|ke\s*mana|mengapa|kenapa|bagaimana|gimana|berapa|berapakah|bisakah|bolehkah|adakah|mana)\b/i;

const QUESTION_INTENT =
  /\b(?:apa|apakah|siapa|kapan|dimana|di\s*mana|kemana|ke\s*mana|mengapa|kenapa|bagaimana|gimana|berapa|bisakah|bolehkah|adakah|kasih\s+(?:aku\s+|saya\s+|kami\s+|kita\s+)?(?:tips|saran|info|rekomendasi|cara|panduan|tahu|tutorial|penjelasan)|minta\s+(?:tips|saran|info|rekomendasi|resep|cara)|rekomendasi(?:kan)?|tips\b|tutorial\b|panduan\b|jelasin\b|jelaskan\b|terangkan\b|ceritakan\b|tolong\s+(?:jelasin|cari|kasih|rekomendasikan)|info\s+(?:tentang|soal|seputar)?|workout\b|latihan\b|olahraga\b|fitness\b|resep\b|bedanya\b|perbedaan\b)\b/i;

const TIME_SENSITIVE =
  /\b(?:terbaru|terkini|sekarang|saat\s+ini|hari\s+ini|kemarin|besok|minggu\s+ini|bulan\s+ini|tahun\s+ini|tadi|baru\s+saja|update|rilis|jadwal|harga|kurs|skor|hasil|cuaca|berita|viral|tren|inflasi|saham|bitcoin|pemilu|pilpres|pertandingan|transfer|202[5-9])\b/i;

const FACTUAL_ENTITY =
  /\b(?:presiden|wakil\s+presiden|menteri|gubernur|bupati|walikota|ceo|pendiri|pemilik|juara|pemenang|rekor|film|lagu|album|game|hp|iphone|samsung|android|ios|windows|linux|nvidia|amd|intel|dolar|gempa|gunung|liga|artis|idol|kpop|anime|manga|workout|femboy|fitness|diet|kalori|nutrisi|resep|mobil|motor|porsche|komputer|laptop|gadget)\b/i;

const EXPLICIT_SEARCH =
  /\b(?:cari\s+tahu|cari\s+info|cek\s+di\s+google|googling|telusuri\s+di\s+internet|search\s+(?:the\s+)?web|cariin|carikan)\b/i;

export function isQuestionLike(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return lower.includes('?') || QUESTION_START.test(lower) || QUESTION_INTENT.test(lower);
}

/**
 * Deteksi apakah pesan chat biasa membutuhkan pencarian fakta real-time di internet layaknya search engine.
 * Dipakai hanya untuk chat yang memang menyebut bot, jadi responsif untuk segala kebutuhan informasi.
 */
export function shouldAutoSearchWeb(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (lower.length < 5 || lower.length > 400) return false;

  if (EXPLICIT_SEARCH.test(lower)) return true;

  // Pertanyaan tutorial, tips, cara, latihan, atau rekomendasi
  if (/\b(?:tips|cara|tutorial|panduan|resep|rekomendasi|latihan|workout|jadwal|harga|spek|spesifikasi|sinopsis)\b/i.test(lower)) {
    return true;
  }

  const isQuestion = isQuestionLike(lower);
  const isTimeSensitive = TIME_SENSITIVE.test(lower);
  const mentionsEntity = FACTUAL_ENTITY.test(lower);

  if (isTimeSensitive || mentionsEntity) return true;
  if (isQuestion) return true;

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
