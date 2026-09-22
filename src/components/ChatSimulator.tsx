import React, { useState, useRef, useEffect } from "react";
import { Send, Trash2, User, Sparkles, Crown, Heart, Bot } from "lucide-react";
import { ChatMessage } from "../types";

export const ChatSimulator: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "model",
      text: "a- halo...! Aku Porsche-chan~ (⁄ ⁄•⁄ω⁄•⁄ ⁄) Ada yang bisa aku bantu hari ini? Kamu bisa tanya-tanya apa aja, atau uji coba perintah bot bersamaku di sini ya~! ✨ (๑˃ᴗ˂)ﻌ",
      provider: "gemini",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isCreator, setIsCreator] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const samplePrompts = [
    "Siapa yang bikin kamu?",
    "Kenapa nama kamu Porsche-chan?",
    "Ceritain mobil Porsche favorit kamu dong~",
    "Bisa bantu aku terjemahkan teks?",
    "Coba blushing dong >///<",
    "Apa aja fitur yang ada di bot Discord kamu?",
  ];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      isCreator,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = messages.slice(-8).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const res = await fetch("/api/bot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query,
          isCreator,
          history,
        }),
      });

      const data = await res.json();
      if (res.ok && data.reply) {
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-${Date.now()}`,
            role: "model",
            text: data.reply,
            provider: data.provider || "gemini",
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "model",
            text: data.error || "Maaf, aku lagi bingung... Coba lagi ya~ (๑•́ ₃ •̀๑)",
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "model",
          text: "Waduh, koneksi ke Porsche-chan server terputus... Pastikan server berjalan ya! (｡•́︿•̀｡)",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: "model",
        text: "Riwayat percakapan sudah dibersihkan~! Mau ngobrol apa lagi sekarang? (๑˃ᴗ˂)ﻌ",
        provider: "gemini",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] min-h-[540px] max-w-5xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Simulator Control Bar */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs">
            <span className="text-slate-500 font-medium">Role:</span>
            <button
              onClick={() => setIsCreator(true)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-all ${
                isCreator
                  ? "bg-amber-500 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Crown className="w-3 h-3" />
              Creator (KnapQi)
            </button>
            <button
              onClick={() => setIsCreator(false)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-all ${
                !isCreator
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <User className="w-3 h-3" />
              Discord User
            </button>
          </div>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            {isCreator
              ? "✨ Porsche-chan mengenali kamu sebagai KnapQi (lebih manis & akrab)"
              : "👤 Persona umum (pemalu, sopan & ramah)"}
          </span>
        </div>

        <button
          onClick={clearChat}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg border border-transparent hover:border-rose-100 transition-colors"
          title="Reset chat history"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear Chat</span>
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-gradient-to-b from-slate-50/50 to-white">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div
              key={msg.id}
              className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
            >
              {!isUser && (
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-400 to-amber-400 flex items-center justify-center text-white text-base shadow-xs shrink-0">
                  🏎️
                </div>
              )}
              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 text-sm leading-relaxed ${
                  isUser
                    ? "bg-slate-900 text-white rounded-br-xs shadow-xs"
                    : "bg-white border border-slate-200 text-slate-800 rounded-bl-xs shadow-xs"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-semibold text-xs opacity-80">
                    {isUser ? (msg.isCreator ? "KnapQi (Creator)" : "You") : "Porsche-chan"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {msg.provider && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-rose-50 text-rose-600 border border-rose-100 font-mono">
                        {msg.provider}
                      </span>
                    )}
                    <span className="text-[10px] opacity-60 font-mono">
                      {msg.timestamp}
                    </span>
                  </div>
                </div>
                <div className="whitespace-pre-wrap">{msg.text}</div>
              </div>
              {isUser && (
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm shadow-xs shrink-0 ${
                    msg.isCreator
                      ? "bg-gradient-to-tr from-amber-500 to-rose-500"
                      : "bg-slate-700"
                  }`}
                >
                  {msg.isCreator ? <Crown className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </div>
              )}
            </div>
          );
        })}

        {loading && (
          <div className="flex gap-3 justify-start items-center">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-400 to-amber-400 flex items-center justify-center text-white text-base shadow-xs animate-pulse shrink-0">
              🏎️
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-xs px-4 py-3 shadow-xs flex items-center gap-2">
              <span className="text-xs text-rose-500 font-medium">
                Porsche-chan lagi mikir... (⁄ ⁄•⁄ω⁄•⁄ ⁄)
              </span>
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-rose-400 rounded-full animate-bounce"></span>
                <span
                  className="w-1.5 h-1.5 bg-rose-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0.2s" }}
                ></span>
                <span
                  className="w-1.5 h-1.5 bg-rose-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0.4s" }}
                ></span>
              </span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Suggested prompts */}
      <div className="px-4 py-2 bg-slate-50/80 border-t border-slate-100 flex items-center gap-2 overflow-x-auto scrollbar-none">
        <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <span className="text-[11px] text-slate-400 font-medium shrink-0">Coba tanya:</span>
        {samplePrompts.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(prompt)}
            disabled={loading}
            className="text-xs bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1 whitespace-nowrap transition-colors shrink-0"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input area */}
      <div className="p-3 sm:p-4 bg-white border-t border-slate-200">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              isCreator
                ? "Ngobrol sama Porsche-chan sebagai KnapQi... (๑˃ᴗ˂)ﻌ"
                : "Tanya apa saja ke Porsche-chan..."
            }
            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-rose-400 focus:bg-white transition-all"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-gradient-to-r from-rose-500 to-amber-500 text-white font-medium px-4 py-2.5 rounded-xl hover:from-rose-600 hover:to-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs flex items-center gap-1.5"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline text-xs">Kirim</span>
          </button>
        </form>
      </div>
    </div>
  );
};
