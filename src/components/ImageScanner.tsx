import React, { useState, useRef } from "react";
import {
  Camera,
  Upload,
  Link,
  Sparkles,
  RefreshCw,
  Eye,
  Heart,
  MessageSquareQuote,
  ShieldCheck,
  Zap,
} from "lucide-react";

interface ScanResult {
  text: string;
  provider: string;
}

export const ImageScanner: React.FC = () => {
  const [imageUrl, setImageUrl] = useState<string>("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("image/jpeg");
  const [prompt, setPrompt] = useState<string>("");
  const [isCreator, setIsCreator] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sampleImages = [
    {
      label: "🏎️ Porsche 911 GT3 RS",
      url: "https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?q=80&w=1000&auto=format&fit=crop",
      desc: "Uji antusiasme Porsche-chan terhadap mobil favoritnya!",
    },
    {
      label: "🍜 Ramen Hangat Lezat",
      url: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?q=80&w=1000&auto=format&fit=crop",
      desc: "Uji reaksi menggemaskan saat melihat makanan enak",
    },
    {
      label: "🐱 Kucing Lucu",
      url: "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?q=80&w=1000&auto=format&fit=crop",
      desc: "Uji reaksi gemas dan kasih sayang pada hewan peliharaan",
    },
    {
      label: "🌆 Cyberpunk Aesthetic",
      url: "https://images.unsplash.com/photo-1578632767115-351597cf2477?q=80&w=1000&auto=format&fit=crop",
      desc: "Uji penilaian estetika seni dan suasana futuristik",
    },
  ];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMimeType(file.type || "image/jpeg");
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setImagePreview(base64);
      setImageUrl(base64);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleSelectSample = (sampleUrl: string) => {
    setImageUrl(sampleUrl);
    setImagePreview(sampleUrl);
    setMimeType("image/jpeg");
    setError(null);
  };

  const handleScan = async () => {
    if (!imageUrl) {
      setError("Silakan unggah gambar atau pilih salah satu contoh gambar!");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/bot/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: imageUrl,
          mimeType,
          prompt,
          isCreator,
          userName: isCreator ? "KnapQi" : "Discord User",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal menganalisis gambar");
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message || "Terjadi kesalahan saat memproses gambar.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner / Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-rose-500 to-pink-500 flex items-center justify-center text-white text-2xl shadow-md shadow-rose-200">
            📷
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">
                AI Vision & Opinion Scanner
              </h2>
              <span className="text-[10px] bg-rose-100 text-rose-800 font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-rose-600" /> Powered by Gemini 2.5 Flash
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Porsche-chan tidak hanya mendeteksi gambar secara mekanis, tetapi juga memberikan reaksi emosional, penilaian, dan <strong>pendapat pribadinya sendiri</strong>!
            </p>
          </div>
        </div>

        {/* Discord Command hint */}
        <div className="px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <span>Di Discord: ketik <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200 font-semibold text-rose-600">/scan</code> atau kirim foto & tag Porsche-chan!</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Input & Preview Panel */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Camera className="w-4 h-4 text-rose-500" />
              Pilih / Unggah Gambar
            </h3>

            {/* Drag & drop / upload box */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 hover:border-rose-400 rounded-2xl p-4 text-center cursor-pointer transition-colors bg-slate-50 hover:bg-rose-50/30 flex flex-col items-center justify-center min-h-[160px]"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              {imagePreview ? (
                <div className="relative group w-full">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="max-h-48 mx-auto rounded-xl object-contain shadow-xs border border-slate-200"
                  />
                  <div className="mt-2 text-xs text-slate-500 flex items-center justify-center gap-1">
                    <RefreshCw className="w-3.5 h-3.5" /> Klik untuk ganti gambar
                  </div>
                </div>
              ) : (
                <div className="space-y-2 py-4">
                  <div className="w-10 h-10 mx-auto rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div className="text-xs font-medium text-slate-700">
                    Klik untuk upload gambar dari perangkat
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Mendukung JPG, PNG, WEBP, GIF (maks 10MB)
                  </p>
                </div>
              )}
            </div>

            {/* URL Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
                <Link className="w-3.5 h-3.5 text-slate-400" /> Atau masukkan URL Gambar:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://example.com/image.jpg"
                  value={imageUrl.startsWith("data:") ? "" : imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value);
                    setImagePreview(e.target.value);
                  }}
                  className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                />
              </div>
            </div>

            {/* Sample Presets */}
            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-medium text-slate-500">
                Coba Contoh Cepat:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {sampleImages.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectSample(s.url)}
                    className="text-left px-2.5 py-2 rounded-xl border border-slate-200 hover:border-rose-300 hover:bg-rose-50/40 transition-all text-xs"
                  >
                    <div className="font-semibold text-slate-800 text-[11px] truncate">
                      {s.label}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate mt-0.5">
                      {s.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Question or Prompt */}
            <div className="space-y-1.5 pt-1">
              <label className="text-xs font-medium text-slate-700 flex items-center justify-between">
                <span>Pesan / Pertanyaan Tambahan (Opsional):</span>
                <span className="text-[10px] text-slate-400">Kosongkan untuk opini spontan</span>
              </label>
              <textarea
                rows={2}
                placeholder="Misal: 'Gimana menurutmu mobil ini?', 'Bagus gak?', 'Kasih rating dong!'"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
              />
            </div>

            {/* Creator Mode Toggle */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
              <div className="flex items-center gap-2">
                <Heart className={`w-4 h-4 ${isCreator ? "text-rose-500 fill-rose-500" : "text-slate-400"}`} />
                <div>
                  <div className="font-semibold text-slate-800">Mode KnapQi (Creator)</div>
                  <div className="text-[10px] text-slate-500">
                    {isCreator ? "Porsche-chan tahu ini adalah kamu (KnapQi)!" : "Sebagai anggota Discord biasa"}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCreator(!isCreator)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  isCreator
                    ? "bg-rose-500 text-white"
                    : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                }`}
              >
                {isCreator ? "Aktif" : "Nonaktif"}
              </button>
            </div>

            {/* Scan Button */}
            <button
              type="button"
              disabled={loading || !imageUrl}
              onClick={handleScan}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white font-semibold text-xs shadow-md shadow-rose-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Porsche-chan sedang memperhatikan gambarnya...
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4" />
                  Minta Pendapat & Pengamatan Porsche-chan
                </>
              )}
            </button>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Right Output & Reaction Panel */}
        <div className="lg:col-span-7">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs min-h-[480px] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center font-bold text-sm">
                  🏎️
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Reaksi & Opini Porsche-chan
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Analisis visual mendalam dengan karakter anime yang hidup
                  </p>
                </div>
              </div>

              {result && (
                <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {result.provider}
                </span>
              )}
            </div>

            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center text-2xl animate-bounce">
                  ✨
                </div>
                <div className="text-sm font-semibold text-slate-800">
                  "Uwahh... coba kulihat baik-baik ya~! (⁄ ⁄•⁄ω⁄•⁄ ⁄)"
                </div>
                <p className="text-xs text-slate-400 max-w-sm">
                  Porsche-chan sedang mencermati detail gambar, warna, objek, dan menyiapkan pendapat pribadinya...
                </p>
              </div>
            ) : result ? (
              <div className="flex-1 py-4 space-y-4">
                {/* Result Message Container */}
                <div className="p-5 rounded-2xl bg-gradient-to-b from-rose-50/40 via-white to-slate-50/50 border border-rose-100 shadow-xs">
                  <div className="flex items-center gap-2 mb-3 text-rose-600 font-semibold text-xs">
                    <MessageSquareQuote className="w-4 h-4" />
                    <span>Tanggapan & Opini Pribadi:</span>
                  </div>

                  <div className="text-slate-800 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap font-sans">
                    {result.text}
                  </div>
                </div>

                {/* What made it special banner */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <div className="font-semibold text-slate-800 flex items-center gap-1 text-[11px]">
                      🎯 Pengenalan Tajam
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Mengenali model mobil, karakter, makanan, atau estetika secara tepat.
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <div className="font-semibold text-slate-800 flex items-center gap-1 text-[11px]">
                      💬 Pendapat Otentik
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Memberi review jujur, rasa kagum, humor, atau rating versinya sendiri.
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <div className="font-semibold text-slate-800 flex items-center gap-1 text-[11px]">
                      💖 Persona KnapQi
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Sopan & ceria kepada semua user, dan ekstra hangat untuk sang creator.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center text-3xl">
                  🖼️
                </div>
                <div className="text-sm font-semibold text-slate-700">
                  Belum ada gambar yang dipindai
                </div>
                <p className="text-xs text-slate-400 max-w-md">
                  Pilih salah satu contoh di sebelah kiri atau unggah gambarmu sendiri untuk melihat bagaimana Porsche-chan mengenali gambar dan memberikan reaksinya!
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
