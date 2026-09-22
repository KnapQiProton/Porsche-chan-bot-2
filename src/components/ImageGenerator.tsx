import React, { useState, useEffect } from "react";
import {
  Image as ImageIcon,
  Sparkles,
  Download,
  ExternalLink,
  RefreshCw,
  Cat,
  Zap,
  Tag,
  CheckCircle2,
  SlidersHorizontal,
  Lock,
  Unlock,
  KeyRound,
  Search,
} from "lucide-react";

interface GalleryItem {
  url: string;
  title: string;
  timestamp: string;
  type: "pollinations" | "neko";
  rating?: string;
  tags?: string[];
  artistName?: string;
  sourceUrl?: string;
  pixivUrl?: string;
  danbooruUrl?: string;
  provider?: string;
}

export const ImageGenerator: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"image" | "illust">("image");

  // State for /image (Nano Banana & Pollinations AI)
  const [prompt, setPrompt] = useState("");
  const [imageModel, setImageModel] = useState<"nanobanana" | "flux" | "turbo">("nanobanana");
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "16:9" | "9:16" | "4:3" | "3:4">("1:1");
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // State for /illust (Neko API & Danbooru)
  const [illustTags, setIllustTags] = useState("");
  const [illustRating, setIllustRating] = useState<"safe" | "suggestive">("safe");
  const [illustLoading, setIllustLoading] = useState(false);

  // NSFW Toggle & Owner Passcode state
  const [nsfwAllowed, setNsfwAllowed] = useState(false);
  const [nsfwBlockedNotice, setNsfwBlockedNotice] = useState<string | null>(null);
  const [showPasscodeModal, setShowPasscodeModal] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeError, setPasscodeError] = useState("");
  const [passcodeSuccess, setPasscodeSuccess] = useState("");

  // Shared gallery with examples
  const [gallery, setGallery] = useState<GalleryItem[]>([
    {
      url: "/assets/image_1785170080556.png",
      title: "Porsche-chan cute anime style portrait",
      timestamp: "Pre-rendered Asset",
      type: "pollinations",
    },
    {
      url: "/assets/image_1785171298204.png",
      title: "Porsche 911 GT3 RS race car with anime livery",
      timestamp: "Pre-rendered Asset",
      type: "pollinations",
    },
    {
      url: "/assets/image_1785207077062.png",
      title: "Cyberpunk neon Porsche driving through Tokyo rain",
      timestamp: "Pre-rendered Asset",
      type: "pollinations",
    },
  ]);

  // Fetch initial NSFW status from backend
  useEffect(() => {
    fetch("/api/bot/nsfw-status")
      .then((res) => res.json())
      .then((data) => {
        if (typeof data.nsfwEnabled === "boolean") {
          setNsfwAllowed(data.nsfwEnabled);
        }
      })
      .catch(() => {});
  }, []);

  const presetPollinationsPrompts = [
    "Anime girl with silver hair and cute racing jacket driving a Porsche 911 GT3 RS",
    "Futuristic glowing neon Porsche drifting in a cyber city at sunset, 8k wallpaper",
    "Chibi cute Porsche-chan mechanic holding a wrench, blushing anime style",
    "Vintage red Porsche 356 parked in front of a cozy Japanese cafe in autumn",
  ];

  // Suggestive / Search Tag Presets for /illust
  const presetIllustTags = [
    { label: "hk416, gfl", tags: "hk416, gfl" },
    { label: "raiden shogun, genshin", tags: "raiden shogun, genshin" },
    { label: "2b, nier", tags: "2b, nier" },
    { label: "kafka, hsr", tags: "kafka, hsr" },
    { label: "cat ears, maid", tags: "cat ears, maid" },
    { label: "1girls, white hair", tags: "1girls, white hair" },
    { label: "kimono, sakura", tags: "kimono, cherry blossoms" },
  ];

  const suggestivePresets = [
    "1girl, off shoulder, blushing, swimsuit",
    "1girl, cleavage, teasing smile, lingerie",
    "1girl, wet clothes, rain, anime art",
    "1girl, bunny suit, embarrassed",
  ];

  // Handler for /image (Nano Banana & Pollinations AI)
  const handleGenerateImage = async (customPrompt?: string) => {
    const textPrompt = (customPrompt || prompt).trim();
    if (!textPrompt || imageLoading) return;

    setImageLoading(true);
    setImageError(null);
    try {
      const res = await fetch("/api/bot/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: textPrompt,
          model: imageModel,
          aspectRatio,
        }),
      });

      const data = await res.json();
      if (res.ok && data.imageUrl) {
        const newItem: GalleryItem = {
          url: data.imageUrl,
          title: textPrompt,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          type: "pollinations",
          provider: data.modelDisplayName || (imageModel === "nanobanana" ? "🍌 Nano Banana" : "⚡ FLUX.1"),
        };
        setGallery((prev) => [newItem, ...prev]);
        setPrompt("");
        setImageError(null);
      } else {
        const errorDetail = data.details ? `${data.error}: ${data.details}` : data.error || "Gagal membuat gambar AI";
        setImageError(errorDetail);
      }
    } catch (err: any) {
      setImageError("Gagal menghubungi server generator gambar. Silakan periksa koneksi internet atau coba lagi.");
    } finally {
      setImageLoading(false);
    }
  };

  // Handler for /illust (Nekos API & Danbooru)
  const handleFetchIllust = async (customTag?: string) => {
    if (illustLoading) return;

    const tagsToQuery = (customTag !== undefined ? customTag : illustTags).trim();

    setNsfwBlockedNotice(null);
    setIllustLoading(true);
    try {
      const res = await fetch("/api/bot/illust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: illustRating,
          tags: tagsToQuery || undefined,
          passcode: passcodeInput || undefined,
        }),
      });

      const data = await res.json();
      if (data.blocked || data.error?.includes("filter nsfw lagi on")) {
        setNsfwBlockedNotice(data.error || "saat ini filter nsfw lagi on konsultasi sama KnapQi untuk menonaktifkannya");
        return;
      }
      if (res.ok && data.imageUrl) {
        setNsfwBlockedNotice(null);
        const newItem: GalleryItem = {
          url: data.imageUrl,
          title: data.prompt || (tagsToQuery ? `Tags: ${tagsToQuery}` : "Ilustrasi Anime"),
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          type: "neko",
          rating: data.rating,
          tags: data.tags,
          artistName: data.artistName,
          sourceUrl: data.sourceUrl,
          pixivUrl: data.pixivUrl,
          danbooruUrl: data.danbooruUrl,
          provider: data.provider,
        };
        setGallery((prev) => [newItem, ...prev]);
      } else {
        alert("Gagal mengambil ilustrasi: " + (data.error || data.details || "Tidak ada gambar cocok"));
      }
    } catch {
      alert("Error menghubungi server ilustrasi anime");
    } finally {
      setIllustLoading(false);
    }
  };

  // Handler for owner passcode submit to toggle NSFW
  const handleToggleNsfw = async () => {
    setPasscodeError("");
    setPasscodeSuccess("");

    if (!passcodeInput.trim()) {
      setPasscodeError("Masukkan kode rahasia owner!");
      return;
    }

    try {
      const targetState = !nsfwAllowed;
      const res = await fetch("/api/bot/nsfw-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: targetState,
          passcode: passcodeInput.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setNsfwAllowed(data.nsfwEnabled);
        setPasscodeSuccess(data.message);
        if (data.nsfwEnabled) {
          setNsfwBlockedNotice(null);
        }
        setTimeout(() => {
          setShowPasscodeModal(false);
          setPasscodeSuccess("");
        }, 1200);
      } else {
        setPasscodeError(data.error || "Kode rahasia owner tidak valid!");
      }
    } catch {
      setPasscodeError("Terjadi kesalahan saat verifikasi kode");
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Navigation Sub-Tabs separating /image and /illust */}
      <div className="flex items-center justify-between flex-wrap gap-3 bg-white p-2 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("image")}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === "image"
                ? "bg-rose-600 text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>🎨 /image (Pollinations AI)</span>
            <span className="text-[10px] bg-rose-500/30 text-white px-1.5 py-0.5 rounded-full font-mono">
              Text-to-Image
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("illust")}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === "illust"
                ? "bg-pink-600 text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Cat className="w-4 h-4" />
            <span>🐱 /illust (Neko API & Danbooru)</span>
            <span className="text-[10px] bg-pink-500/30 text-white px-1.5 py-0.5 rounded-full font-mono">
              Tags & Pixiv
            </span>
          </button>
        </div>

        {/* NSFW Indicator & Secret Toggle Button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPasscodeModal(true)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all cursor-pointer ${
              nsfwAllowed
                ? "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                : "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
            }`}
            title="Filter NSFW hanya dapat diubah dengan izin kode owner KnapQi"
          >
            {nsfwAllowed ? (
              <>
                <Unlock className="w-3.5 h-3.5 text-amber-600" />
                <span>Filter NSFW: <strong className="text-amber-700">OFF (Bebas / NSFW)</strong></span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5 text-emerald-600" />
                <span>Filter NSFW: <strong className="text-emerald-700">ON (Safe Mode)</strong></span>
              </>
            )}
            <span className="text-[10px] font-mono bg-white px-1.5 py-0.5 rounded-md border border-slate-200 text-slate-500">
              Khusus Owner
            </span>
          </button>
        </div>
      </div>

      {/* --- TAB 1: /image (NANO BANANA & POLLINATIONS AI TEXT-TO-IMAGE) --- */}
      {activeTab === "image" && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 text-white flex items-center justify-center font-bold text-lg shadow-xs">
              🍌
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  Generate Gambar AI — <code className="text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-md text-xs font-mono">/image &lt;prompt&gt;</code>
                </h2>
                <span className="text-[10px] bg-amber-100 text-amber-900 font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <span>🍌 Nano Banana (Gemini)</span>
                  <span className="text-slate-400">•</span>
                  <span>⚡ FLUX</span>
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Ketik prompt teks bebas apa saja. Pilih model generator favoritmu (Nano Banana ultra-detail atau FLUX.1 artistik) dan tentukan rasio aspek gambar.
              </p>
            </div>
          </div>

          {/* Model & Aspect Ratio Selector Toolbar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {/* Model Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <span>🤖 Pilihan AI Model:</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setImageModel("nanobanana")}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    imageModel === "nanobanana"
                      ? "bg-amber-500/10 border-amber-500 text-amber-950 font-bold ring-2 ring-amber-400/20"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <div className="text-xs flex items-center gap-1">
                    <span>🍌</span>
                    <span>Nano Banana</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                    Gemini 2.5 Flash
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setImageModel("flux")}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    imageModel === "flux"
                      ? "bg-rose-500/10 border-rose-500 text-rose-950 font-bold ring-2 ring-rose-400/20"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <div className="text-xs flex items-center gap-1">
                    <span>⚡</span>
                    <span>FLUX.1</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                    Pollinations AI
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setImageModel("turbo")}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    imageModel === "turbo"
                      ? "bg-purple-500/10 border-purple-500 text-purple-950 font-bold ring-2 ring-purple-400/20"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <div className="text-xs flex items-center gap-1">
                    <span>🚀</span>
                    <span>SDXL Turbo</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                    Super Fast
                  </div>
                </button>
              </div>
            </div>

            {/* Aspect Ratio Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <span>📐 Rasio Aspek (Aspect Ratio):</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { value: "1:1", label: "1:1 Persegi (1024x1024)" },
                  { value: "16:9", label: "16:9 Lanskap (1280x720)" },
                  { value: "9:16", label: "9:16 Potret (720x1280)" },
                  { value: "4:3", label: "4:3 (1024x768)" },
                  { value: "3:4", label: "3:4 (768x1024)" },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setAspectRatio(item.value as any)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                      aspectRatio === item.value
                        ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Image Generation Error Banner */}
          {imageError && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2.5">
              <span className="text-base leading-none">⚠️</span>
              <div className="flex-1">
                <div className="font-semibold text-amber-950">Gagal Memproses Pembuatan Gambar</div>
                <div className="mt-0.5 text-amber-800 leading-relaxed">{imageError}</div>
                {imageModel === "nanobanana" && (
                  <div className="mt-2 text-[11px] text-amber-900 bg-amber-100/70 p-2 rounded-lg">
                    💡 <strong>Tips Nano Banana:</strong> Model ini memakai Google Gemini 2.5 Flash via OpenRouter. Pastikan akun OpenRouter memiliki credit aktif di <code>https://openrouter.ai/settings/credits</code> atau pilih model <strong>FLUX.1</strong> di atas untuk generator alternatif!
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setImageError(null)}
                className="text-amber-600 hover:text-amber-800 font-bold px-1.5 py-0.5 rounded-md hover:bg-amber-100 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleGenerateImage();
            }}
            className="flex flex-col sm:flex-row gap-3 pt-2"
          >
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Deskripsikan gambar (contoh: 'Porsche 911 GT3 RS drifting in Tokyo at night neon style')..."
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-rose-400 focus:bg-white transition-all"
              disabled={imageLoading}
            />
            <button
              type="submit"
              disabled={imageLoading || !prompt.trim()}
              className="bg-gradient-to-r from-amber-500 via-rose-500 to-rose-600 hover:from-amber-600 hover:to-rose-700 text-white font-medium px-6 py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs flex items-center justify-center gap-2 shrink-0 cursor-pointer"
            >
              {imageLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Membuat Gambar ({imageModel === "nanobanana" ? "Nano Banana" : imageModel.toUpperCase()})...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generate /image</span>
                </>
              )}
            </button>
          </form>

          {/* Quick suggestions */}
          <div className="pt-2 border-t border-slate-100">
            <div className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Contoh prompt kreatif:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {presetPollinationsPrompts.map((p, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setPrompt(p);
                    handleGenerateImage(p);
                  }}
                  disabled={imageLoading}
                  className="text-xs text-left bg-slate-50 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 transition-colors cursor-pointer"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* --- TAB 2: /illust (NEKO API & BOORU ANIME ILLUSTRATIONS) --- */}
      {activeTab === "illust" && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 text-white flex items-center justify-center font-bold text-lg shadow-xs">
                🐱
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900">
                    Cari Ilustrasi Anime — <code className="text-pink-600 bg-pink-50 px-1.5 py-0.5 rounded-md text-xs font-mono">/illust [tags] [rating]</code>
                  </h2>
                  <span className="text-[10px] bg-pink-100 text-pink-800 font-semibold px-2 py-0.5 rounded-full">
                    Neko API & Danbooru
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cari berdasarkan tag (contoh: <code>1girls, white hair</code>) dengan resolusi tinggi, sumber asli Pixiv & Danbooru.
                </p>
              </div>
            </div>

            {/* Rating selector */}
            <div className="flex items-center gap-2 bg-pink-50/60 p-1.5 rounded-xl border border-pink-100 text-xs">
              <span className="text-pink-700 font-medium px-2">Rating:</span>
              <select
                value={illustRating}
                onChange={(e) => setIllustRating(e.target.value as "safe" | "suggestive")}
                className="bg-white border border-pink-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 font-semibold focus:ring-2 focus:ring-pink-400 cursor-pointer"
              >
                <option value="safe">Safe (SFW - Semua Umur)</option>
                <option value="suggestive">Suggestive (Anime Art / Sensual)</option>
              </select>
            </div>
          </div>

          {/* NSFW Blocked Alert Banner */}
          {nsfwBlockedNotice && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs animate-in fade-in">
              <div className="flex items-start gap-3">
                <span className="text-xl">⚠️</span>
                <div>
                  <p className="text-sm font-bold text-amber-900">
                    {nsfwBlockedNotice}
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Filter NSFW aktif memblokir pencarian tag bernuansa vulgar/dewasa. Konsultasikan dengan <strong>KnapQi</strong> untuk mendapatkan izin akses.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPasscodeModal(true)}
                className="self-start sm:self-center px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shrink-0 transition-colors shadow-xs cursor-pointer"
              >
                Buka Filter (Owner)
              </button>
            </div>
          )}

          {/* Search Form with Tags Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleFetchIllust();
            }}
            className="flex flex-col sm:flex-row gap-3"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="text"
                value={illustTags}
                onChange={(e) => setIllustTags(e.target.value)}
                placeholder="Cari karakter & tag (contoh: hk416, gfl atau raiden, genshin atau cat ears, maid)..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-pink-400 focus:bg-white transition-all"
                disabled={illustLoading}
              />
            </div>

            <button
              type="submit"
              disabled={illustLoading}
              className="bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white font-medium px-6 py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs flex items-center justify-center gap-2 shrink-0 cursor-pointer"
            >
              {illustLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Mencari Ilustrasi...</span>
                </>
              ) : (
                <>
                  <Cat className="w-4 h-4" />
                  <span>Cari /illust</span>
                </>
              )}
            </button>
          </form>

          {/* Tag Suggestions */}
          <div className="space-y-2 pt-1 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-pink-500" />
                Opsi Tag Populer (Klik untuk cari):
              </span>
              <span className="text-[11px] text-slate-400">
                Mendukung sintaks comma-separated
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {presetIllustTags.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setIllustTags(item.tags);
                    handleFetchIllust(item.tags);
                  }}
                  disabled={illustLoading}
                  className="text-xs bg-slate-50 hover:bg-pink-50 hover:text-pink-700 hover:border-pink-200 text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 transition-colors cursor-pointer"
                >
                  #{item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Suggestive Mode Ideas */}
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-amber-50/70 to-pink-50/70 border border-amber-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                Ide Opsi Suggestive (Jika tidak ada ide):
              </span>
              <span className="text-[10px] text-amber-700 font-mono">
                {nsfwAllowed ? "Mode Unlocked" : "Dilindungi Passcode"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestivePresets.map((tagText, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setIllustRating("suggestive");
                    setIllustTags(tagText);
                    handleFetchIllust(tagText);
                  }}
                  disabled={illustLoading}
                  className="text-xs bg-white/80 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-lg px-2.5 py-1 transition-colors cursor-pointer"
                >
                  {tagText}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Secret Passcode Modal for NSFW Toggle */}
      {showPasscodeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Verifikasi Otorisasi Owner
                </h3>
                <p className="text-xs text-slate-500">
                  Hanya owner (KnapQi) yang memiliki kode otorisasi untuk on/off filter NSFW.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700">
                Masukkan Kode Rahasia Owner:
              </label>
              <input
                type="password"
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                placeholder="Masukkan passcode..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono tracking-widest text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-amber-400 focus:bg-white"
              />
              {passcodeError && (
                <p className="text-xs text-rose-600 font-medium">{passcodeError}</p>
              )}
              {passcodeSuccess && (
                <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{passcodeSuccess}</span>
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setShowPasscodeModal(false);
                  setPasscodeError("");
                }}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleToggleNsfw}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-5 py-2 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                {nsfwAllowed ? "Kunci Filter (Safe SFW)" : "Buka Filter (Allow NSFW)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gallery Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-slate-500" />
            <span>Galeri Gambar & Ilustrasi ({gallery.length})</span>
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            Koleksi /image & /illust
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {gallery.map((item, idx) => (
            <div
              key={idx}
              className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-shadow flex flex-col group"
            >
              <div className="relative aspect-square bg-slate-100 overflow-hidden">
                <img
                  src={item.url}
                  alt={item.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
                <div className="absolute top-2 right-2">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-xs ${
                      item.type === "neko"
                        ? "bg-pink-600 text-white"
                        : item.provider?.includes("Banana")
                        ? "bg-amber-500 text-amber-950 font-bold"
                        : "bg-rose-600 text-white"
                    }`}
                  >
                    {item.provider || (item.type === "neko" ? "🐱 /illust (Neko)" : "🎨 /image")}
                  </span>
                </div>
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-800 line-clamp-2">
                    {item.title}
                  </p>

                  {item.tags && item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {item.tags.slice(0, 4).map((t, ti) => (
                        <span key={ti} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-sm font-mono">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}

                  {item.artistName && (
                    <p className="text-[11px] text-pink-600 mt-1">
                      Artist: <strong>{item.artistName}</strong>
                    </p>
                  )}

                  <p className="text-[11px] text-slate-400 mt-1 font-mono">
                    {item.timestamp}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Buka</span>
                    </a>

                    {item.pixivUrl && (
                      <a
                        href={item.pixivUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                      >
                        <span>Pixiv</span>
                      </a>
                    )}

                    {item.danbooruUrl && (
                      <a
                        href={item.danbooruUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-amber-600 hover:text-amber-800 font-medium flex items-center gap-1"
                      >
                        <span>Danbooru</span>
                      </a>
                    )}

                    {!item.pixivUrl && !item.danbooruUrl && item.sourceUrl && (
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-pink-600 hover:text-pink-800 font-medium flex items-center gap-1"
                      >
                        <span>Sumber</span>
                      </a>
                    )}
                  </div>

                  <a
                    href={item.url}
                    download="porsche-chan-art.webp"
                    className="text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Unduh</span>
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
