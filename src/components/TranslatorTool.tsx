import React, { useState } from "react";
import { Globe, ArrowRight, Sparkles, RefreshCw, Check } from "lucide-react";
import { TranslationResult } from "../types";

export const TranslatorTool: React.FC = () => {
  const [text, setText] = useState("Halo semuanya! Selamat datang di Discord server kami. Porsche-chan siap membantu!");
  const [targetLang, setTargetLang] = useState("EN-US");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TranslationResult | null>(null);

  const flagOptions = [
    { flag: "🇺🇸", code: "EN-US", label: "English (US)" },
    { flag: "🇬🇧", code: "EN-GB", label: "English (UK)" },
    { flag: "🇯🇵", code: "JA", label: "Japanese (日本語)" },
    { flag: "🇮🇩", code: "ID", label: "Indonesian (Indonesia)" },
    { flag: "🇸🇦", code: "AR", label: "Arabic (العربية)" },
    { flag: "🇰🇷", code: "KO", label: "Korean (한국어)" },
    { flag: "🇨🇳", code: "ZH", label: "Chinese (简体)" },
    { flag: "🇹🇼", code: "ZH-TW", label: "Chinese (繁體)" },
    { flag: "🇫🇷", code: "FR", label: "French (Français)" },
    { flag: "🇩🇪", code: "DE", label: "German (Deutsch)" },
    { flag: "🇪🇸", code: "ES", label: "Spanish (Español)" },
    { flag: "🇧🇷", code: "PT-BR", label: "Portuguese (Brasil)" },
    { flag: "🇷🇺", code: "RU", label: "Russian (Русский)" },
    { flag: "🇻🇳", code: "VI", label: "Vietnamese (Tiếng Việt)" },
    { flag: "🇹🇭", code: "TH", label: "Thai (ไทย)" },
    { flag: "🇲🇾", code: "MS", label: "Malay (Melayu)" },
    { flag: "🇵🇭", code: "TL", label: "Filipino / Tagalog" },
  ];

  const handleTranslate = async (chosenLang?: string) => {
    const lang = chosenLang || targetLang;
    if (!text.trim() || loading) return;

    setLoading(true);
    try {
      const res = await fetch("/api/bot/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), targetLanguage: lang }),
      });

      const data = await res.json();
      if (res.ok && data.text) {
        setResult(data);
      } else {
        alert(data.error || "Gagal menerjemahkan teks");
      }
    } catch (err) {
      alert("Terjadi kesalahan server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Intro */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center font-bold">
            🌐
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">
                Flag Reaction Translation Engine
              </h2>
              <span className="text-[10px] bg-teal-100 text-teal-800 font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-teal-600" /> Powered by Gemini AI
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Di Discord, cukup beri reaksi emoji bendera (misal 🇯🇵 🇺🇸 🇸🇦 🇫🇷 🇰🇷) pada pesan apa saja untuk diterjemahkan secara presisi, alami, dan mempertahankan formatting!
            </p>
          </div>
        </div>

        {/* Flag Selector */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <label className="text-xs font-medium text-slate-500 mb-2 block">
            Pilih Target Bahasa / Emoji Bendera:
          </label>
          <div className="flex flex-wrap gap-2">
            {flagOptions.map((f) => {
              const isSelected = targetLang === f.code;
              return (
                <button
                  key={f.code}
                  onClick={() => {
                    setTargetLang(f.code);
                    handleTranslate(f.code);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
                    isSelected
                      ? "bg-teal-600 border-teal-600 text-white shadow-xs"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span className="text-base">{f.flag}</span>
                  <span>{f.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Translation Boxes */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1.5 block">
              Teks Sumber:
            </label>
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ketik teks yang ingin diterjemahkan..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-teal-400 focus:bg-white resize-none transition-all"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-600">
                Hasil Terjemahan:
              </label>
              {result && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 font-mono font-medium border border-teal-200">
                  Via {result.provider} ({result.detectedSourceLanguage} → {targetLang})
                </span>
              )}
            </div>
            <div className="w-full h-[106px] bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-900 overflow-y-auto">
              {loading ? (
                <div className="flex items-center gap-2 text-slate-400 h-full justify-center">
                  <RefreshCw className="w-4 h-4 animate-spin text-teal-600" />
                  <span>Menerjemahkan...</span>
                </div>
              ) : result?.text ? (
                <span className="font-medium text-slate-800">{result.text}</span>
              ) : (
                <span className="text-slate-400 italic">
                  Klik tombol terjemahkan atau pilih bendera di atas...
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={() => handleTranslate()}
            disabled={loading || !text.trim()}
            className="bg-teal-600 text-white font-medium px-5 py-2 rounded-xl hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs flex items-center gap-2 text-xs"
          >
            {loading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Menerjemahkan...</span>
              </>
            ) : (
              <>
                <Globe className="w-3.5 h-3.5" />
                <span>Terjemahkan Sekarang</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
