import React, { useState, useEffect } from "react";
import { Header } from "./components/Header";
import { ChatSimulator } from "./components/ChatSimulator";
import { ImageScanner } from "./components/ImageScanner";
import { ImageGenerator } from "./components/ImageGenerator";
import { SearchAndThink } from "./components/SearchAndThink";
import { TranslatorTool } from "./components/TranslatorTool";
import { BotCommandsGuide } from "./components/BotCommandsGuide";
import { LiveLogs } from "./components/LiveLogs";
import { BotStatus } from "./types";

export default function App() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>("chat");

  const fetchStatus = async () => {
    try {
      setLoadingStatus(true);
      const res = await fetch("/api/bot/status");
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err) {
      console.warn("Status endpoint temporarily unavailable during startup/reload:", err);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900 selection:bg-rose-100 selection:text-rose-900">
      <Header
        status={status}
        loading={loadingStatus}
        onRefresh={fetchStatus}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === "chat" && <ChatSimulator />}
        {activeTab === "scan" && <ImageScanner />}
        {activeTab === "image" && <ImageGenerator />}
        {activeTab === "search" && <SearchAndThink />}
        {activeTab === "translate" && <TranslatorTool />}
        {activeTab === "commands" && <BotCommandsGuide status={status} />}
        {activeTab === "logs" && <LiveLogs />}
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        <p>
          🏎️ Porsche-chan Bot 2.0 • Created by{" "}
          <strong className="text-slate-800">KnapQi</strong> • Powered by Discord.js, Gemini AI & Pollinations
        </p>
      </footer>
    </div>
  );
}
