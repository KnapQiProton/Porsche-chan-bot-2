import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { logger, getRecentLogs } from "./server/logger";
import {
  startBot,
  getBotStatus,
  generateText,
  buildPersona,
  searchDuckDuckGo,
  analyzeImage,
  translateWithAI,
  translateWithFreeProviders,
  performDeepThink,
  fetchNekosImage,
  generateAiImage,
  ImageGenModel,
  AspectRatioType,
  isNsfwAllowed,
  setNsfwAllowed,
  isNsfwFilterOn,
  setNsfwFilterState,
  NsfwFilterBlockedError,
  containsNsfwTags,
  NSFW_PASSCODE,
  COMMANDS,
  FLAG_TARGET_LANGUAGES,
  FLAG_LANGUAGE_NAMES,
  CREATOR_NAME,
  CREATOR_ID,
} from "./server/bot";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Request logger middleware
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
      logger.debug({ method: req.method, path: req.path }, `API Request: ${req.method} ${req.path}`);
    }
    next();
  });

  // --- API Routes ---
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/bot/status", (_req, res) => {
    try {
      const status = getBotStatus();
      res.setHeader("Content-Type", "application/json");
      res.json(status);
    } catch (err) {
      logger.error({ err }, "Error getting bot status");
      res.status(500).setHeader("Content-Type", "application/json").json({ error: "Gagal mengambil status bot" });
    }
  });

  app.post("/api/bot/start", async (_req, res) => {
    try {
      await startBot();
      res.json({ success: true, status: getBotStatus() });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : "Gagal memulai bot",
      });
    }
  });

  app.get("/api/bot/logs", (_req, res) => {
    res.json(getRecentLogs());
  });

  app.get("/api/bot/info", (_req, res) => {
    res.json({
      name: "Porsche-chan",
      creator: CREATOR_NAME,
      creatorId: CREATOR_ID,
      commands: COMMANDS,
      flagLanguages: FLAG_TARGET_LANGUAGES,
      flagLanguageNames: FLAG_LANGUAGE_NAMES,
    });
  });

  // Interactive Web Chat Simulator with Porsche-chan Persona
  app.post("/api/bot/chat", async (req, res) => {
    const { message, isCreator = false, history = [] } = req.body;
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Pesan tidak boleh kosong" });
      return;
    }

    try {
      const conversation = [
        ...history.slice(-10),
        { role: "user" as const, text: message },
      ];
      const systemPrompt = buildPersona(Boolean(isCreator));
      const result = await generateText(conversation, systemPrompt);

      logger.info(
        { provider: result.provider, isCreator, messageLength: message.length },
        "Chat simulated from web interface"
      );

      res.json({
        reply: result.text,
        provider: result.provider,
        persona: isCreator ? "Creator (KnapQi)" : "Normal User",
      });
    } catch (err) {
      logger.error({ err }, "Error simulating chat");
      res.status(500).json({
        error: "Porsche-chan lagi error nih... (๑•́ ₃ •̀๑)",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Image Generation endpoint (Nano Banana & Pollinations - /image)
  app.post("/api/bot/image", async (req, res) => {
    const { prompt, model = "nanobanana", aspectRatio = "1:1" } = req.body;
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "Prompt gambar tidak boleh kosong" });
      return;
    }

    try {
      const result = await generateAiImage(
        prompt,
        (model as ImageGenModel) || "nanobanana",
        (aspectRatio as AspectRatioType) || "1:1"
      );

      const base64Image = `data:image/png;base64,${result.buffer.toString("base64")}`;

      logger.info(
        { prompt, model: result.model, provider: result.provider, durationMs: result.durationMs },
        "Image generated via API"
      );

      res.json({
        success: true,
        imageUrl: base64Image,
        prompt,
        model: result.model,
        modelDisplayName: result.modelDisplayName,
        provider: result.provider,
        aspectRatio: result.aspectRatio,
        dimensions: result.dimensions,
        durationMs: result.durationMs,
      });
    } catch (err) {
      logger.error({ err }, "Error generating image");
      res.status(500).json({
        error: "Gagal membuat gambar AI",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Dedicated Anime Illustration Search endpoint (Nekos API & Booru - /illust)
  app.post("/api/bot/illust", async (req, res) => {
    const { rating = "safe", tags, passcode } = req.body;

    try {
      const { info } = await fetchNekosImage({ rating, tags, passcode });
      logger.info({ id: info.id, rating: info.rating, tags, provider: info.provider }, "Fetched anime illustration");
      res.json({
        success: true,
        imageUrl: info.url,
        prompt: tags ? `Ilustrasi anime: "${tags}"` : `Anime Illustration #${info.id}`,
        rating: info.rating,
        tags: info.tags,
        artistName: info.artistName,
        sourceUrl: info.sourceUrl,
        pixivUrl: info.pixivUrl,
        danbooruUrl: info.danbooruUrl,
        provider: info.provider,
        nsfwAllowed: isNsfwAllowed(),
        filterNsfwOn: isNsfwFilterOn(),
      });
    } catch (err) {
      if (err instanceof NsfwFilterBlockedError || (err as { isNsfwBlocked?: boolean })?.isNsfwBlocked || String(err).includes("filter nsfw lagi on")) {
        res.status(403).json({
          success: false,
          blocked: true,
          error: "saat ini filter nsfw lagi on konsultasi sama KnapQi untuk menonaktifkannya",
        });
        return;
      }
      logger.error({ err, tags, rating }, "Error fetching anime illustration");
      res.status(500).json({
        error: "Gagal mengambil ilustrasi anime. Silakan periksa tag pencarian atau coba lagi!",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // NSFW Filter toggle endpoint (requires owner passcode)
  app.post("/api/bot/nsfw-toggle", (req, res) => {
    const { enabled, filterOn, passcode } = req.body;
    if (!passcode) {
      res.status(400).json({ error: "Parameter 'passcode' diperlukan" });
      return;
    }

    let result;
    if (typeof filterOn === "boolean") {
      result = setNsfwFilterState(filterOn, passcode);
    } else if (typeof enabled === "boolean") {
      result = setNsfwAllowed(enabled, passcode);
    } else {
      res.status(400).json({ error: "Parameter 'filterOn' atau 'enabled' (boolean) diperlukan" });
      return;
    }

    if (!result.success) {
      res.status(403).json({ success: false, error: result.message });
      return;
    }

    res.json({
      success: true,
      nsfwEnabled: isNsfwAllowed(),
      filterNsfwOn: isNsfwFilterOn(),
      message: result.message,
    });
  });

  app.get("/api/bot/nsfw-status", (req, res) => {
    res.json({
      nsfwEnabled: isNsfwAllowed(),
      filterNsfwOn: isNsfwFilterOn(),
    });
  });

  // Image Analysis & Opinion scan endpoint
  app.post("/api/bot/scan", async (req, res) => {
    const { image, mimeType, prompt, isCreator, userName } = req.body;
    if (!image || typeof image !== "string") {
      res.status(400).json({ error: "Gambar tidak boleh kosong (masukkan URL atau upload file)" });
      return;
    }

    try {
      const result = await analyzeImage(
        image,
        mimeType || "image/jpeg",
        prompt || "",
        Boolean(isCreator),
        userName || (isCreator ? CREATOR_NAME : "User")
      );
      logger.info({ provider: result.provider, isCreator }, "Image scanned and reviewed by Porsche-chan");
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Error analyzing image");
      res.status(500).json({
        error: "Porsche-chan gagal menganalisis gambar ini... Coba upload ulang ya!",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Search DuckDuckGo + AI Summary endpoint
  app.post("/api/bot/search", async (req, res) => {
    const { query } = req.body;
    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "Query pencarian tidak boleh kosong" });
      return;
    }

    try {
      const results = await searchDuckDuckGo(query);
      if (results.length === 0) {
        res.json({ results: [], summary: "Tidak ada hasil ditemukan." });
        return;
      }

      const resultsText = results
        .slice(0, 5)
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
        .join("\n\n");

      const prompt = `Berdasarkan hasil pencarian DuckDuckGo berikut untuk query "${query}", berikan ringkasan yang informatif, ramah, dan mudah dipahami dalam bahasa yang sama dengan query:\n\n${resultsText}`;
      const { text: summary, provider } = await generateText([{ role: "user", text: prompt }]);

      res.json({
        results: results.slice(0, 5),
        summary,
        provider,
      });
    } catch (err) {
      logger.error({ err }, "Error in search API");
      res.status(500).json({ error: "Gagal melakukan pencarian" });
    }
  });

  // Translation test endpoint
  app.post("/api/bot/translate", async (req, res) => {
    const { text, targetLanguage = "EN-US" } = req.body;
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "Teks terjemahan tidak boleh kosong" });
      return;
    }

    try {
      const result = await translateWithAI(text, targetLanguage);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Error in translation API");
      res.status(500).json({
        error: "Gagal menerjemahkan teks dengan AI. Silakan coba beberapa saat lagi!",
      });
    }
  });

  // Deep Think endpoint with 2-page pagination (Answer & Sources)
  app.post("/api/bot/think", async (req, res) => {
    const { question } = req.body;
    if (!question || typeof question !== "string") {
      res.status(400).json({ error: "Pertanyaan tidak boleh kosong" });
      return;
    }

    try {
      const result = await performDeepThink(question);
      logger.info({ id: result.id, provider: result.provider }, "Deep reasoning generated with sources");
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Error in deep think API");
      res.status(500).json({
        error: "Gagal memproses penalaran mendalam. Silakan coba sesaat lagi!",
      });
    }
  });

  // --- Vite / Static files middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Attempt non-blocking startup of Discord Bot
  try {
    startBot();
  } catch (err) {
    logger.warn({ err }, "Discord bot did not start immediately (check secrets configuration)");
  }

  app.listen(PORT, "0.0.0.0", () => {
    logger.info({ port: PORT }, `Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  logger.error({ err }, "Fatal error starting server");
  process.exit(1);
});
