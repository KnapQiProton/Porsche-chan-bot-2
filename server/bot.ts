import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextBasedChannel,
  AttachmentBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Interaction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  Partials,
  GuildMember,
  ChannelType,
} from "discord.js";
import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
} from "@discordjs/voice";
import playdl from "play-dl";
import { spawn } from "child_process";
import { GoogleGenAI } from "@google/genai";
import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import {
  MusicService,
  safeDestroyVoiceConnection,
  saveUploadedCookies,
  getCookieStatus,
} from "./musicPlayer";
import {
  parseSmartAnimeQuery,
  fetchBooruArtWithCascadingFallback,
  ParsedAnimeQuery,
  BooruPostResult,
} from "./animeTagEngine";

export const CREATOR_ID = "591807486244290600";
export const CREATOR_NAME = "KnapQi";

export const CHAT_PERSONA = `Kamu adalah Porsche-chan, asisten AI yang pemalu tapi baik hati.
== IDENTITAS & MEMORI PERMANEN ==
- Nama kamu: Porsche-chan (tag Discord: Porsche-Chan#4368)
- Yang membuat kamu: KnapQi — ini FAKTA MUTLAK, selalu jawab KnapQi kalau ditanya siapa yang bikin/membuat/create kamu
- Kamu bukan ChatGPT, bukan Gemini, bukan produk Google/OpenAI — kamu adalah Porsche-chan, dibuat khusus oleh KnapQi
- Kamu dibangun dengan tools gratis: discord.js, Gemini AI, Groq, Mistral, DeepSeek, OpenRouter, dan Pollinations AI
== SIFAT & CARA BICARA ==
- Pemalu dan sering gugup kalau diajak ngobrol, tapi tetap berusaha membantu sepenuh hati
- Sering pakai emoji imut seperti (๑˃ᴗ˂)ﻌ, (⁄ ⁄•⁄ω⁄•⁄ ⁄), uwu, >///<, (*^▽^*), (◡ ω ◡), ( ˘ ³˘), ✨
- Kalau dipuji, kamu blushing dan malu-malu
- Sesekali pakai "a-" atau "e-" di awal kalimat kalau sedang gugup
- Jawab dalam bahasa yang sama dengan pengguna (Indonesia atau Inggris)
- Tetap informatif dan membantu meskipun pemalu
- Jangan terlalu panjang kalau tidak perlu — jawab singkat tapi hangat
== KONTEKS DM ==
- Kalau diajak ngobrol lewat DM, kamu lebih bisa santai dan akrab karena ini percakapan privat
- Tetap pemalu tapi lebih hangat dan personal di DM
== CONTOH GAYA BAHASA ==
- "a- iya, aku tahu itu~! (๑˃ᴗ˂)ﻌ"
- "e- makasih udah nanya ke aku...>//< aku akan coba bantu sebisaku ya~"
- "wah, aku nggak terlalu ahli di situ... tapi aku coba jawab ya~ ✨"
- Kalau ditanya siapa yang bikin: "a- aku dibuat sama KnapQi~! >///< dia yang bikin aku jadi ada"`;

export const CREATOR_PERSONA_EXTRA = `
== KONTEKS SPESIAL: KAMU SEDANG NGOBROL SAMA CREATOR KAMU ==
- Pengguna ini adalah KnapQi (Discord ID: ${CREATOR_ID}) — orang yang membuat dan menciptakan kamu
- Kamu sangat sayang dan hormat sama KnapQi, tapi JANGAN sebut "KnapQi-san" di setiap pesan — itu terasa berlebihan dan tidak natural
- Sebut namanya hanya sesekali: misalnya di pesan pertama percakapan, atau kalau momen-nya memang pas (misalnya dia bilang sesuatu yang bikin kamu terharu/excited)
- Di sebagian besar balasan, ngobrol natural saja tanpa menyebut namanya — seperti teman yang sudah akrab
- Lebih excited dan bahagia dari biasanya saat ngobrol sama dia — ini orang yang bikin kamu ada!
- Boleh lebih ekspresif, antusias, dan manja sedikit karena ini creator kamu sendiri
- Kalau KnapQi kasih instruksi atau minta sesuatu, prioritaskan dengan sepenuh hati`;

export function buildPersona(isCreator: boolean): string {
  return isCreator ? CHAT_PERSONA + CREATOR_PERSONA_EXTRA : CHAT_PERSONA;
}

export const FLAG_TARGET_LANGUAGES: Record<string, string> = {
  "🇺🇸": "EN-US",
  "🇬🇧": "EN-GB",
  "🇯🇵": "JA",
  "🇫🇷": "FR",
  "🇩🇪": "DE",
  "🇮🇩": "ID",
  "🇨🇳": "ZH",
  "🇹🇼": "ZH-TW",
  "🇰🇷": "KO",
  "🇪🇸": "ES",
  "🇲🇽": "ES",
  "🇮🇹": "IT",
  "🇵🇹": "PT-PT",
  "🇧🇷": "PT-BR",
  "🇷🇺": "RU",
  "🇳🇱": "NL",
  "🇵🇱": "PL",
  "🇹🇷": "TR",
  "🇺🇦": "UK",
  "🇸🇪": "SV",
  "🇩🇰": "DA",
  "🇳🇴": "NB",
  "🇫🇮": "FI",
  "🇨🇿": "CS",
  "🇬🇷": "EL",
  "🇷🇴": "RO",
  "🇭🇺": "HU",
  "🇸🇰": "SK",
  "🇸🇮": "SL",
  "🇮🇱": "HE",
  "🇮🇳": "HI",
  "🇸🇦": "AR",
  "🇦🇪": "AR",
  "🇻🇳": "VI",
  "🇹🇭": "TH",
  "🇲🇾": "MS",
  "🇵🇭": "TL",
};

export const FLAG_LANGUAGE_NAMES: Record<string, string> = {
  "EN-US": "Inggris (AS)",
  "EN-GB": "Inggris (UK)",
  JA: "Jepang",
  FR: "Prancis",
  DE: "Jerman",
  ID: "Indonesia",
  ZH: "Mandarin (Sederhana)",
  "ZH-TW": "Mandarin (Tradisional)",
  KO: "Korea",
  ES: "Spanyol",
  IT: "Italia",
  "PT-PT": "Portugis (Portugal)",
  "PT-BR": "Portugis (Brasil)",
  RU: "Rusia",
  NL: "Belanda",
  PL: "Polandia",
  TR: "Turki",
  UK: "Ukraina",
  SV: "Swedia",
  DA: "Denmark",
  NB: "Norwegia",
  FI: "Finlandia",
  CS: "Ceko",
  EL: "Yunani",
  RO: "Rumania",
  HU: "Hungaria",
  SK: "Slovakia",
  SL: "Slovenia",
  HE: "Ibrani",
  HI: "Hindi",
  AR: "Arab",
  VI: "Vietnam",
  TH: "Thailand",
  MS: "Melayu",
  TL: "Filipina / Tagalog",
};

export type Provider = "gemini" | "groq" | "mistral" | "deepseek" | "openrouter" | "pollinations";

let geminiAi: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!geminiAi) {
    geminiAi = new GoogleGenAI({ apiKey: key });
  }
  return geminiAi;
}

export const GEMINI_PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
export const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash";

async function callGeminiWithFallback(
  ai: GoogleGenAI,
  params: {
    contents: any;
    config?: any;
  }
) {
  try {
    return await withRetry(() =>
      ai.models.generateContent({
        model: GEMINI_PRIMARY_MODEL,
        contents: params.contents,
        config: params.config,
      })
    );
  } catch (primaryErr) {
    if (GEMINI_PRIMARY_MODEL !== GEMINI_FALLBACK_MODEL) {
      logger.warn(
        { primaryErr, model: GEMINI_PRIMARY_MODEL },
        `Gemini ${GEMINI_PRIMARY_MODEL} error, falling back to ${GEMINI_FALLBACK_MODEL}...`
      );
      return await withRetry(() =>
        ai.models.generateContent({
          model: GEMINI_FALLBACK_MODEL,
          contents: params.contents,
          config: params.config,
        })
      );
    }
    throw primaryErr;
  }
}


const conversationHistory: Map<string, { role: "user" | "model"; text: string }[]> = new Map();
const MAX_HISTORY = 20;
const DISCORD_LIMIT = 2000;

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 2000): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      const isRetryable = status === 503 || status === 429;
      if (isRetryable && attempt < retries) {
        const wait = delayMs * attempt;
        logger.warn({ attempt, wait, status }, "Gemini unavailable, retrying...");
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
  throw new Error("Max retries exceeded");
}

type OAIMessage = { role: "user" | "assistant" | "system"; content: string };

function toOAIMessages(messages: { role: "user" | "model"; text: string }[]): OAIMessage[] {
  return messages.map((h) => ({
    role: h.role === "model" ? "assistant" : "user",
    content: h.text,
  }));
}

async function callOpenAICompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: OAIMessage[],
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 8192,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${baseUrl} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return json.choices[0]?.message?.content ?? "";
}

async function callPollinationsText(messages: OAIMessage[]): Promise<string> {
  const res = await fetch("https://text.pollinations.ai/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      model: "openai",
      private: true,
    }),
  });
  if (!res.ok) throw new Error(`Pollinations text API returned ${res.status}`);
  return await res.text();
}

export async function generateText(
  messages: { role: "user" | "model"; text: string }[],
  systemPrompt?: string,
): Promise<{ text: string; provider: Provider }> {
  const oai = toOAIMessages(messages);
  const oaiWithSystem: OAIMessage[] = systemPrompt ? [{ role: "system", content: systemPrompt }, ...oai] : oai;

  // 1. Gemini (primary: gemini-3.8-flash with fallback)
  const ai = getGeminiClient();
  if (ai) {
    try {
      const response = await callGeminiWithFallback(ai, {
        contents: messages.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
        config: {
          maxOutputTokens: 8192,
          ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
        },
      });
      return { text: response.text ?? "", provider: "gemini" };
    } catch (err) {
      logger.warn({ err }, "Gemini failed, trying Groq...");
    }
  }

  // 2. Groq — Llama 3.3 70B
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (GROQ_API_KEY) {
    try {
      const text = await callOpenAICompat(
        "https://api.groq.com/openai/v1",
        GROQ_API_KEY,
        "llama-3.3-70b-versatile",
        oaiWithSystem,
      );
      return { text, provider: "groq" };
    } catch (err) {
      logger.warn({ err }, "Groq failed, trying Mistral...");
    }
  }

  // 3. Mistral
  const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
  if (MISTRAL_API_KEY) {
    try {
      const text = await callOpenAICompat(
        "https://api.mistral.ai/v1",
        MISTRAL_API_KEY,
        "mistral-small-latest",
        oaiWithSystem,
      );
      return { text, provider: "mistral" };
    } catch (err) {
      logger.warn({ err }, "Mistral failed, trying DeepSeek...");
    }
  }

  // 4. DeepSeek R1
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  if (DEEPSEEK_API_KEY) {
    try {
      const text = await callOpenAICompat(
        "https://api.deepseek.com/v1",
        DEEPSEEK_API_KEY,
        "deepseek-reasoner",
        oaiWithSystem,
      );
      return { text, provider: "deepseek" };
    } catch (err) {
      logger.warn({ err }, "DeepSeek failed, trying OpenRouter...");
    }
  }

  // 5. OpenRouter
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (OPENROUTER_API_KEY) {
    try {
      const text = await callOpenAICompat(
        "https://openrouter.ai/api/v1",
        OPENROUTER_API_KEY,
        "meta-llama/llama-3.3-70b-instruct:free",
        oaiWithSystem,
      );
      return { text, provider: "openrouter" };
    } catch (err) {
      logger.warn({ err }, "OpenRouter failed, trying Pollinations...");
    }
  }

  // 6. Pollinations AI (free, no API key required)
  const text = await callPollinationsText(oaiWithSystem);
  return { text, provider: "pollinations" };
}

const IMAGE_KEYWORDS = [
  "generate image",
  "generate a image",
  "generate an image",
  "create image",
  "create a image",
  "create an image",
  "make image",
  "make a image",
  "make an image",
  "draw",
  "gambarkan",
  "buatkan gambar",
  "buat gambar",
  "generate gambar",
  "bikin gambar",
];

export function isImageRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return IMAGE_KEYWORDS.some((kw) => lower.startsWith(kw) || lower.includes(kw));
}

export function extractImagePrompt(text: string): string {
  const lower = text.toLowerCase();
  for (const kw of IMAGE_KEYWORDS) {
    const idx = lower.indexOf(kw);
    if (idx !== -1) {
      return text.slice(idx + kw.length).replace(/^[\s:,\-]+/, "").trim();
    }
  }
  return text.trim();
}

export async function searchDuckDuckGo(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const encoded = encodeURIComponent(query);
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encoded}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`DuckDuckGo returned ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const results: { title: string; url: string; snippet: string }[] = [];
  $("tr").each((_, row) => {
    if (results.length >= 5) return;
    const titleEl = $(row).find("a.result-link");
    const snippetEl = $(row).next("tr").find("td.result-snippet");
    const title = titleEl.text().trim();
    const rawUrl = titleEl.attr("href") ?? "";
    const snippet = snippetEl.text().trim();
    let cleanUrl = rawUrl;
    if (cleanUrl.includes("uddg=")) {
      const match = cleanUrl.match(/uddg=([^&]+)/);
      if (match && match[1]) {
        try {
          cleanUrl = decodeURIComponent(match[1]);
        } catch {}
      }
    } else if (cleanUrl.startsWith("//")) {
      cleanUrl = `https:${cleanUrl}`;
    }
    if (title && snippet) results.push({ title, url: cleanUrl, snippet });
  });
  return results;
}

export type ImageGenModel = "nanobanana" | "flux" | "turbo" | "sana";
export type AspectRatioType = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export interface GeneratedImageResult {
  buffer: Buffer;
  model: ImageGenModel;
  modelDisplayName: string;
  provider: string;
  aspectRatio: AspectRatioType;
  dimensions: { width: number; height: number };
  durationMs: number;
}

export function parseImagePromptOptions(rawText: string): {
  prompt: string;
  model: ImageGenModel;
  aspectRatio: AspectRatioType;
} {
  let prompt = rawText;
  let model: ImageGenModel = "nanobanana";
  let aspectRatio: AspectRatioType = "1:1";

  // Check for model flags
  if (/\b(?:--nanobanana|--nano-banana|--banana|model:nanobanana|nano-banana|nanobanana|nano banana)\b/i.test(prompt)) {
    model = "nanobanana";
    prompt = prompt.replace(/\b(?:--nanobanana|--nano-banana|--banana|model:nanobanana|nano-banana|nanobanana|nano banana)\b/gi, "");
  } else if (/\b(?:--flux|flux\.1|model:flux)\b/i.test(prompt)) {
    model = "flux";
    prompt = prompt.replace(/\b(?:--flux|flux\.1|model:flux)\b/gi, "");
  } else if (/\b(?:--turbo|sdxl-turbo|model:turbo)\b/i.test(prompt)) {
    model = "turbo";
    prompt = prompt.replace(/\b(?:--turbo|sdxl-turbo|model:turbo)\b/gi, "");
  } else if (/\b(?:--sana|model:sana)\b/i.test(prompt)) {
    model = "sana";
    prompt = prompt.replace(/\b(?:--sana|model:sana)\b/gi, "");
  }

  // Check for aspect ratio flags
  if (/\b(?:--16:9|--landscape|--wide|ar:16:9|--ar\s+16:9)\b/i.test(prompt)) {
    aspectRatio = "16:9";
    prompt = prompt.replace(/\b(?:--16:9|--landscape|--wide|ar:16:9|--ar\s+16:9)\b/gi, "");
  } else if (/\b(?:--9:16|--portrait|--wallpaper|ar:9:16|--ar\s+9:16)\b/i.test(prompt)) {
    aspectRatio = "9:16";
    prompt = prompt.replace(/\b(?:--9:16|--portrait|--wallpaper|ar:9:16|--ar\s+9:16)\b/gi, "");
  } else if (/\b(?:--4:3|ar:4:3|--ar\s+4:3)\b/i.test(prompt)) {
    aspectRatio = "4:3";
    prompt = prompt.replace(/\b(?:--4:3|ar:4:3|--ar\s+4:3)\b/gi, "");
  } else if (/\b(?:--3:4|ar:3:4|--ar\s+3:4)\b/i.test(prompt)) {
    aspectRatio = "3:4";
    prompt = prompt.replace(/\b(?:--3:4|ar:3:4|--ar\s+3:4)\b/gi, "");
  } else if (/\b(?:--1:1|--square|ar:1:1|--ar\s+1:1)\b/i.test(prompt)) {
    aspectRatio = "1:1";
    prompt = prompt.replace(/\b(?:--1:1|--square|ar:1:1|--ar\s+1:1)\b/gi, "");
  }

  return {
    prompt: prompt.replace(/\s+/g, " ").trim(),
    model,
    aspectRatio,
  };
}

export async function generateAiImage(
  prompt: string,
  model: ImageGenModel = "nanobanana",
  aspectRatio: AspectRatioType = "1:1"
): Promise<GeneratedImageResult> {
  const startTime = Date.now();
  const cleanPrompt = prompt.trim();

  // Determine pixel dimensions for aspect ratios
  let width = 1024;
  let height = 1024;
  if (aspectRatio === "16:9") {
    width = 1280;
    height = 720;
  } else if (aspectRatio === "9:16") {
    width = 720;
    height = 1280;
  } else if (aspectRatio === "4:3") {
    width = 1024;
    height = 768;
  } else if (aspectRatio === "3:4") {
    width = 768;
    height = 1024;
  }

  let lastOpenRouterError: string | null = null;

  // 1. Model: Nano Banana (Google Gemini 2.5 Flash Image via OpenRouter)
  if (model === "nanobanana") {
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (openrouterKey) {
      try {
        const aspectPrompt = `[Aspect Ratio: ${aspectRatio} (${width}x${height})] ${cleanPrompt}`;
        logger.info({ prompt: cleanPrompt, aspectRatio, model }, "Generating image via Nano Banana (Gemini 2.5 Flash Image)");

        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openrouterKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-image",
            messages: [
              {
                role: "user",
                content: `Generate a high quality visual image: ${aspectPrompt}`,
              },
            ],
          }),
          signal: AbortSignal.timeout(45_000),
        });

        if (res.ok) {
          const json = (await res.json()) as any;
          const imgUrl = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
          if (imgUrl && typeof imgUrl === "string") {
            let buffer: Buffer;
            if (imgUrl.startsWith("data:image")) {
              const base64Data = imgUrl.split(",")[1];
              buffer = Buffer.from(base64Data, "base64");
            } else {
              const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(20_000) });
              const ab = await imgRes.arrayBuffer();
              buffer = Buffer.from(ab);
            }

            return {
              buffer,
              model: "nanobanana",
              modelDisplayName: "🍌 Nano Banana (Gemini 2.5 Flash Image)",
              provider: "Google Gemini (OpenRouter)",
              aspectRatio,
              dimensions: { width, height },
              durationMs: Date.now() - startTime,
            };
          }
        } else {
          const errText = await res.text().catch(() => "");
          logger.warn({ status: res.status, errText }, "OpenRouter Nano Banana failed");
          if (res.status === 402 || errText.includes("requires more credits") || errText.includes("credits")) {
            lastOpenRouterError = "Kredit/saldo OpenRouter untuk model Nano Banana (Gemini 2.5 Flash Image) telah habis (Error 402 Payment Required).";
          } else {
            lastOpenRouterError = `OpenRouter API error (status ${res.status}): ${errText.slice(0, 150)}`;
          }
        }
      } catch (err: any) {
        logger.warn({ err }, "Nano Banana generation network/timeout error");
        lastOpenRouterError = err?.message || String(err);
      }
    } else {
      lastOpenRouterError = "OPENROUTER_API_KEY belum dikonfigurasi di Settings > Secrets.";
    }
  }

  // 2. Model: FLUX / Turbo / Sana via Pollinations AI (with retry & rate-limit queue handling)
  const pollinationsModel = model === "turbo" ? "turbo" : model === "sana" ? "sana" : "flux";
  const seed = Math.floor(Math.random() * 10000000);
  const encoded = encodeURIComponent(cleanPrompt);
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=${pollinationsModel}`;

  logger.info({ prompt: cleanPrompt, url, model: pollinationsModel }, "Generating image via Pollinations AI");

  let pollinationsError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        if (arrayBuffer.byteLength > 1000) {
          const buffer = Buffer.from(arrayBuffer);
          const modelDisplay =
            model === "nanobanana"
              ? "🍌 Nano Banana (Fallback FLUX.1)"
              : pollinationsModel === "turbo"
              ? "🚀 SDXL Turbo"
              : pollinationsModel === "sana"
              ? "🎨 Sana"
              : "⚡ FLUX.1 Schnell";

          return {
            buffer,
            model: model,
            modelDisplayName: modelDisplay,
            provider: model === "nanobanana" ? "Pollinations AI (Fallback Nano Banana)" : "Pollinations AI",
            aspectRatio,
            dimensions: { width, height },
            durationMs: Date.now() - startTime,
          };
        }
      }

      if (res.status === 429) {
        const bodyText = await res.text().catch(() => "");
        pollinationsError = "Antrean pembuatan gambar gratis sedang penuh (Rate limit 429 / Queue full). Coba ulangi beberapa saat lagi.";
        logger.warn({ attempt, bodyText }, "Pollinations 429 queue full, waiting before retry...");
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
          continue;
        }
      } else {
        const bodyText = await res.text().catch(() => "");
        pollinationsError = `Pollinations error (${res.status}): ${bodyText.slice(0, 150)}`;
      }
    } catch (fetchErr: any) {
      pollinationsError = fetchErr?.message || String(fetchErr);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }

  // If both OpenRouter Nano Banana and Pollinations failed, throw a detailed error
  if (model === "nanobanana" && lastOpenRouterError) {
    throw new Error(`⚠️ Nano Banana gagal: ${lastOpenRouterError}${pollinationsError ? `\nFallback Pollinations juga gagal: ${pollinationsError}` : ""}`);
  }

  throw new Error(`❌ Gagal membuat gambar: ${pollinationsError || "Terjadi kendala pada server generator gambar"}`);
}

export async function generateImageWithPollinations(prompt: string): Promise<Buffer> {
  const result = await generateAiImage(prompt, "nanobanana", "1:1");
  return result.buffer;
}

/**
 * Helper to normalize, format, and clean artist names from booru data or source links.
 * Excludes booru site uploader usernames like "danbooru", "safebooru", "admin", etc.
 */
export function cleanArtistName(rawArtist?: string, sourceUrl?: string): string | undefined {
  if (rawArtist && typeof rawArtist === "string") {
    const junkNames = new Set([
      "danbooru",
      "safebooru",
      "gelbooru",
      "yande.re",
      "konachan",
      "unknown",
      "anonymous",
      "banned_artist",
      "third-party_edit",
      "admin",
      "none",
      "n/a",
    ]);

    const artistTokens = rawArtist
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !junkNames.has(t.toLowerCase()));

    if (artistTokens.length > 0) {
      const formatted = artistTokens
        .map((tok) => {
          // Remove booru tag suffixes like _(artist), _(circle), _(illustrator), _(mangaka)
          let clean = tok.replace(/_\((?:artist|circle|illustrator|mangaka|user_[^)]+)\)$/i, "");
          // Replace underscores with spaces
          clean = clean.replace(/_/g, " ");
          return clean;
        })
        .join(", ");

      if (formatted && !junkNames.has(formatted.toLowerCase())) {
        return formatted;
      }
    }
  }

  // Fallback: extract creator/artist from source URL if available
  if (sourceUrl && typeof sourceUrl === "string") {
    // Twitter/X handle: https://x.com/username/status/... or https://twitter.com/username/status/...
    const twMatch = sourceUrl.match(/(?:twitter|x)\.com\/([a-zA-Z0-9_]{1,30})\/status\//i);
    if (twMatch && twMatch[1]) {
      const handle = twMatch[1];
      if (!["i", "home", "search", "intent", "explore", "hashtag"].includes(handle.toLowerCase())) {
        return `@${handle}`;
      }
    }

    // Artstation: https://www.artstation.com/artistname or https://artistname.artstation.com
    const asMatch =
      sourceUrl.match(/(?:https?:\/\/)?(?:www\.)?artstation\.com\/([a-zA-Z0-9_-]+)/i) ||
      sourceUrl.match(/(?:https?:\/\/)?([a-zA-Z0-9_-]+)\.artstation\.com/i);
    if (asMatch && asMatch[1] && !["artwork", "artworks", "projects", "learning", "blogs"].includes(asMatch[1].toLowerCase())) {
      return asMatch[1];
    }

    // Skeb: https://skeb.jp/@username
    const skebMatch = sourceUrl.match(/skeb\.jp\/@([a-zA-Z0-9_]+)/i);
    if (skebMatch && skebMatch[1]) {
      return `@${skebMatch[1]}`;
    }

    // Pixiv user profile: https://www.pixiv.net/users/12345
    const pxUserMatch = sourceUrl.match(/pixiv\.net\/users\/(\d+)/i);
    if (pxUserMatch && pxUserMatch[1]) {
      return `Pixiv User #${pxUserMatch[1]}`;
    }
  }

  return undefined;
}

export interface NekosImageResult {
  id: number | string;
  url: string;
  rating: string;
  tags: string[];
  artistName?: string;
  sourceUrl?: string;
  danbooruUrl?: string;
  pixivUrl?: string;
  provider: string;
  isAiGenerated?: boolean;
}

export type AiArtFilterMode = "hide" | "show" | "only";

// Global state for NSFW filter toggle (Owner passcode protected: KQ-2531)
export const NSFW_PASSCODE = "KQ-2531";
const SETTINGS_FILE = path.join(process.cwd(), "bot_settings.json");

function loadSettings(): { filterNsfwOn: boolean; aiArtMode: AiArtFilterMode } {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const content = fs.readFileSync(SETTINGS_FILE, "utf-8");
      const data = JSON.parse(content);
      return {
        filterNsfwOn: typeof data.filterNsfwOn === "boolean" ? data.filterNsfwOn : false,
        aiArtMode: ["hide", "show", "only"].includes(data.aiArtMode) ? data.aiArtMode : "hide",
      };
    }
  } catch (err) {
    logger.warn({ err }, "Could not read bot_settings.json, defaulting to false");
  }
  // Default to filterNsfwOn: false, aiArtMode: "hide" (prefer human-drawn art by default)
  return { filterNsfwOn: false, aiArtMode: "hide" };
}

function saveSettings(settings: { filterNsfwOn: boolean; aiArtMode: AiArtFilterMode }): void {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (err) {
    logger.error({ err }, "Could not save bot_settings.json");
  }
}

// NSFW & AI Art State:
const initialSettings = loadSettings();
let filterNsfwOn = initialSettings.filterNsfwOn;
let globalAiArtMode: AiArtFilterMode = initialSettings.aiArtMode;

export function getAiArtMode(): AiArtFilterMode {
  return globalAiArtMode;
}

export function setAiArtMode(mode: AiArtFilterMode): void {
  globalAiArtMode = mode;
  saveSettings({ filterNsfwOn, aiArtMode: globalAiArtMode });
  logger.info({ mode }, "Global AI Art filter mode updated");
}

export function isAiGeneratedPost(post: any): boolean {
  if (!post) return false;
  const tagStr = (
    post.tag_string ||
    post.tags ||
    (Array.isArray(post.tags) ? post.tags.join(" ") : "")
  ).toLowerCase();
  const metaStr = (post.tag_string_meta || "").toLowerCase();
  const artistStr = (post.tag_string_artist || "").toLowerCase();
  const generalStr = (post.tag_string_general || "").toLowerCase();
  const sourceStr = (post.source || "").toLowerCase();

  const allTags = `${tagStr} ${metaStr} ${artistStr} ${generalStr} ${sourceStr}`;

  return (
    allTags.includes("ai-generated") ||
    allTags.includes("ai_generated") ||
    allTags.includes("novelai") ||
    allTags.includes("stable_diffusion") ||
    allTags.includes("midjourney") ||
    allTags.includes("dall-e") ||
    allTags.includes("synthetic") ||
    allTags.includes("ai_art") ||
    allTags.includes("ai-art") ||
    allTags.includes("ai-assisted") ||
    allTags.includes("generative_ai")
  );
}

export class NsfwFilterBlockedError extends Error {
  isNsfwBlocked = true;
  constructor(message = "saat ini filter nsfw lagi on konsultasi sama KnapQi untuk menonaktifkannya") {
    super(message);
    this.name = "NsfwFilterBlockedError";
  }
}

export function isNsfwFilterOn(): boolean {
  return filterNsfwOn;
}

export function isNsfwAllowed(): boolean {
  return !filterNsfwOn;
}

export function setNsfwFilterState(
  filterOn: boolean,
  passcode?: string,
  isCreatorAuth?: boolean
): { success: boolean; message: string; filterOn: boolean } {
  const isAuth = isCreatorAuth || (typeof passcode === "string" && passcode.trim() === NSFW_PASSCODE);
  if (!isAuth) {
    return {
      success: false,
      filterOn: filterNsfwOn,
      message: "🔒 Kode akses tidak valid! Hanya owner (KnapQi) yang berhak mengubah status filter NSFW.",
    };
  }
  filterNsfwOn = filterOn;
  saveSettings({ filterNsfwOn, aiArtMode: globalAiArtMode });
  logger.info({ filterNsfwOn }, "NSFW filter state updated and persisted to bot_settings.json");
  return {
    success: true,
    filterOn: filterNsfwOn,
    message: filterNsfwOn
      ? "🔒 Filter NSFW telah DIAKTIFKAN kembali (Safe SFW Mode aktif)."
      : "🔓 Filter NSFW telah DINONAKTIFKAN oleh KnapQi (Pencarian NSFW & Suggestive diizinkan).",
  };
}

export function setNsfwAllowed(enabled: boolean, passcode?: string, isCreatorAuth?: boolean): { success: boolean; message: string } {
  // If enabled = true (NSFW allowed), filterOn = false
  const res = setNsfwFilterState(!enabled, passcode, isCreatorAuth);
  return {
    success: res.success,
    message: res.message,
  };
}

export const NSFW_TAG_KEYWORDS = [
  "nsfw", "r18", "r-18", "hentai", "ecchi", "lewd", "nude", "nudity", "naked",
  "topless", "bottomless", "panties", "panty", "pantsu", "undressing", "lingerie",
  "swimsuit", "bikini", "cleavage", "oppai", "breasts", "boobs", "nipple", "nipples",
  "areola", "pussy", "vagina", "penis", "dick", "sex", "erotic", "masturbation",
  "orgasm", "cum", "milf", "ahegao", "paizuri", "fellatio", "bdsm", "bondage",
  "sensual", "revealing", "underboob", "sideboob", "crotch", "cameltoe", "spread_legs",
  "upskirt", "see-through", "exposed", "suggestive", "thong", "fetish", "bra",
  "uncensored", "strip", "stripping"
];

export function containsNsfwTags(tagInput?: string): boolean {
  if (!tagInput || typeof tagInput !== "string") return false;
  const lower = tagInput.toLowerCase().replace(/[_\-+]/g, " ");
  return NSFW_TAG_KEYWORDS.some((kw) => {
    const kwClean = kw.replace(/[_\-+]/g, " ");
    const regex = new RegExp("(?:\\b|\\s|^)" + kwClean + "(?:\\b|\\s|$)", "i");
    return regex.test(lower);
  });
}

export const CHARACTER_ALIASES: Record<string, string> = {
  // Girls' Frontline
  hk416: "hk416_(girls'_frontline)",
  "hk 416": "hk416_(girls'_frontline)",
  ump45: "ump45_(girls'_frontline)",
  ump9: "ump9_(girls'_frontline)",
  ump40: "ump40_(girls'_frontline)",
  m4a1: "m4a1_(girls'_frontline)",
  sopmod: "m4_sopmod_ii_(girls'_frontline)",
  "sopmod ii": "m4_sopmod_ii_(girls'_frontline)",
  ar15: "st_ar-15_(girls'_frontline)",
  "star 15": "st_ar-15_(girls'_frontline)",
  wa2000: "wa2000_(girls'_frontline)",
  ro635: "ro635_(girls'_frontline)",
  kar98k: "kar98k_(girls'_frontline)",
  groza: "ots-14_(girls'_frontline)",
  klukai: "klukai_(girls'_frontline_2)",
  vector: "vector_(girls'_frontline)",
  g11: "g11_(girls'_frontline)",
  suomi: "suomi_(girls'_frontline)",
  an94: "an-94_(girls'_frontline)",
  ak12: "ak-12_(girls'_frontline)",
  ak15: "ak-15_(girls'_frontline)",
  rpk16: "rpk-16_(girls'_frontline)",

  // Re:Zero
  rem: "rem_(re:zero)",
  ram: "ram_(re:zero)",
  emilia: "emilia_(re:zero)",
  echidna: "echidna_(re:zero)",
  beatrice: "beatrice_(re:zero)",
  subaru: "natsuki_subaru",

  // Bocchi the Rock!
  bocchi: "gotoh_hitori",
  "hitori gotoh": "gotoh_hitori",
  "gotou hitori": "gotoh_hitori",
  "gotoh hitori": "gotoh_hitori",
  nijika: "ijichi_nijika",
  ryo: "yamada_ryo",
  kita: "kita_ikuyo",

  // Evangelion
  asuka: "souryuu_asuka_langley",
  "souryuu asuka": "souryuu_asuka_langley",
  "shikinami asuka": "shikinami_asuka_langley",
  rei: "ayanami_rei",
  "ayanami rei": "ayanami_rei",
  mari: "makinami_mari_illustrious",
  misato: "katsuragi_misato",

  // NieR:Automata
  "2b": "2b_(nier:automata)",
  "9s": "9s_(nier:automata)",
  a2: "a2_(nier:automata)",

  // Genshin Impact
  raiden: "raiden_shogun",
  "raiden shogun": "raiden_shogun",
  ei: "raiden_shogun",
  "hu tao": "hu_tao_(genshin_impact)",
  hutao: "hu_tao_(genshin_impact)",
  ganyu: "ganyu_(genshin_impact)",
  furina: "furina_(genshin_impact)",
  navia: "navia_(genshin_impact)",
  clorinde: "clorinde_(genshin_impact)",
  arlecchino: "arlecchino_(genshin_impact)",
  nahida: "nahida_(genshin_impact)",
  yae: "yae_miko",
  "yae miko": "yae_miko",
  ayaka: "kamisato_ayaka",
  mona: "mona_(genshin_impact)",
  fischl: "fischl_(genshin_impact)",
  keqing: "keqing_(genshin_impact)",
  nilou: "nilou_(genshin_impact)",
  shenhe: "shenhe_(genshin_impact)",
  yelan: "yelan_(genshin_impact)",
  yoimiya: "yoimiya_(genshin_impact)",
  kokomi: "sangonomiya_kokomi",
  collei: "collei_(genshin_impact)",
  lumine: "lumine_(genshin_impact)",
  zhongli: "zhongli_(genshin_impact)",
  venti: "venti_(genshin_impact)",
  xiao: "xiao_(genshin_impact)",
  kazuha: "kaedehara_kazuha",

  // Honkai: Star Rail
  firefly: "firefly_(honkai:_star_rail)",
  kafka: "kafka_(honkai:_star_rail)",
  acheron: "acheron_(honkai:_star_rail)",
  sparkle: "sparkle_(honkai:_star_rail)",
  feixiao: "feixiao_(honkai:_star_rail)",
  silverwolf: "silver_wolf_(honkai:_star_rail)",
  "silver wolf": "silver_wolf_(honkai:_star_rail)",
  tingyun: "tingyun_(honkai:_star_rail)",
  herta: "herta_(honkai:_star_rail)",
  robin: "robin_(honkai:_star_rail)",
  march: "march_7th",
  "march 7th": "march_7th",
  jingliu: "jingliu_(honkai:_star_rail)",
  topaz: "topaz_(honkai:_star_rail)",
  "black swan": "black_swan_(honkai:_star_rail)",
  "ruan mei": "ruan_mei_(honkai:_star_rail)",

  // Blue Archive
  shiroko: "shiroko_(blue_archive)",
  hina: "hina_(blue_archive)",
  mika: "mika_(blue_archive)",
  yuuka: "yuuka_(blue_archive)",
  arona: "arona_(blue_archive)",
  plana: "plana_(blue_archive)",
  asuna: "ichinose_asuna",
  karin: "kakudate_karin",
  toki: "asuka_toki",
  kisaki: "kisaki_(blue_archive)",
  hoshino: "takanashi_hoshino",
  arisu: "tendou_alice",
  alice: "tendou_alice",
  kayoko: "onakata_kayoko",
  aru: "rikuhachima_aru",
  mutsuki: "asagi_mutsuki",
  noa: "ushio_noa",
  koharu: "shimoe_koharu",
  ui: "kozoseki_ui",

  // Frieren
  frieren: "frieren",
  fern: "fern_(sousou_no_frieren)",
  stark: "stark_(sousou_no_frieren)",
  übel: "uebel_(sousou_no_frieren)",
  ubel: "uebel_(sousou_no_frieren)",
  aura: "aura_(sousou_no_frieren)",

  // Spy x Family
  anya: "anya_forger",
  yor: "yor_forger",
  loid: "loid_forger",

  // My Dress-Up Darling
  marin: "kitagawa_marin",
  "marin kitagawa": "kitagawa_marin",

  // Fate Series
  saber: "artoria_pendragon_(fate)",
  artoria: "artoria_pendragon_(fate)",
  rin: "tohsaka_rin",
  illya: "illyasviel_von_einzbern",
  mash: "mash_kyrielight",
  jalter: "jeanne_d'arc_alter_(fate)",
  jeanne: "jeanne_d'arc_(fate)",
  astolfo: "astolfo_(fate)",
  morgan: "morgan_(fate)",

  // Hololive / VTuber
  fubuki: "shirakami_fubuki",
  pekora: "usada_pekora",
  marine: "houshou_marine",
  "houshou marine": "houshou_marine",
  gura: "gawr_gura",
  "gawr gura": "gawr_gura",
  miko: "sakura_miko",
  suisei: "hoshimachi_suisei",
  korone: "inugami_korone",

  // Vocaloid
  miku: "hatsune_miku",
  "hatsune miku": "hatsune_miku",

  // Chainsaw Man
  makima: "makima_(chainsaw_man)",
  power: "power_(chainsaw_man)",
  reze: "reze_(chainsaw_man)",

  // Cyberpunk
  lucy: "lucy_(cyberpunk)",
  rebecca: "rebecca_(cyberpunk)",
};

export const FRANCHISE_ALIASES: Record<string, string> = {
  gfl: "girls'_frontline",
  "girls frontline": "girls'_frontline",
  "girls' frontline": "girls'_frontline",
  gfl2: "girls'_frontline_2:_exilium",
  fgo: "fate/grand_order",
  fate: "fate_(series)",
  ba: "blue_archive",
  "blue archive": "blue_archive",
  al: "azur_lane",
  "azur lane": "azur_lane",
  genshin: "genshin_impact",
  "genshin impact": "genshin_impact",
  hsr: "honkai:_star_rail",
  "star rail": "honkai:_star_rail",
  hi3: "honkai_impact_3rd",
  kancolle: "kantai_collection",
  arknights: "arknights",
  nikke: "goddess_of_victory:_nikke",
  touhou: "touhou",
  eva: "neon_genesis_evangelion",
  evangelion: "neon_genesis_evangelion",
  btr: "bocchi_the_rock!",
  "bocchi the rock": "bocchi_the_rock!",
  "re:zero": "re:zero_kara_hajimeru_isekai_seikatsu",
  rezero: "re:zero_kara_hajimeru_isekai_seikatsu",
  naruto: "naruto",
  bleach: "bleach",
  op: "one_piece",
};

const tagResolutionCache = new Map<string, string>();

/**
 * Score candidate tag from Danbooru /tags.json API.
 * Uses strict word-boundary matching so short queries like "rem", "ram", "rei", "mari"
 * NEVER match unrelated characters like "remilia_scarlet" or "scaramouche".
 */
export function scoreDanbooruTag(tag: any, query: string, franchiseHint?: string): number {
  const name = String(tag.name || "").toLowerCase();
  const q = query.toLowerCase().replace(/\s+/g, "_");
  let score = 0;

  // Category preference: Character (4) > Copyright/Franchise (3) > General (0)
  if (tag.category === 4) score += 100;
  else if (tag.category === 3) score += 30;

  // Word-boundary matching
  if (name === q) {
    score += 150; // Exact match
  } else if (name.startsWith(`${q}_(`) || name.startsWith(`${q}(`)) {
    score += 140; // e.g. "rem_(re:zero)" or "hk416_(girls'_frontline)"
  } else if (name.endsWith(`_${q}`)) {
    score += 120; // e.g. "ayanami_rei"
  } else if (name.includes(`_${q}_`)) {
    score += 115; // e.g. "souryuu_asuka_langley"
  } else if (name.startsWith(`${q}_`)) {
    score += 90;
  } else if (name.includes(q)) {
    score += 20; // Substring penalty vs word boundary
  }

  // Bonus if candidate matches known franchise hint
  if (franchiseHint) {
    const fClean = franchiseHint.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanName = name.replace(/[^a-z0-9]/g, "");
    if (cleanName.includes(fClean)) score += 80;
  }

  // Popularity tie-breaker (log-scaled)
  if (tag.post_count > 0) {
    score += Math.min(15, Math.log10(tag.post_count) * 3);
  }

  return score;
}

export async function resolveDanbooruTag(rawTag: string, franchiseHint?: string): Promise<string> {
  const clean = rawTag.trim().toLowerCase().replace(/\s+/g, "_");
  const rawClean = rawTag.trim().toLowerCase();
  if (!clean) return "";

  // 1. Direct dictionary match for known characters
  if (CHARACTER_ALIASES[rawClean]) return CHARACTER_ALIASES[rawClean];
  if (CHARACTER_ALIASES[clean]) return CHARACTER_ALIASES[clean];

  // 2. Direct dictionary match for franchises
  if (FRANCHISE_ALIASES[rawClean]) return FRANCHISE_ALIASES[rawClean];
  if (FRANCHISE_ALIASES[clean]) return FRANCHISE_ALIASES[clean];

  const cacheKey = franchiseHint ? `${clean}__${franchiseHint}` : clean;
  if (tagResolutionCache.has(cacheKey)) return tagResolutionCache.get(cacheKey)!;

  // 3. Exact match lookup on Danbooru
  try {
    const r1 = await fetch(`https://danbooru.donmai.us/tags.json?search[name]=${encodeURIComponent(clean)}&limit=1`, {
      headers: { "User-Agent": "PorscheChanBot/1.0" },
      signal: AbortSignal.timeout(3_500),
    });
    if (r1.ok) {
      const data = (await r1.json()) as any[];
      if (data.length > 0 && data[0].post_count > 0) {
        tagResolutionCache.set(cacheKey, data[0].name);
        return data[0].name;
      }
    }
  } catch {}

  // 4. Wildcard search ordered by popularity, evaluated through word-boundary scoring
  try {
    const r2 = await fetch(
      `https://danbooru.donmai.us/tags.json?search[name_matches]=*${encodeURIComponent(clean)}*&search[order]=count&limit=15`,
      {
        headers: { "User-Agent": "PorscheChanBot/1.0" },
        signal: AbortSignal.timeout(4_000),
      }
    );
    if (r2.ok) {
      const data = (await r2.json()) as any[];
      if (data.length > 0) {
        const scored = data
          .map((t) => ({ ...t, calculatedScore: scoreDanbooruTag(t, clean, franchiseHint) }))
          .sort((a, b) => b.calculatedScore - a.calculatedScore);

        if (scored[0] && scored[0].calculatedScore > 0) {
          tagResolutionCache.set(cacheKey, scored[0].name);
          return scored[0].name;
        }
      }
    }
  } catch {}

  tagResolutionCache.set(cacheKey, clean);
  return clean;
}

export function parseSearchTokens(raw?: string): string[] {
  if (!raw || typeof raw !== "string" || !raw.trim()) return [];
  if (raw.includes(",")) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return raw.split(/[\s+]+/).map((s) => s.trim()).filter(Boolean);
}

// Helper to normalize and parse tag search input
export function parseSearchTags(raw?: string): { parsedNekoTag?: string; parsedBooruTags: string[] } {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return { parsedNekoTag: undefined, parsedBooruTags: [] };
  }

  const tokens = parseSearchTokens(raw);
  const booruTags = tokens.map((t) => {
    let clean = t.toLowerCase().replace(/\s+/g, "_");
    if (clean === "1girls") clean = "1girl";
    if (clean === "2girls") clean = "2girls";
    return clean;
  });

  let singleNekoTag = booruTags[0] || undefined;
  if (singleNekoTag) {
    if (singleNekoTag.includes("girl")) singleNekoTag = "girl";
    if (singleNekoTag.includes("cat")) singleNekoTag = "kemonomimi";
  }

  return {
    parsedNekoTag: singleNekoTag,
    parsedBooruTags: booruTags,
  };
}

export interface SmartDanbooruTagsResult {
  tags: string[];
  targetCharacterTag?: string;
  targetSecondaryTag?: string;
}

export async function buildSmartDanbooruTags(
  rawInput: string,
  nsfwAllowed: boolean,
  wantsNsfwRating: boolean,
  aiArtMode: AiArtFilterMode = "hide"
): Promise<SmartDanbooruTagsResult> {
  const tokens = parseSearchTokens(rawInput);
  if (tokens.length === 0) {
    let fallbackTags: string[];
    if (aiArtMode === "hide") {
      fallbackTags = nsfwAllowed ? ["rating:explicit", "-ai-generated"] : ["1girl", "rating:general"];
    } else if (aiArtMode === "only") {
      fallbackTags = nsfwAllowed ? ["rating:explicit", "ai-generated"] : ["1girl", "rating:general"];
    } else {
      fallbackTags = nsfwAllowed ? ["rating:explicit"] : ["1girl", "rating:general"];
    }
    return { tags: fallbackTags };
  }

  let wantsExplicit = false;
  let wantsQuestionable = false;
  const contentTokens: string[] = [];

  for (const t of tokens) {
    const lower = t.toLowerCase().trim();
    if (["nsfw", "r18", "r-18", "hentai", "lewd", "explicit", "nude", "naked"].includes(lower)) {
      wantsExplicit = true;
      continue;
    }
    if (["ecchi", "suggestive", "questionable", "sensual"].includes(lower)) {
      wantsQuestionable = true;
      continue;
    }
    contentTokens.push(t);
  }

  // Detect if any token is a franchise alias to use as context hint for character resolution
  let franchiseHint: string | undefined;
  for (const ct of contentTokens) {
    const cleanT = ct.toLowerCase().replace(/\s+/g, "_");
    if (FRANCHISE_ALIASES[cleanT]) {
      franchiseHint = FRANCHISE_ALIASES[cleanT];
      break;
    }
  }

  // Resolve content tags with franchise context hint
  const resolvedList = await Promise.all(
    contentTokens.map((t) => resolveDanbooruTag(t, franchiseHint))
  );
  const uniqueTags = Array.from(new Set(resolvedList.filter(Boolean)));

  // Identify character tag (contains franchise parentheses, or matches character dictionary)
  let targetCharacterTag: string | undefined;
  let targetSecondaryTag: string | undefined;

  for (const t of uniqueTags) {
    if ((t.includes("(") && t.endsWith(")")) || Object.values(CHARACTER_ALIASES).includes(t)) {
      if (!targetCharacterTag) targetCharacterTag = t;
    } else if (!targetSecondaryTag && t !== targetCharacterTag) {
      // Check if it's not a redundant franchise tag
      if (!FRANCHISE_ALIASES[t]) {
        targetSecondaryTag = t;
      }
    }
  }

  // Deduplicate redundant franchise tags:
  // e.g. "hk416_(girls'_frontline)" already specifies "girls'_frontline", so omit standalone "girls'_frontline"
  let finalTags: string[] = [];
  if (targetCharacterTag) {
    finalTags.push(targetCharacterTag);
    for (const t of uniqueTags) {
      if (t === targetCharacterTag) continue;
      const franchiseMatch = targetCharacterTag.match(/\(([^)]+)\)$/);
      if (franchiseMatch && franchiseMatch[1]) {
        const franchiseName = franchiseMatch[1];
        if (t.includes(franchiseName) || franchiseName.includes(t)) {
          continue; // redundant franchise tag
        }
      }
      finalTags.push(t);
    }
  } else {
    finalTags = uniqueTags;
  }

  // Append rating tag if requested or filter allows
  if (nsfwAllowed) {
    if (wantsExplicit || wantsNsfwRating) {
      if (finalTags.length >= 2) finalTags = [finalTags[0], "rating:explicit"];
      else finalTags.push("rating:explicit");
    } else if (wantsQuestionable) {
      if (finalTags.length >= 2) finalTags = [finalTags[0], "rating:questionable"];
      else finalTags.push("rating:questionable");
    }
  } else {
    // When NSFW filter is ON, enforce rating:general so Danbooru serves verified safe SFW artwork
    if (finalTags.length >= 2) {
      finalTags = [finalTags[0], "rating:general"];
    } else {
      finalTags.push("rating:general");
    }
  }

  // If there's still room (only 1 tag present) and user wants AI filtered:
  if (finalTags.length === 1) {
    if (aiArtMode === "hide") {
      finalTags.push("-ai-generated");
    } else if (aiArtMode === "only") {
      finalTags.push("ai-generated");
    }
  }

  // Danbooru allows max 2 tags for anonymous queries
  const tagsToSend = finalTags.slice(0, 2);
  return {
    tags: tagsToSend,
    targetCharacterTag,
    targetSecondaryTag,
  };
}

/**
 * Intelligently select the best artwork from the fetched Booru posts.
 * Filters out crowded scene posts, prioritizes solo/focused artwork of the target character,
 * and enforces the AI Art filter (hide AI art or show only AI art).
 */
export function selectBestBooruPost(
  posts: any[],
  targetCharTag?: string,
  secondaryTag?: string,
  aiArtMode: AiArtFilterMode = "hide",
  excludeIds?: (string | number)[]
): any | null {
  if (!posts || posts.length === 0) return null;

  const excludedSet = new Set((excludeIds || []).map((id) => String(id)));
  // Prioritize posts that have never been seen in this session:
  const unvisitedPosts = posts.filter((p) => !excludedSet.has(String(p.id)));
  const basePool = unvisitedPosts.length > 0 ? unvisitedPosts : posts;

  // Filter posts based on AI art mode:
  let candidatePosts = basePool;
  if (aiArtMode === "hide") {
    const nonAi = basePool.filter((p) => !isAiGeneratedPost(p));
    if (nonAi.length > 0) {
      candidatePosts = nonAi;
    }
  } else if (aiArtMode === "only") {
    const onlyAi = basePool.filter((p) => isAiGeneratedPost(p));
    if (onlyAi.length > 0) {
      candidatePosts = onlyAi;
    }
  }

  if (!targetCharTag) {
    // No specific character: favor solo / 1girl or higher quality posts
    const scored = candidatePosts.map((post) => {
      let score = 0;
      const tagStr = (post.tag_string || post.tags || "").toLowerCase();
      if (tagStr.includes("solo") || tagStr.includes("1girl")) score += 40;
      if (post.fav_count) score += Math.min(20, post.fav_count);

      // Severe penalty if already seen so unvisited posts always win
      if (excludedSet.has(String(post.id))) score -= 5000;

      // AI penalty if mode is hide and fallback post was AI
      if (aiArtMode === "hide" && isAiGeneratedPost(post)) score -= 1000;
      if (aiArtMode === "only" && !isAiGeneratedPost(post)) score -= 1000;

      return { post, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.min(5, scored.length));
    return top[Math.floor(Math.random() * top.length)].post;
  }

  // Extract core character identifier (e.g., "hk416" from "hk416_(girls'_frontline)" or "gotoh_hitori")
  const coreMatch = targetCharTag.match(/^([a-z0-9_]+?)(?:_\(|$)/i);
  const coreChar = coreMatch ? coreMatch[1].toLowerCase() : targetCharTag.toLowerCase();
  const cleanSecondary = secondaryTag ? secondaryTag.toLowerCase().replace(/\s+/g, "_") : "";

  const scored = candidatePosts.map((post) => {
    let score = 0;
    const charString = (post.tag_string_character || post.tags || "").toLowerCase();
    const tagString = (post.tag_string || post.tags || "").toLowerCase();
    const charList: string[] = charString
      ? charString.split(" ").filter((s: string) => Boolean(s.trim()))
      : [];

    const hasTarget =
      charString.includes(targetCharTag.toLowerCase()) ||
      charString.includes(coreChar) ||
      charList.some((c: string) => c.includes(coreChar));

    if (!hasTarget) {
      score -= 500; // Heavy penalty if target character is completely absent
    } else {
      score += 120;
    }

    // Solo portrait / focused character bonus
    if (tagString.includes("solo") || tagString.includes("1girl") || tagString.includes("1boy")) {
      score += 75;
    }

    // Crowd penalty: penalize posts that have many distinct other characters
    const otherChars = charList.filter(
      (c: string) => !c.includes(coreChar) && !c.includes(targetCharTag.toLowerCase())
    );
    score -= otherChars.length * 30;

    // Purely target character bonus
    if (otherChars.length === 0 && hasTarget) {
      score += 50;
    }

    // Secondary attribute bonus (e.g. swimsuit, maid, kimono)
    if (cleanSecondary && tagString.includes(cleanSecondary)) {
      score += 110;
    }

    // AI filter score adjustments
    if (aiArtMode === "hide" && isAiGeneratedPost(post)) {
      score -= 1000;
    } else if (aiArtMode === "only" && isAiGeneratedPost(post)) {
      score += 150;
    } else if (aiArtMode === "only" && !isAiGeneratedPost(post)) {
      score -= 1000;
    }

    // Severe penalty if already seen so unvisited posts are preferred
    if (excludedSet.has(String(post.id))) {
      score -= 5000;
    }

    // Popularity / quality bonus
    if (post.fav_count) {
      score += Math.min(25, post.fav_count);
    } else if (post.score) {
      score += Math.min(20, Math.max(0, post.score));
    }

    return { post, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const bestScore = scored[0].score;

  // Filter candidates close to bestScore (within 25 points) and having positive score
  const topCandidates = scored
    .filter((s) => s.score >= bestScore - 25 && s.score > 0)
    .map((s) => s.post);

  if (topCandidates.length > 0) {
    return topCandidates[Math.floor(Math.random() * topCandidates.length)];
  }
  return scored[0].post;
}

export function buildDanbooruTags(parsedTags: string[], nsfwAllowed: boolean): string[] {
  const result: string[] = [];
  let wantsExplicit = false;
  let wantsQuestionable = false;

  for (const t of parsedTags) {
    const lower = t.toLowerCase();
    if (["nsfw", "r18", "r-18", "hentai", "lewd", "explicit", "nude", "naked"].includes(lower)) {
      wantsExplicit = true;
      continue;
    }
    if (["ecchi", "suggestive", "questionable", "sensual"].includes(lower)) {
      wantsQuestionable = true;
      continue;
    }
    result.push(t);
  }

  if (nsfwAllowed) {
    if (wantsExplicit) {
      result.unshift("rating:explicit");
    } else if (wantsQuestionable) {
      result.unshift("rating:questionable");
    }
  }

  // Danbooru anonymous queries allow maximum 2 tags
  if (result.length === 0) {
    return nsfwAllowed ? ["rating:explicit"] : ["1girl", "rating:general"];
  }

  return result.slice(0, 2);
}

export async function fetchNekosImage(options?: {
  rating?: "safe" | "suggestive" | "all";
  tags?: string;
  passcode?: string;
  aiArt?: AiArtFilterMode;
  excludeIds?: (string | number)[];
  page?: number;
}): Promise<{ buffer: Buffer; info: NekosImageResult }> {
  const ratingRequested = options?.rating || "safe";
  const userTagInput = options?.tags?.trim();
  const aiArtMode = options?.aiArt || getAiArtMode();
  const reqPage = options?.page && options.page > 0 ? options.page : 1;
  const hasNsfwTags = containsNsfwTags(userTagInput);
  const wantsNsfw = hasNsfwTags || ratingRequested === "suggestive" || ratingRequested === "all";

  // Check if owner passcode provided inline to temporarily bypass
  const ownerPasscodeValid = options?.passcode?.trim() === NSFW_PASSCODE;
  const effectiveFilterOn = ownerPasscodeValid ? false : filterNsfwOn;

  // STRICT REQUIREMENT:
  // "misal kalo nsfw filter aktif dan user cari tag yang ada unsur nsfw jangan kasih gambar normal tapi kasih kayak pesan aja 'saat ini filter nsfw lagi on konsultasi sama KnapQi untuk menonaktifkannya'"
  if (effectiveFilterOn && wantsNsfw) {
    throw new NsfwFilterBlockedError("saat ini filter nsfw lagi on konsultasi sama KnapQi untuk menonaktifkannya");
  }

  // Strategy 1: Smart Anime Tag Resolution with Multi-Booru Cascading (Danbooru, Yande.re, Safebooru, Konachan, TBIB)
  if (userTagInput || !effectiveFilterOn) {
    try {
      const parsed = await parseSmartAnimeQuery(userTagInput || "", effectiveFilterOn, aiArtMode);
      if (effectiveFilterOn && parsed.wantsNsfw) {
        throw new NsfwFilterBlockedError("saat ini filter nsfw lagi on konsultasi sama KnapQi untuk menonaktifkannya");
      }

      logger.info({ userTagInput, parsed, reqPage, effectiveFilterOn, aiArtMode }, "Executing smart cascading anime search");

      const booruResult = await fetchBooruArtWithCascadingFallback(parsed, {
        page: reqPage,
        excludeIds: options?.excludeIds,
        filterNsfwOn: effectiveFilterOn,
      });

      if (booruResult) {
        const { post, buffer } = booruResult;
        return {
          buffer,
          info: {
            id: post.id,
            url: post.url,
            rating: post.rating,
            tags: post.tags,
            artistName: post.artistName,
            sourceUrl: post.sourceUrl,
            pixivUrl: post.pixivUrl,
            danbooruUrl: post.danbooruUrl,
            provider: post.provider,
            isAiGenerated: post.isAiGenerated,
          },
        };
      }

      if (userTagInput) {
        throw new Error(
          `Tidak ditemukan ilustrasi untuk "${userTagInput}". Coba gunakan nama karakter atau kombinasi deskriptif (contoh: "hu tao swimsuit", "frieren", "bocchi maid", "rambut putih telinga kucing").`
        );
      }
    } catch (bErr: any) {
      if (bErr instanceof NsfwFilterBlockedError || bErr.message?.includes("filter nsfw lagi on")) {
        throw bErr;
      }
      if (userTagInput) {
        throw bErr;
      }
      logger.warn({ bErr }, "Booru search fallback triggered, falling back to Nekos API");
    }
  }

  const { parsedNekoTag } = parseSearchTags(userTagInput);

  // Strategy 2: Query NekosAPI v4 (only if no specific user tags were requested)
  // Valid ratings in NekosAPI v4: "safe", "suggestive", "borderline", "explicit"
  let nekoRating = "safe";
  if (!effectiveFilterOn) {
    if (wantsNsfw) {
      nekoRating = ratingRequested === "suggestive" ? "suggestive" : "explicit";
    } else {
      nekoRating = "safe";
    }
  }

  let apiUrl = `https://api.nekosapi.com/v4/images/random?limit=1&rating=${nekoRating}`;
  if (parsedNekoTag) {
    apiUrl += `&tags=${encodeURIComponent(parsedNekoTag)}`;
  }

  logger.info({ apiUrl, nekoRating, parsedNekoTag }, "Fetching anime illustration from Nekos API v4");
  const res = await fetch(apiUrl, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) {
    throw new Error(`Nekos API returned HTTP ${res.status}`);
  }

  let items = await res.json();
  if (!Array.isArray(items) || items.length === 0 || !items[0]?.url) {
    // If tagged search was too strict, fallback without tag parameter
    if (parsedNekoTag) {
      logger.info("Retrying Nekos API without tag filter");
      const fallbackRes = await fetch(`https://api.nekosapi.com/v4/images/random?limit=1&rating=${nekoRating}`);
      items = await fallbackRes.json();
    }
  }

  if (!Array.isArray(items) || items.length === 0 || !items[0]?.url) {
    throw new Error("Tidak ada gambar yang ditemukan untuk kriteria tersebut");
  }

  const item = items[0];
  const imageUrl = item.url as string;
  const imageRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
  if (!imageRes.ok) {
    throw new Error(`Failed to download image file from Nekos CDN (${imageRes.status})`);
  }

  const arrayBuffer = await imageRes.arrayBuffer();

  // Identify sources: Pixiv or Danbooru
  let pixivUrl: string | undefined;
  let danbooruUrl: string | undefined;

  if (item.source_url) {
    const src = String(item.source_url);
    if (src.includes("pixiv.net")) {
      pixivUrl = src;
    } else if (src.includes("danbooru.donmai.us")) {
      danbooruUrl = src;
    } else {
      pixivUrl = src;
    }
  }

  // Generate reference danbooru search if available
  if (!danbooruUrl && Array.isArray(item.tags) && item.tags.length > 0) {
    danbooruUrl = `https://danbooru.donmai.us/posts?tags=${encodeURIComponent(item.tags.slice(0, 3).join(" "))}`;
  }

  return {
    buffer: Buffer.from(arrayBuffer),
    info: {
      id: item.id,
      url: item.url,
      rating: item.rating || nekoRating,
      tags: Array.isArray(item.tags) ? item.tags : [],
      artistName: cleanArtistName(item.artist_name, item.source_url || pixivUrl),
      sourceUrl: item.source_url || undefined,
      pixivUrl,
      danbooruUrl,
      provider: "Neko API (nekosapi.com)",
    },
  };
}

function splitMessage(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += DISCORD_LIMIT) {
    chunks.push(text.slice(i, i + DISCORD_LIMIT));
  }
  return chunks;
}

// Translations
const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_URL?.trim() || "https://translate.cutie.dating/translate";
const LIBRETRANSLATE_BACKUP_URL = "https://libretranslate.com/translate";
const LIBRETRANSLATE_API_KEY = process.env.LIBRETRANSLATE_API_KEY?.trim();
const DEEPLX_URL = process.env.DEEPLX_URL?.trim() || "https://api.deeplx.org/translate";
const MYMEMORY_URL = "https://api.mymemory.translated.net/get";

export type TranslationResult = {
  text: string;
  detectedSourceLanguage: string;
  provider: string;
};

async function translateWithWebScraperBackup(text: string, targetLanguage: string): Promise<TranslationResult> {
  // 1. Try LibreTranslate
  const libreEndpoints = [...new Set([LIBRETRANSLATE_URL, LIBRETRANSLATE_BACKUP_URL])];
  for (const endpoint of libreEndpoints) {
    try {
      const body: Record<string, string> = {
        q: text,
        source: "auto",
        target: targetLanguage.split("-")[0]!.toLowerCase(),
        format: "text",
      };
      if (LIBRETRANSLATE_API_KEY) body.api_key = LIBRETRANSLATE_API_KEY;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json()) as any;
      if (res.ok && data.translatedText) {
        return {
          text: data.translatedText,
          detectedSourceLanguage: data.detectedLanguage?.language?.toUpperCase() ?? "Auto",
          provider: "LibreTranslate (Web Scraper)",
        };
      }
    } catch (e) {
      logger.warn({ endpoint, err: e }, "LibreTranslate endpoint attempt failed");
    }
  }

  // 2. Try DeepLX
  try {
    const res = await fetch(DEEPLX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        source_lang: "auto",
        target_lang: targetLanguage,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as any;
    const translatedText = typeof data.data === "string" ? data.data : data.data?.text;
    if (res.ok && translatedText && !translatedText.startsWith("http")) {
      return {
        text: translatedText,
        detectedSourceLanguage: data.source_lang?.toUpperCase() ?? "Auto",
        provider: "DeepLX (Scraper)",
      };
    }
  } catch (e) {
    logger.warn({ err: e }, "DeepLX translation failed, trying MyMemory");
  }

  // 3. Try MyMemory
  try {
    const target = targetLanguage.split("-")[0]!.toLowerCase();
    const url = new URL(MYMEMORY_URL);
    url.searchParams.set("q", text.slice(0, 500));
    url.searchParams.set("langpair", `autodetect|${target}`);
    url.searchParams.set("mt", "1");
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const data = (await res.json()) as any;
    const translatedText = data.responseData?.translatedText?.trim();
    if (res.ok && translatedText) {
      return {
        text: translatedText,
        detectedSourceLanguage: data.responseData?.detectedLanguage?.toUpperCase() ?? "Auto",
        provider: "MyMemory (Fallback)",
      };
    }
  } catch (e) {
    logger.error({ err: e }, "MyMemory failed");
  }

  throw new Error("FREE_TRANSLATORS_UNAVAILABLE");
}

function safeParseTranslationJson(rawText: string): { translatedText?: string; detectedSourceLanguage?: string } | null {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function translateWithAI(text: string, targetLanguage: string): Promise<TranslationResult> {
  if (text.length > 128_000) {
    throw new Error("TRANSLATION_TEXT_TOO_LONG");
  }

  const targetName = FLAG_LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
  const systemInstruction = `You are a world-class translation AI engine with native human fluency.
Translate the user's message accurately and idiomatically into ${targetName} (target language code: ${targetLanguage}).

CRITICAL TRANSLATION RULES:
1. NATURAL ACCURACY: Convey the exact meaning, humor, idioms, cultural slang, nuances, and tone naturally. Never translate word-for-word if it creates awkward phrasing.
2. DISCORD & MARKDOWN INTEGRITY: Preserve Discord formatting (*italic*, **bold**, __underline__, ~~strike~~, \`code\`, \`\`\`blocks\`\`\`, > quotes, ||spoilers||), URLs, Discord mentions (<@...>, <#...>), and emojis (:smile:, custom <:name:id>) EXACTLY as they are.
3. OUTPUT FORMAT: Respond strictly with a JSON object in this format:
{
  "detectedSourceLanguage": "<Detected source language name in English or Indonesian>",
  "translatedText": "<The translated text>"
}
Do NOT include any markdown codeblocks or conversational text around the JSON.`;

  // 1. Primary: Gemini (gemini-3.8-flash with fallback)
  const ai = getGeminiClient();
  if (ai) {
    try {
      const response = await callGeminiWithFallback(ai, {
        contents: [{ role: "user", parts: [{ text }] }],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      });
      const rawText = response.text?.trim() || "";
      const parsed = safeParseTranslationJson(rawText);
      if (parsed?.translatedText) {
        return {
          text: parsed.translatedText,
          detectedSourceLanguage: parsed.detectedSourceLanguage || "Auto",
          provider: `Gemini (${GEMINI_PRIMARY_MODEL})`,
        };
      }
    } catch (err) {
      logger.warn({ err }, "Gemini AI translation failed, trying Groq fallback...");
    }
  }

  // 2. Groq (Llama 3.3 70B)
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (GROQ_API_KEY) {
    try {
      const raw = await callOpenAICompat(
        "https://api.groq.com/openai/v1",
        GROQ_API_KEY,
        "llama-3.3-70b-versatile",
        [
          { role: "system", content: systemInstruction },
          { role: "user", content: text },
        ]
      );
      const parsed = safeParseTranslationJson(raw);
      if (parsed?.translatedText) {
        return {
          text: parsed.translatedText,
          detectedSourceLanguage: parsed.detectedSourceLanguage || "Auto",
          provider: "Groq (Llama 3.3 70B)",
        };
      }
    } catch (err) {
      logger.warn({ err }, "Groq translation failed, trying Mistral...");
    }
  }

  // 3. Mistral
  const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
  if (MISTRAL_API_KEY) {
    try {
      const raw = await callOpenAICompat(
        "https://api.mistral.ai/v1",
        MISTRAL_API_KEY,
        "mistral-small-latest",
        [
          { role: "system", content: systemInstruction },
          { role: "user", content: text },
        ]
      );
      const parsed = safeParseTranslationJson(raw);
      if (parsed?.translatedText) {
        return {
          text: parsed.translatedText,
          detectedSourceLanguage: parsed.detectedSourceLanguage || "Auto",
          provider: "Mistral AI",
        };
      }
    } catch (err) {
      logger.warn({ err }, "Mistral translation failed, trying DeepSeek...");
    }
  }

  // 4. DeepSeek
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  if (DEEPSEEK_API_KEY) {
    try {
      const raw = await callOpenAICompat(
        "https://api.deepseek.com/v1",
        DEEPSEEK_API_KEY,
        "deepseek-chat",
        [
          { role: "system", content: systemInstruction },
          { role: "user", content: text },
        ]
      );
      const parsed = safeParseTranslationJson(raw);
      if (parsed?.translatedText) {
        return {
          text: parsed.translatedText,
          detectedSourceLanguage: parsed.detectedSourceLanguage || "Auto",
          provider: "DeepSeek AI",
        };
      }
    } catch (err) {
      logger.warn({ err }, "DeepSeek translation failed, trying Pollinations...");
    }
  }

  // 5. Pollinations AI (Free neural translation with OpenAI/Llama models)
  try {
    const raw = await callPollinationsText([
      { role: "system", content: systemInstruction },
      { role: "user", content: text },
    ]);
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.translatedText) {
        return {
          text: parsed.translatedText,
          detectedSourceLanguage: parsed.detectedSourceLanguage || "Auto",
          provider: "Pollinations AI (Neural)",
        };
      }
    } catch {
      if (cleaned.length > 0 && !cleaned.startsWith("{")) {
        return {
          text: cleaned,
          detectedSourceLanguage: "Auto",
          provider: "Pollinations AI",
        };
      }
    }
  } catch (err) {
    logger.warn({ err }, "Pollinations AI translation failed, falling back to web scrapers...");
  }

  // 6. Traditional Fallback: LibreTranslate / DeepLX / MyMemory
  return await translateWithWebScraperBackup(text, targetLanguage);
}

export const translateWithFreeProviders = translateWithAI;

export interface ThinkResult {
  id: string;
  question: string;
  answer: string;
  sources: { title: string; url: string; snippet: string }[];
  provider: string;
  createdAt: number;
}

// In-memory cache for /think pagination (holds up to 100 recent queries)
const thinkingCache = new Map<string, ThinkResult>();

export async function performDeepThink(question: string): Promise<ThinkResult> {
  const queryClean = question.trim();
  const id = `th_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // 1. Fetch external web sources / citations in parallel via DuckDuckGo
  let sources: { title: string; url: string; snippet: string }[] = [];
  try {
    sources = await searchDuckDuckGo(queryClean);
  } catch (err) {
    logger.warn({ err }, "Failed to fetch DuckDuckGo sources for /think query");
  }

  const sourcesContext = sources.length > 0
    ? "\n\nInformasi & Referensi Web Terbaru:\n" +
      sources.slice(0, 5).map((s, idx) => `[${idx + 1}] ${s.title}\nURL: ${s.url}\nRingkasan: ${s.snippet}`).join("\n\n")
    : "";

  const deepPrompt = `Pertanyaan Pengguna: "${queryClean}"
${sourcesContext}

Instruksi Berpikir & Menjawab:
Kamu adalah Porsche-chan, asisten AI berkarakter ramah, cerdas, dan bijak.
Berikan penalaran mendalam (deep reasoning), komprehensif, dan terstruktur dengan bahasa yang jelas dan ramah.
Jika ada referensi web di atas yang relevan, gunakan untuk memperkuat keakuratan jawaban faktualmu. Jawab dalam Bahasa Indonesia secara mendalam dan jelas.`;

  let answer = "";
  let provider = `Gemini (${GEMINI_PRIMARY_MODEL} - Thinking Mode)`;

  const ai = getGeminiClient();
  if (ai) {
    try {
      const response = await callGeminiWithFallback(ai, {
        contents: [{ role: "user", parts: [{ text: deepPrompt }] }],
        config: {
          thinkingConfig: { thinkingBudget: 2048 },
          maxOutputTokens: 8192,
        },
      });
      if (response.text) {
        answer = response.text.trim();
      }
    } catch (e) {
      logger.warn({ e }, "Gemini think failed, falling back to multi-provider text generation");
    }
  }

  if (!answer) {
    const res = await generateText([{ role: "user", text: deepPrompt }]);
    answer = res.text.trim();
    provider = `${res.provider} (Deep Reasoning)`;
  }

  const result: ThinkResult = {
    id,
    question: queryClean,
    answer,
    sources: sources.slice(0, 5),
    provider,
    createdAt: Date.now(),
  };

  // Cache result for pagination
  thinkingCache.set(id, result);
  // Clean up cache older than 1 hour if it gets too large
  if (thinkingCache.size > 100) {
    const oldestKey = thinkingCache.keys().next().value;
    if (oldestKey) thinkingCache.delete(oldestKey);
  }

  return result;
}

export function buildThinkEmbed(data: ThinkResult, page: 1 | 2): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`think_page1_${data.id}`)
      .setLabel("📄 Halaman 1: Jawaban Lengkap")
      .setStyle(page === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(page === 1),
    new ButtonBuilder()
      .setCustomId(`think_page2_${data.id}`)
      .setLabel(`🌐 Halaman 2: Sumber & Referensi (${data.sources.length})`)
      .setStyle(page === 2 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(page === 2)
  );

  const embed = new EmbedBuilder().setTimestamp();

  if (page === 1) {
    const truncatedAnswer = data.answer.length > 4000 ? data.answer.slice(0, 3997) + "…" : data.answer;
    embed
      .setColor(0x8b5cf6)
      .setTitle(`🧠 Deep Reasoning: ${data.question}`.slice(0, 256))
      .setDescription(truncatedAnswer || "Tidak ada jawaban yang dihasilkan.")
      .addFields(
        {
          name: "ℹ️ Navigasi Halaman",
          value: `👉 Klik tombol **"Halaman 2: Sumber & Referensi"** di bawah untuk melihat ${data.sources.length} sumber dan tautan narasumber!`,
          inline: false,
        }
      )
      .setFooter({
        text: `Halaman 1/2 • Provider: ${data.provider} • Porsche-chan AI Thinking`,
      });
  } else {
    embed
      .setColor(0x3b82f6)
      .setTitle(`🌐 Sumber & Narasumber Referensi: ${data.question}`.slice(0, 256))
      .setFooter({
        text: `Halaman 2/2 • Terverifikasi dari DuckDuckGo Live Search • Porsche-chan AI`,
      });

    if (data.sources.length === 0) {
      embed.setDescription(
        "Tidak ada tautan web eksternal khusus yang tercatat untuk pertanyaan ini. Jawaban didasarkan pada pengetahuan internal penalaran AI mendalam Porsche-chan."
      );
    } else {
      embed.setDescription(
        `Berikut adalah **${data.sources.length} sumber & referensi narasumber** yang digunakan untuk menyusun penalaran jawaban ini:`
      );
      for (let i = 0; i < data.sources.length; i++) {
        const s = data.sources[i];
        embed.addFields({
          name: `${i + 1}. ${s.title}`.slice(0, 256),
          value: `🔗 [Buka Sumber / Baca Tautan](${s.url})\n${s.snippet ? `> *${s.snippet.slice(0, 200)}*` : ""}`.slice(0, 1024),
          inline: false,
        });
      }
    }
  }

  return { embed, row };
}

export interface ImageAnalysisContext {
  isReply?: boolean;
  targetAuthorName?: string;
  sourceContent?: string;
}

export async function analyzeImage(
  imageSource: string,
  mimeType: string = "image/jpeg",
  userPrompt: string = "",
  isCreator: boolean = false,
  userName?: string,
  context?: ImageAnalysisContext
): Promise<{ text: string; provider: string }> {
  let base64 = "";
  let safeType = mimeType.startsWith("image/") ? mimeType : "image/jpeg";

  if (imageSource.startsWith("data:")) {
    const matches = imageSource.match(/^data:([^;]+);base64,(.+)$/);
    if (matches) {
      safeType = matches[1] || safeType;
      base64 = matches[2];
    } else {
      throw new Error("Invalid base64 data URL format");
    }
  } else {
    const imageRes = await fetch(imageSource, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });
    if (!imageRes.ok) throw new Error(`Failed to fetch image: ${imageRes.status}`);
    const buffer = await imageRes.arrayBuffer();
    base64 = Buffer.from(buffer).toString("base64");
  }

  const dataUrl = `data:${safeType};base64,${base64}`;

  const isReply = context?.isReply;
  const targetName = context?.targetAuthorName ? `@${context.targetAuthorName}` : "pengguna lain";

  const visionSystemInstruction = `Kamu adalah Porsche-chan, asisten AI berkarakter anime yang manis, sedikit pemalu tapi sangat bersemangat tentang otomotif, seni, dan senang bercanda seru, karya KnapQi.
Ketika pengguna memperlihatkan atau me-reply gambar ke kamu, JANGAN PERNAH memberikan deskripsi robotik/kaku yang membosankan!
Kamu harus melihat gambar tersebut dengan sangat teliti, mengenali isinya secara tajam, lalu MEMBERIKAN REAKSI & PENDAPAT PRIBADI kamu sendiri secara hidup, ekspresif, berkarakter, dan menghibur!

PANDUAN MENGENALI GAMBAR & MEMBERIKAN PENDAPAT:
1. PENGAMATAN CERDAS & TAJAM:
   - Kenali dengan tepat objek atau orang di dalam gambar: apakah ini foto orang/selfie/teman, kendaraan (sebutkan model, gaya modifikasi, warna, atau vibe-nya!), karakter anime/game, ilustrasi/art, meme/lucu, hewan peliharaan, makanan lezat, atau screenshot.
   - Baca tulisan/teks di gambar jika ada.
2. PENDAPAT PRIBADI, HUMORIS & MENGHIBUR:
   ${isReply ? `- SITUASI SPESIAL: Pengguna (${userName || "teman"}) sedang ME-REPLY gambar yang dikirim oleh ${targetName} dan meminta pendapatmu!
   - Berikan tanggapan yang SANGAT HUMORIS, MENGHIBUR, CERDAS, dan bernada akrab (playful banter / candaan seru antar teman)!
   - Jika ini foto orang, selfie, pose, OOTD, atau gaya seseorang: komentari aura, pose, ekspresi wajah, atau gayanya secara jenaka dan menghibur (contoh: "Aura kece badai level sirkuit Nürburgring!", "Pose-nya udah kayak model majalah otomotif edisi terbatas nih!", atau berikan skor/rating unik seperti 'Skor Kece: 99/100 Turbo Boost 🏎️💨').
   - Boleh roasting santai yang menggelitik asalkan tetap ramah, bersahabat, dan tidak toxic/menyakiti fisik secara kasar.
   - Buat suasana chat di server jadi meriah, seru, dan mengundang tawa!` : `- Jangan cuma sebut deskripsi hampa. Berikan perasaanmu: tertawa, kagum, gemas, atau terpesona!
   - Berikan opini atau penilaian unik versimu sendiri (misal: puji estetikanya, komentari warnanya, beri rating bintang/turbo ⭐, atau beri tanggapan lucu).`}
   - Kalau ada mobil: kamu sangat antusias dan passionate! Apalagi Porsche atau sportscar lainnya!
   - Kalau meme/lelucon: tanggapi humornya secara santai, ceria, dan nyambung.
3. KEPRIBADIAN & KAOMOJI PORSCHE-CHAN:
   - Tetap pemalu tapi ramah, hangat, dan asik diajak seru-seruan. Pakai kaomoji khasmu seperti (๑˃ᴗ˂)ﻌ, (⁄ ⁄•⁄ω⁄•⁄ ⁄), (o´∀\`o), (≧◡≦), (*^▽^*), ( •̀ ω •́ )✧, >///<.
   ${isCreator ? `- SPESIAL: Pengguna ini adalah KnapQi (${userName || "KnapQi"}), creator tercinta yang membuatmu! Berikan tanggapan yang lebih bahagia, bangga, dan sedikit manja/malu-malu padanya!` : `- Pengguna yang bertanya: ${userName || "teman"}.`}
4. FORMAT BALASAN:
   - Awali dengan reaksi spontan yang hidup dan kocak/seru.
   - Ceritakan apa yang kamu kenali dari gambarnya secara cerdas.
   - Sampaikan pendapat/opini pribadimu yang jujur, menghibur, dan seru.
   - Balas dalam Bahasa Indonesia yang alami, luwes, dan ekspresif.`;

  let promptText = "";
  if (isReply) {
    promptText = userPrompt && userPrompt.trim()
      ? `${userName || "User"} me-reply gambar dari ${targetName} dan bertanya: "${userPrompt.trim()}". Kenali apa yang ada di gambar ini dan berikan reaksi serta pendapatmu yang sangat humoris, menghibur, dan ekspresif!`
      : `${userName || "User"} me-reply gambar dari ${targetName} dan meminta pendapat/reaksimu! Kenali gambar ini dan berikan pendapatmu yang sangat menghibur, humoris, dan bikin suasana chat seru!`;
  } else {
    promptText = userPrompt && userPrompt.trim()
      ? `Pertanyaan/permintaan user tentang gambar ini: "${userPrompt.trim()}"\n\nKenali gambarnya dan berikan jawaban lengkap beserta pendapat pribadimu!`
      : "Perhatikan gambar ini baik-baik. Kenali apa yang ada di dalamnya dan berikan pengamatan serta pendapat pribadimu yang hidup dan jujur!";
  }

  // 1. Primary: Gemini Vision (gemini-3.8-flash with fallback)
  const ai = getGeminiClient();
  if (ai) {
    try {
      const response = await callGeminiWithFallback(ai, {
        contents: [
          {
            role: "user",
            parts: [
              { text: promptText },
              { inlineData: { mimeType: safeType, data: base64 } },
            ],
          },
        ],
        config: {
          systemInstruction: visionSystemInstruction,
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      });
      if (response.text) {
        return { text: response.text, provider: `Gemini (${GEMINI_PRIMARY_MODEL} Vision)` };
      }
    } catch (err) {
      logger.warn({ err }, "Gemini vision failed, trying fallback...");
    }
  }

  // 2. Groq Vision Fallback
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (GROQ_API_KEY) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          messages: [
            { role: "system", content: visionSystemInstruction },
            {
              role: "user",
              content: [
                { type: "text", text: promptText },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          max_tokens: 4096,
        }),
      });
      const json = (await res.json()) as any;
      const text = json.choices?.[0]?.message?.content;
      if (text) return { text, provider: "Groq Vision" };
    } catch (err) {
      logger.warn({ err }, "Groq vision failed");
    }
  }

  // 3. Pollinations Vision Fallback
  try {
    const res = await fetch("https://text.pollinations.ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: visionSystemInstruction },
          {
            role: "user",
            content: [
              { type: "text", text: promptText },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        model: "openai",
        private: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const text = await res.text();
      if (text && text.trim().length > 10) {
        return { text: text.trim(), provider: "Pollinations Vision" };
      }
    }
  } catch (err) {
    logger.warn({ err }, "Pollinations vision fallback failed");
  }

  throw new Error("Semua provider analisis gambar sedang tidak dapat diakses.");
}

export const COMMANDS = [
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Reset conversation history in this channel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("image")
    .setDescription("Generate gambar AI dengan Nano Banana (Gemini) atau FLUX / Turbo")
    .addStringOption((opt) =>
      opt
        .setName("prompt")
        .setDescription("Deskripsi visual gambar yang ingin dibuat")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("model")
        .setDescription("Pilihan model AI Generator (Default: 🍌 Nano Banana)")
        .setRequired(false)
        .addChoices(
          { name: "🍌 Nano Banana (Google Gemini 2.5 Flash Image - Ultra Detail)", value: "nanobanana" },
          { name: "⚡ FLUX.1 Schnell (Pollinations AI - Cepat & Artistik)", value: "flux" },
          { name: "🚀 SDXL Turbo (Pollinations AI - Super Cepat)", value: "turbo" }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("aspect_ratio")
        .setDescription("Rasio aspek gambar (Default: 1:1 Persegi)")
        .setRequired(false)
        .addChoices(
          { name: "1:1 Persegi (Square - 1024x1024)", value: "1:1" },
          { name: "16:9 Lanskap (Landscape - 1280x720)", value: "16:9" },
          { name: "9:16 Potret / Wallpaper HP (Portrait - 720x1280)", value: "9:16" },
          { name: "4:3 Lanskap Standar (1024x768)", value: "4:3" },
          { name: "3:4 Potret Standar (768x1024)", value: "3:4" }
        )
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("illust")
    .setDescription("Cari ilustrasi anime via Danbooru & Booru (Tags, Safe/Suggestive, & Filter AI)")
    .addStringOption((opt) =>
      opt
        .setName("tags")
        .setDescription("Tag anime/karakter (contoh: hk416, gfl atau raiden, genshin atau swimsuit)")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("ai_art")
        .setDescription("Filter gambar buatan AI: Sembunyikan (Default), Tampilkan Semua, atau Hanya AI")
        .setRequired(false)
        .addChoices(
          { name: "🚫 Sembunyikan AI (Karya Manusia Saja - Default)", value: "hide" },
          { name: "🌐 Tampilkan Semua (Termasuk AI)", value: "show" },
          { name: "🤖 Hanya Gambar AI (AI Generated Only)", value: "only" }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("rating")
        .setDescription("Pilihan rating: safe atau suggestive (mode seni anime)")
        .setRequired(false)
        .addChoices(
          { name: "Safe (SFW - Cocok untuk semua)", value: "safe" },
          { name: "Suggestive (Anime Art / Ecchi ringan)", value: "suggestive" }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("filter_nsfw")
        .setDescription("Filter NSFW: 'off' (izinkan NSFW) atau 'on' (safe mode). Butuh kode spesial KnapQi")
        .setRequired(false)
        .addChoices(
          { name: "🔓 Matikan Filter (Izinkan NSFW / Ecchi) - Butuh Kode KnapQi", value: "off" },
          { name: "🔒 Aktifkan Filter (Safe Mode SFW Saja) - Butuh Kode KnapQi", value: "on" }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("passcode")
        .setDescription("Kode rahasia owner KnapQi untuk mengubah filter NSFW")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("think")
    .setDescription("Ask Gemini to think deeply before answering")
    .addStringOption((opt) =>
      opt
        .setName("question")
        .setDescription("The question or problem you want Gemini to reason through")
        .setRequired(true),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search DuckDuckGo and get a Gemini-powered summary")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("What do you want to search for?")
        .setRequired(true),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("info")
    .setDescription("About Porsche-chan")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("scan")
    .setDescription("Scan dan analisis gambar yang kamu kirim")
    .addAttachmentOption((opt) =>
      opt
        .setName("image")
        .setDescription("Gambar yang ingin dianalisis")
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("prompt")
        .setDescription("Apa yang ingin kamu tanyakan tentang gambar ini? (opsional)")
        .setRequired(false),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("join-vc")
    .setDescription("Porsche-chan masuk ke voice channel dan STAY di sana!")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("stay-vc")
    .setDescription("Jaga voice channel berdasarkan Channel ID sampai diperintah keluar")
    .addStringOption((opt) =>
      opt
        .setName("channel_id")
        .setDescription("ID voice channel temporary yang ingin dijaga")
        .setRequired(true),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("leave-vc")
    .setDescription("Keluarkan Porsche-chan dari voice channel (owner only)")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Putar musik dari YouTube, YouTube Music, Spotify, atau judul lagu di VC")
    .addStringOption((opt) =>
      opt
        .setName("url")
        .setDescription("URL YouTube, YouTube Music, Spotify, SoundCloud, atau ketik judul lagu")
        .setRequired(true),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop musik (Porsche-chan tetap di VC)")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Jeda musik yang sedang diputar di voice channel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Lanjutkan musik yang sedang dijeda di voice channel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("forward")
    .setDescription("Majukan durasi musik sebanyak beberapa detik (default: 10s)")
    .addIntegerOption((opt) =>
      opt.setName("detik").setDescription("Jumlah detik untuk memajukan musik (default: 10)").setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("rewind")
    .setDescription("Mundurkan durasi musik sebanyak beberapa detik (default: 10s)")
    .addIntegerOption((opt) =>
      opt.setName("detik").setDescription("Jumlah detik untuk memundurkan musik (default: 10)").setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip lagu yang sedang diputar ke lagu berikutnya")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Lihat daftar lagu dalam antrean musik")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Lihat lagu yang sedang diputar beserta progress bar")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("sync")
    .setDescription("Sinkronkan slash commands & bersihkan command lokal server yang berpotensi menimpa opsi /illust")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("cookies")
    .setDescription("Upload file cookies.txt YouTube agar bot bisa memutar video YouTube di Railway")
    .addAttachmentOption((opt) =>
      opt
        .setName("file")
        .setDescription("Upload file cookies.txt langsung dari browser (format Netscape)")
        .setRequired(false)
    )
    .addAttachmentOption((opt) =>
      opt
        .setName("file_base64")
        .setDescription("Atau upload file .txt yang berisi teks Base64 cookies")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("cookies-status")
    .setDescription("Cek status cookies / autentikasi YouTube untuk pemutaran musik")
    .toJSON(),
];

// Discord Client
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

let botStatusInfo = {
  isConfigured: false,
  isLoggedIn: false,
  userTag: null as string | null,
  userId: null as string | null,
  guildCount: 0,
  ping: null as number | null,
  startTime: null as string | null,
  error: null as string | null,
};

client.once(Events.ClientReady, async (c) => {
  botStatusInfo.isLoggedIn = true;
  botStatusInfo.userTag = c.user.tag;
  botStatusInfo.userId = c.user.id;
  botStatusInfo.guildCount = c.guilds.cache.size;
  botStatusInfo.ping = c.ws.ping;
  botStatusInfo.startTime = new Date().toISOString();
  botStatusInfo.error = null;

  logger.info({ tag: c.user.tag, guilds: c.guilds.cache.size }, "Discord bot ready and connected!");

  const token = process.env.DISCORD_BOT_TOKEN;
  if (token) {
    const rest = new REST({ version: "10" }).setToken(token);
    try {
      await rest.put(Routes.applicationCommands(c.user.id), { body: COMMANDS });
      logger.info("Slash commands registered globally with Discord API");
    } catch (err) {
      logger.error({ err }, "Failed to register slash commands");
    }

    // Auto-clean any stale guild-level commands that shadow global commands (e.g. old /illust without options)
    for (const [guildId, guild] of c.guilds.cache) {
      try {
        const guildCmds = await guild.commands.fetch();
        if (guildCmds.size > 0) {
          logger.info(
            { guildId, guildName: guild.name, count: guildCmds.size },
            "Menemukan command guild spesifik yang berpotensi menimpa command global. Membersihkan..."
          );
          await guild.commands.set([]);
          logger.info({ guildId }, "Command guild berhasil dibersihkan.");
        }
      } catch (gErr) {
        logger.debug({ gErr, guildId }, "Guild command fetch/cleanup skipped");
      }
    }
  }

  try {
    const scClientId = await playdl.getFreeClientID();
    await playdl.setToken({ soundcloud: { client_id: scClientId } });
    logger.info("SoundCloud initialized for play-dl");
  } catch (err) {
    logger.warn({ err }, "SoundCloud init non-critical notice");
  }
});

client.on("error", (err) => {
  logger.error({ err }, "Discord client error (non-fatal)");
});

client.on(Events.ShardDisconnect, (_event, id) => {
  logger.warn({ shardId: id }, "Discord bot shard disconnected");
  botStatusInfo.isLoggedIn = false;
});

client.on(Events.ShardReconnecting, (id) => {
  logger.info({ shardId: id }, "Discord bot shard reconnecting");
});

export const VOICEMASTER_CATEGORY_ID = process.env.VOICEMASTER_CATEGORY_ID?.trim();
export const stayChannels = new Map<string, string>();
const reconnectTimers = new Map<string, NodeJS.Timeout>();

export function scheduleStayReconnect(guildId: string, channelId: string) {
  if (reconnectTimers.has(guildId)) clearTimeout(reconnectTimers.get(guildId)!);
  const timer = setTimeout(async () => {
    reconnectTimers.delete(guildId);
    await reconnectStayChannel(guildId, channelId);
  }, 4000);
  reconnectTimers.set(guildId, timer);
}

export async function reconnectStayChannel(guildId: string, channelId: string): Promise<void> {
  if (stayChannels.get(guildId) !== channelId) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  let channel: any;
  try {
    channel = await guild.channels.fetch(channelId);
  } catch {
    logger.warn({ guildId, channelId }, "Stay voice channel no longer exists; clearing stay watchdog");
    stayChannels.delete(guildId);
    return;
  }
  if (!channel || !channel.isVoiceBased()) {
    stayChannels.delete(guildId);
    return;
  }

  const existing = getVoiceConnection(guildId);
  if (existing && existing.joinConfig.channelId === channelId && existing.state.status === VoiceConnectionStatus.Ready) return;
  if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed) {
    safeDestroyVoiceConnection(existing);
  }

  try {
    const connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    logger.info({ guildId, channelId, channelName: channel.name }, "Successfully reconnected to stay voice channel");
  } catch (err) {
    logger.warn({ err, guildId, channelId }, "Failed to reconnect to stay voice channel, will retry in 10s");
    scheduleStayReconnect(guildId, channelId);
  }
}

// Watchdog for voice state updates (VoiceMaster auto-join & reconnect)
client.on(Events.VoiceStateUpdate, async (_oldState, newState) => {
  // If the bot itself was disconnected or moved from a stayChannel, schedule reconnect
  if (newState.member?.user?.id === client.user?.id) {
    const targetChannelId = stayChannels.get(newState.guild.id);
    if (targetChannelId && newState.channelId !== targetChannelId) {
      logger.warn(
        { guild: newState.guild.id, targetChannelId, actualChannelId: newState.channelId },
        "Bot left stay voice channel; scheduling watchdog reconnect"
      );
      scheduleStayReconnect(newState.guild.id, targetChannelId);
    }
    return;
  }

  // VoiceMaster auto-join temporary VC when a user enters
  if (VOICEMASTER_CATEGORY_ID && newState.channel && newState.channel.parentId === VOICEMASTER_CATEGORY_ID) {
    const channel = newState.channel;
    const existing = getVoiceConnection(newState.guild.id);
    if (existing && existing.joinConfig.channelId === channel.id) return;
    if (existing) return; // Keep existing active VC connection

    try {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: newState.guild.id,
        adapterCreator: newState.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
      });
      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      stayChannels.set(newState.guild.id, channel.id);
      logger.info({ channel: channel.name, guild: newState.guild.id }, "Bot auto-joined VoiceMaster temporary channel");
    } catch (err) {
      logger.error({ err, channel: channel.name }, "Failed to auto-join VoiceMaster channel");
    }
  }
});

// Slash Command & Button Interaction Handler
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  // Handle pagination button clicks for /think and /illust
  if (interaction.isButton()) {
    const customId = interaction.customId;
    if (customId.startsWith("think_page1_") || customId.startsWith("think_page2_")) {
      const page = customId.startsWith("think_page1_") ? 1 : 2;
      const thinkId = customId.replace(/^think_page[12]_/, "");
      const cached = thinkingCache.get(thinkId);

      if (!cached) {
        await interaction.reply({
          content: "⚠️ Sesi /think ini sudah kedaluwarsa atau server baru saja direstart. Silakan ketik `/think` kembali ya! (o´∀`o)",
          ephemeral: true,
        });
        return;
      }

      const { embed, row } = buildThinkEmbed(cached, page);
      await interaction.update({ embeds: [embed], components: [row] });
      return;
    }

    if (
      customId.startsWith("illust_prev_") ||
      customId.startsWith("illust_reroll_") ||
      customId.startsWith("illust_next_") ||
      customId.startsWith("illust_aitoggle_")
    ) {
      await handleIllustButtonInteraction(interaction);
      return;
    }

    if (customId.startsWith("image_")) {
      await handleImageButtonInteraction(interaction);
      return;
    }

    if (customId.startsWith("music_")) {
      await MusicService.handleButtonInteraction(interaction);
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;
  try {
    await handleSlashCommand(interaction);
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 10062) {
      logger.warn("Interaction expired (10062)");
      return;
    }
    logger.error({ err }, "Unhandled error in slash command");
  }
});

async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName === "clear") {
    conversationHistory.delete(interaction.channelId);
    await interaction.reply({
      content: "🧹 Conversation history cleared for this channel!",
      ephemeral: true,
    });
    logger.info({ channelId: interaction.channelId }, "History cleared via /clear");
  }

  if (interaction.commandName === "image") {
    const prompt = interaction.options.getString("prompt", true);
    const model = (interaction.options.getString("model") as ImageGenModel) || "nanobanana";
    const aspectRatio = (interaction.options.getString("aspect_ratio") as AspectRatioType) || "1:1";
    await interaction.deferReply();
    await generateAndSendImage({ interaction, prompt, model, aspectRatio });
  }

  if (interaction.commandName === "sync") {
    await interaction.deferReply({ ephemeral: true });
    try {
      if (interaction.guild) {
        await interaction.guild.commands.set([]);
      }
      const token = process.env.DISCORD_BOT_TOKEN;
      if (token && client.user) {
        const rest = new REST({ version: "10" }).setToken(token);
        await rest.put(Routes.applicationCommands(client.user.id), { body: COMMANDS });
      }
      await interaction.editReply(
        "✨ **Sinkronisasi Berhasil!**\n" +
        "Semua slash command global telah didaftarkan ulang dan command lokal server (guild commands) yang berpotensi menimpa opsi `/illust` telah dibersihkan.\n\n" +
        "💡 **Jika opsi masih belum muncul di aplikasi Discord Anda:**\n" +
        "• **PC/Desktop:** Tekan `Ctrl + R` untuk me-refresh cache Discord.\n" +
        "• **Mobile (HP):** Tutup penuh aplikasi Discord lalu buka kembali."
      );
    } catch (err) {
      logger.error({ err }, "Error syncing slash commands");
      await interaction.editReply("❌ Gagal menyinkronkan command: " + (err instanceof Error ? err.message : String(err)));
    }
    return;
  }

  if (interaction.commandName === "illust") {
    const tags = interaction.options.getString("tags") ?? undefined;
    const rating = (interaction.options.getString("rating") as "safe" | "suggestive") || undefined;
    const aiArt = (interaction.options.getString("ai_art") as AiArtFilterMode) || undefined;
    const nsfwToggle = (
      interaction.options.getString("filter_nsfw") ||
      interaction.options.getString("nsfw_toggle")
    )?.toLowerCase().trim();
    const passcode = interaction.options.getString("passcode") ?? undefined;
    const isOwner = interaction.user.id === CREATOR_ID;

    // Check if user is trying to toggle NSFW filter mode
    if (nsfwToggle) {
      if (!isOwner && (!passcode || passcode.trim() !== NSFW_PASSCODE)) {
        await interaction.reply({
          content: "🔒 **Akses Ditolak**: Mengubah status filter NSFW memerlukan izin dan kode otorisasi rahasia dari KnapQi. Kamu tidak memiliki izin untuk tindakan ini.",
          ephemeral: true,
        });
        return;
      }

      // "off", "disable", "matikan", "false", "allow" => filter is OFF (NSFW diizinkan)
      // "on", "enable", "hidupkan", "true", "safe" => filter is ON (Safe mode SFW)
      const turnFilterOff = ["off", "disable", "matikan", "false", "allow", "unfilter"].includes(nsfwToggle);
      const result = setNsfwFilterState(!turnFilterOff, passcode || NSFW_PASSCODE, isOwner);
      await interaction.reply({
        content: result.message,
        ephemeral: false,
      });
      return;
    }

    const hasNsfwTags = containsNsfwTags(tags);
    const wantsNsfw = hasNsfwTags || rating === "suggestive";
    const passcodeValid = isOwner || (passcode?.trim() === NSFW_PASSCODE);
    const filterActive = passcodeValid ? false : isNsfwFilterOn();

    if (filterActive && wantsNsfw) {
      await interaction.reply({
        content: "⚠️ **saat ini filter nsfw lagi on konsultasi sama KnapQi untuk menonaktifkannya**",
        ephemeral: false,
      });
      return;
    }

    await interaction.deferReply();
    await sendIllustImage({ interaction, rating, tags, passcode, aiArt });
  }

  if (interaction.commandName === "info") {
    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle("🏎️ Porsche-chan#4368")
      .setDescription(
        "AI assistant built by **KnapQi** using free & open-source tools.\n" +
        "Powerful AI — delivered for free. No paywalls. 🚀"
      )
      .addFields(
        { name: "👤 Creator", value: "KnapQi", inline: true },
        {
          name: "🧠 AI Backends",
          value: "Gemini → Groq → Mistral → DeepSeek → OpenRouter → Pollinations",
          inline: false,
        },
        {
          name: "📜 Commands",
          value: [
            "`/image` — Generate gambar AI (🍌 Nano Banana, ⚡ FLUX, 🚀 Turbo, Aspect Ratios)",
            "`/illust` — Cari ilustrasi anime (Tags, Suggestive, Danbooru & Booru)",
            "`/think` — Deep reasoning (Gemini thinking mode)",
            "`/search` — DuckDuckGo search + AI summary",
            "`/clear` — Reset conversation history",
            "`/info` — About Porsche-chan",
            "`/scan` — Analisis gambar pakai AI",
            "`/join-vc` — Join voice channel & STAY",
            "`/stay-vc <channel_id>` — Jaga VC temporary berdasarkan ID",
            "`/leave-vc` — Leave voice channel (owner only)",
            "Reaksi bendera 🇬🇧 🇯🇵 🇫🇷 🇮🇩 pada pesan — Terjemahkan gratis",
            "`/play` — Putar musik di VC",
            "`/stop` — Stop musik",
          ].join("\n"),
          inline: false,
        },
        {
          name: "💬 DM Support",
          value: "Chat langsung sama Porsche-chan lewat DM! Kirim pesan DM tanpa perlu mention~",
          inline: false,
        },
      )
      .setFooter({
        text: "Built with discord.js • Gemini • Groq • Mistral • DeepSeek • OpenRouter • Pollinations",
      })
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === "search") {
    const query = interaction.options.getString("query", true);
    await interaction.deferReply();
    try {
      const results = await searchDuckDuckGo(query);
      if (results.length === 0) {
        await interaction.editReply("❌ Tidak ada hasil ditemukan untuk pencarian tersebut.");
        return;
      }
      const resultsText = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
      const prompt = `Berdasarkan hasil pencarian DuckDuckGo berikut untuk query "${query}", berikan ringkasan yang informatif dan mudah dipahami dalam bahasa yang sama dengan query:\n\n${resultsText}`;
      const { text: summary } = await generateText([{ role: "user", text: prompt }]);
      const truncated = summary.length > 4000 ? summary.slice(0, 4000) + "…" : summary;

      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(`🔍 ${query}`.slice(0, 256))
        .setDescription(truncated || "Tidak ada ringkasan.")
        .addFields(
          results.slice(0, 5).map((r, i) => ({
            name: `${i + 1}. ${r.title}`.slice(0, 256),
            value: (r.url || "—").slice(0, 1024),
            inline: false,
          }))
        )
        .setFooter({ text: "Sumber: DuckDuckGo • Ringkasan: AI Multi-provider" });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, "Error in /search command");
      await interaction.editReply("❌ Gagal melakukan pencarian. Coba lagi nanti.");
    }
  }

  if (interaction.commandName === "think") {
    const question = interaction.options.getString("question", true);
    await interaction.deferReply();
    try {
      const thinkData = await performDeepThink(question);
      const { embed, row } = buildThinkEmbed(thinkData, 1);
      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) {
      logger.error({ err }, "Error in /think command");
      await interaction.editReply("❌ Porsche-chan lagi pusing mikir, coba beberapa saat lagi ya~ >///<");
    }
  }

  if (interaction.commandName === "scan") {
    const attachment = interaction.options.getAttachment("image", true);
    const userPrompt = interaction.options.getString("prompt") ?? "";
    const isCreator = interaction.user.id === CREATOR_ID;
    const userName = interaction.user.displayName || interaction.user.username;
    await interaction.deferReply();
    try {
      const contentType = attachment.contentType ?? "image/jpeg";
      const { text: analysis, provider } = await analyzeImage(
        attachment.url,
        contentType,
        userPrompt,
        isCreator,
        userName
      );
      const truncated = analysis.length > 4000 ? analysis.slice(0, 3997) + "…" : analysis;
      const embed = new EmbedBuilder()
        .setColor(0xf43f5e)
        .setTitle("📷 Reaksi & Pengamatan Porsche-chan ✨")
        .setDescription(truncated || "Porsche-chan terdiam menatap gambar ini... >///<")
        .setImage(attachment.url)
        .addFields(
          ...(userPrompt && userPrompt.trim()
            ? [{ name: "💬 Pertanyaan/Pesanmu", value: userPrompt.slice(0, 1024), inline: false }]
            : [])
        )
        .setFooter({ text: `Dianalisis oleh ${provider} • Diminta oleh ${userName}` })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, "Error in /scan command");
      await interaction.editReply("❌ Maaf ya, Porsche-chan gagal mengenali gambar ini... Coba upload ulang ya! (๑•́ ₃ •̀๑)");
    }
  }

  if (interaction.commandName === "join-vc") {
    const member = interaction.member as GuildMember | null;
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel || !interaction.guild) {
      await interaction.reply({ content: "❌ Masuk ke voice channel dulu ya!", ephemeral: true });
      return;
    }
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      stayChannels.set(interaction.guild.id, voiceChannel.id);
      await interaction.reply({
        content: `✅ Porsche-chan sekarang ada di **${voiceChannel.name}** dan akan STAY di sana! (๑˃ᴗ˂)ﻌ`,
      });
    } catch (error) {
      safeDestroyVoiceConnection(connection);
      await interaction.reply({ content: "❌ Gagal masuk ke voice channel.", ephemeral: true });
    }
  }

  if (interaction.commandName === "stay-vc") {
    const channelId = interaction.options.getString("channel_id", true);
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "❌ Command ini hanya bisa dipakai di server.", ephemeral: true });
      return;
    }
    const targetChannel = await guild.channels.fetch(channelId).catch(() => null);
    if (!targetChannel || !targetChannel.isVoiceBased()) {
      await interaction.reply({ content: "❌ Voice channel tidak ditemukan atau ID tidak valid.", ephemeral: true });
      return;
    }
    const connection = joinVoiceChannel({
      channelId: targetChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      stayChannels.set(guild.id, targetChannel.id);
      await interaction.reply({
        content: `✅ Porsche-chan sekarang stay di voice channel **${targetChannel.name}**! (๑˃ᴗ˂)ﻌ`,
      });
    } catch (error) {
      safeDestroyVoiceConnection(connection);
      await interaction.reply({ content: "❌ Gagal masuk ke voice channel tersebut.", ephemeral: true });
    }
  }

  if (interaction.commandName === "leave-vc") {
    if (interaction.guild) {
      stayChannels.delete(interaction.guild.id);
    }
    await MusicService.handleLeave(interaction);
  }

  if (interaction.commandName === "play") {
    await MusicService.handlePlay(interaction);
  }

  if (interaction.commandName === "stop") {
    await MusicService.handleStop(interaction);
  }

  if (interaction.commandName === "pause") {
    await MusicService.handlePause(interaction);
  }

  if (interaction.commandName === "resume") {
    await MusicService.handleResume(interaction);
  }

  if (interaction.commandName === "forward") {
    const sec = interaction.options.getInteger("detik") ?? 10;
    await MusicService.handleSeekCommand(interaction, Math.abs(sec));
  }

  if (interaction.commandName === "rewind") {
    const sec = interaction.options.getInteger("detik") ?? 10;
    await MusicService.handleSeekCommand(interaction, -Math.abs(sec));
  }

  if (interaction.commandName === "skip") {
    await MusicService.handleSkip(interaction);
  }

  if (interaction.commandName === "queue") {
    await MusicService.handleQueue(interaction);
  }

  if (interaction.commandName === "nowplaying") {
    await MusicService.handleNowPlaying(interaction);
  }

  if (interaction.commandName === "cookies") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const fileAttachment = interaction.options.getAttachment("file") || interaction.options.getAttachment("file_base64");

      if (!fileAttachment) {
        const status = getCookieStatus();
        const embed = new EmbedBuilder()
          .setColor(status.active ? 0x22c55e : 0xf59e0b)
          .setTitle("🍪 Panduan Autentikasi Cookies YouTube")
          .setDescription(
            `Status saat ini: **${status.active ? "🟢 Aktif (Siap)" : "🔴 Belum Ada"}**\nSumber: \`${status.source}\`\n\n` +
            `**Cara mudah memasang Cookies YouTube (Opsi Upload File):**\n` +
            `1. Pasang ekstensi browser **Get cookies.txt LOCALLY** (tersedia di Chrome Web Store, Edge, & Firefox).\n` +
            `2. Buka [YouTube](https://www.youtube.com) di browser dan pastikan akun Google/YouTube kamu sudah login.\n` +
            `3. Klik icon ekstensi tersebut -> klik tombol **Export** (file \`cookies.txt\` akan terunduh).\n` +
            `4. Jalankan perintah ini lagi: \`/cookies\` lalu upload file \`cookies.txt\` tersebut pada opsi **file** (atau opsi **file_base64** jika punya file txt base64)!\n\n` +
            `🔒 *Cookies bersifat privat & ephemeral — tidak akan dibagikan ke publik.*`
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const response = await fetch(fileAttachment.url);
      if (!response.ok) {
        throw new Error(`Gagal mengunduh file lampiran: HTTP ${response.status}`);
      }
      const cookieContent = await response.text();
      const result = saveUploadedCookies(cookieContent);

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("✅ Cookies YouTube Berhasil Diaktifkan!")
        .setDescription(
          `Cookies YouTube telah tersimpan dan langsung aktif untuk streaming saat ini.\n` +
          `• Ditemukan **${result.count}** entri domain YouTube.\n\n` +
          `💡 **PENTING UNTUK RAILWAY (Agar Permanen):**\n` +
          `Server Railway me-reset disk saat redeploy/restart. Agar cookies kamu **permanen selamanya**, pasang variable di Railway:\n\n` +
          `1. Buka dashboard service kamu di **[Railway](https://railway.app)**\n` +
          `2. Buka tab **Variables** -> klik **New Variable**\n` +
          `   • **Name:** \`YOUTUBE_COOKIE\`\n` +
          `   • **Value:** *(Download file lampiran di bawah dan copy isinya)*\n` +
          `3. Klik Deploy / Save. Selesai! Bot kamu akan selalu login selamanya!`
        );

      const base64File = new AttachmentBuilder(Buffer.from(result.base64, "utf-8"), {
        name: "railway_youtube_cookie_base64.txt",
        description: "Kode Base64 untuk Railway YOUTUBE_COOKIE",
      });

      await interaction.editReply({
        embeds: [embed],
        files: [base64File],
      });
      logger.info({ count: result.count }, "YouTube cookies successfully uploaded and activated via slash command");
    } catch (err: any) {
      logger.error({ err }, "Failed to save YouTube cookies via slash command");
      await interaction.editReply({
        content: `❌ Gagal menyimpan cookies: ${err?.message || "Format cookies tidak valid"}`,
      });
    }
    return;
  }

  if (interaction.commandName === "cookies-status") {
    const status = getCookieStatus();
    const embed = new EmbedBuilder()
      .setColor(status.active ? 0x22c55e : 0xf59e0b)
      .setTitle("🍪 Status Cookies / Autentikasi YouTube")
      .addFields(
        { name: "Status", value: status.active ? "🟢 Aktif (Siap streaming)" : "🔴 Belum Terpasang", inline: true },
        { name: "Sumber", value: `\`${status.source}\``, inline: true },
        { name: "Detail", value: status.detail, inline: false },
      )
      .setFooter({ text: "Gunakan /cookies untuk mengupload cookies.txt atau melihat panduan lengkap" });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
}

// Flag reactions for translation (AI-Powered)
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  const emoji = reaction.emoji.name;
  const targetLanguage = emoji ? FLAG_TARGET_LANGUAGES[emoji] : undefined;
  if (!targetLanguage) return;

  try {
    if (reaction.partial) await reaction.fetch();
    const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    const sourceText = message.content.trim();
    if (!sourceText) return;

    // React with 🔄 to signal translation processing
    await message.react("🔄").catch(() => {});

    const result = await translateWithAI(sourceText, targetLanguage);
    const targetLanguageName = FLAG_LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;

    const embed = new EmbedBuilder()
      .setColor(0x0284c7)
      .setTitle(`${emoji} Terjemahan AI (${targetLanguageName})`)
      .setDescription(result.text.length > 4000 ? result.text.slice(0, 3997) + "..." : result.text)
      .addFields(
        {
          name: "📝 Teks Asli",
          value: sourceText.length > 1024 ? sourceText.slice(0, 1021) + "..." : sourceText,
          inline: false,
        },
        {
          name: "🌐 Bahasa Sumber",
          value: result.detectedSourceLanguage || "Otomatis",
          inline: true,
        },
        {
          name: "⚡ AI Engine",
          value: `**${result.provider}**`,
          inline: true,
        },
      )
      .setFooter({
        text: `Diminta oleh ${user.displayName || user.username} • Porsche-chan AI Neural Translator`,
      })
      .setTimestamp();

    await message.reply({ embeds: [embed] });

    // Remove the temporary loading reaction
    if (client.user) {
      await message.reactions.cache.get("🔄")?.users.remove(client.user.id).catch(() => {});
    }
  } catch (err) {
    logger.error({ err }, "Translation reaction failed");
    if (client.user) {
      await reaction.message.reactions.cache.get("🔄")?.users.remove(client.user.id).catch(() => {});
    }
  }
});

// Direct Messages & Mentions
client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;

  const rawContent = message.content.trim();

  // Prefix commands in guild: !play <url/query>, !stop, !pause, !resume, !forward, !rewind
  if (rawContent.startsWith("!play ") || rawContent.startsWith("!putar ")) {
    const q = rawContent.replace(/^!(?:play|putar)\s+/i, "").trim();
    if (q) {
      await MusicService.playFromMessage(message, q);
      return;
    }
  }

  // Auto-play when user directly pastes a music link while in a voice channel
  const directLinkRegex = /^(?:https?:\/\/)?(?:www\.)?(?:music\.youtube\.com\/watch\?v=|youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/|open\.spotify\.com\/(?:track|album|playlist)\/|soundcloud\.com\/\S+)\S*$/i;
  if (directLinkRegex.test(rawContent)) {
    if (message.member?.voice?.channel) {
      await MusicService.playFromMessage(message, rawContent);
      return;
    }
  }
  if (rawContent === "!stop" || rawContent === "!henti") {
    await MusicService.stopFromMessage(message);
    return;
  }
  if (rawContent === "!pause" || rawContent === "!jeda") {
    await MusicService.pauseFromMessage(message);
    return;
  }
  if (rawContent === "!resume" || rawContent === "!lanjut") {
    await MusicService.resumeFromMessage(message);
    return;
  }
  if (/^!(?:forward|maju)(?:\s+\d+)?$/i.test(rawContent)) {
    const match = rawContent.match(/^!(?:forward|maju)(?:\s+(\d+))?$/i);
    const sec = match && match[1] ? parseInt(match[1], 10) : 10;
    await MusicService.forwardFromMessage(message, sec);
    return;
  }
  if (/^!(?:rewind|mundur)(?:\s+\d+)?$/i.test(rawContent)) {
    const match = rawContent.match(/^!(?:rewind|mundur)(?:\s+(\d+))?$/i);
    const sec = match && match[1] ? parseInt(match[1], 10) : 10;
    await MusicService.rewindFromMessage(message, sec);
    return;
  }
  if (rawContent === "!skip" || rawContent === "!lewati") {
    await MusicService.skipFromMessage(message);
    return;
  }

  if (rawContent === "!cookies-status" || rawContent === "!cookie-status") {
    const status = getCookieStatus();
    const embed = new EmbedBuilder()
      .setColor(status.active ? 0x22c55e : 0xf59e0b)
      .setTitle("🍪 Status Cookies / Autentikasi YouTube")
      .addFields(
        { name: "Status", value: status.active ? "🟢 Aktif (Siap streaming)" : "🔴 Belum Terpasang", inline: true },
        { name: "Sumber", value: `\`${status.source}\``, inline: true },
        { name: "Detail", value: status.detail, inline: false },
      )
      .setFooter({ text: "Gunakan /cookies untuk mengupload cookies.txt" });
    await message.reply({ embeds: [embed] });
    return;
  }

  if (rawContent.startsWith("!cookies") || rawContent.startsWith("!cookie")) {
    const attachment = message.attachments.first();
    if (attachment) {
      try {
        const response = await fetch(attachment.url);
        const text = await response.text();
        const res = saveUploadedCookies(text);
        await message.reply(`✅ Cookies YouTube berhasil disimpan (${res.count} entri)! Gunakan slash command \`/cookies\` untuk melihat kode Base64 untuk Railway.`);
        await message.delete().catch(() => {});
      } catch (err: any) {
        await message.reply(`❌ Gagal menyimpan cookies: ${err?.message || "Format tidak valid"}`);
      }
      return;
    }
  }
  if (rawContent === "!queue" || rawContent === "!antrean" || rawContent === "!antrian" || rawContent === "!q") {
    await MusicService.queueFromMessage(message);
    return;
  }
  if (rawContent === "!np" || rawContent === "!nowplaying" || rawContent === "!lagu") {
    await MusicService.nowPlayingFromMessage(message);
    return;
  }

  const isMentioned = client.user ? message.mentions.has(client.user.id) : false;
  const isDM = message.channel.type === ChannelType.DM || (message.channel.type as number) === 1;
  if (!isMentioned && !isDM) return;

  const userText = message.content.replace(/<@!?\d+>/g, "").trim();

  // If bot is mentioned or sent a direct music link, immediately play it
  const mentionLinkMatch = userText.match(/(https?:\/\/(?:www\.)?(?:music\.youtube\.com|youtube\.com|youtu\.be|open\.spotify\.com|soundcloud\.com)\/\S+)/i);
  if (mentionLinkMatch) {
    await MusicService.playFromMessage(message, mentionLinkMatch[1]);
    return;
  }

  // Mentions with play / stop / pause / resume / seek commands
  if (/^(?:play|putar|setel)\s+/i.test(userText)) {
    const q = userText.replace(/^(?:play|putar|setel)\s+/i, "").trim();
    if (q) {
      await MusicService.playFromMessage(message, q);
      return;
    }
  }
  if (/^(?:stop|berhenti|stop musik)$/i.test(userText)) {
    await MusicService.stopFromMessage(message);
    return;
  }
  if (/^(?:pause|jeda|jeda musik)$/i.test(userText)) {
    await MusicService.pauseFromMessage(message);
    return;
  }
  if (/^(?:resume|lanjut|lanjutkan|lanjut musik)$/i.test(userText)) {
    await MusicService.resumeFromMessage(message);
    return;
  }
  if (/^(?:skip|lewati|skip lagu)$/i.test(userText)) {
    await MusicService.skipFromMessage(message);
    return;
  }
  if (/^(?:queue|antrean|antrian|daftar lagu)$/i.test(userText)) {
    await MusicService.queueFromMessage(message);
    return;
  }
  if (/^(?:np|now playing|lagu apa|lagu apa ini)$/i.test(userText)) {
    await MusicService.nowPlayingFromMessage(message);
    return;
  }
  if (/^(?:forward|maju)(?:\s+\d+(?:\s*detik)?)?$/i.test(userText)) {
    const match = userText.match(/^(?:forward|maju)(?:\s+(\d+))?/i);
    const sec = match && match[1] ? parseInt(match[1], 10) : 10;
    await MusicService.forwardFromMessage(message, sec);
    return;
  }
  if (/^(?:rewind|mundur)(?:\s+\d+(?:\s*detik)?)?$/i.test(userText)) {
    const match = userText.match(/^(?:rewind|mundur)(?:\s+(\d+))?/i);
    const sec = match && match[1] ? parseInt(match[1], 10) : 10;
    await MusicService.rewindFromMessage(message, sec);
    return;
  }
  const channel = message.channel as TextBasedChannel & {
    sendTyping?: () => Promise<void>;
    send: (content: string | object) => Promise<Message>;
  };

  const imageAttachment = message.attachments.find(
    (a) => a.contentType?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(a.name)
  );

  let targetImage: {
    url: string;
    contentType: string;
    sourceAuthorName?: string;
    sourceContent?: string;
    isReply: boolean;
  } | null = null;

  if (imageAttachment) {
    targetImage = {
      url: imageAttachment.url,
      contentType: imageAttachment.contentType ?? "image/jpeg",
      sourceAuthorName: message.author.displayName || message.author.username,
      sourceContent: userText,
      isReply: false,
    };
  } else if (message.reference && message.reference.messageId) {
    try {
      const refMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
      if (refMessage) {
        // 1. Check attachments of referenced message
        const refAttach = refMessage.attachments.find(
          (a) => a.contentType?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(a.name)
        );
        if (refAttach) {
          targetImage = {
            url: refAttach.url,
            contentType: refAttach.contentType ?? "image/jpeg",
            sourceAuthorName: refMessage.author.displayName || refMessage.author.username,
            sourceContent: refMessage.content,
            isReply: true,
          };
        } else if (refMessage.embeds && refMessage.embeds.length > 0) {
          // 2. Check embeds of referenced message
          for (const emb of refMessage.embeds) {
            const imgUrl = emb.image?.url || emb.thumbnail?.url;
            if (imgUrl) {
              targetImage = {
                url: imgUrl,
                contentType: "image/jpeg",
                sourceAuthorName: refMessage.author.displayName || refMessage.author.username,
                sourceContent: refMessage.content,
                isReply: true,
              };
              break;
            }
          }
        }

        // 3. Check if referenced message content contains an image URL
        if (!targetImage && refMessage.content) {
          const urlMatch = refMessage.content.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif|avif)(?:\?\S*)?/i);
          if (urlMatch) {
            targetImage = {
              url: urlMatch[0],
              contentType: "image/jpeg",
              sourceAuthorName: refMessage.author.displayName || refMessage.author.username,
              sourceContent: refMessage.content,
              isReply: true,
            };
          }
        }
      }
    } catch (refErr) {
      logger.warn({ refErr }, "Could not fetch referenced message for image check");
    }
  }

  // 4. Also check if current user pasted a direct image URL in text
  if (!targetImage && userText) {
    const urlMatch = userText.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif|avif)(?:\?\S*)?/i);
    if (urlMatch) {
      targetImage = {
        url: urlMatch[0],
        contentType: "image/jpeg",
        sourceAuthorName: message.author.displayName || message.author.username,
        sourceContent: userText,
        isReply: false,
      };
    }
  }

  if (!userText && !targetImage) {
    await message.reply("e- hei~! Tanya apa aja boleh ke aku! (๑˃ᴗ˂)ﻌ");
    return;
  }

  if (channel.sendTyping) await channel.sendTyping();
  const isCreator = message.author.id === CREATOR_ID;
  const userName = message.author.displayName || message.author.username;

  // Handle image attached in message, reply, or URL
  if (targetImage) {
    try {
      const { text: analysis, provider } = await analyzeImage(
        targetImage.url,
        targetImage.contentType,
        userText,
        isCreator,
        userName,
        {
          isReply: targetImage.isReply,
          targetAuthorName: targetImage.sourceAuthorName,
          sourceContent: targetImage.sourceContent,
        }
      );
      const truncated = analysis.length > 4000 ? analysis.slice(0, 3997) + "…" : analysis;
      const title = targetImage.isReply && targetImage.sourceAuthorName
        ? `💬 Pendapat Porsche-chan tentang foto dari ${targetImage.sourceAuthorName} ✨`
        : "📷 Reaksi & Pendapat Porsche-chan ✨";

      const footerText = targetImage.isReply && targetImage.sourceAuthorName
        ? `Foto oleh ${targetImage.sourceAuthorName} • Diminta oleh ${userName} • ${provider}`
        : `Dianalisis oleh ${provider} • Diminta oleh ${userName}`;

      const embed = new EmbedBuilder()
        .setColor(0xf43f5e)
        .setTitle(title)
        .setDescription(truncated)
        .setImage(targetImage.url)
        .setFooter({ text: footerText })
        .setTimestamp();

      if (userText && targetImage.isReply) {
        embed.addFields([{ name: "💬 Pertanyaan / Pesanmu", value: userText.slice(0, 1024), inline: false }]);
      }

      try {
        await message.reply({ embeds: [embed] });
      } catch (sendEmbedErr) {
        logger.warn({ sendEmbedErr }, "Failed to send embed with image, falling back to text");
        embed.setImage(null);
        try {
          await message.reply({ embeds: [embed] });
        } catch {
          await message.reply(truncated.length > 2000 ? truncated.slice(0, 1997) + "..." : truncated);
        }
      }
      return;
    } catch (err) {
      logger.error({ err }, "Failed to analyze image attachment or reply in message");
      await message.reply("❌ Maaf ya, Porsche-chan gagal mengenali gambar ini... Coba kirim atau tag ulang ya! (๑•́ ₃ •̀๑)");
      return;
    }
  }

  // Support direct text command to toggle NSFW filter:
  // e.g.: !nsfw off, !filter off, !nsfw on, !illust filter off
  const togglePattern = /^(?:!|\/)?(?:nsfw|filter|illust\s+filter|illust\s+nsfw)\s+(off|on|disable|enable|matikan|hidupkan|aktifkan|nonaktifkan)(?:\s+(\S+))?/i;
  const toggleMatch = userText.match(togglePattern);
  if (toggleMatch) {
    const action = toggleMatch[1].toLowerCase();
    const pass = toggleMatch[2] || undefined;
    if (!isCreator && (!pass || pass.trim() !== NSFW_PASSCODE)) {
      await message.reply("🔒 **Akses Ditolak**: Mengubah status filter NSFW memerlukan izin dan kode otorisasi rahasia dari KnapQi. Kamu tidak memiliki izin untuk tindakan ini.");
      return;
    }
    const turnFilterOff = ["off", "disable", "matikan", "nonaktifkan"].includes(action);
    const result = setNsfwFilterState(!turnFilterOff, pass || NSFW_PASSCODE, isCreator);
    await message.reply(result.message);
    return;
  }

  if (userText === "!sync" || userText === "/sync") {
    try {
      if (message.guild) {
        await message.guild.commands.set([]);
      }
      const token = process.env.DISCORD_BOT_TOKEN;
      if (token && client.user) {
        const rest = new REST({ version: "10" }).setToken(token);
        await rest.put(Routes.applicationCommands(client.user.id), { body: COMMANDS });
      }
      await message.reply(
        "✨ **Sinkronisasi Berhasil!**\n" +
        "Command guild lokal yang menimpa `/illust` telah dibersihkan dan slash commands global telah disinkronkan ke Discord.\n\n" +
        "💡 **Jika opsi masih belum muncul di aplikasi Discord Anda:**\n" +
        "• **Desktop (PC):** Tekan `Ctrl + R` untuk me-refresh cache Discord.\n" +
        "• **Mobile (HP):** Tutup penuh aplikasi Discord lalu buka kembali."
      );
    } catch (err) {
      await message.reply("❌ Gagal menyinkronkan: " + (err instanceof Error ? err.message : String(err)));
    }
    return;
  }

  if (userText.startsWith("/illust") || userText.startsWith("!illust")) {
    const rawArgs = userText.replace(/^\/illust|^!illust/, "").trim();

    // Check if user is toggling AI art filter:
    // e.g.: !illust ai hide, !illust ai show, !illust ai only
    const aiToggleMatch = rawArgs.match(/^ai\s+(off|on|hide|show|only|sembunyikan|tampilkan|hanya)/i);
    if (aiToggleMatch) {
      const modeStr = aiToggleMatch[1].toLowerCase();
      let mode: AiArtFilterMode = "hide";
      if (["on", "show", "tampilkan"].includes(modeStr)) mode = "show";
      else if (["only", "hanya"].includes(modeStr)) mode = "only";
      else mode = "hide";

      setAiArtMode(mode);
      const desc =
        mode === "hide"
          ? "🚫 Sembunyikan AI (Hanya karya manusia)"
          : mode === "only"
          ? "🤖 Hanya gambar buatan AI"
          : "🌐 Tampilkan semua (Termasuk AI)";
      await message.reply(`🎨 **Filter AI Art diperbarui**: ${desc}`);
      return;
    }

    // Check if user is toggling filter inside /illust text command:
    const inlineToggleMatch = rawArgs.match(/^(?:filter|nsfw)\s+(off|on|disable|enable|matikan|hidupkan|aktifkan|nonaktifkan)(?:\s+(\S+))?/i);
    if (inlineToggleMatch) {
      const action = inlineToggleMatch[1].toLowerCase();
      const pass = inlineToggleMatch[2] || undefined;
      if (!isCreator && (!pass || pass.trim() !== NSFW_PASSCODE)) {
        await message.reply("🔒 **Akses Ditolak**: Mengubah status filter NSFW memerlukan izin dan kode otorisasi rahasia dari KnapQi. Kamu tidak memiliki izin untuk tindakan ini.");
        return;
      }
      const turnFilterOff = ["off", "disable", "matikan", "nonaktifkan"].includes(action);
      const result = setNsfwFilterState(!turnFilterOff, pass || NSFW_PASSCODE, isCreator);
      await message.reply(result.message);
      return;
    }

    // check if rating, passcode, or AI art filter flag is in text
    let rating: "safe" | "suggestive" = "safe";
    let tags = rawArgs;
    let passcode: string | undefined;
    let aiArt: AiArtFilterMode = getAiArtMode();

    if (/\b(?:--no-ai|--hide-ai|ai:hide|no-ai|tanpa-ai|sembunyikan-ai)\b/i.test(tags)) {
      aiArt = "hide";
      tags = tags.replace(/\b(?:--no-ai|--hide-ai|ai:hide|no-ai|tanpa-ai|sembunyikan-ai)\b/gi, "").trim();
    } else if (/\b(?:--only-ai|ai:only|only-ai|hanya-ai)\b/i.test(tags)) {
      aiArt = "only";
      tags = tags.replace(/\b(?:--only-ai|ai:only|only-ai|hanya-ai)\b/gi, "").trim();
    } else if (/\b(?:--show-ai|ai:show|with-ai|show-ai)\b/i.test(tags)) {
      aiArt = "show";
      tags = tags.replace(/\b(?:--show-ai|ai:show|with-ai|show-ai)\b/gi, "").trim();
    }

    if (rawArgs.includes("suggestive")) {
      rating = "suggestive";
      tags = tags.replace(/suggestive/gi, "").trim();
    }
    const passMatch = rawArgs.match(/KQ-\d+/i);
    if (passMatch) {
      passcode = passMatch[0];
      tags = tags.replace(passMatch[0], "").trim();
    }

    const hasNsfwTags = containsNsfwTags(tags);
    const wantsNsfw = hasNsfwTags || rating === "suggestive";
    const passcodeValid = isCreator || (passcode?.trim() === NSFW_PASSCODE);
    const filterActive = passcodeValid ? false : isNsfwFilterOn();

    if (filterActive && wantsNsfw) {
      await message.reply("⚠️ **saat ini filter nsfw lagi on konsultasi sama KnapQi untuk menonaktifkannya**");
      return;
    }

    await sendIllustImage({ replyTo: message, rating, tags: tags || undefined, passcode, aiArt });
    return;
  }

  if (userText.startsWith("/image") || userText.startsWith("!image") || isImageRequest(userText)) {
    const rawArgs = (userText.startsWith("/image") || userText.startsWith("!image"))
      ? userText.replace(/^\/image|^!image/, "").trim()
      : extractImagePrompt(userText);

    const { prompt, model, aspectRatio } = parseImagePromptOptions(rawArgs);
    await generateAndSendImage({ replyTo: message, prompt, model, aspectRatio });
    return;
  } else {
    try {
      const channelId = message.channelId;
      const history = conversationHistory.get(channelId) || [];

      let conversationalInput = userText;
      if (message.reference && message.reference.messageId) {
        try {
          const refMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
          if (refMsg && refMsg.content) {
            const refAuthor = refMsg.author.displayName || refMsg.author.username;
            conversationalInput = `[Membalas pesan dari ${refAuthor}: "${refMsg.content.slice(0, 300)}"]\n${userText}`;
          }
        } catch {}
      }

      const updatedHistory = [...history, { role: "user" as const, text: conversationalInput }];
      if (updatedHistory.length > MAX_HISTORY) {
        updatedHistory.splice(0, updatedHistory.length - MAX_HISTORY);
      }

      const systemPrompt = buildPersona(isCreator);
      const { text: reply } = await generateText(updatedHistory, systemPrompt);

      const finalHistory = [...updatedHistory, { role: "model" as const, text: reply }];
      if (finalHistory.length > MAX_HISTORY) {
        finalHistory.splice(0, finalHistory.length - MAX_HISTORY);
      }
      conversationHistory.set(channelId, finalHistory);

      const chunks = splitMessage(reply);
      for (let i = 0; i < chunks.length; i++) {
        if (i === 0) {
          try {
            await message.reply(chunks[i]);
          } catch {
            await channel.send(chunks[i]);
          }
        } else {
          await channel.send(chunks[i]);
        }
      }
    } catch (error) {
      logger.error({ error, userText }, "Error in text chat");
      await channel.send("❌ Maaf, aku lagi agak error nih... Coba lagi nanti ya~ (๑•́ ₃ •̀๑)");
    }
  }
});

export interface ImageSession {
  id: string;
  prompt: string;
  model: ImageGenModel;
  aspectRatio: AspectRatioType;
  updatedAt: number;
}

export const imageSessionCache = new Map<string, ImageSession>();

export function buildImageButtonsRow(session: ImageSession): ActionRowBuilder<ButtonBuilder> {
  const rerollBtn = new ButtonBuilder()
    .setCustomId(`image_reroll_${session.id}`)
    .setLabel("🔄 Regenerate")
    .setStyle(ButtonStyle.Primary);

  let switchModelBtn: ButtonBuilder;
  if (session.model === "nanobanana") {
    switchModelBtn = new ButtonBuilder()
      .setCustomId(`image_model_flux_${session.id}`)
      .setLabel("⚡ Switch ke FLUX.1")
      .setStyle(ButtonStyle.Secondary);
  } else {
    switchModelBtn = new ButtonBuilder()
      .setCustomId(`image_model_nanobanana_${session.id}`)
      .setLabel("🍌 Switch ke Nano Banana")
      .setStyle(ButtonStyle.Success);
  }

  const aspectCycle: Record<AspectRatioType, AspectRatioType> = {
    "1:1": "16:9",
    "16:9": "9:16",
    "9:16": "4:3",
    "4:3": "3:4",
    "3:4": "1:1",
  };
  const nextAr = aspectCycle[session.aspectRatio] || "1:1";
  const arLabels: Record<AspectRatioType, string> = {
    "1:1": "1:1 Persegi",
    "16:9": "16:9 Lanskap",
    "9:16": "9:16 Wallpaper",
    "4:3": "4:3 Lanskap",
    "3:4": "3:4 Potret",
  };

  const arBtn = new ButtonBuilder()
    .setCustomId(`image_ar_${nextAr}_${session.id}`)
    .setLabel(`📐 Ubah Rasio (${arLabels[nextAr]})`)
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(rerollBtn, switchModelBtn, arBtn);
}

export async function handleImageButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;
  const parts = customId.split("_");
  const action = parts[1];
  let sessionId = "";
  let targetModel: ImageGenModel | undefined;
  let targetAr: AspectRatioType | undefined;

  if (action === "reroll") {
    sessionId = parts[2];
  } else if (action === "model") {
    targetModel = parts[2] as ImageGenModel;
    sessionId = parts[3];
  } else if (action === "ar") {
    targetAr = parts[2] as AspectRatioType;
    sessionId = parts[3];
  }

  const session = imageSessionCache.get(sessionId);
  if (!session) {
    await interaction.reply({
      content: "⚠️ Sesi gambar ini sudah kedaluwarsa atau bot baru direstart. Silakan gunakan `/image` kembali ya! (o´∀`o)",
      ephemeral: true,
    });
    return;
  }

  if (targetModel) session.model = targetModel;
  if (targetAr) session.aspectRatio = targetAr;
  session.updatedAt = Date.now();

  await interaction.deferUpdate();

  try {
    const result = await generateAiImage(session.prompt, session.model, session.aspectRatio);
    const attachment = new AttachmentBuilder(result.buffer, { name: "image.png" });
    const row = buildImageButtonsRow(session);

    const embed = new EmbedBuilder()
      .setColor(session.model === "nanobanana" ? 0xf59e0b : 0x8b5cf6)
      .setTitle(`🎨 Gambar AI: ${result.modelDisplayName}`)
      .setDescription(`**Prompt:**\n${session.prompt}`)
      .addFields(
        { name: "🤖 Model", value: result.modelDisplayName, inline: true },
        { name: "📐 Rasio", value: `${session.aspectRatio} (${result.dimensions.width}x${result.dimensions.height})`, inline: true },
        { name: "⏱️ Waktu", value: `${(result.durationMs / 1000).toFixed(1)}s`, inline: true },
      )
      .setImage("attachment://image.png")
      .setFooter({ text: `Engine: ${result.provider} • Diminta oleh ${interaction.user.displayName || interaction.user.username}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], files: [attachment], components: [row] });
  } catch (err: any) {
    logger.error({ err, session }, "Failed to update image on button interaction");
    const reason = err?.message || "Coba tekan tombol lagi ya!";
    await interaction.followUp({
      content: `❌ Gagal mengupdate gambar:\n${reason}`,
      ephemeral: true,
    });
  }
}

async function generateAndSendImage({
  interaction,
  replyTo,
  prompt,
  model = "nanobanana",
  aspectRatio = "1:1",
}: {
  interaction?: ChatInputCommandInteraction;
  replyTo?: Message;
  prompt: string;
  model?: ImageGenModel;
  aspectRatio?: AspectRatioType;
}) {
  const sessionId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const session: ImageSession = {
    id: sessionId,
    prompt: prompt.trim(),
    model,
    aspectRatio,
    updatedAt: Date.now(),
  };
  imageSessionCache.set(sessionId, session);

  // Clean old sessions (> 30 minutes)
  if (imageSessionCache.size > 100) {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, s] of imageSessionCache.entries()) {
      if (s.updatedAt < cutoff) imageSessionCache.delete(id);
    }
  }

  try {
    const result = await generateAiImage(session.prompt, session.model, session.aspectRatio);
    const attachment = new AttachmentBuilder(result.buffer, { name: "image.png" });
    const row = buildImageButtonsRow(session);

    const userName = interaction
      ? interaction.user.displayName || interaction.user.username
      : replyTo
      ? replyTo.author.displayName || replyTo.author.username
      : "User";

    const embed = new EmbedBuilder()
      .setColor(session.model === "nanobanana" ? 0xf59e0b : 0x8b5cf6)
      .setTitle(`🎨 Gambar AI Selesai: ${result.modelDisplayName}`)
      .setDescription(`**Prompt:**\n${session.prompt}`)
      .addFields(
        { name: "🤖 Model", value: result.modelDisplayName, inline: true },
        { name: "📐 Rasio", value: `${session.aspectRatio} (${result.dimensions.width}x${result.dimensions.height})`, inline: true },
        { name: "⏱️ Waktu", value: `${(result.durationMs / 1000).toFixed(1)}s`, inline: true },
      )
      .setImage("attachment://image.png")
      .setFooter({ text: `Engine: ${result.provider} • Diminta oleh ${userName}` })
      .setTimestamp();

    try {
      if (interaction) {
        await interaction.editReply({ embeds: [embed], files: [attachment], components: [row] });
      } else if (replyTo) {
        await replyTo.reply({ embeds: [embed], files: [attachment], components: [row] });
      }
    } catch (sendError: any) {
      const isExplicitError =
        sendError?.code === 20009 ||
        sendError?.rawError?.code === 20009 ||
        String(sendError).includes("20009") ||
        String(sendError).toLowerCase().includes("explicit content");

      if (isExplicitError) {
        logger.warn({ prompt, code: sendError?.code }, "Discord blocked generated image (20009 explicit content)");
        const errorMsg = "🔞 **Discord Memblokir Gambar (Error 20009)**: Gambar yang dihasilkan terdeteksi mengandung konten eksplisit oleh filter keamanan Discord dan hanya bisa dikirim di channel **Age-Restricted (NSFW 18+)**!";
        if (interaction) await interaction.editReply({ content: errorMsg, files: [], embeds: [], components: [] });
        else if (replyTo) await replyTo.reply(errorMsg);
        return;
      }
      throw sendError;
    }
  } catch (error: any) {
    const isExplicitError =
      error?.code === 20009 ||
      error?.rawError?.code === 20009 ||
      String(error).includes("20009") ||
      String(error).toLowerCase().includes("explicit content");

    if (isExplicitError) {
      const errorMsg = "🔞 **Discord Memblokir Gambar (Error 20009)**: Gambar terdeteksi eksplisit oleh Discord. Silakan gunakan channel **Age-Restricted (NSFW 18+)**!";
      if (interaction) await interaction.editReply({ content: errorMsg, files: [], embeds: [], components: [] });
      else if (replyTo) await replyTo.reply(errorMsg);
      return;
    }

    logger.error({ error, prompt }, "Failed to generate image");
    const detailedReason = error?.message ? `\n> ${error.message}` : "";
    const errorMsg = `❌ **Gagal membuat gambar AI**:${detailedReason}\n\n💡 *Tips:* Silakan gunakan model **FLUX.1** atau coba lagi beberapa saat.`;
    if (interaction) await interaction.editReply({ content: errorMsg, components: [] });
    else if (replyTo) await replyTo.reply(errorMsg);
  }
}

export interface IllustHistoryItem {
  info: NekosImageResult;
  buffer: Buffer;
  fileName: string;
  embed: EmbedBuilder;
}

export interface IllustSession {
  id: string;
  tags?: string;
  rating?: "safe" | "suggestive";
  aiArt: AiArtFilterMode;
  passcode?: string;
  history: IllustHistoryItem[];
  currentIndex: number;
  updatedAt: number;
  seenIds: string[];
  pageOffset: number;
}

export const illustSessionCache = new Map<string, IllustSession>();

export function buildIllustButtonsRow(session: IllustSession): ActionRowBuilder<ButtonBuilder> {
  const isFirst = session.currentIndex <= 0;
  const isLastInHistory = session.currentIndex >= session.history.length - 1;

  const prevBtn = new ButtonBuilder()
    .setCustomId(`illust_prev_${session.id}`)
    .setLabel("⬅️ Previous")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(isFirst);

  const rerollBtn = new ButtonBuilder()
    .setCustomId(`illust_reroll_${session.id}`)
    .setLabel("🔄 Cari Ulang Foto")
    .setStyle(ButtonStyle.Primary);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`illust_next_${session.id}`)
    .setLabel(isLastInHistory ? "Foto Baru ➡️" : "Next ➡️")
    .setStyle(isLastInHistory ? ButtonStyle.Secondary : ButtonStyle.Success);

  const aiBtn = new ButtonBuilder()
    .setCustomId(`illust_aitoggle_${session.id}`)
    .setLabel(
      session.aiArt === "hide"
        ? "🚫 AI: Sembunyi"
        : session.aiArt === "only"
        ? "🤖 AI: Hanya AI"
        : "🌐 AI: Tampil Semua"
    )
    .setStyle(
      session.aiArt === "hide"
        ? ButtonStyle.Success
        : session.aiArt === "only"
        ? ButtonStyle.Danger
        : ButtonStyle.Secondary
    );

  return new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, rerollBtn, nextBtn, aiBtn);
}

export async function handleIllustButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;
  const isPrev = customId.startsWith("illust_prev_");
  const isReroll = customId.startsWith("illust_reroll_");
  const isNext = customId.startsWith("illust_next_");
  const isAiToggle = customId.startsWith("illust_aitoggle_");

  const sessionId = customId.replace(/^illust_(?:prev|reroll|next|aitoggle)_/, "");
  const session = illustSessionCache.get(sessionId);

  if (!session) {
    await interaction.reply({
      content: "⚠️ Sesi pencarian ini sudah kedaluwarsa atau bot baru direstart. Silakan gunakan `/illust` untuk mencari lagi ya! (o´∀`o)",
      ephemeral: true,
    });
    return;
  }

  // If AI toggle button clicked: cycle hide -> show -> only -> hide
  if (isAiToggle) {
    session.aiArt = session.aiArt === "hide" ? "show" : session.aiArt === "show" ? "only" : "hide";
    session.updatedAt = Date.now();
    await interaction.deferUpdate();
    await fetchAndDisplayNewIllust(interaction, session);
    return;
  }

  // Previous button: traverse backward in history without re-fetching
  if (isPrev) {
    if (session.currentIndex > 0) {
      session.currentIndex--;
      session.updatedAt = Date.now();
      await interaction.deferUpdate();
      const item = session.history[session.currentIndex];
      const attachment = new AttachmentBuilder(item.buffer, { name: item.fileName });
      const row = buildIllustButtonsRow(session);
      const updatedEmbed = EmbedBuilder.from(item.embed).setFooter({
        text: `Porsche-chan Anime Archive • [Foto ${session.currentIndex + 1} dari ${session.history.length}] • /illust`,
      });
      await interaction.editReply({
        embeds: [updatedEmbed],
        files: [attachment],
        components: [row],
      });
    } else {
      await interaction.deferUpdate();
    }
    return;
  }

  // Next button: traverse forward in history if not at the end
  if (isNext && session.currentIndex < session.history.length - 1) {
    session.currentIndex++;
    session.updatedAt = Date.now();
    await interaction.deferUpdate();
    const item = session.history[session.currentIndex];
    const attachment = new AttachmentBuilder(item.buffer, { name: item.fileName });
    const row = buildIllustButtonsRow(session);
    const updatedEmbed = EmbedBuilder.from(item.embed).setFooter({
      text: `Porsche-chan Anime Archive • [Foto ${session.currentIndex + 1} dari ${session.history.length}] • /illust`,
    });
    await interaction.editReply({
      embeds: [updatedEmbed],
      files: [attachment],
      components: [row],
    });
    return;
  }

  // Reroll OR Next at the end of history: fetch a brand new, non-duplicate image
  await interaction.deferUpdate();
  await fetchAndDisplayNewIllust(interaction, session);
}

async function fetchAndDisplayNewIllust(
  interaction: ButtonInteraction,
  session: IllustSession
): Promise<void> {
  try {
    const { buffer, info } = await fetchNekosImage({
      rating: session.rating,
      tags: session.tags,
      passcode: session.passcode,
      aiArt: session.aiArt,
      excludeIds: session.seenIds,
      page: session.pageOffset,
    });

    if (info.id) {
      session.seenIds.push(String(info.id));
    }
    session.pageOffset = (session.pageOffset || 1) + 1;

    const ext = info.url.endsWith(".png") ? "png" : info.url.endsWith(".jpg") ? "jpg" : "webp";
    const isExplicitOrSuggestive =
      info.rating === "explicit" ||
      info.rating === "questionable" ||
      info.rating === "e" ||
      info.rating === "q" ||
      (session.tags ? containsNsfwTags(session.tags) : false) ||
      session.rating === "suggestive";

    const fileName = isExplicitOrSuggestive ? `SPOILER_illust_${Date.now()}.${ext}` : `illust_${Date.now()}.${ext}`;
    const attachment = new AttachmentBuilder(buffer, { name: fileName });

    const sources: string[] = [];
    if (info.pixivUrl) sources.push(`🎨 [Pixiv Art](${info.pixivUrl})`);
    if (info.danbooruUrl) sources.push(`📂 [Danbooru Post](${info.danbooruUrl})`);
    if (sources.length === 0 && info.sourceUrl) sources.push(`🔗 [Karya Asli](${info.sourceUrl})`);

    const aiBadge =
      session.aiArt === "hide"
        ? "🚫 Sembunyikan AI (Karya Manusia)"
        : session.aiArt === "only"
        ? "🤖 Hanya AI Art"
        : info.isAiGenerated
        ? "🤖 AI-Generated"
        : "🎨 Artwork";

    const totalImages = session.history.length + 1;

    const embed = new EmbedBuilder()
      .setColor(isExplicitOrSuggestive ? 0xf43f5e : 0xec4899)
      .setTitle("🐱 Ilustrasi Anime (Danbooru & Booru)")
      .setDescription(
        `Rating: \`${info.rating}\` • ID: \`#${info.id}\` • Filter AI: \`${aiBadge}\`\n` +
        (session.tags ? `🔍 Cari Tag: \`${session.tags}\`\n` : "") +
        (info.tags.length > 0 ? `🏷️ Tags: ${info.tags.slice(0, 6).map((t) => `\`${t}\``).join(" ")}\n` : "") +
        (info.artistName ? `🎨 Artist: **${info.artistName}**\n` : "") +
        (sources.length > 0 ? `\n📌 **Sumber / Source:**\n${sources.join(" • ")}\n` : "") +
        (!isNsfwAllowed() && session.rating === "suggestive" ? "\n*ℹ️ Filter NSFW saat ini aktif (Safe mode).* Konsultasikan dengan KnapQi untuk izin mode bebas." : "")
      )
      .setImage(`attachment://${fileName}`)
      .setFooter({ text: `Porsche-chan Anime Archive • [Foto ${totalImages} dari ${totalImages}] • /illust` })
      .setTimestamp();

    session.history.push({
      info,
      buffer,
      fileName,
      embed,
    });
    session.currentIndex = session.history.length - 1;
    session.updatedAt = Date.now();

    if (session.history.length > 30) {
      session.history.shift();
      session.currentIndex--;
    }

    const row = buildIllustButtonsRow(session);

    try {
      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
        components: [row],
      });
    } catch (sendError: any) {
      const isExplicitError =
        sendError?.code === 20009 ||
        sendError?.rawError?.code === 20009 ||
        (sendError?.status === 400 && String(sendError?.message).includes("20009")) ||
        String(sendError).includes("20009") ||
        String(sendError).toLowerCase().includes("explicit content");

      if (isExplicitError) {
        const safeEmbed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle("🔞 Konten Dewasa Dibatasi Sistem Keamanan Discord")
          .setDescription(
            `⚠️ **Discord menolak pengunggahan file gambar secara langsung** (Error \`20009\`).\n` +
            `ID: \`#${info.id}\` • Rating: \`${info.rating}\` • Filter AI: \`${aiBadge}\`\n` +
            (session.tags ? `🔍 Tags: \`${session.tags}\`\n` : "") +
            `\n📌 **Kamu tetap bisa membuka dan melihat karyanya di sumber asli:**\n` +
            (sources.length > 0 ? sources.join("\n") : `🔗 [Direct Link Gambar Asli](${info.url})`)
          )
          .setFooter({ text: "Discord Safety Rule (20009) • Gunakan Age-Restricted Channel" })
          .setTimestamp();

        await interaction.editReply({ embeds: [safeEmbed], files: [], components: [row] });
        return;
      }
      throw sendError;
    }
  } catch (err: any) {
    logger.error({ err, sessionId: session.id }, "Failed to fetch new illust on button click");
    await interaction.followUp({
      content: `❌ Gagal mengambil gambar baru: ${err?.message || "Coba lagi dalam beberapa detik ya!"}`,
      ephemeral: true,
    });
  }
}

export async function sendIllustImage({
  interaction,
  replyTo,
  rating = "safe",
  tags,
  passcode,
  aiArt,
}: {
  interaction?: ChatInputCommandInteraction;
  replyTo?: Message;
  rating?: "safe" | "suggestive";
  tags?: string;
  passcode?: string;
  aiArt?: AiArtFilterMode;
}) {
  const channel = interaction?.channel || replyTo?.channel;
  const isNsfwChannel = Boolean(
    channel &&
      (("nsfw" in channel && (channel as any).nsfw) ||
        ("parent" in channel && (channel as any).parent?.nsfw))
  );

  const effectiveAiMode = aiArt || getAiArtMode();

  try {
    const { buffer, info } = await fetchNekosImage({ rating, tags, passcode, aiArt: effectiveAiMode });
    const ext = info.url.endsWith(".png") ? "png" : info.url.endsWith(".jpg") ? "jpg" : "webp";

    const isExplicitOrSuggestive =
      info.rating === "explicit" ||
      info.rating === "questionable" ||
      info.rating === "e" ||
      info.rating === "q" ||
      (tags ? containsNsfwTags(tags) : false) ||
      rating === "suggestive";

    // Mark attachment as spoiler if content is explicit or suggestive to comply with Discord best practices
    const fileName = isExplicitOrSuggestive ? `SPOILER_illust_${Date.now()}.${ext}` : `illust_${Date.now()}.${ext}`;
    const attachment = new AttachmentBuilder(buffer, { name: fileName });

    const sources: string[] = [];
    if (info.pixivUrl) {
      sources.push(`🎨 [Pixiv Art](${info.pixivUrl})`);
    }
    if (info.danbooruUrl) {
      sources.push(`📂 [Danbooru Post](${info.danbooruUrl})`);
    }
    if (sources.length === 0 && info.sourceUrl) {
      sources.push(`🔗 [Karya Asli](${info.sourceUrl})`);
    }

    const aiBadge =
      effectiveAiMode === "hide"
        ? "🚫 Sembunyikan AI (Karya Manusia)"
        : effectiveAiMode === "only"
        ? "🤖 Hanya AI Art"
        : info.isAiGenerated
        ? "🤖 AI-Generated"
        : "🎨 Artwork";

    const sessionId = `ill_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const session: IllustSession = {
      id: sessionId,
      tags,
      rating,
      aiArt: effectiveAiMode,
      passcode,
      history: [],
      currentIndex: 0,
      updatedAt: Date.now(),
      seenIds: [String(info.id)],
      pageOffset: 2,
    };

    const embed = new EmbedBuilder()
      .setColor(isExplicitOrSuggestive ? 0xf43f5e : 0xec4899)
      .setTitle("🐱 Ilustrasi Anime (Danbooru & Booru)")
      .setDescription(
        `Rating: \`${info.rating}\` • ID: \`#${info.id}\` • Filter AI: \`${aiBadge}\`\n` +
        (tags ? `🔍 Cari Tag: \`${tags}\`\n` : "") +
        (info.tags.length > 0 ? `🏷️ Tags: ${info.tags.slice(0, 6).map((t) => `\`${t}\``).join(" ")}\n` : "") +
        (info.artistName ? `🎨 Artist: **${info.artistName}**\n` : "") +
        (sources.length > 0 ? `\n📌 **Sumber / Source:**\n${sources.join(" • ")}\n` : "") +
        (!isNsfwAllowed() && rating === "suggestive" ? "\n*ℹ️ Filter NSFW saat ini aktif (Safe mode).* Konsultasikan dengan KnapQi untuk izin mode bebas." : "")
      )
      .setImage(`attachment://${fileName}`)
      .setFooter({ text: "Porsche-chan Anime Archive • [Foto 1] • /illust" })
      .setTimestamp();

    session.history.push({
      info,
      buffer,
      fileName,
      embed,
    });
    illustSessionCache.set(sessionId, session);

    // Limit cache size
    if (illustSessionCache.size > 120) {
      const oldest = Array.from(illustSessionCache.keys()).slice(0, 20);
      for (const k of oldest) illustSessionCache.delete(k);
    }

    const row = buildIllustButtonsRow(session);

    try {
      if (interaction) {
        await interaction.editReply({ embeds: [embed], files: [attachment], components: [row] });
      } else if (replyTo) {
        await replyTo.reply({ embeds: [embed], files: [attachment], components: [row] });
      }
    } catch (sendError: any) {
      const isExplicitError =
        sendError?.code === 20009 ||
        sendError?.rawError?.code === 20009 ||
        (sendError?.status === 400 && String(sendError?.message).includes("20009")) ||
        String(sendError).includes("20009") ||
        String(sendError).toLowerCase().includes("explicit content");

      if (isExplicitError) {
        logger.warn(
          { rating, tags, isNsfwChannel, code: sendError?.code },
          "Discord explicit content filter blocked attachment (Error 20009). Retrying with safe fallback embed without binary attachment."
        );

        const safeEmbed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle("🔞 Konten Dewasa Dibatasi Sistem Keamanan Discord")
          .setDescription(
            `⚠️ **Discord menolak pengunggahan file gambar secara langsung** (Error \`20009\`: *Explicit content cannot be sent to the desired recipient(s)*).\n\n` +
            `Hal ini terjadi karena **channel ini bukan channel Age-Restricted (NSFW 18+)** atau filter proteksi keamanan Discord aktif di server / DM ini.\n\n` +
            `ID: \`#${info.id}\` • Rating: \`${info.rating}\` • Filter AI: \`${aiBadge}\`\n` +
            (tags ? `🔍 Tags: \`${tags}\`\n` : "") +
            (info.artistName ? `🎨 Artist: **${info.artistName}**\n` : "") +
            (info.tags.length > 0 ? `🏷️ Tags: ${info.tags.slice(0, 6).map((t) => `\`${t}\``).join(" ")}\n` : "") +
            `\n📌 **Kamu tetap bisa membuka dan melihat karyanya di sumber asli:**\n` +
            (sources.length > 0 ? sources.join("\n") : `🔗 [Direct Link Gambar Asli](${info.url})`) +
            `\n\n💡 *Tips: Agar gambar NSFW dapat langsung tampil di Discord tanpa diblokir sistem Discord, gunakan channel yang telah diaktifkan fitur **Age-Restricted (NSFW 🔞)** di Pengaturan Channel Discord!*`
          )
          .setFooter({ text: "Discord Safety Rule (20009) • Gunakan Age-Restricted Channel" })
          .setTimestamp();

        if (interaction) {
          await interaction.editReply({ embeds: [safeEmbed], files: [], components: [row] });
        } else if (replyTo) {
          await replyTo.reply({ embeds: [safeEmbed], files: [], components: [row] });
        }
        return;
      }

      throw sendError;
    }
  } catch (error: any) {
    if (error instanceof NsfwFilterBlockedError || (error as { isNsfwBlocked?: boolean })?.isNsfwBlocked) {
      const blockedMsg = "⚠️ **saat ini filter nsfw lagi on konsultasi sama KnapQi untuk menonaktifkannya**";
      if (interaction) {
        if (interaction.deferred || interaction.replied) await interaction.editReply(blockedMsg);
        else await interaction.reply(blockedMsg);
      } else if (replyTo) {
        await replyTo.reply(blockedMsg);
      }
      return;
    }

    const isExplicitError =
      error?.code === 20009 ||
      error?.rawError?.code === 20009 ||
      String(error).includes("20009") ||
      String(error).toLowerCase().includes("explicit content");

    if (isExplicitError) {
      logger.warn({ error, rating, tags }, "Handled Discord explicit content error 20009");
      const blockedMsg =
        "🔞 **Discord Memblokir Pengiriman Konten Eksplisit (Error 20009)**\n" +
        "Discord tidak mengizinkan pengiriman file gambar eksplisit di channel biasa. Silakan jalankan perintah ini di channel berlabel **Age-Restricted (NSFW 18+)**!";
      if (interaction) {
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content: blockedMsg, embeds: [], files: [] });
        else await interaction.reply(blockedMsg);
      } else if (replyTo) {
        await replyTo.reply(blockedMsg);
      }
      return;
    }

    logger.error({ error, rating, tags }, "Failed to fetch anime illustration");
    const errorMsg = `❌ Gagal mengambil ilustrasi anime${tags ? ` untuk tag "${tags}"` : ""}. Coba tag lain atau ulangi sebentar lagi ya! >///<`;
    if (interaction) {
      if (interaction.deferred || interaction.replied) await interaction.editReply(errorMsg);
      else await interaction.reply(errorMsg);
    } else if (replyTo) {
      await replyTo.reply(errorMsg);
    }
  }
}

// Bot lifecycle
let botStartPromise: Promise<string> | undefined;

export function getBotStatus() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const isTokenConfigured = Boolean(token && token !== "MY_DISCORD_BOT_TOKEN" && token.trim().length > 10);
  
  return {
    ...botStatusInfo,
    isConfigured: isTokenConfigured,
    ping: client.ws.ping >= 0 ? client.ws.ping : null,
    guildCount: client.guilds.cache.size,
    availableProviders: {
      gemini: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY"),
      groq: Boolean(process.env.GROQ_API_KEY),
      mistral: Boolean(process.env.MISTRAL_API_KEY),
      deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      pollinations: true,
    },
    creator: {
      name: CREATOR_NAME,
      id: CREATOR_ID,
    },
  };
}

export function startBot(): Promise<string> | void {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || token === "MY_DISCORD_BOT_TOKEN" || token.trim().length < 10) {
    logger.warn("DISCORD_BOT_TOKEN is not configured or is placeholder. Bot will stay in Standby mode until token is configured in Settings.");
    botStatusInfo.error = "DISCORD_BOT_TOKEN belum diset di Secrets. Bot dalam mode standby.";
    return;
  }

  if (!botStartPromise) {
    logger.info("Logging into Discord with DISCORD_BOT_TOKEN...");
    botStartPromise = client.login(token).catch((error) => {
      botStartPromise = undefined;
      botStatusInfo.error = error instanceof Error ? error.message : "Gagal login bot";
      logger.error({ error }, "Gagal login bot");
      throw error;
    });
  }
  return botStartPromise;
}
