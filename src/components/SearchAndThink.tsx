import React, { useState } from "react";
import {
  Brain,
  Search,
  ExternalLink,
  Sparkles,
  RefreshCw,
  FileText,
  Globe,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Zap,
} from "lucide-react";
import { SearchResultItem } from "../types";

interface ThinkResponse {
  id: string;
  question: string;
  answer: string;
  sources: SearchResultItem[];
  provider: string;
}

export const SearchAndThink: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<"think" | "search">("think");

  // State for /think simulator
  const [thinkQuestion, setThinkQuestion] = useState("");
  const [thinkLoading, setThinkLoading] = useState(false);
  const [thinkResult, setThinkResult] = useState<ThinkResponse | null>(null);
  const [thinkPage, setThinkPage] = useState<1 | 2>(1);

  // State for /search simulator
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searchSummary, setSearchSummary] = useState<string | null>(null);
  const [searchProvider, setSearchProvider] = useState<string | null>(null);

  const sampleQuestions = [
    "Jelaskan evolusi mesin flat-six Porsche 911 dari generasi ke generasi beserta referensinya",
    "Bagaimana algoritma deep reasoning AI bekerja dalam menyelesaikan problem kompleks?",
    "Apa perbedaan spesifikasi Porsche 911 GT3 RS dengan GT3 standar di sirkuit Nürburgring?",
    "Bagaimana masa depan teknologi semikonduktor 2nm dan dampaknya ke AI?",
  ];

  const sampleSearches = [
    "Porsche 911 GT3 RS top speed & specs",
    "Bagaimana cara kerja Discord bot dengan play-dl?",
    "Berita teknologi AI terbaru 2026",
    "Tips belajar programming untuk pemula",
  ];

  const handleThink = async (q?: string) => {
    const questionToAsk = (q || thinkQuestion).trim();
    if (!questionToAsk || thinkLoading) return;

    setThinkLoading(true);
    setThinkResult(null);
    setThinkPage(1); // Default to Page 1 (Answer)

    try {
      const res = await fetch("/api/bot/think", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: questionToAsk }),
      });

      const data = await res.json();
      if (res.ok) {
        setThinkResult(data);
      } else {
        alert("Gagal memproses reasoning: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      alert("Terjadi kesalahan koneksi ke server");
    } finally {
      setThinkLoading(false);
    }
  };

  const handleSearch = async (text?: string) => {
    const activeQuery = (text || searchQuery).trim();
    if (!activeQuery || searchLoading) return;

    setSearchLoading(true);
    setSearchResults([]);
    setSearchSummary(null);

    try {
      const res = await fetch("/api/bot/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: activeQuery }),
      });

      const data = await res.json();
      if (res.ok) {
        setSearchResults(data.results || []);
        setSearchSummary(data.summary || "Tidak ada ringkasan.");
        setSearchProvider(data.provider || "gemini");
      } else {
        alert("Gagal melakukan pencarian: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      alert("Terjadi kesalahan koneksi");
    } finally {
      setSearchLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Navigation Sub-Tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3 bg-white p-2 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSubTab("think")}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeSubTab === "think"
                ? "bg-purple-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Brain className="w-4 h-4" />
            <span>🧠 Deep Reasoning (/think)</span>
            <span className="text-[10px] bg-purple-500/30 text-white px-1.5 py-0.5 rounded-full font-mono">
              2 Halaman Tombol
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab("search")}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeSubTab === "search"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Search className="w-4 h-4" />
            <span>🔍 DuckDuckGo Search (/search)</span>
          </button>
        </div>

        <div className="text-xs text-slate-500 hidden md:flex items-center gap-1.5 px-3">
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          <span>Tersedia interaktif di Discord Bot & Web Simulator</span>
        </div>
      </div>

      {/* --- SUBTAB 1: THINK WITH 2-PAGE PAGINATION --- */}
      {activeSubTab === "think" && (
        <div className="space-y-6">
          {/* Think Input Box */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-lg shadow-xs">
                🧠
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900">
                    Deep Reasoning + Sumber Referensi — <code className="text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-md text-xs font-mono">/think &lt;question&gt;</code>
                  </h2>
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full">
                    Page 1: Jawaban • Page 2: Sumber
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Porsche-chan melakukan penalaran mendalam dan mengumpulkan narasumber web live. Di Discord, kamu bisa beralih halaman jawaban & sumber narasumber dengan tombol interaktif!
                </p>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleThink();
              }}
              className="mt-4 flex flex-col sm:flex-row gap-3"
            >
              <div className="relative flex-1">
                <Brain className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" />
                <input
                  type="text"
                  value={thinkQuestion}
                  onChange={(e) => setThinkQuestion(e.target.value)}
                  placeholder="Tanyakan masalah mendalam atau minta analisis terstruktur..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-purple-400 focus:bg-white transition-all"
                  disabled={thinkLoading}
                />
              </div>
              <button
                type="submit"
                disabled={thinkLoading || !thinkQuestion.trim()}
                className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-medium px-6 py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs flex items-center justify-center gap-2 shrink-0 cursor-pointer"
              >
                {thinkLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Menganalisis...</span>
                  </>
                ) : (
                  <>
                    <Brain className="w-4 h-4" />
                    <span>Mulai Deep Think</span>
                  </>
                )}
              </button>
            </form>

            {/* Quick samples */}
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 overflow-x-auto scrollbar-none">
              <Sparkles className="w-3.5 h-3.5 text-purple-500 shrink-0" />
              <span className="text-xs text-slate-400 shrink-0">Coba Pertanyaan:</span>
              {sampleQuestions.map((sq, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setThinkQuestion(sq);
                    handleThink(sq);
                  }}
                  disabled={thinkLoading}
                  className="text-xs bg-slate-50 hover:bg-purple-50 hover:text-purple-700 hover:border-purple-200 text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1 whitespace-nowrap transition-colors shrink-0 cursor-pointer"
                >
                  {sq.slice(0, 45)}...
                </button>
              ))}
            </div>
          </div>

          {/* Interactive Discord Message Simulation (Result View) */}
          {thinkLoading ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-xs text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center text-2xl animate-pulse">
                🧠
              </div>
              <h3 className="text-sm font-bold text-slate-800">
                Porsche-chan sedang berpikir secara mendalam...
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Melakukan deep multi-step reasoning dengan Gemini 2.5 Thinking Engine serta memverifikasi narasumber web live...
              </p>
            </div>
          ) : thinkResult ? (
            <div className="space-y-4">
              {/* Simulated Discord Embed Card */}
              <div className="bg-[#313338] text-white rounded-2xl p-5 border border-slate-700 shadow-md">
                <div className="flex items-center justify-between pb-3 border-b border-slate-700/60 mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-rose-500 flex items-center justify-center text-white text-sm font-bold">
                      🏎️
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">Porsche-chan</span>
                        <span className="bg-[#5865f2] text-white text-[10px] px-1.5 py-0.2 rounded font-semibold">BOT</span>
                      </div>
                      <span className="text-[11px] text-slate-400">Balasan untuk perintah /think</span>
                    </div>
                  </div>

                  <span className="text-xs text-slate-400 font-mono">
                    ID: {thinkResult.id}
                  </span>
                </div>

                {/* The Embed Box itself */}
                <div className={`p-4 sm:p-5 rounded-xl border-l-4 bg-[#2b2d31] transition-all ${thinkPage === 1 ? "border-l-purple-500" : "border-l-blue-500"}`}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      {thinkPage === 1 ? (
                        <>
                          <Brain className="w-4 h-4 text-purple-400" />
                          <span>Deep Reasoning: {thinkResult.question}</span>
                        </>
                      ) : (
                        <>
                          <Globe className="w-4 h-4 text-blue-400" />
                          <span>Sumber & Narasumber Referensi: {thinkResult.question}</span>
                        </>
                      )}
                    </h3>
                    <span className="text-[11px] bg-[#1e1f22] text-slate-300 px-2 py-0.5 rounded border border-slate-700">
                      Halaman {thinkPage}/2
                    </span>
                  </div>

                  {/* Page 1: Answer Content */}
                  {thinkPage === 1 && (
                    <div className="space-y-4 pt-2">
                      <div className="text-slate-200 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap font-sans">
                        {thinkResult.answer}
                      </div>

                      <div className="p-3 rounded-lg bg-purple-950/40 border border-purple-800/40 text-purple-200 text-xs flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <BookOpen className="w-4 h-4 text-purple-400" />
                          Ada <strong>{thinkResult.sources.length} sumber referensi</strong> untuk jawaban ini.
                        </span>
                        <button
                          type="button"
                          onClick={() => setThinkPage(2)}
                          className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded font-medium text-xs flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          Lihat Sumber <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Page 2: Sources Content */}
                  {thinkPage === 2 && (
                    <div className="space-y-3 pt-2">
                      <p className="text-xs text-slate-300">
                        Berikut narasumber dan referensi web yang dihimpun Porsche-chan:
                      </p>

                      {thinkResult.sources.length === 0 ? (
                        <div className="p-4 rounded-lg bg-[#1e1f22] text-slate-400 text-xs">
                          Tidak ada referensi eksternal khusus. Jawaban berbasis penalaran internal mendalam AI.
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {thinkResult.sources.map((s, idx) => (
                            <div
                              key={idx}
                              className="p-3 rounded-lg bg-[#1e1f22] border border-slate-700 hover:border-blue-400 transition-colors"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <a
                                  href={s.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs sm:text-sm font-semibold text-blue-400 hover:underline flex items-center gap-1.5"
                                >
                                  <span>{idx + 1}. {s.title}</span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              </div>
                              <div className="text-[11px] text-emerald-400 font-mono truncate mt-0.5">
                                {s.url}
                              </div>
                              {s.snippet && (
                                <p className="text-xs text-slate-300 mt-1.5 line-clamp-2 italic">
                                  "{s.snippet}"
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Embed Footer */}
                  <div className="mt-4 pt-3 border-t border-slate-700/50 flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      {thinkPage === 1
                        ? `Halaman 1/2 • Provider: ${thinkResult.provider} • Porsche-chan Deep Thinking`
                        : `Halaman 2/2 • Terverifikasi dari DuckDuckGo Live Search`}
                    </span>
                    <span>{new Date().toLocaleTimeString()}</span>
                  </div>
                </div>

                {/* THE 2 DISCORD BUTTONS (Halaman 1 & Halaman 2) */}
                <div className="mt-3 pt-3 border-t border-slate-700 flex flex-wrap items-center gap-2.5">
                  <span className="text-xs text-slate-400 mr-1 font-medium">
                    Simulasi Tombol Discord:
                  </span>

                  <button
                    type="button"
                    onClick={() => setThinkPage(1)}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                      thinkPage === 1
                        ? "bg-[#5865f2] text-white shadow-sm ring-2 ring-purple-400"
                        : "bg-[#4e5058] hover:bg-[#6d6f78] text-white"
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>📄 Halaman 1: Jawaban Lengkap</span>
                    {thinkPage === 1 && <CheckCircle2 className="w-3.5 h-3.5 ml-1" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setThinkPage(2)}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                      thinkPage === 2
                        ? "bg-[#5865f2] text-white shadow-sm ring-2 ring-blue-400"
                        : "bg-[#4e5058] hover:bg-[#6d6f78] text-white"
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>🌐 Halaman 2: Sumber & Narasumber ({thinkResult.sources.length})</span>
                    {thinkPage === 2 && <CheckCircle2 className="w-3.5 h-3.5 ml-1" />}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-xs text-center space-y-3">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center text-3xl">
                🧠
              </div>
              <h3 className="text-sm font-semibold text-slate-800">
                Fitur /think dengan Tombol Paginasi 2 Halaman
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Ketik pertanyaan di atas atau coba salah satu contoh untuk melihat jawaban penalaran mendalam di <strong>Halaman 1</strong> dan tautan narasumber di <strong>Halaman 2</strong> secara interaktif!
              </p>
            </div>
          )}
        </div>
      )}

      {/* --- SUBTAB 2: REGULAR DUCKDUCKGO SEARCH --- */}
      {activeSubTab === "search" && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
                🔍
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  DuckDuckGo Search + AI Summary — <code className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md text-xs font-mono">/search &lt;query&gt;</code>
                </h2>
                <p className="text-xs text-slate-500">
                  Mencari informasi live di web tanpa batasan, lalu dirangkum oleh Porsche-chan AI.
                </p>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSearch();
              }}
              className="mt-4 flex flex-col sm:flex-row gap-3"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari apa saja (misal: 'Porsche 911 specs' atau berita terbaru)..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-400 focus:bg-white transition-all"
                  disabled={searchLoading}
                />
              </div>
              <button
                type="submit"
                disabled={searchLoading || !searchQuery.trim()}
                className="bg-blue-600 text-white font-medium px-6 py-3 rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs flex items-center justify-center gap-2 shrink-0 cursor-pointer"
              >
                {searchLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Mencari...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>Cari & Rangkum</span>
                  </>
                )}
              </button>
            </form>

            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 overflow-x-auto scrollbar-none">
              <Sparkles className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span className="text-xs text-slate-400 shrink-0">Contoh:</span>
              {sampleSearches.map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setSearchQuery(s);
                    handleSearch(s);
                  }}
                  disabled={searchLoading}
                  className="text-xs bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1 whitespace-nowrap transition-colors shrink-0 cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {searchSummary && (
            <div className="bg-gradient-to-br from-indigo-50/50 via-white to-rose-50/30 rounded-2xl border border-indigo-100 p-6 shadow-xs">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs text-xs">
                    🏎️
                  </div>
                  <span className="text-sm font-semibold text-slate-900">
                    Ringkasan AI Porsche-chan
                  </span>
                </div>
                {searchProvider && (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
                    {searchProvider}
                  </span>
                )}
              </div>
              <div className="prose prose-sm max-w-none text-slate-800 leading-relaxed whitespace-pre-wrap">
                {searchSummary}
              </div>
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 px-1">
                Sumber Pencarian DuckDuckGo ({searchResults.length} hasil)
              </h3>
              <div className="grid gap-3">
                {searchResults.map((res, i) => (
                  <a
                    key={i}
                    href={res.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block bg-white p-4 rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-xs transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-medium text-blue-600 group-hover:underline">
                        {res.title}
                      </h4>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 shrink-0 mt-1" />
                    </div>
                    <p className="text-xs text-emerald-700 truncate mt-0.5 font-mono">
                      {res.url}
                    </p>
                    <p className="text-xs text-slate-600 mt-1.5 line-clamp-2">
                      {res.snippet}
                    </p>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
