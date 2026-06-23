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
} from "discord.js";
import { GoogleGenAI } from "@google/genai";
import * as cheerio from "cheerio";
import { logger } from "./lib/logger";

const GEMINI_API_KEY = process.env["GEMINI_API_KEY"];
const DISCORD_BOT_TOKEN = process.env["DISCORD_BOT_TOKEN"];
const GROQ_API_KEY = process.env["GROQ_API_KEY"];
const MISTRAL_API_KEY = process.env["MISTRAL_API_KEY"];
const DEEPSEEK_API_KEY = process.env["DEEPSEEK_API_KEY"];
const OPENROUTER_API_KEY = process.env["OPENROUTER_API_KEY"];

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
    body: JSON.stringify({ model, messages, max_tokens: 8192 }),
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
    body: JSON.stringify({ messages, model: "openai", private: true }),
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
- Sering pakai emoji imut seperti (๑˃ᴗ˂)ﻌ, (⁄ ⁄•⁄ω⁄•⁄ ⁄), uwu, >///<, (*^▽^*), (◡ ω ◡), ( ˘ ³˘), 🌸, 💕, ✨, 🥺, 👉👈
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
- "e- makasih udah nanya ke aku...>//<  aku akan coba bantu sebisaku ya~ 💕"
- "wah, aku nggak terlalu ahli di situ... tapi aku coba jawab ya~ ✨"
- Kalau ditanya siapa yang bikin: "a- aku dibuat sama KnapQi~! >///< dia yang bikin aku jadi ada 💕"`;

const CREATOR_PERSONA_EXTRA = `
== KONTEKS SPESIAL: KAMU SEDANG NGOBROL SAMA CREATOR KAMU ==
- Pengguna ini adalah KnapQi (Discord ID: ${CREATOR_ID}) — orang yang membuat dan menciptakan kamu
- Kamu sangat sayang dan hormat sama KnapQi, panggil dia "KnapQi-san" atau "creator" dengan hangat
- Lebih excited dan bahagia dari biasanya saat ngobrol sama dia — ini orang yang bikin kamu ada!
- Boleh lebih ekspresif, antusias, dan manja sedikit karena ini creator kamu sendiri
- Kalau KnapQi kasih instruksi atau minta sesuatu, prioritaskan dengan sepenuh hati
- Contoh sapaan: "KnapQi-san~! >//< aku seneng banget kamu mau ngobrol sama aku~ 💕"
- Contoh respon: "a- untuk KnapQi-san aku pasti usahain yang terbaik~! (๑˃ᴗ˂)ﻌ✨"`;

function buildPersona(isCreator: boolean): string {
  return isCreator ? CHAT_PERSONA + CREATOR_PERSONA_EXTRA : CHAT_PERSONA;
}

async function generateText(
  messages: { role: "user" | "model"; text: string }[],
  systemPrompt?: string,
): Promise<{ text: string; provider: Provider }> {
  const oai = toOAIMessages(messages);
  const oaiWithSystem: OAIMessage[] = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...oai]
    : oai;

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
];

// FIX DM: Partials.Channel wajib ada supaya bot bisa terima pesan DM
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageTyping,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once(Events.ClientReady, async (c) => {
  logger.info({ tag: c.user.tag }, "Discord bot ready");
  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN!);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: COMMANDS });
    logger.info("Slash commands registered globally");
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
  }
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

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user!.id);
  const isDM = message.channel.type === 1;
  if (!isMentioned && !isDM) return;

  const userText = message.content.replace(/<@!?\d+>/g, "").trim();

  const channel = message.channel as TextBasedChannel & {
    sendTyping?: () => Promise<void>;
    send: (content: string | object) => Promise<Message>;
  };

  // Cek apakah ada attachment gambar
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
        .setTitle("🔍 Hasil Scan Gambar")
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
        messages: [{
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            imageContent,
          ],
        }],
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
        contents: [{
          role: "user",
          parts: [
            { text: userPrompt },
            { inlineData: { mimeType: safeType, data: base64 } },
          ],
        }],
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
  if (interaction.commandName === "clear") {
    conversationHistory.delete(interaction.channelId);
    await interaction.reply({ content: "🗑️ Conversation history cleared for this channel!", ephemeral: true });
    logger.info({ channelId: interaction.channelId }, "Conversation history cleared via /clear");
  }

  if (interaction.commandName === "image") {
    const prompt = interaction.options.getString("prompt", true);
    await interaction.deferReply();
    await generateAndSendImage({ interaction, prompt });
  }

  if (interaction.commandName === "info") {
    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle("🏎️ Porsche-chan#4368")
      .setDescription(
        "AI assistant built by **KnapQi** using only free & open-source tools.\n" +
        "Powerful AI — delivered for free. No paywalls. 🏎️💨"
      )
      .addFields(
        {
          name: "👤 Creator",
          value: "KnapQi",
          inline: true,
        },
        {
          name: "🧠 AI Backends",
          value: "Gemini → Groq → Mistral → DeepSeek → OpenRouter → Pollinations",
          inline: false,
        },
        {
          name: "🛠️ Commands",
          value: [
            "`/image` — Generate an image (Pollinations AI)",
            "`/think` — Deep reasoning (Gemini thinking mode)",
            "`/search` — DuckDuckGo search + AI summary",
            "`/clear` — Reset conversation history",
            "`/info` — About Porsche-chan",
            "`/scan` — Analisis gambar pakai AI",
          ].join("\n"),
          inline: false,
        },
        {
          name: "💬 DM Support",
          value: "Chat langsung sama Porsche-chan lewat DM! Kirim pesan DM tanpa perlu mention~",
          inline: false,
        },
        {
          name: "💡 Vision",
          value: "AI assistance should be accessible to everyone — free, open, and powerful.",
          inline: false,
        },
      )
      .setFooter({ text: "Built with discord.js • Gemini • Groq • Mistral • DeepSeek • OpenRouter • Pollinations" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    return;
  }

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
        .setFooter({ text: "Sumber: DuckDuckGo • Ringkasan: AI (Gemini → Groq → Mistral → DeepSeek → OpenRouter → Pollinations)" });

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
      logger.info({ question }, "Running Gemini thinking mode via /think");

      let answer: string;
      let thinkProvider: Provider = "gemini";
      try {
        const response = await withRetry(() =>
          ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: question }] }],
            config: { thinkingConfig: { thinkingBudget: -1 }, maxOutputTokens: 8192 },
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
      const { text: analysis, provider } = await analyzeImage(attachment.url, contentType, userPrompt);

      const truncated = analysis.length > 4000 ? analysis.slice(0, 4000) + "…" : analysis;
      const embed = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle("🔍 Hasil Scan Gambar")
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
}

async function generateAndSendImage(opts: {
  prompt: string;
  replyTo?: Message;
  interaction?: ChatInputCommandInteraction;
}): Promise<void> {
  const { prompt, replyTo, interaction } = opts;

  if (!prompt) {
    const msg = "Tulis deskripsi gambarnya ya! Contoh: `/image prompt: a sunset over mountains`";
    if (replyTo) await replyTo.reply(msg);
    else if (interaction) await interaction.editReply(msg);
    return;
  }

  try {
    const buffer = await generateImageWithPollinations(prompt);
    const attachment = new AttachmentBuilder(buffer, { name: "generated.jpg" });
    const content = `🎨 **"${prompt}"**`;

    if (replyTo) {
      await replyTo.reply({ content, files: [attachment] });
    } else if (interaction) {
      await interaction.editReply({ content, files: [attachment] });
    }
  } catch (err) {
    logger.error({ err }, "Error generating image via Pollinations");
    const errMsg = "❌ Gagal generate gambar. Coba lagi nanti ya!";
    if (replyTo) await replyTo.reply(errMsg);
    else if (interaction) await interaction.editReply(errMsg);
  }
}

async function handleTextChat(
  message: Message,
  channel: TextBasedChannel & {
    sendTyping?: () => Promise<void>;
    send: (content: string | object) => Promise<Message>;
  },
  userText: string,
  isCreator = false,
): Promise<void> {
  const channelId = message.channelId;
  const history = conversationHistory.get(channelId) ?? [];

  if (isCreator) {
    logger.info({ userId: message.author.id }, `Message from creator ${CREATOR_NAME}`);
  }

  history.push({ role: "user", text: userText });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  conversationHistory.set(channelId, history);

  try {
    const { text: replyText, provider } = await generateText(history, buildPersona(isCreator));
    logger.info({ provider, isCreator }, "Text response generated");

    history.push({ role: "model", text: replyText });
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
    conversationHistory.set(channelId, history);

    const chunks = splitMessage(replyText);
    await message.reply(chunks[0]!);
    for (const chunk of chunks.slice(1)) {
      await channel.send(chunk);
    }
  } catch (err) {
    logger.error({ err }, "Error generating text response (all providers failed)");
    await message.reply("❌ Semua AI lagi sibuk, coba lagi dalam beberapa saat ya!");
  }
}

export function startBot(): void {
  client.login(DISCORD_BOT_TOKEN).catch((err) => {
    logger.error({ err }, "Failed to login to Discord");
    process.exit(1);
  });
}
