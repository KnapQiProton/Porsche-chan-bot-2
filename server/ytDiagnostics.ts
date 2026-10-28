import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  Message,
  PermissionFlagsBits,
} from "discord.js";
import { exec } from "child_process";
import path from "path";
import os from "os";
import { logger } from "./logger";
import { CREATOR_ID } from "./bot";
import {
  getOrDownloadYtDlp,
  clearCachedYtDlpPath,
  getYtDlpCookieArgs,
  getYtExtractorArgs,
  getCookieStatus,
  FFMPEG_BIN,
} from "./musicPlayer";

export interface ShellExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  error?: Error;
}

/**
 * Run shell command with strict timeout, killing the process on expiration
 * and automatically extending PATH for Pterodactyl container user environments (~/.local/bin).
 */
export function execWithTimeout(
  command: string,
  timeoutMs: number = 15000,
  extraEnv?: Record<string, string>
): Promise<ShellExecResult> {
  return new Promise((resolve) => {
    let resolved = false;

    // Extend PATH to ensure ~/.local/bin and /home/container/.local/bin are found
    const homeDir = os.homedir();
    const localBins = [
      path.join(homeDir, ".local", "bin"),
      "/home/container/.local/bin",
      "/root/.local/bin",
    ];
    let pathVar = process.env.PATH || "";
    for (const b of localBins) {
      if (!pathVar.includes(b)) {
        pathVar = `${b}${path.delimiter}${pathVar}`;
      }
    }

    const child = exec(
      command,
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: pathVar,
          ...(extraEnv || {}),
        },
      },
      (error, stdout, stderr) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);

        const timedOut = Boolean(
          error &&
            (error.killed ||
              (error as any).signal === "SIGTERM" ||
              (error as any).code === "ETIMEDOUT" ||
              error.message.includes("timed out"))
        );

        resolve({
          stdout: (stdout || "").toString().trim(),
          stderr: (stderr || "").toString().trim(),
          code: error ? (error.code ?? 1) : 0,
          timedOut,
          error: error || undefined,
        });
      }
    );

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve({
          stdout: "",
          stderr: `Batas waktu perintah (${Math.round(timeoutMs / 1000)} detik) terlampaui (Timeout).`,
          code: 124,
          timedOut: true,
          error: new Error(`Command timed out after ${timeoutMs}ms`),
        });
      }
    }, timeoutMs);
  });
}

export interface SystemVersions {
  python: string;
  ytdlp: string;
  ffmpeg: string;
  ytdlpPath: string;
}

/**
 * Collect installed Python, yt-dlp, and FFmpeg versions
 */
export async function getSystemVersions(): Promise<SystemVersions> {
  // 1. Python version
  let python = "Tidak terdeteksi";
  const py3 = await execWithTimeout("python3 --version", 5000);
  if (py3.code === 0 && (py3.stdout || py3.stderr)) {
    python = py3.stdout || py3.stderr;
  } else {
    const py = await execWithTimeout("python --version", 5000);
    if (py.code === 0 && (py.stdout || py.stderr)) {
      python = py.stdout || py.stderr;
    }
  }

  // 2. yt-dlp version & executable path
  let ytdlp = "Tidak terdeteksi";
  let ytdlpPath = "yt-dlp";
  try {
    ytdlpPath = await getOrDownloadYtDlp();
    const ytVer = await execWithTimeout(`"${ytdlpPath}" --version`, 5000);
    if (ytVer.code === 0 && ytVer.stdout) {
      ytdlp = ytVer.stdout.trim();
    }
  } catch {}

  // 3. FFmpeg version
  let ffmpeg = "Tidak terdeteksi";
  try {
    const ffVer = await execWithTimeout(`"${FFMPEG_BIN}" -version`, 5000);
    if (ffVer.code === 0 && ffVer.stdout) {
      const firstLine = ffVer.stdout.split(/\r?\n/)[0];
      ffmpeg = firstLine.length > 35 ? firstLine.slice(0, 35) + "..." : firstLine;
    }
  } catch {}

  return { python, ytdlp, ffmpeg, ytdlpPath };
}

export interface LiveTestResult {
  success: boolean;
  title?: string;
  durationMs: number;
  rawError?: string;
  timedOut: boolean;
}

/**
 * Execute YouTube live test with strict max 15s timeout
 */
export async function runYtLiveTest(ytdlpBin: string): Promise<LiveTestResult> {
  const startTime = Date.now();
  const testUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  const cookieArgs = getYtDlpCookieArgs();
  const extractorArgs = getYtExtractorArgs(cookieArgs.length > 0);

  const testCmd = [
    `"${ytdlpBin}"`,
    "--force-ipv4",
    "--no-check-certificates",
    "-j",
    "--skip-download",
    "--print title",
    ...cookieArgs,
    ...extractorArgs,
    `"${testUrl}"`,
  ].join(" ");

  logger.info({ testCmd }, "[YT-Diagnose] Menjalankan Live Test YouTube");
  const res = await execWithTimeout(testCmd, 15000);
  const durationMs = Date.now() - startTime;

  if (res.timedOut) {
    return {
      success: false,
      durationMs,
      timedOut: true,
      rawError: "Timeout: Eksekusi YouTube melebihi batas waktu 15 detik (server tidak merespons atau throttled).",
    };
  }

  // Extract title: yt-dlp with --print title outputs title on the first non-JSON/non-empty line
  const lines = res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const title = lines.find((l) => !l.startsWith("{") && !l.startsWith("[") && l.length > 0);

  if (res.code === 0 && title) {
    return {
      success: true,
      title,
      durationMs,
      timedOut: false,
    };
  }

  // Fallback: test without extra args in case custom args caused format parsing issue
  if (cookieArgs.length > 0 || extractorArgs.length > 0) {
    const plainCmd = `"${ytdlpBin}" -j --skip-download --print title "${testUrl}"`;
    const plainRes = await execWithTimeout(plainCmd, 12000);
    const plainLines = plainRes.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const plainTitle = plainLines.find((l) => !l.startsWith("{") && !l.startsWith("[") && l.length > 0);

    if (plainRes.code === 0 && plainTitle) {
      return {
        success: true,
        title: plainTitle,
        durationMs: Date.now() - startTime,
        timedOut: false,
      };
    }
  }

  // Truncate raw error to max 500 characters
  const rawErr = (res.stderr || res.stdout || res.error?.message || "YouTube live test failed").trim();
  const truncatedError = rawErr.length > 500 ? `${rawErr.slice(0, 497)}...` : rawErr;

  return {
    success: false,
    durationMs,
    rawError: truncatedError,
    timedOut: false,
  };
}

export interface UpdateAttemptResult {
  success: boolean;
  method: string;
  output: string;
}

/**
 * Run multi-tier auto-update specifically tuned for Pterodactyl container permissions:
 * 1. pip3 install --upgrade --pre yt-dlp
 * 2. fallback: pip install --user --upgrade --pre yt-dlp
 * 3. fallback: pipx upgrade yt-dlp
 * 4. fallback: yt-dlp --update-to nightly
 */
export async function attemptYtDlpUpdate(): Promise<UpdateAttemptResult> {
  const isWin = process.platform === "win32";

  const commandChain = isWin
    ? [
        { cmd: "python -m pip install --upgrade --pre yt-dlp", method: "python -m pip install" },
        { cmd: "pip install --upgrade --pre yt-dlp", method: "pip install" },
      ]
    : [
        { cmd: "pip3 install --upgrade --pre yt-dlp", method: "pip3 install (global)" },
        { cmd: "pip3 install --break-system-packages --upgrade --pre yt-dlp", method: "pip3 --break-system-packages" },
        { cmd: "pip install --user --upgrade --pre yt-dlp", method: "pip install --user (Pterodactyl safe)" },
        { cmd: "pip3 install --user --upgrade --pre yt-dlp", method: "pip3 install --user (Pterodactyl safe)" },
        { cmd: "pipx upgrade --pip-args=\"--pre\" yt-dlp", method: "pipx upgrade" },
      ];

  for (const step of commandChain) {
    logger.info({ step: step.method, cmd: step.cmd }, "[YT-Fix] Mencoba perintah update yt-dlp");
    const res = await execWithTimeout(step.cmd, 25000);
    if (res.code === 0) {
      clearCachedYtDlpPath();
      logger.info({ step: step.method }, "[YT-Fix] Berhasil update yt-dlp!");
      return {
        success: true,
        method: step.method,
        output: res.stdout || res.stderr,
      };
    }
  }

  // Fallback to standalone binary update if installed via curl/binary
  try {
    const ytdlpBin = await getOrDownloadYtDlp();
    const binUpdateRes = await execWithTimeout(`"${ytdlpBin}" --update-to nightly`, 20000);
    if (binUpdateRes.code === 0) {
      clearCachedYtDlpPath();
      return {
        success: true,
        method: "yt-dlp --update-to nightly",
        output: binUpdateRes.stdout || binUpdateRes.stderr,
      };
    }
  } catch {}

  return {
    success: false,
    method: "None",
    output: "Semua metode update gagal dijalankan.",
  };
}

/**
 * Check if the user is authorized (Bot Owner or Server Administrator)
 */
export function isAuthorizedUser(userId: string, member: GuildMember | null): boolean {
  if (userId === CREATOR_ID) return true;
  if (process.env.OWNER_ID && userId === process.env.OWNER_ID.trim()) return true;

  if (member && member.permissions && typeof member.permissions.has === "function") {
    return member.permissions.has(PermissionFlagsBits.Administrator);
  }
  return false;
}

/**
 * Handle Slash Command `/ytfix` and `/check`
 */
export async function handleYtFixCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  // 1. Security Check
  const member = interaction.member as GuildMember | null;
  if (!isAuthorizedUser(interaction.user.id, member)) {
    await interaction.reply({
      content: "❌ Command ini hanya dapat dipanggil oleh Owner Bot atau Administrator server.",
      ephemeral: true,
    });
    return;
  }

  // 2. Defer Reply
  await interaction.deferReply();

  // 3. Initial Status Embed (Kuning)
  const initialEmbed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("🛠️ YouTube Auto-Diagnose & Auto-Fix")
    .setDescription("Memulai diagnosa sistem pemutar YouTube...")
    .addFields(
      { name: "⏳ Status", value: "Memeriksa versi Python, yt-dlp, dan FFmpeg...", inline: false }
    )
    .setFooter({ text: "KeritCloud / Pterodactyl Diagnostic Tool" })
    .setTimestamp();

  await interaction.editReply({ embeds: [initialEmbed] });

  // 4. Gather System Versions
  const sys = await getSystemVersions();

  // 5. Update Status: Running Live Test (Kuning)
  const testingEmbed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("🛠️ YouTube Auto-Diagnose & Auto-Fix")
    .setDescription("Menjalankan Live Test koneksi ke YouTube...")
    .addFields(
      { name: "🐍 Python", value: `\`${sys.python}\``, inline: true },
      { name: "🎵 yt-dlp", value: `\`${sys.ytdlp}\``, inline: true },
      { name: "🎬 FFmpeg", value: `\`${sys.ffmpeg}\``, inline: true },
      { name: "📡 Live Test Status", value: "Menguji ekstraksi video uji coba (maks. 15 detik)...", inline: false }
    )
    .setFooter({ text: "KeritCloud / Pterodactyl Diagnostic Tool" })
    .setTimestamp();

  await interaction.editReply({ embeds: [testingEmbed] });

  // 6. Run Live Test
  const test = await runYtLiveTest(sys.ytdlpPath);

  // 7. Case A: Live Test Success -> Sistem Sehat (Hijau)
  if (test.success) {
    const healthyEmbed = new EmbedBuilder()
      .setColor(0x57f287) // Hijau
      .setTitle("Sistem Sehat ✅")
      .setDescription("Seluruh komponen pemutar YouTube berfungsi normal! Tidak ada pemblokiran terdeteksi.")
      .addFields(
        { name: "🐍 Python", value: `\`${sys.python}\``, inline: true },
        { name: "🎵 yt-dlp", value: `\`${sys.ytdlp}\``, inline: true },
        { name: "🎬 FFmpeg", value: `\`${sys.ffmpeg}\``, inline: true },
        { name: "🍪 Cookies Aktif", value: `\`${getCookieStatus().source}\``, inline: true },
        {
          name: "📡 Hasil Live Test",
          value: `✅ Berhasil mengekstrak judul:\n**${test.title}** (${test.durationMs}ms)`,
          inline: false,
        },
        { name: "✨ Status Bot", value: "Siap memutar musik via command `/play`", inline: false }
      )
      .setFooter({ text: "Diagnosa Selesai • Sistem Normal" })
      .setTimestamp();

    await interaction.editReply({ embeds: [healthyEmbed] });
    return;
  }

  // 8. Case B: Live Test Failed -> Begin Auto-Fix (Kuning)
  const fixingEmbed = new EmbedBuilder()
    .setColor(0xfee75c) // Kuning
    .setTitle("⚠️ Terdeteksi Masalah YouTube — Sedang Mencoba Auto-Update...")
    .setDescription(
      "Live Test YouTube gagal (terdeteksi 403/429/timeout atau perubahan algoritma YouTube). Sedang mencoba memperbarui `yt-dlp` ke versi nightly terbaru di container Pterodactyl..."
    )
    .addFields(
      { name: "🐍 Python", value: `\`${sys.python}\``, inline: true },
      { name: "🎵 yt-dlp (Versi Saat Ini)", value: `\`${sys.ytdlp}\``, inline: true },
      { name: "🎬 FFmpeg", value: `\`${sys.ffmpeg}\``, inline: true },
      {
        name: "❌ Error Live Test Awal",
        value: `\`\`\`text\n${test.rawError || "YouTube stream timeout / error"}\n\`\`\``,
        inline: false,
      },
      {
        name: "🔧 Urutan Perbaikan Pterodactyl",
        value:
          "1. `pip3 install --upgrade --pre yt-dlp`\n" +
          "2. `pip install --user --upgrade --pre yt-dlp`\n" +
          "3. `pipx upgrade yt-dlp`\n\n" +
          "*Sedang mengeksekusi...*",
        inline: false,
      }
    )
    .setFooter({ text: "Sedang Menjalankan Auto-Fix..." })
    .setTimestamp();

  await interaction.editReply({ embeds: [fixingEmbed] });

  // 9. Execute Auto-Update
  const update = await attemptYtDlpUpdate();
  const newSys = await getSystemVersions();

  // 10. Update Status: Retesting (Kuning)
  const retestingEmbed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("🔄 Update Selesai — Menjalankan Uji Coba Ulang...")
    .setDescription(
      `Proses update telah selesai dieksekusi.\n` +
      `• Versi yt-dlp: \`${sys.ytdlp}\` ➔ **\`${newSys.ytdlp}\`**\n` +
      `• Metode: \`${update.method}\`\n\n` +
      `Sedang menjalankan Live Test kedua untuk memverifikasi perbaikan...`
    )
    .setFooter({ text: "Verifikasi Ulang..." })
    .setTimestamp();

  await interaction.editReply({ embeds: [retestingEmbed] });

  // 11. Run Retest
  const retest = await runYtLiveTest(newSys.ytdlpPath);

  // 12. Evaluate Retest Result
  if (retest.success) {
    const fixedEmbed = new EmbedBuilder()
      .setColor(0x57f287) // Hijau
      .setTitle("Berhasil Diperbaiki! ✅")
      .setDescription("Masalah pemutaran YouTube berhasil diatasi! yt-dlp berhasil di-update dan lolos Live Test.")
      .addFields(
        { name: "🎵 Versi yt-dlp", value: `\`${sys.ytdlp}\` ➔ **\`${newSys.ytdlp}\`**`, inline: true },
        { name: "🛠️ Metode Update", value: `\`${update.method}\``, inline: true },
        {
          name: "📡 Live Test Ulang",
          value: `✅ Berhasil mengekstrak:\n**${retest.title}** (${retest.durationMs}ms)`,
          inline: false,
        },
        { name: "✨ Status", value: "YouTube audio engine sudah normal kembali. Silakan coba `/play`!", inline: false }
      )
      .setFooter({ text: "Auto-Fix Berhasil!" })
      .setTimestamp();

    await interaction.editReply({ embeds: [fixedEmbed] });
  } else {
    const failedEmbed = new EmbedBuilder()
      .setColor(0xed4245) // Merah
      .setTitle("Gagal Diperbaiki ❌")
      .setDescription("yt-dlp sudah diperbarui, namun YouTube tetap menolak/memblokir permintaan audio dari server ini.")
      .addFields(
        { name: "🎵 Versi yt-dlp", value: `\`${newSys.ytdlp}\``, inline: true },
        {
          name: "🛠️ Status Update",
          value: update.success ? `Sukses via \`${update.method}\`` : "Gagal update package",
          inline: true,
        },
        {
          name: "💥 Error Mentah yt-dlp (Maks. 500 Karakter)",
          value: `\`\`\`text\n${retest.rawError || test.rawError || "Tidak ada detail error"}\n\`\`\``,
          inline: false,
        },
        {
          name: "⚠️ Analisis",
          value:
            "Kemungkinan besar **IP hosting KeritCloud / Pterodactyl terkena ban/rate-limit (403/429)** langsung oleh Google/YouTube.",
          inline: false,
        },
        {
          name: "💡 Solusi yang Disarankan",
          value:
            "1. Gunakan command `/cookies` dan upload file `cookies.txt` akun YouTube kamu agar bot login sebagai user nyata.\n" +
            "2. Atau pasang environment variable `YOUTUBE_COOKIE` di panel KeritCloud.\n" +
            "3. Minta admin KeritCloud untuk mengganti IP container node kamu jika subnet IP terkena ban massal.",
          inline: false,
        }
      )
      .setFooter({ text: "Auto-Fix Selesai • Diperlukan Tindakan Manual" })
      .setTimestamp();

    await interaction.editReply({ embeds: [failedEmbed] });
  }
}

/**
 * Handle Message / Prefix Command `!ytfix` and `!check`
 */
export async function handleYtFixMessage(message: Message): Promise<void> {
  const member = message.member;
  if (!isAuthorizedUser(message.author.id, member)) {
    const denied = await message.reply("❌ Command ini hanya dapat digunakan oleh Owner Bot atau Administrator server.");
    setTimeout(() => denied.delete().catch(() => {}), 5000);
    return;
  }

  const initialEmbed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("🛠️ YouTube Auto-Diagnose & Auto-Fix")
    .setDescription("Memulai diagnosa sistem pemutar YouTube...")
    .addFields(
      { name: "⏳ Status", value: "Memeriksa versi Python, yt-dlp, dan FFmpeg...", inline: false }
    )
    .setFooter({ text: "KeritCloud / Pterodactyl Diagnostic Tool" })
    .setTimestamp();

  const replyMsg = await message.reply({ embeds: [initialEmbed] });

  // Gather versions
  const sys = await getSystemVersions();

  const testEmbed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("🛠️ YouTube Auto-Diagnose & Auto-Fix")
    .setDescription("Menjalankan Live Test koneksi ke YouTube...")
    .addFields(
      { name: "🐍 Python", value: `\`${sys.python}\``, inline: true },
      { name: "🎵 yt-dlp", value: `\`${sys.ytdlp}\``, inline: true },
      { name: "🎬 FFmpeg", value: `\`${sys.ffmpeg}\``, inline: true },
      { name: "📡 Live Test Status", value: "Menguji ekstraksi video uji coba (maks. 15 detik)...", inline: false }
    )
    .setFooter({ text: "KeritCloud / Pterodactyl Diagnostic Tool" })
    .setTimestamp();

  await replyMsg.edit({ embeds: [testEmbed] });

  const test = await runYtLiveTest(sys.ytdlpPath);

  if (test.success) {
    const healthyEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("Sistem Sehat ✅")
      .setDescription("Seluruh komponen pemutar YouTube berfungsi normal! Tidak ada pemblokiran terdeteksi.")
      .addFields(
        { name: "🐍 Python", value: `\`${sys.python}\``, inline: true },
        { name: "🎵 yt-dlp", value: `\`${sys.ytdlp}\``, inline: true },
        { name: "🎬 FFmpeg", value: `\`${sys.ffmpeg}\``, inline: true },
        { name: "🍪 Cookies Aktif", value: `\`${getCookieStatus().source}\``, inline: true },
        {
          name: "📡 Hasil Live Test",
          value: `✅ Berhasil mengekstrak judul:\n**${test.title}** (${test.durationMs}ms)`,
          inline: false,
        },
        { name: "✨ Status Bot", value: "Siap memutar musik via command `!play` atau `/play`", inline: false }
      )
      .setFooter({ text: "Diagnosa Selesai • Sistem Normal" })
      .setTimestamp();

    await replyMsg.edit({ embeds: [healthyEmbed] });
    return;
  }

  // Failed initial test -> Attempt Fix
  const fixingEmbed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("⚠️ Terdeteksi Masalah YouTube — Sedang Mencoba Auto-Update...")
    .setDescription("Live Test YouTube gagal. Sedang mencoba memperbarui `yt-dlp` ke versi nightly terbaru...")
    .addFields(
      { name: "🐍 Python", value: `\`${sys.python}\``, inline: true },
      { name: "🎵 yt-dlp (Versi Saat Ini)", value: `\`${sys.ytdlp}\``, inline: true },
      { name: "🎬 FFmpeg", value: `\`${sys.ffmpeg}\``, inline: true },
      {
        name: "❌ Error Live Test Awal",
        value: `\`\`\`text\n${test.rawError || "YouTube stream timeout / error"}\n\`\`\``,
        inline: false,
      },
      {
        name: "🔧 Urutan Perbaikan",
        value: "1. `pip3 install`\n2. `pip install --user`\n3. `pipx upgrade`\n\n*Sedang mengeksekusi...*",
        inline: false,
      }
    )
    .setFooter({ text: "Sedang Menjalankan Auto-Fix..." })
    .setTimestamp();

  await replyMsg.edit({ embeds: [fixingEmbed] });

  const update = await attemptYtDlpUpdate();
  const newSys = await getSystemVersions();

  const retestingEmbed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("🔄 Update Selesai — Menjalankan Uji Coba Ulang...")
    .setDescription(
      `Proses update selesai dieksekusi.\n` +
      `• Versi yt-dlp: \`${sys.ytdlp}\` ➔ **\`${newSys.ytdlp}\`** via \`${update.method}\`\n\n` +
      `Sedang menjalankan Live Test kedua untuk memverifikasi perbaikan...`
    )
    .setFooter({ text: "Verifikasi Ulang..." })
    .setTimestamp();

  await replyMsg.edit({ embeds: [retestingEmbed] });

  const retest = await runYtLiveTest(newSys.ytdlpPath);

  if (retest.success) {
    const fixedEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("Berhasil Diperbaiki! ✅")
      .setDescription("Masalah pemutaran YouTube berhasil diatasi! yt-dlp berhasil di-update dan lolos Live Test.")
      .addFields(
        { name: "🎵 Versi yt-dlp", value: `\`${sys.ytdlp}\` ➔ **\`${newSys.ytdlp}\`**`, inline: true },
        { name: "🛠️ Metode Update", value: `\`${update.method}\``, inline: true },
        {
          name: "📡 Live Test Ulang",
          value: `✅ Berhasil mengekstrak:\n**${retest.title}** (${retest.durationMs}ms)`,
          inline: false,
        },
        { name: "✨ Status", value: "YouTube audio engine sudah normal kembali. Silakan coba `!play` / `/play`!", inline: false }
      )
      .setFooter({ text: "Auto-Fix Berhasil!" })
      .setTimestamp();

    await replyMsg.edit({ embeds: [fixedEmbed] });
  } else {
    const failedEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("Gagal Diperbaiki ❌")
      .setDescription("yt-dlp sudah diperbarui, namun YouTube tetap menolak/memblokir permintaan audio dari server ini.")
      .addFields(
        { name: "🎵 Versi yt-dlp", value: `\`${newSys.ytdlp}\``, inline: true },
        {
          name: "🛠️ Status Update",
          value: update.success ? `Sukses via \`${update.method}\`` : "Gagal update package",
          inline: true,
        },
        {
          name: "💥 Error Mentah yt-dlp (Maks. 500 Karakter)",
          value: `\`\`\`text\n${retest.rawError || test.rawError || "Tidak ada detail error"}\n\`\`\``,
          inline: false,
        },
        {
          name: "⚠️ Analisis",
          value:
            "Kemungkinan besar **IP hosting KeritCloud / Pterodactyl terkena ban/rate-limit (403/429)** langsung oleh Google/YouTube.",
          inline: false,
        },
        {
          name: "💡 Solusi yang Disarankan",
          value:
            "1. Gunakan command `/cookies` dan upload file `cookies.txt` akun YouTube kamu.\n" +
            "2. Atau pasang environment variable `YOUTUBE_COOKIE` di panel KeritCloud.\n" +
            "3. Minta admin KeritCloud untuk mengganti IP container node kamu jika subnet IP terkena ban massal.",
          inline: false,
        }
      )
      .setFooter({ text: "Auto-Fix Selesai • Diperlukan Tindakan Manual" })
      .setTimestamp();

    await replyMsg.edit({ embeds: [failedEmbed] });
  }
}
