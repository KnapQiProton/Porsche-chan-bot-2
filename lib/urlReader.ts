import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import net from "node:net";

export interface PageContent {
  url: string;
  finalUrl: string;
  title: string;
  siteName?: string;
  description?: string;
  text: string;
  truncated: boolean;
  ok: boolean;
  error?: string;
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 2_500_000;
const MAX_TEXT_CHARS = 9_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

const pageCache = new Map<string, { at: number; page: PageContent }>();

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const IMAGE_URL = /\.(?:png|jpe?g|webp|gif|avif|bmp|svg|ico)(?:$|[?#])/i;
const MUSIC_HOST =
  /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be|music\.youtube\.com|open\.spotify\.com|soundcloud\.com)$/i;

export function isImageUrl(url: string): boolean {
  try {
    return IMAGE_URL.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function isMusicUrl(url: string): boolean {
  try {
    return MUSIC_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Ambil semua URL dari teks, buang duplikat dan tanda baca di ujung. */
export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const cleaned = matches
    .map((raw) => raw.replace(/[)\].,;!?]+$/g, ""))
    .filter((raw) => {
      try {
        const parsed = new URL(raw);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    });
  return [...new Set(cleaned)];
}

/** URL yang masuk akal untuk dibaca sebagai halaman (bukan gambar/lagu). */
export function extractReadableUrls(text: string): string[] {
  return extractUrls(text).filter((url) => !isImageUrl(url) && !isMusicUrl(url));
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (/^f[cd]/.test(lower)) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true;
}

/** Cegah bot dipakai untuk mengakses localhost/jaringan internal (SSRF). */
async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL tidak valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Hanya URL http/https yang didukung");
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Host tidak diizinkan");
  }

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Host mengarah ke jaringan privat");
    return url;
  }

  const addresses = await dns.lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) {
    throw new Error("Domain tidak bisa di-resolve");
  }
  if (addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("Host mengarah ke jaringan privat");
  }
  return url;
}

async function readBodyWithLimit(
  res: Response,
  maxBytes: number
): Promise<{ buffer: Buffer; truncated: boolean }> {
  if (!res.body) return { buffer: Buffer.alloc(0), truncated: false };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    const remaining = maxBytes - total;
    if (value.byteLength > remaining) {
      chunks.push(value.subarray(0, remaining));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }

  return {
    buffer: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    truncated,
  };
}

function decodeBody(buffer: Buffer, contentType: string): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = buffer.subarray(0, 2048).toString("latin1");
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractFromHtml(html: string): {
  title: string;
  siteName?: string;
  description?: string;
  text: string;
} {
  const $ = cheerio.load(html);

  const meta = (selector: string): string =>
    ($(selector).attr("content") || "").trim();

  const title =
    meta('meta[property="og:title"]') ||
    meta('meta[name="twitter:title"]') ||
    $("title").first().text().trim();
  const siteName = meta('meta[property="og:site_name"]') || undefined;
  const description =
    meta('meta[property="og:description"]') ||
    meta('meta[name="description"]') ||
    meta('meta[name="twitter:description"]') ||
    undefined;

  $(
    [
      "script",
      "style",
      "noscript",
      "svg",
      "iframe",
      "canvas",
      "form",
      "header",
      "footer",
      "nav",
      "aside",
      "template",
      '[role="navigation"]',
      '[role="banner"]',
      '[role="contentinfo"]',
      '[aria-hidden="true"]',
      '[class*="cookie"]',
      '[id*="cookie"]',
      '[class*="consent"]',
      '[id*="consent"]',
      '[class*="newsletter"]',
      '[class*="sidebar"]',
    ].join(",")
  ).remove();

  const candidates = ["article", "main", '[role="main"]', "#content", ".content", "body"];
  let root: cheerio.Cheerio<any> = $("body").first();
  for (const selector of candidates) {
    const candidate = $(selector).first();
    if (candidate.length && normalizeText(candidate.text()).length > 200) {
      root = candidate;
      break;
    }
  }

  root.find("br").replaceWith("\n");
  root
    .find("p,div,section,li,h1,h2,h3,h4,h5,h6,tr,blockquote,pre,figcaption")
    .each((_, el) => {
      $(el).append("\n");
    });

  return {
    title,
    siteName,
    description,
    text: normalizeText(root.text()),
  };
}

function failedPage(url: string, error: string): PageContent {
  return {
    url,
    finalUrl: url,
    title: "",
    text: "",
    truncated: false,
    ok: false,
    error,
  };
}

/** Baca satu halaman web dan ubah jadi teks bersih. */
export async function fetchWebPage(rawUrl: string): Promise<PageContent> {
  const key = rawUrl.trim();
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.page;
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    const url = await assertSafeUrl(key);
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    timer.unref?.();

    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (!res.ok) {
      return failedPage(key, `HTTP ${res.status} ${res.statusText}`.trim());
    }

    // Validasi ulang setelah redirect, supaya redirect ke jaringan privat ditolak.
    await assertSafeUrl(res.url || key);

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType.startsWith("image/")) {
      return failedPage(key, "URL ini adalah gambar, bukan halaman teks");
    }
    if (contentType.includes("application/pdf")) {
      return failedPage(key, "PDF belum didukung untuk dibaca langsung");
    }

    const { buffer, truncated: bodyTruncated } = await readBodyWithLimit(res, MAX_BYTES);
    if (buffer.length === 0) {
      return failedPage(key, "Halaman kosong");
    }

    const decoded = decodeBody(buffer, contentType);
    let title = "";
    let siteName: string | undefined;
    let description: string | undefined;
    let text = "";

    const isHtml =
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml") ||
      /<html[\s>]/i.test(decoded.slice(0, 2000));

    if (isHtml) {
      const extracted = extractFromHtml(decoded);
      title = extracted.title;
      siteName = extracted.siteName;
      description = extracted.description;
      text = extracted.text;
    } else if (contentType.includes("application/json")) {
      try {
        text = normalizeText(JSON.stringify(JSON.parse(decoded), null, 2));
      } catch {
        text = normalizeText(decoded);
      }
    } else {
      text = normalizeText(decoded);
    }

    if (!text) {
      return failedPage(key, "Tidak ada teks yang bisa dibaca dari halaman ini");
    }

    const truncated = bodyTruncated || text.length > MAX_TEXT_CHARS;
    const page: PageContent = {
      url: key,
      finalUrl: res.url || key,
      title: title || key,
      siteName,
      description,
      text: text.slice(0, MAX_TEXT_CHARS),
      truncated,
      ok: true,
    };

    pageCache.set(key, { at: Date.now(), page });
    if (pageCache.size > MAX_CACHE_ENTRIES) {
      const oldest = pageCache.keys().next().value;
      if (oldest !== undefined) pageCache.delete(oldest);
    }

    return page;
  } catch (err) {
    const message = (err as Error).name === "AbortError" ? "Waktu baca habis (timeout)" : (err as Error).message;
    return failedPage(key, message || "Gagal membuka halaman");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function formatPageContext(pages: PageContent[]): string {
  if (pages.length === 0) return "";

  const usable = pages.filter((page) => page.ok && page.text);
  if (usable.length === 0) {
    const failures = pages
      .map((page) => `- ${page.url}: ${page.error || "tidak bisa dibaca"}`)
      .join("\n");
    return `[GAGAL MEMBACA HALAMAN]\n${failures}`;
  }

  return usable
    .map((page, index) => {
      const header = [
        `[Halaman ${index + 1}] ${page.title || page.finalUrl}`,
        `URL: ${page.finalUrl || page.url}`,
        page.siteName ? `Situs: ${page.siteName}` : "",
        page.description ? `Deskripsi: ${page.description}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return `${header}\n--- ISI HALAMAN ---\n${page.text}${
        page.text.length < 300
          ? "\n[Catatan: teks halaman sangat sedikit; mungkin halaman butuh login atau JavaScript.]"
          : ""
      }${page.truncated ? "\n[...isi dipotong karena terlalu panjang...]" : ""}\n--- AKHIR HALAMAN ---`;
    })
    .join("\n\n");
}

/** Baca maksimal `maxPages` URL dari teks dan siapkan konteks untuk prompt AI. */
export async function readUrlsFromText(
  text: string,
  maxPages = 2
): Promise<{ context: string; pages: PageContent[] }> {
  const urls = extractReadableUrls(text).slice(0, maxPages);
  if (urls.length === 0) return { context: "", pages: [] };

  const pages = await Promise.all(urls.map((url) => fetchWebPage(url)));
  return { context: formatPageContext(pages), pages };
}
