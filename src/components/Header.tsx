import React from "react";
import { Bot, Sparkles, Server, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { BotStatus } from "../types";

interface HeaderProps {
  status: BotStatus | null;
  loading: boolean;
  onRefresh: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  loading,
  onRefresh,
  activeTab,
  setActiveTab,
}) => {
  const tabs = [
    { id: "chat", label: "💬 Chat Simulator" },
    { id: "scan", label: "📷 Scan & Opini (/scan)" },
    { id: "image", label: "🎨 Image & Illust" },
    { id: "search", label: "🧠 Think & Search" },
    { id: "translate", label: "🌐 Translator (Flags)" },
    { id: "commands", label: "📜 Bot Commands & Setup" },
    { id: "logs", label: "📋 Live Logs" },
  ];

  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between py-4 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-indigo-600 flex items-center justify-center shadow-md shadow-rose-200 text-white font-bold text-xl">
              🏎️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  Porsche-chan Bot
                </h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-medium border border-rose-200">
                  v2.0
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium border border-indigo-200">
                  by KnapQi
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Discord AI Bot with Multi-Provider Fallback & Media Controls
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Bot Discord Connection Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-700">
              <span className="relative flex h-2 w-2">
                {status?.isLoggedIn ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </>
                ) : (
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400"></span>
                )}
              </span>
              <span className="font-medium">
                {status?.isLoggedIn
                  ? `Connected: ${status.userTag}`
                  : status?.isConfigured
                  ? "Connecting..."
                  : "Standby (Web Ready)"}
              </span>
              {status?.ping !== null && status?.ping !== undefined && (
                <span className="text-slate-400">({status.ping}ms)</span>
              )}
            </div>

            {/* AI Providers Badge */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-600">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>AI:</span>
              <span
                className={`font-mono text-[11px] font-semibold ${
                  status?.availableProviders?.gemini
                    ? "text-emerald-600"
                    : "text-slate-400"
                }`}
                title="Gemini 3.8 Flash"
              >
                Gemini 3.8
              </span>
              <span className="text-slate-300">•</span>
              <span
                className={`font-mono text-[11px] ${
                  status?.availableProviders?.groq
                    ? "text-emerald-600"
                    : "text-slate-400"
                }`}
                title="Groq Llama 3.3 70B"
              >
                Groq
              </span>
              <span className="text-slate-300">•</span>
              <span
                className="font-mono text-[11px] text-emerald-600 font-semibold"
                title="Pollinations AI (Always active free fallback)"
              >
                Pollinations
              </span>
            </div>

            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              title="Refresh status"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex space-x-1 overflow-x-auto pb-2 scrollbar-none">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 text-xs sm:text-sm font-medium rounded-lg whitespace-nowrap transition-all duration-150 ${
                  isActive
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
