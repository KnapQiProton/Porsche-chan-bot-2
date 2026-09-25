import React, { useState } from "react";
import {
  Terminal,
  Radio,
  Music,
  Shield,
  Key,
  ExternalLink,
  Sparkles,
  CheckCircle2,
  Copy,
  Check,
} from "lucide-react";
import { BotStatus } from "../types";

interface Props {
  status: BotStatus | null;
}

export const BotCommandsGuide: React.FC<Props> = ({ status }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const commands = [
    {
      name: "/image",
      args: "prompt: <text> [model: nanobanana|flux|turbo] [aspect_ratio: 1:1|16:9|9:16|4:3|3:4]",
      desc: "Generate gambar AI resolusi tinggi dengan opsi model 🍌 Nano Banana (Google Gemini), ⚡ FLUX.1, atau 🚀 Turbo, lengkap dengan pilihan aspek rasio & tombol interaktif Discord (Regenerate, Switch Model, Ubah Rasio).",
      category: "Creative AI",
      badgeColor: "bg-rose-50 text-rose-700 border-rose-200",
    },
    {
      name: "/illust",
      args: "[tags: text] [ai_art: hide|show|only] [filter_nsfw: off|on] [passcode: kode_owner]",
      desc: "Cari ilustrasi anime via Danbooru & Booru dengan navigasi riwayat tanpa duplikat (Previous, Next, Cari Ulang Foto, & Filter AI). Opsi filter NSFW disatukan dalam satu kontrol dan membutuhkan kode otorisasi rahasia dari KnapQi.",
      category: "Anime Illustration",
      badgeColor: "bg-pink-50 text-pink-700 border-pink-200",
    },
    {
      name: "/think",
      args: "question: <text>",
      desc: "Deep reasoning + verifikasi web: jawaban dilengkapi tombol interaktif Discord (Halaman 1: Jawaban Lengkap & Halaman 2: Sumber & Narasumber Referensi).",
      category: "Reasoning & Citations",
      badgeColor: "bg-purple-50 text-purple-700 border-purple-200",
    },
    {
      name: "/search",
      args: "query: <text>",
      desc: "Pencarian web via DuckDuckGo langsung dirangkum dengan rapi oleh AI.",
      category: "Web Intelligence",
      badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
    },
    {
      name: "/scan",
      args: "image: <file>, [prompt: <text>]",
      desc: "Analisis visual cerdas: Porsche-chan mengenali isi gambar secara detail & memberikan opini, rating, dan reaksi pribadinya (bisa juga kirim gambar langsung & tag Porsche-chan!).",
      category: "Vision & Opinion",
      badgeColor: "bg-rose-50 text-rose-700 border-rose-200",
    },
    {
      name: "/join-vc",
      args: "",
      desc: "Porsche-chan masuk ke voice channel kamu dan STAY (tetap bertahan) di sana.",
      category: "Voice Channel",
      badgeColor: "bg-amber-50 text-amber-700 border-amber-200",
    },
    {
      name: "/stay-vc",
      args: "channel_id: <id>",
      desc: "Jaga voice channel temporary berdasarkan Channel ID agar tidak ditutup VoiceMaster.",
      category: "Voice Channel",
      badgeColor: "bg-amber-50 text-amber-700 border-amber-200",
    },
    {
      name: "/leave-vc",
      args: "",
      desc: "Porsche-chan keluar dari voice channel (dapat dipanggil oleh KnapQi atau Admin server).",
      category: "Voice Channel",
      badgeColor: "bg-amber-50 text-amber-700 border-amber-200",
    },
    {
      name: "/play",
      args: "url: <youtube / spotify / title>",
      desc: "Putar lagu di voice channel dari YouTube, YouTube Music, Spotify, atau pencarian judul lagu langsung di YouTube dengan audio jernih 48kHz stereo & tombol interaktif.",
      category: "Music Player",
      badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    },
    {
      name: "/pause",
      args: "",
      desc: "Jeda pemutaran musik di voice channel (atau tekan tombol ⏸️ di pesan embed musik).",
      category: "Music Player",
      badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    },
    {
      name: "/resume",
      args: "",
      desc: "Lanjutkan pemutaran musik yang sedang dijeda (atau tekan tombol ▶️ di pesan embed).",
      category: "Music Player",
      badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    },
    {
      name: "/forward",
      args: "[detik: 10]",
      desc: "Majukan durasi musik sebanyak beberapa detik (default: +10 detik).",
      category: "Music Player",
      badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    },
    {
      name: "/rewind",
      args: "[detik: 10]",
      desc: "Mundurkan durasi musik sebanyak beberapa detik (default: -10 detik).",
      category: "Music Player",
      badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    },
    {
      name: "/stop",
      args: "",
      desc: "Hentikan musik dan bersihkan antrean (atau tekan tombol ⏹️). Porsche-chan tetap stay di VC.",
      category: "Music Player",
      badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    },
    {
      name: "/skip",
      args: "",
      desc: "Lewati lagu yang sedang diputar dan mainkan lagu berikutnya di antrean (atau tekan tombol ⏭️).",
      category: "Music Player",
      badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    },
    {
      name: "/queue",
      args: "",
      desc: "Lihat daftar lengkap lagu dalam antrean pemutaran musik server.",
      category: "Music Player",
      badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    },
    {
      name: "/nowplaying",
      args: "",
      desc: "Tampilkan informasi lagu yang sedang diputar lengkap dengan visual progress bar durasi.",
      category: "Music Player",
      badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    },
    {
      name: "/clear",
      args: "",
      desc: "Hapus riwayat memori percakapan Porsche-chan di channel tersebut.",
      category: "Utility",
      badgeColor: "bg-slate-100 text-slate-700 border-slate-200",
    },
    {
      name: "/info",
      args: "",
      desc: "Informasi lengkap tentang Porsche-chan, creator (KnapQi), dan daftar fitur aktif.",
      category: "Info",
      badgeColor: "bg-slate-100 text-slate-700 border-slate-200",
    },
  ];

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Discord Bot Connection Setup Guide */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
            ⚡
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Panduan Menghubungkan Porsche-chan ke Server Discord
            </h2>
            <p className="text-xs text-slate-500">
              Porsche-chan siap 100%. Untuk menghubungkannya ke server Discord kamu, ikuti 3 langkah mudah ini:
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center mb-2">
              1
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Discord Developer Portal</h3>
            <p className="text-xs text-slate-600 mt-1">
              Buka{" "}
              <a
                href="https://discord.com/developers/applications"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 underline font-medium"
              >
                discord.com/developers
              </a>
              , buat bot atau pilih bot Porsche-chan kamu, lalu salin <strong>Bot Token</strong>.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center mb-2">
              2
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Aktifkan Privileged Intents</h3>
            <p className="text-xs text-slate-600 mt-1">
              Di tab <strong>Bot</strong> di Developer Portal, pastikan toggle <strong>Message Content Intent</strong> dan <strong>Server Members Intent</strong> dalam posisi <strong>ON</strong>.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center mb-2">
              3
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Masukkan Token di Settings</h3>
            <p className="text-xs text-slate-600 mt-1">
              Buka menu <strong>Settings</strong> di AI Studio ini, lalu tambahkan secret key:
              <br />
              <code className="text-xs bg-slate-200 px-1 py-0.5 rounded-md font-mono mt-1 inline-block text-slate-800">
                DISCORD_BOT_TOKEN
              </code>
            </p>
          </div>
        </div>

        {/* Current status banner */}
        <div className="mt-4 p-3 rounded-xl bg-slate-100 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-slate-600" />
            <span className="text-slate-700">
              Status Token:{" "}
              <strong>
                {status?.isConfigured
                  ? "Terkonfigurasi"
                  : "Belum diset (Bot berjalan dalam mode Web Simulator)"}
              </strong>
            </span>
          </div>
          {status?.userTag && (
            <span className="font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
              Logged in as {status.userTag} ({status.guildCount} servers)
            </span>
          )}
        </div>
      </div>

      {/* Commands List */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-slate-600" />
              <span>Daftar Slash Commands Porsche-chan</span>
            </h3>
            <p className="text-xs text-slate-500">
              Semua command terdaftar otomatis ke Discord API saat bot dijalankan.
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {commands.map((cmd, idx) => (
            <div
              key={idx}
              className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-900">
                    {cmd.name}
                  </span>
                  {cmd.args && (
                    <span className="font-mono text-xs text-slate-400">
                      {cmd.args}
                    </span>
                  )}
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${cmd.badgeColor}`}
                  >
                    {cmd.category}
                  </span>
                </div>
                <p className="text-xs text-slate-600">{cmd.desc}</p>
              </div>

              <button
                onClick={() => handleCopy(cmd.name, idx)}
                className="self-start sm:self-center p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                title="Copy command"
              >
                {copiedIndex === idx ? (
                  <Check className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Porsche-chan Music Engine & Interactive Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 mb-3">
          <Music className="w-5 h-5 text-indigo-600" />
          <h3 className="text-base font-semibold text-slate-900">
            Music Engine Presisi Tinggi & Tombol Interaktif Discord
          </h3>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Porsche-chan memutar musik dengan output jernih <strong>48kHz Stereo Raw PCM</strong>. Setiap lagu yang diputar menyertakan pesan kontrol interaktif langsung di Discord:
        </p>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-center">
            <div className="text-xl mb-1">⏸️ / ▶️</div>
            <div className="text-xs font-semibold text-indigo-900">Pause / Resume</div>
            <div className="text-[11px] text-indigo-600 mt-0.5">Jeda & lanjutkan musik secara instan</div>
          </div>
          <div className="p-3 bg-violet-50 border border-violet-200 rounded-xl text-center">
            <div className="text-xl mb-1">⏭️</div>
            <div className="text-xs font-semibold text-violet-900">Skip</div>
            <div className="text-[11px] text-violet-600 mt-0.5">Lewati lagu ke antrean berikutnya</div>
          </div>
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-center">
            <div className="text-xl mb-1">⏹️</div>
            <div className="text-xs font-semibold text-rose-900">Stop</div>
            <div className="text-[11px] text-rose-600 mt-0.5">Hentikan musik & bersihkan antrean</div>
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
          <span>💡</span>
          <span>
            Bisa juga menggunakan command teks: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800">!play &lt;link/judul&gt;</code>, <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800">!skip</code>, <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800">!queue</code>, <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800">!np</code>, <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800">!pause</code>, <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800">!resume</code>, <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800">!stop</code>.
          </span>
        </div>
      </div>

      {/* VoiceMaster & Stay VC Mechanism */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 mb-3">
          <Radio className="w-5 h-5 text-amber-500" />
          <h3 className="text-base font-semibold text-slate-900">
            Fitur Khusus: VoiceMaster Anti-Delete Temporary VC
          </h3>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Bot Porsche-chan dilengkapi dengan fitur <strong>Stay VC</strong> dan <strong>Auto-watchdog</strong>. Ketika kamu menggunakan{" "}
          <code className="bg-slate-100 px-1 py-0.5 rounded-md font-mono text-slate-800">/stay-vc &lt;channel_id&gt;</code>, Porsche-chan akan masuk ke channel temporary (misal buatan bot VoiceMaster) dan terus menetap di dalamnya.
        </p>
        <div className="mt-3 p-3 bg-amber-50/60 rounded-xl border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
          <Shield className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            Jika VoiceMaster mencoba mendiskoneksi Porsche-chan, event listener <code className="font-mono font-semibold">VoiceStateUpdate</code> secara otomatis menjadwalkan koneksi ulang (<code className="font-mono">scheduleStayReconnect</code>) agar channel temporary tidak terhapus otomatis karena kosong!
          </div>
        </div>
      </div>

      {/* Flag Reaction AI Translation */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center font-bold text-xs">
            🌐
          </div>
          <h3 className="text-base font-semibold text-slate-900">
            Terjemahan Reaksi Bendera (AI-Powered)
          </h3>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Beri reaksi emoji bendera negara pada pesan mana pun di server Discord, dan Porsche-chan akan otomatis membalas dengan terjemahan berkualitas tinggi menggunakan model AI <strong>Gemini 3.8 Flash</strong> (dengan fallback Groq Llama 3.3 70B & Mistral):
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {[
            { flag: "🇺🇸 🇬🇧", lang: "English" },
            { flag: "🇯🇵", lang: "Japanese" },
            { flag: "🇮🇩", lang: "Indonesia" },
            { flag: "🇸🇦", lang: "Arabic" },
            { flag: "🇰🇷", lang: "Korean" },
            { flag: "🇨🇳 🇹🇼", lang: "Chinese" },
            { flag: "🇫🇷", lang: "French" },
            { flag: "🇩🇪", lang: "German" },
            { flag: "🇪🇸", lang: "Spanish" },
            { flag: "🇧🇷 🇵🇹", lang: "Portuguese" },
            { flag: "🇷🇺", lang: "Russian" },
            { flag: "🇻🇳", lang: "Vietnamese" },
            { flag: "🇹🇭", lang: "Thai" },
            { flag: "🇲🇾", lang: "Malay" },
            { flag: "🇵🇭", lang: "Tagalog" },
          ].map((item, i) => (
            <div key={i} className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 flex items-center gap-1.5 font-medium text-slate-700">
              <span>{item.flag}</span>
              <span>{item.lang}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
