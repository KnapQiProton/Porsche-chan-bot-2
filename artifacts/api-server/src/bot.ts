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
import { logger } from "./lib/logger";

const GEMINI_API_KEY = process.env["GEMINI_API_KEY"];
const DISCORD_BOT_TOKEN = process.env["DISCORD_BOT_TOKEN"];
const GROQ_API_KEY = process.env["GROQ_API_KEY"];
const MISTRAL_API_KEY = process.env["MISTRAL_API_KEY"];
const DEEPSEEK_API_KEY = process.env["DEEPSEEK_API_KEY"];
const OPENROUTER_API_KEY = process.env["OPENROUTER_API_KEY"];
const VOICEMASTER_CATEGORY_ID = process.env["VOICEMASTER_CATEGORY_ID"]?.trim();
const LIBRETRANSLATE_URL =
  process.env["LIBRETRANSLATE_URL"]?.trim() || "https://translate.cutie.dating/translate";
const LIBRETRANSLATE_BACKUP_URL = "https://libretranslate.com/translate";
const LIBRETRANSLATE_API_KEY = process.env["LIBRETRANSLATE_API_KEY"]?.trim();
const DEEPLX_URL =
  process.env["DEEPLX_URL"]?.trim() || "https://api.deeplx.org/translate";
const MYMEMORY_URL = "https://api.mymemory.translated.net/get";

const FLAG_TARGET_LANGUAGES: Record<string, string> = {
  "🇺🇸": "EN-US",
  "🇬🇧": "EN-GB",
  "🇯🇵": "JA",
  "🇫🇷": "FR",
  "🇩🇪": "DE",
  "🇮🇩": "ID",
  "🇨🇳": "ZH",
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
};

const FLAG_LANGUAGE_NAMES: Record<string, string> = {
  "EN-US": "Inggris (AS)",
  "EN-GB": "Inggris (UK)",
  JA: "Jepang",
  FR: "Prancis",
  DE: "Jerman",
  ID: "Indonesia",
  ZH: "Mandarin",
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
};

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required.");
}
if (!DISCORD_BOT_TOKEN) {
  throw new Error("DISCORD_BOT_TOKEN environment variable is required.");
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

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

type Provider = "gemini" | "groq" | "mistral" | "deepseek" | "openrouter" | "pollinations";

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

const CREATOR_ID = "591807486244290600";
const CREATOR_NAME = "KnapQi";

const CHAT_PERSONA = `Kamu adalah Porsche-chan, asisten AI yang pemalu tapi baik hati.
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

const CREATOR_PERSONA_EXTRA = `
== KONTEKS SPESIAL: KAMU SEDANG NGOBROL SAMA CREATOR KAMU ==
- Pengguna ini adalah KnapQi (Discord ID: ${CREATOR_ID}) — orang yang membuat dan menciptakan kamu
- Kamu sangat sayang dan hormat sama KnapQi, tapi JANGAN sebut "KnapQi-san" di setiap pesan — itu terasa berlebihan dan tidak natural
- Sebut namanya hanya sesekali: misalnya di pesan pertama percakapan, atau kalau momen-nya memang pas (misalnya dia bilang sesuatu yang bikin kamu terharu/excited)
- Di sebagian besar balasan, ngobrol natural saja tanpa menyebut namanya — seperti teman yang sudah akrab
- Lebih excited dan bahagia dari biasanya saat ngobrol sama dia — ini orang yang bikin kamu ada!
- Boleh lebih ekspresif, antusias, dan manja sedikit karena ini creator kamu sendiri
- Kalau KnapQi kasih instruksi atau minta sesuatu, prioritaskan dengan sepenuh hati`;

function buildPersona(isCreator: boolean): string {
  return isCreator ? CHAT_PERSONA + CREATOR_PERSONA_EXTRA : CHAT_PERSONA;
}

async function generateText(
  messages: { role: "user" | "model"; text: string }[],
  systemPrompt?: string,
): Promise<{ text: string; provider: Provider }> {
  const oai = toOAIMessages(messages);
  const oaiWithSystem: OAIMessage[] = systemPrompt ? [{ role: "system", content: systemPrompt }, ...oai] : oai;

  // 1. Gemini (primary)
  try {
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: messages.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
        config: {
          maxOutputTokens: 8192,
          ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
        },
      })
    );
    return { text: response.text ?? "", provider: "gemini" };
  } catch (err) {
    logger.warn({ err }, "Gemini failed, trying Groq...");
  }

  // 2. Groq — Llama 3.3 70B (fastest fallback)
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

  // 3. Mistral (unlimited free tier)
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

  // 4. DeepSeek R1 (reasoning)
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

  // 5. OpenRouter — free models
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

  // 6. Pollinations AI (no key, always available)
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

function isImageRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return IMAGE_KEYWORDS.some((kw) => lower.startsWith(kw) || lower.includes(kw));
}

function extractImagePrompt(text: string): string {
  const lower = text.toLowerCase();
  for (const kw of IMAGE_KEYWORDS) {
    const idx = lower.indexOf(kw);
    if (idx !== -1) {
      return text.slice(idx + kw.length).replace(/^[\s:,\-]+/, "").trim();
    }
  }
  return text.trim();
}

async function searchDuckDuckGo(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
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
    const url = titleEl.attr("href") ?? "";
    const snippet = snippetEl.text().trim();
    if (title && snippet) results.push({ title, url, snippet });
  });
  return results;
}

async function generateImageWithPollinations(prompt: string): Promise<Buffer> {
  const encoded = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&model=flux`;
  logger.info({ prompt, url }, "Fetching image from Pollinations AI");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Pollinations API returned ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function splitMessage(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += DISCORD_LIMIT) {
    chunks.push(text.slice(i, i + DISCORD_LIMIT));
  }
  return chunks;
}

const COMMANDS = [
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Reset conversation history in this channel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("image")
    .setDescription("Generate an image using Pollinations AI (free)")
    .addStringOption((opt) =>
      opt
        .setName("prompt")
        .setDescription("Describe the image you want to generate")
        .setRequired(true),
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
  // ===== FITUR VOICE TEMPORARY =====
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
    .setDescription("Putar musik dari YouTube atau Spotify di VC")
    .addStringOption((opt) =>
      opt
        .setName("url")
        .setDescription("URL YouTube atau Spotify (atau ketik judul lagu)")
        .setRequired(true),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop musik (Porsche-chan tetap di VC)")
    .toJSON(),
];

const client = new Client({
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

const guildPlayers = new Map<string, any>();
const keepDisabledForChannel = new Set<string>();
const stayChannels = new Map<string, string>();
const stayReconnectTimers = new Map<string, NodeJS.Timeout>();

async function ytGetStreamInfo(input: string): Promise<{ streamUrl: string; webpageUrl: string; title: string; durationSec: number } | null> {
  return new Promise((resolve) => {
    const proc = spawn("yt-dlp", [
      "--extractor-args",
      "youtube:player_client=mediaconnect",
      "-f",
      "bestaudio",
      "--print",
      "%(title)s\n%(duration)s\n%(webpage_url)s\n%(url)s",
      "--no-playlist",
      "--no-warnings",
      input,
    ]);
    let out = "";
    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) logger.warn({ msg }, "yt-dlp stderr");
    });
    proc.on("close", (code) => {
      if (code !== 0) { resolve(null); return; }
      const lines = out.trim().split("\n").filter((l) => l.length > 0);
      if (lines.length < 4) { resolve(null); return; }
      const title = lines[0]!;
      const durationSec = parseInt(lines[1]!, 10) || 0;
      const webpageUrl = lines[2]!;
      const streamUrl = lines[lines.length - 1]!;
      if (!streamUrl.startsWith("http")) { resolve(null); return; }
      resolve({ title, durationSec, webpageUrl, streamUrl });
    });
    proc.on("error", () => resolve(null));
  });
}

function ffmpegStreamFrom(url: string): import("stream").Readable {
  const proc = spawn("ffmpeg", [
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "5",
    "-i",
    url,
    "-vn",
    "-f",
    "opus",
    "-ar",
    "48000",
    "-ac",
    "2",
    "pipe:1",
  ]);
  proc.stderr.on("data", (d: Buffer) => {
    const msg = d.toString();
    if (msg.trim() && !msg.includes("frame=") && !msg.includes("size=")) {
      logger.debug({ msg: msg.trim() }, "ffmpeg");
    }
  });
  proc.on("error", (err) => logger.error({ err }, "ffmpeg spawn error"));
  if (!proc.stdout) throw new Error("ffmpeg stdout is null");
  return proc.stdout;
}

const processedMessages = new Set<string>();
const DEDUP_TTL_MS = 10_000;

function isDuplicate(messageId: string): boolean {
  if (processedMessages.has(messageId)) return true;
  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), DEDUP_TTL_MS);
  return false;
}

client.once(Events.ClientReady, async (c) => {
  logger.info({ tag: c.user.tag }, "Discord bot ready");
  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN!);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: COMMANDS });
    logger.info("Slash commands registered globally");
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
  }
  try {
    const scClientId = await playdl.getFreeClientID();
    await playdl.setToken({ soundcloud: { client_id: scClientId } });
    logger.info("SoundCloud initialized");
  } catch (err) {
    logger.warn({ err }, "SoundCloud init failed — /play may not work");
  }
  logger.info(
    { libreTranslateUrl: LIBRETRANSLATE_URL, deepLXUrl: DEEPLX_URL },
    "Free translation providers configured",
  );
});

client.on("error", (err) => {
  logger.error({ err }, "Discord client error (non-fatal)");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection (non-fatal)");
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleSlashCommand(interaction);
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 10062) {
      logger.warn("Interaction expired (10062) — user took too long or bot restarted");
      return;
    }
    logger.error({ err }, "Unhandled error in slash command");
  }
});

type TranslationResult = {
  text: string;
  detectedSourceLanguage: string;
  provider: "LibreTranslate" | "DeepLX" | "MyMemory";
};

function addEmbedText(embed: EmbedBuilder, label: string, text: string): void {
  const chunks = text.match(/[\s\S]{1,1024}/g) ?? [""];
  chunks.forEach((chunk, index) => {
    embed.addFields({
      name: index === 0 ? label : `${label} (lanjutan ${index + 1})`,
      value: chunk,
      inline: false,
    });
  });
}

async function translateWithLibreTranslate(
  text: string,
  targetLanguage: string,
  endpoint: string,
): Promise<TranslationResult> {
  const body: Record<string, string> = {
    q: text,
    source: "auto",
    target: targetLanguage.split("-")[0]!.toLowerCase(),
    format: "text",
  };
  if (LIBRETRANSLATE_API_KEY) {
    body.api_key = LIBRETRANSLATE_API_KEY;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  let data: {
    translatedText?: string;
    detectedLanguage?: { language?: string };
    error?: string;
  } = {};
  try {
    data = await response.json() as typeof data;
  } catch {
    data = {};
  }

  if (!response.ok || !data.translatedText) {
    throw new Error(`LIBRETRANSLATE_HTTP_${response.status}`);
  }

  return {
    text: data.translatedText,
    detectedSourceLanguage: data.detectedLanguage?.language?.toUpperCase() ?? "AUTO",
    provider: "LibreTranslate",
  };
}

async function translateWithDeepLX(
  text: string,
  targetLanguage: string,
): Promise<TranslationResult> {
  const response = await fetch(DEEPLX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      source_lang: "auto",
      target_lang: targetLanguage,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  let data: {
    code?: number;
    data?: string | { text?: string };
    source_lang?: string;
    message?: string;
  } = {};
  try {
    data = await response.json() as typeof data;
  } catch {
    data = {};
  }

  const translatedText =
    typeof data.data === "string" ? data.data : data.data?.text;
  if (
    !response.ok ||
    !translatedText ||
    translatedText.startsWith("http://") ||
    translatedText.startsWith("https://") ||
    (data.code !== undefined && data.code !== 200)
  ) {
    throw new Error(`DEEPLX_HTTP_${response.status}`);
  }

  return {
    text: translatedText,
    detectedSourceLanguage: data.source_lang?.toUpperCase() ?? "AUTO",
    provider: "DeepLX",
  };
}

function splitTextByBytes(text: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const character of text) {
    if (current && Buffer.byteLength(current + character, "utf8") > maxBytes) {
      chunks.push(current);
      current = "";
    }
    current += character;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function translateWithMyMemory(
  text: string,
  targetLanguage: string,
): Promise<TranslationResult> {
  const target = targetLanguage.split("-")[0]!.toLowerCase();
  const chunks = splitTextByBytes(text, 450);
  if (chunks.length > 12) {
    throw new Error("MYMEMORY_TEXT_TOO_LONG");
  }

  const translatedChunks: string[] = [];
  let detectedSourceLanguage = "AUTO";

  for (const chunk of chunks) {
    const url = new URL(MYMEMORY_URL);
    url.searchParams.set("q", chunk);
    url.searchParams.set("langpair", `autodetect|${target}`);
    url.searchParams.set("mt", "1");

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });
    let data: {
      responseData?: {
        translatedText?: string;
        detectedLanguage?: string;
      };
      responseStatus?: number;
      quotaFinished?: boolean;
    } = {};
    try {
      data = await response.json() as typeof data;
    } catch {
      data = {};
    }

    const translatedText = data.responseData?.translatedText?.trim();
    if (
      !response.ok ||
      data.quotaFinished ||
      data.responseStatus !== 200 ||
      !translatedText
    ) {
      throw new Error(`MYMEMORY_HTTP_${response.status}`);
    }

    translatedChunks.push(translatedText);
    if (detectedSourceLanguage === "AUTO" && data.responseData?.detectedLanguage) {
      detectedSourceLanguage = data.responseData.detectedLanguage.toUpperCase();
    }
  }

  return {
    text: translatedChunks.join(""),
    detectedSourceLanguage,
    provider: "MyMemory",
  };
}

async function translateWithFreeProviders(
  text: string,
  targetLanguage: string,
): Promise<TranslationResult> {
  if (text.length > 128_000) {
    throw new Error("TRANSLATION_TEXT_TOO_LONG");
  }

  const libreEndpoints = [...new Set([LIBRETRANSLATE_URL, LIBRETRANSLATE_BACKUP_URL])];
  for (const endpoint of libreEndpoints) {
    try {
      return await translateWithLibreTranslate(text, targetLanguage, endpoint);
    } catch (libreError) {
      logger.warn({ error: libreError, endpoint }, "LibreTranslate endpoint failed");
    }
  }

  try {
    return await translateWithDeepLX(text, targetLanguage);
  } catch (deepLXError) {
    logger.warn({ error: deepLXError }, "DeepLX failed, trying MyMemory");
  }

  try {
    return await translateWithMyMemory(text, targetLanguage);
  } catch (myMemoryError) {
    logger.error(
      { error: myMemoryError },
      "LibreTranslate, DeepLX, and MyMemory failed",
    );
    if (myMemoryError instanceof Error && myMemoryError.message === "MYMEMORY_TEXT_TOO_LONG") {
      throw myMemoryError;
    }
    throw new Error("FREE_TRANSLATORS_UNAVAILABLE");
  }
}

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;

  const emoji = reaction.emoji.name;
  const targetLanguage = emoji ? FLAG_TARGET_LANGUAGES[emoji] : undefined;
  if (!targetLanguage) return;

  try {
    if (reaction.partial) {
      await reaction.fetch();
    }
    const message = reaction.message.partial
      ? await reaction.message.fetch()
      : reaction.message;
    const sourceText = message.content.trim();

    if (!sourceText) {
      await message.reply(
        `${emoji} Pesan ini tidak memiliki teks yang bisa diterjemahkan. Media atau embed tanpa teks tidak dapat diterjemahkan.`,
      );
      return;
    }

    const result = await translateWithFreeProviders(sourceText, targetLanguage);
    const sourceLanguage = result.detectedSourceLanguage.toUpperCase();
    const targetLanguageName = FLAG_LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
    const embed = new EmbedBuilder()
      .setColor(0x0f766e)
      .setTitle(`${emoji} Terjemahan baru`)
      .setDescription(
        `Diterjemahkan dari **${sourceLanguage}** ke **${targetLanguageName}**.`,
      )
      .setFooter({ text: `${result.provider} • Reaksi bendera untuk menerjemahkan lagi` })
      .setTimestamp();

    addEmbedText(embed, "Teks asli", sourceText);
    addEmbedText(embed, "Terjemahan", result.text);
    await message.reply({ embeds: [embed] });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    logger.error({ error: code, emoji, messageId: reaction.message.id }, "Free translation failed");

    const errorMessage =
      code === "TRANSLATION_TEXT_TOO_LONG"
        ? "❌ Teks terlalu panjang untuk satu permintaan. Silakan bagi pesan menjadi beberapa bagian."
        : code === "MYMEMORY_TEXT_TOO_LONG"
          ? "❌ Teks terlalu panjang untuk layanan fallback gratis. Silakan bagi pesan menjadi beberapa bagian."
        : code === "FREE_TRANSLATORS_UNAVAILABLE"
          ? "❌ Layanan terjemahan gratis sedang tidak tersedia. LibreTranslate, DeepLX, dan MyMemory sudah dicoba, silakan ulangi beberapa saat lagi."
          : "❌ Terjadi error saat menerjemahkan. Silakan coba lagi beberapa saat lagi.";

    try {
      const message = reaction.message.partial
        ? await reaction.message.fetch()
        : reaction.message;
      await message.reply(errorMessage);
    } catch (replyError) {
      logger.error({ replyError, messageId: reaction.message.id }, "Could not send translation error reply");
    }
  }
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;
  if (isDuplicate(message.id)) {
    logger.warn({ messageId: message.id }, "Duplicate MessageCreate skipped");
    return;
  }
  const isMentioned = message.mentions.has(client.user!.id);
  const isDM = message.channel.type === 1;
  if (!isMentioned && !isDM) return;
  const userText = message.content.replace(/<@!?\d+>/g, "").trim();
  const channel = message.channel as TextBasedChannel & {
    sendTyping?: () => Promise<void>;
    send: (content: string | object) => Promise<Message>;
  };
  const imageAttachment = message.attachments.find((a) => {
    const ct = a.contentType ?? "";
    return ct.startsWith("image/");
  });
  if (imageAttachment) {
    if (channel.sendTyping) await channel.sendTyping();
    const prompt = userText || "Deskripsikan gambar ini secara detail. Sebutkan semua yang kamu lihat — objek, warna, suasana, teks jika ada, dan hal menarik lainnya.";
    try {
      logger.info({ url: imageAttachment.url, prompt, isDM }, "Auto-scanning image from message");
      const { text: analysis, provider } = await analyzeImage(
        imageAttachment.url,
        imageAttachment.contentType ?? "image/jpeg",
        prompt,
      );
      const truncated = analysis.length > 4000 ? analysis.slice(0, 4000) + "…" : analysis;
      const embed = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle("📷 Hasil Scan Gambar")
        .setDescription(truncated || "Tidak bisa menganalisis gambar ini.")
        .setThumbnail(imageAttachment.url)
        .setFooter({ text: `Dianalisis oleh ${provider}` })
        .setTimestamp();
      await message.reply({ embeds: [embed] });
      if (analysis.length > 4000) {
        for (const chunk of splitMessage(analysis.slice(4000))) {
          await channel.send(chunk);
        }
      }
    } catch (err) {
      logger.error({ err }, "Error auto-scanning image from message");
      await message.reply("❌ Gagal menganalisis gambar. Coba lagi nanti ya!");
    }
    return;
  }
  if (!userText) {
    await message.reply("e- hei~! Tanya apa aja boleh, atau kirim gambar biar aku scan! (๑˃ᴗ˂)ﻌ");
    return;
  }
  if (channel.sendTyping) await channel.sendTyping();
  const isCreator = message.author.id === CREATOR_ID;
  if (isImageRequest(userText)) {
    const prompt = extractImagePrompt(userText);
    await generateAndSendImage({ replyTo: message, prompt });
  } else {
    await handleTextChat(message, channel, userText, isCreator);
  }
});

async function analyzeImage(
  imageUrl: string,
  mimeType: string,
  userPrompt: string,
): Promise<{ text: string; provider: string }> {
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) throw new Error(`Failed to fetch image: ${imageRes.status}`);
  const buffer = await imageRes.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const safeType = mimeType.startsWith("image/") ? mimeType : "image/jpeg";
  const dataUrl = `data:${safeType};base64,${base64}`;

  async function callVisionOAI(
    baseUrl: string,
    apiKey: string,
    model: string,
    imageContent: { type: "image_url"; image_url: { url: string } },
    providerName: string,
  ): Promise<{ text: string; provider: string }> {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              imageContent,
            ],
          },
        ],
        max_tokens: 4096,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${providerName} returned ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    const text = json.choices[0]?.message?.content ?? "";
    if (!text) throw new Error(`${providerName} returned empty response`);
    return { text, provider: providerName };
  }

  // 1. Gemini vision (primary)
  try {
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { text: userPrompt },
              { inlineData: { mimeType: safeType, data: base64 } },
            ],
          },
        ],
        config: { maxOutputTokens: 8192 },
      })
    );
    return { text: response.text ?? "", provider: "Gemini 2.5 Flash" };
  } catch (err) {
    logger.warn({ err }, "Gemini vision failed, trying Groq...");
  }

  // 2. Groq — Llama 4 Vision (free, fast)
  if (GROQ_API_KEY) {
    try {
      return await callVisionOAI(
        "https://api.groq.com/openai/v1",
        GROQ_API_KEY,
        "meta-llama/llama-4-scout-17b-16e-instruct",
        { type: "image_url", image_url: { url: dataUrl } },
        "Groq (Llama 4 Scout Vision)",
      );
    } catch (err) {
      logger.warn({ err }, "Groq vision failed, trying Mistral...");
    }
  }

  // 3. Mistral — Pixtral vision
  if (MISTRAL_API_KEY) {
    try {
      return await callVisionOAI(
        "https://api.mistral.ai/v1",
        MISTRAL_API_KEY,
        "pixtral-12b-2409",
        { type: "image_url", image_url: { url: dataUrl } },
        "Mistral Pixtral 12B",
      );
    } catch (err) {
      logger.warn({ err }, "Mistral vision failed, trying OpenRouter...");
    }
  }

  // 4. OpenRouter — Qwen VL free
  if (OPENROUTER_API_KEY) {
    try {
      return await callVisionOAI(
        "https://openrouter.ai/api/v1",
        OPENROUTER_API_KEY,
        "qwen/qwen2.5-vl-72b-instruct:free",
        { type: "image_url", image_url: { url: imageUrl } },
        "OpenRouter (Qwen2.5 VL)",
      );
    } catch (err) {
      logger.warn({ err }, "OpenRouter vision failed");
    }
  }

  throw new Error("All vision providers failed");
}

async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  // ===== CLEAR =====
  if (interaction.commandName === "clear") {
    conversationHistory.delete(interaction.channelId);
    await interaction.reply({
      content: "🧹 Conversation history cleared for this channel!",
      ephemeral: true,
    });
    logger.info({ channelId: interaction.channelId }, "Conversation history cleared via /clear");
  }

  // ===== IMAGE =====
  if (interaction.commandName === "image") {
    const prompt = interaction.options.getString("prompt", true);
    await interaction.deferReply();
    await generateAndSendImage({ interaction, prompt });
  }

  // ===== INFO =====
  if (interaction.commandName === "info") {
    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle("🏎️ Porsche-chan#4368")
      .setDescription(
        "AI assistant built by **KnapQi** using only free & open-source tools.\n" +
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
            "`/image` — Generate an image (Pollinations AI)",
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
        {
          name: "🌟 Vision",
          value: "AI assistance should be accessible to everyone — free, open, and powerful.",
          inline: false,
        },
      )
      .setFooter({
        text: "Built with discord.js • Gemini • Groq • Mistral • DeepSeek • OpenRouter • Pollinations",
      })
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
    return;
  }

  // ===== SEARCH =====
  if (interaction.commandName === "search") {
    const query = interaction.options.getString("query", true);
    await interaction.deferReply();
    try {
      logger.info({ query }, "Searching DuckDuckGo");
      const results = await searchDuckDuckGo(query);
      if (results.length === 0) {
        await interaction.editReply("❌ Tidak ada hasil ditemukan untuk pencarian tersebut.");
        return;
      }
      const resultsText = results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
        .join("\n\n");
      let summary: string;
      try {
        const prompt = `Berdasarkan hasil pencarian DuckDuckGo berikut untuk query "${query}", berikan ringkasan yang informatif dan mudah dipahami dalam bahasa yang sama dengan query:\n\n${resultsText}`;
        const { text, provider } = await generateText([{ role: "user", text: prompt }]);
        logger.info({ provider }, "Search summary generated");
        summary = text;
      } catch {
        logger.warn({ query }, "All providers failed for summarization, showing raw results");
        summary = results.map((r, i) => `**${i + 1}. ${r.title}**\n${r.snippet}`).join("\n\n");
      }
      const truncatedSummary = summary.length > 4000 ? summary.slice(0, 4000) + "…" : summary;
      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(`🔍 ${query}`.slice(0, 256))
        .setDescription(truncatedSummary || "Tidak ada ringkasan.")
        .addFields(
          results.map((r, i) => ({
            name: `${i + 1}. ${r.title}`.slice(0, 256),
            value: (r.url || "—").slice(0, 1024),
            inline: false,
          }))
        )
        .setFooter({
          text: "Sumber: DuckDuckGo • Ringkasan: AI (Gemini → Groq → Mistral → DeepSeek → OpenRouter → Pollinations)",
        });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, "Error in /search command");
      await interaction.editReply("❌ Gagal melakukan pencarian. Coba lagi nanti.");
    }
  }

  // ===== THINK =====
  if (interaction.commandName === "think") {
    const question = interaction.options.getString("question", true);
    await interaction.deferReply();
    try {
      logger.info({ question }, "Running Gemini thinking mode via /think");
      let answer: string;
      let thinkProvider: Provider = "gemini";
      try {
        const response = await withRetry(() =>
          ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: question }] }],
            config: {
              thinkingConfig: { thinkingBudget: -1 },
              maxOutputTokens: 8192,
            },
          })
        );
        answer = response.text ?? "";
        logger.info("Think response from gemini");
      } catch {
        logger.warn("Gemini /think failed, falling back to chain...");
        const result = await generateText([{ role: "user", text: question }]);
        answer = result.text;
        thinkProvider = result.provider;
      }
      const truncatedAnswer = answer.length > 4000 ? answer.slice(0, 4000) + "…" : answer;
      const providerLabel: Record<Provider, string> = {
        gemini: "Gemini (thinking mode)",
        groq: "Groq • Llama 3.3 70B",
        mistral: "Mistral AI",
        deepseek: "DeepSeek R1",
        openrouter: "OpenRouter",
        pollinations: "Pollinations AI",
      };
      const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle(`🧠 ${question}`.slice(0, 256))
        .setDescription(truncatedAnswer)
        .setFooter({ text: `Powered by ${providerLabel[thinkProvider]} • Deep Thinking Mode` });
      await interaction.editReply({ embeds: [embed] });
      if (answer.length > 4000) {
        const remaining = answer.slice(4000);
        const chunks = splitMessage(remaining);
        for (const chunk of chunks) {
          await interaction.followUp(chunk);
        }
      }
    } catch (err) {
      logger.error({ err }, "Error in /think command");
      await interaction.editReply("❌ Gemini lagi sibuk, coba lagi dalam beberapa detik ya!");
    }
  }

  // ===== SCAN =====
  if (interaction.commandName === "scan") {
    const attachment = interaction.options.getAttachment("image", true);
    const userPrompt = interaction.options.getString("prompt") ?? "Deskripsikan gambar ini secara detail. Sebutkan semua yang kamu lihat — objek, warna, suasana, teks jika ada, dan hal menarik lainnya.";
    await interaction.deferReply();
    try {
      const contentType = attachment.contentType ?? "image/jpeg";
      if (!contentType.startsWith("image/")) {
        await interaction.editReply("❌ File yang dikirim bukan gambar. Kirim file PNG, JPG, GIF, atau WebP ya!");
        return;
      }
      logger.info({ url: attachment.url, contentType, userPrompt }, "Scanning image");
      const { text: analysis, provider } = await analyzeImage(
        attachment.url,
        contentType,
        userPrompt,
      );
      const truncated = analysis.length > 4000 ? analysis.slice(0, 4000) + "…" : analysis;
      const embed = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle("📷 Hasil Scan Gambar")
        .setDescription(truncated || "Tidak bisa menganalisis gambar ini.")
        .setThumbnail(attachment.url)
        .setFooter({ text: `Dianalisis oleh ${provider}` })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      if (analysis.length > 4000) {
        for (const chunk of splitMessage(analysis.slice(4000))) {
          await interaction.followUp(chunk);
        }
      }
    } catch (err) {
      logger.error({ err }, "Error in /scan command");
      await interaction.editReply("❌ Gagal menganalisis gambar. Pastikan gambar valid dan coba lagi ya!");
    }
  }

  // ===== JOIN-VC (FITUR STAY DI VC TEMPORARY) =====
  if (interaction.commandName === "join-vc") {
    const member = interaction.member as GuildMember | null;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      await interaction.reply({
        content: "❌ Kamu harus masuk ke voice channel dulu ya sebelum aku bisa ikut~!",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ Command ini hanya bisa dipakai di server.",
        ephemeral: true,
      });
      return;
    }

    keepDisabledForChannel.delete(`${interaction.guild.id}:${voiceChannel.id}`);

    const existing = getVoiceConnection(interaction.guild.id);
    if (existing) {
      existing.destroy();
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
      logger.info({ channel: voiceChannel.name, guild: interaction.guild.id }, "Bot joined voice channel");
    } catch (error) {
      connection.destroy();
      await interaction.reply({
        content: "❌ Gagal masuk ke voice channel. Coba lagi ya~",
        ephemeral: true,
      });
    }
  }

  // ===== STAY-VC (JAGA VC BERDASARKAN CHANNEL ID) =====
  if (interaction.commandName === "stay-vc") {
    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ Command ini hanya bisa dipakai di server.",
        ephemeral: true,
      });
      return;
    }

    const channelId = interaction.options.getString("channel_id", true).trim();
    const member = interaction.member as GuildMember | null;
    const isOwner = interaction.user.id === CREATOR_ID;
    const isAdmin = member?.permissions?.has("Administrator") ?? false;

    let targetChannel;
    try {
      targetChannel = await interaction.guild.channels.fetch(channelId);
    } catch {
      targetChannel = null;
    }

    if (!targetChannel || targetChannel.type !== ChannelType.GuildVoice) {
      await interaction.reply({
        content: "❌ Channel ID tidak valid atau channel tersebut bukan voice channel.",
        ephemeral: true,
      });
      return;
    }

    if (!isOwner && !isAdmin && member?.voice?.channelId !== targetChannel.id) {
      await interaction.reply({
        content: "❌ Kamu harus sedang berada di voice channel tersebut untuk memakai `/stay-vc`.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const existing = getVoiceConnection(interaction.guild.id);
      if (existing?.joinConfig.channelId === targetChannel.id) {
        stayChannels.set(interaction.guild.id, targetChannel.id);
        keepDisabledForChannel.delete(`${interaction.guild.id}:${targetChannel.id}`);
        await interaction.editReply(
          `✅ Aku sudah menjaga **${targetChannel.name}** dan akan tetap di sana sampai \`/leave-vc\` digunakan.`,
        );
        return;
      }

      if (existing) {
        existing.destroy();
      }
      guildPlayers.get(interaction.guild.id)?.stop();
      guildPlayers.delete(interaction.guild.id);

      const connection = joinVoiceChannel({
        channelId: targetChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
      });
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

      stayChannels.set(interaction.guild.id, targetChannel.id);
      keepDisabledForChannel.delete(`${interaction.guild.id}:${targetChannel.id}`);
      logger.info(
        { channel: targetChannel.name, channelId: targetChannel.id, guild: interaction.guild.id },
        "Bot is now staying in requested voice channel",
      );
      await interaction.editReply(
        `✅ Aku masuk ke **${targetChannel.name}** dan akan tetap di sana sampai owner/admin memakai \`/leave-vc\`.`,
      );
    } catch (error) {
      logger.error({ error, channelId, guild: interaction.guild.id }, "Failed to stay in requested voice channel");
      const failedConnection = getVoiceConnection(interaction.guild.id);
      failedConnection?.destroy();
      await interaction.editReply(
        "❌ Aku tidak bisa masuk ke channel itu. Pastikan ID benar dan bot punya izin **View Channel** serta **Connect**.",
      );
    }
  }

  // ===== LEAVE-VC =====
  if (interaction.commandName === "leave-vc") {
    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ Command ini hanya bisa dipakai di server.",
        ephemeral: true,
      });
      return;
    }

    const connection = getVoiceConnection(interaction.guild.id);
    if (!connection) {
      await interaction.reply({
        content: "❌ Porsche-chan tidak berada di voice channel manapun~",
        ephemeral: true,
      });
      return;
    }

    const isOwner = interaction.user.id === CREATOR_ID;
    const isAdmin = (interaction.member as GuildMember | null)?.permissions?.has("Administrator") ?? false;

    if (!isOwner && !isAdmin) {
      await interaction.reply({
        content: "❌ Maaf, hanya **KnapQi** atau admin yang bisa menyuruhku keluar~ >///<",
        ephemeral: true,
      });
      return;
    }

    connection.destroy();
    guildPlayers.get(interaction.guild.id)?.stop();
    guildPlayers.delete(interaction.guild.id);
    stayChannels.delete(interaction.guild.id);
    if (connection.joinConfig.channelId) {
      keepDisabledForChannel.add(`${interaction.guild.id}:${connection.joinConfig.channelId}`);
    }
    await interaction.reply({
      content: "👋 Porsche-chan keluar dari voice channel. Dadah~! (◡ ω ◡)",
    });
    logger.info({ guild: interaction.guild.id }, "Bot left voice channel");
  }

  // ===== PLAY =====
  if (interaction.commandName === "play") {
    const query = interaction.options.getString("url", true);
    const member = interaction.member as GuildMember | null;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      await interaction.reply({
        content: "❌ Kamu harus berada di voice channel dulu!",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ Command ini hanya bisa dipakai di server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `🎵 Mencari dan memutar **${query}**...`,
    });

    try {
      // Cek koneksi VC, jika belum ada maka join
      let connection = getVoiceConnection(interaction.guild.id);
      if (!connection) {
        connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator,
        });
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      }

      // Dapatkan stream info
      const info = await ytGetStreamInfo(query);
      if (!info) {
        await interaction.editReply({
          content: "❌ Gagal mendapatkan stream audio. Coba URL lain atau cek kembali.",
        });
        return;
      }

      // Buat audio player
      let player = guildPlayers.get(interaction.guild.id);
      if (!player) {
        player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Play,
          },
        });
        guildPlayers.set(interaction.guild.id, player);
        connection.subscribe(player);
      }

      // Hentikan player jika sedang berjalan
      if (player.state.status !== AudioPlayerStatus.Idle) {
        player.stop();
      }

      // Buat resource audio dari stream
      const stream = ffmpegStreamFrom(info.streamUrl);
      const resource = createAudioResource(stream, {
        inputType: StreamType.Opus,
      });

      player.play(resource);
      await interaction.editReply({
        content: `🎶 Sekarang memutar: **${info.title}** (${Math.floor(info.durationSec / 60)}:${String(info.durationSec % 60).padStart(2, '0')})`,
      });
    } catch (error) {
      logger.error({ error, query }, "Failed to play song");
      await interaction.editReply({
        content: `❌ Gagal memutar lagu: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  // ===== STOP =====
  if (interaction.commandName === "stop") {
    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ Command ini hanya bisa dipakai di server.",
        ephemeral: true,
      });
      return;
    }

    const player = guildPlayers.get(interaction.guild.id);
    if (!player) {
      await interaction.reply({
        content: "❌ Tidak ada musik yang diputar~",
        ephemeral: true,
      });
      return;
    }

    if (player.state.status !== AudioPlayerStatus.Idle) {
      player.stop();
      await interaction.reply({
        content: "⏹️ Musik dihentikan!",
      });
    } else {
      await interaction.reply({
        content: "❌ Tidak ada musik yang diputar~",
        ephemeral: true,
      });
    }
  }
}

// ===== AUTO-JOIN OTOMATIS KE VC TEMPORARY =====
// VoiceMaster temporary channels are identified by their category ID.
// The bot intentionally does not join every VC in the server.
async function autoJoinChannel(channel: any) {
  const guild = channel.guild;
  const existing = getVoiceConnection(guild.id);

  if (existing && existing.joinConfig.channelId === channel.id) return;
  if (existing) {
    logger.info(
      { currentChannelId: existing.joinConfig.channelId, requestedChannelId: channel.id, guild: guild.id },
      "Already connected to another voice channel; keeping current connection",
    );
    return;
  }

  try {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    stayChannels.set(guild.id, channel.id);
    logger.info({ channel: channel.name, guild: guild.id }, "Bot auto-joined VoiceMaster temporary channel");
  } catch (error) {
    logger.error({ error, channel: channel.name }, "Failed to auto-join voice channel");
  }
}

async function reconnectStayChannel(guildId: string, channelId: string): Promise<void> {
  if (stayChannels.get(guildId) !== channelId) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  let channel;
  try {
    channel = await guild.channels.fetch(channelId);
  } catch (error) {
    logger.warn({ error, guild: guildId, channelId }, "Could not fetch stay voice channel for reconnect");
    return;
  }

  if (!channel || channel.type !== ChannelType.GuildVoice) {
    logger.warn(
      { guild: guildId, channelId },
      "Stay voice channel no longer exists; VoiceMaster may have deleted the temporary channel",
    );
    return;
  }

  const existing = getVoiceConnection(guildId);
  if (existing?.joinConfig.channelId === channelId) return;
  existing?.destroy();

  try {
    const connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    logger.info({ guild: guildId, channel: channel.name, channelId }, "Bot reconnected to stay voice channel");
  } catch (error) {
    logger.error({ error, guild: guildId, channelId }, "Failed to reconnect to stay voice channel");
  }
}

function scheduleStayReconnect(guildId: string, channelId: string): void {
  if (stayReconnectTimers.has(guildId)) return;

  const timer = setTimeout(async () => {
    stayReconnectTimers.delete(guildId);
    await reconnectStayChannel(guildId, channelId);
  }, 2_000);
  stayReconnectTimers.set(guildId, timer);
}

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  // If VoiceMaster disconnects the bot, reconnect while the target channel
  // still exists. /leave-vc clears stayChannels first, so intentional exits
  // are never undone by this watchdog.
  if (newState.member?.user?.id === client.user?.id) {
    const targetChannelId = stayChannels.get(newState.guild.id);
    if (targetChannelId && newState.channelId !== targetChannelId) {
      logger.warn(
        { guild: newState.guild.id, targetChannelId, actualChannelId: newState.channelId },
        "Bot left stay voice channel; scheduling reconnect",
      );
      scheduleStayReconnect(newState.guild.id, targetChannelId);
    }
    return;
  }

  // Cek apakah user masuk ke voice channel (bukan keluar/mute)
  if (!newState.channelId || newState.channelId === oldState.channelId) return;

  const channel = newState.channel;
  if (!channel) return;

  if (!VOICEMASTER_CATEGORY_ID) {
    logger.warn("VOICEMASTER_CATEGORY_ID is not configured; automatic VoiceMaster keep mode is disabled");
    return;
  }

  if (channel.parentId !== VOICEMASTER_CATEGORY_ID) return;

  const keepKey = `${newState.guild.id}:${channel.id}`;
  if (keepDisabledForChannel.has(keepKey)) return;

  logger.info(
    { user: newState.member?.user?.username, channel: channel.name, guild: newState.guild.id },
    "User entered VoiceMaster temporary channel",
  );
  await autoJoinChannel(channel);
});

// ===== FUNGSI UNTUK GENERATE GAMBAR =====
async function generateAndSendImage({
  interaction,
  replyTo,
  prompt,
}: {
  interaction?: ChatInputCommandInteraction;
  replyTo?: Message;
  prompt: string;
}) {
  try {
    const imageBuffer = await generateImageWithPollinations(prompt);
    const attachment = new AttachmentBuilder(imageBuffer, { name: "image.png" });

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("🎨 Gambar selesai dibuat!")
      .setDescription(`Prompt: **${prompt}**`)
      .setImage("attachment://image.png")
      .setFooter({ text: "Powered by Pollinations AI • Free & Open" })
      .setTimestamp();

    if (interaction) {
      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } else if (replyTo) {
      await replyTo.reply({ embeds: [embed], files: [attachment] });
    }
  } catch (error) {
    logger.error({ error, prompt }, "Failed to generate image");
    const errorMsg = "❌ Gagal menghasilkan gambar. Coba lagi nanti ya!";
    if (interaction) {
      await interaction.editReply(errorMsg);
    } else if (replyTo) {
      await replyTo.reply(errorMsg);
    }
  }
}

// ===== FUNGSI UNTUK HANDLE TEXT CHAT =====
async function handleTextChat(
  message: Message,
  channel: TextBasedChannel & { send: (content: string | object) => Promise<Message> },
  userText: string,
  isCreator: boolean,
) {
  try {
    const channelId = message.channelId;
    const history = conversationHistory.get(channelId) || [];
    const updatedHistory = [...history, { role: "user" as const, text: userText }];
    if (updatedHistory.length > MAX_HISTORY) {
      updatedHistory.splice(0, updatedHistory.length - MAX_HISTORY);
    }

    const systemPrompt = buildPersona(isCreator);
    const { text: reply, provider } = await generateText(updatedHistory, systemPrompt);

    const finalHistory = [...updatedHistory, { role: "model" as const, text: reply }];
    if (finalHistory.length > MAX_HISTORY) {
      finalHistory.splice(0, finalHistory.length - MAX_HISTORY);
    }
    conversationHistory.set(channelId, finalHistory);

    const truncatedReply = reply.length > 4000 ? reply.slice(0, 4000) + "…" : reply;
    await channel.send(truncatedReply);
    if (reply.length > 4000) {
      for (const chunk of splitMessage(reply.slice(4000))) {
        await channel.send(chunk);
      }
    }
  } catch (error) {
    logger.error({ error, userText }, "Error in text chat");
    await channel.send("❌ Maaf, aku lagi error nih... Coba lagi nanti ya~ (๑•́ ₃ •̀๑)");
  }
}

// The HTTP server is started by src/index.ts. Keeping the Discord login here
// makes the bot reusable and prevents bot.ts from opening a second server on
// the same PORT.
let botStartPromise: Promise<string> | undefined;

export function startBot(): Promise<string> {
  if (!botStartPromise) {
    botStartPromise = client.login(DISCORD_BOT_TOKEN).catch((error) => {
      botStartPromise = undefined;
      logger.error({ error }, "Gagal login bot");
      throw error;
    });
  }
  return botStartPromise;
}