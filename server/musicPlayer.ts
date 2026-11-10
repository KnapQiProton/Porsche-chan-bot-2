import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Guild,
  GuildMember,
  Message,
  TextBasedChannel,
  VoiceBasedChannel,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  StringSelectMenuInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { PassThrough, Readable } from "stream";
import playdl from "play-dl";
import ytdl from "@distube/ytdl-core";
import ffmpegStatic from "ffmpeg-static";
import { logger } from "./logger";
import { buildCloseRow } from "./messageClose";

// Resolve FFmpeg path (support system binary on Linux containers, bundled ffmpeg-static, and env override)
export function resolveFfmpegBin(): string {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  if (process.platform === "linux" && fs.existsSync("/usr/bin/ffmpeg")) {
    return "/usr/bin/ffmpeg";
  }
  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
    return ffmpegStatic;
  }
  return "ffmpeg";
}
export const FFMPEG_BIN = resolveFfmpegBin();
if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
  const ffmpegDir = path.dirname(ffmpegStatic);
  if (!process.env.PATH?.includes(ffmpegDir)) {
    process.env.PATH = `${ffmpegDir}${path.delimiter}${process.env.PATH || ""}`;
  }
}

// Directories that can hold a persisted cookies.txt. Railway wipes the container
// filesystem on every deploy, but an attached volume survives. If the user has
// mounted one, RAILWAY_VOLUME_MOUNT_PATH points at it, so uploads via /cookies
// keep working after redeploys without re-uploading or setting an env var.
export function getPersistentCookiesDirs(): string[] {
  const dirs = [
    process.env.COOKIES_DIR,
    process.env.RAILWAY_VOLUME_MOUNT_PATH,
    process.env.DATA_DIR,
  ].filter((d): d is string => Boolean(d && d.trim()));

  return [...new Set(dirs.map((d) => d.trim()))];
}

export function getCookieSearchPaths(): string[] {
  const candidates: string[] = [];
  for (const dir of getPersistentCookiesDirs()) {
    candidates.push(path.join(dir, "cookies.txt"));
    candidates.push(path.join(dir, "data", "cookies.txt"));
  }
  candidates.push(path.join(process.cwd(), "cookies.txt"));
  candidates.push("/app/cookies.txt");
  candidates.push(path.join(process.cwd(), "cookies.full.txt"));
  candidates.push(path.join(os.tmpdir(), "porsche_chan_youtube_cookies.txt"));
  return [...new Set(candidates)];
}

export function findCookiesFile(): string | null {
  for (const candidate of getCookieSearchPaths()) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 10) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

// Decode a cookie payload from an env var (raw Netscape text, escaped newlines, or base64)
function decodeEnvCookies(raw: string): string {
  let content = raw.trim();
  if (
    (content.startsWith('"') && content.endsWith('"')) ||
    (content.startsWith("'") && content.endsWith("'"))
  ) {
    content = content.slice(1, -1).trim();
  }
  if (!content.includes("\t") && !content.startsWith("#") && content.length > 50) {
    try {
      const decoded = Buffer.from(content, "base64").toString("utf-8");
      if (decoded.includes("\t") || decoded.includes("youtube.com")) {
        content = decoded;
      }
    } catch {}
  }
  // Railway env vars often carry literal "\n"/"\t" instead of real whitespace
  if (content.includes("\\n")) {
    content = content.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }
  return content;
}

function getEnvCookies(): string | undefined {
  const raw =
    process.env.YOUTUBE_COOKIE ||
    process.env.YOUTUBE_COOKIES ||
    process.env.COOKIES ||
    process.env.YOUTUBE_COOKIE_BASE64;
  if (!raw || !raw.trim()) return undefined;
  return decodeEnvCookies(raw);
}

/** Netscape cookie content is logged in when it has LOGIN_INFO + SAPISID, or SAPISID + PSID session tokens. */
function cookieContentLooksLoggedIn(content: string): boolean {
  if (!content) return false;
  const hasLoginInfo = content.includes("\tLOGIN_INFO\t");
  const hasSapisid =
    content.includes("\tSAPISID\t") ||
    content.includes("\t__Secure-1PAPISID\t") ||
    content.includes("\t__Secure-3PAPISID\t");
  const hasPsid =
    content.includes("\tSID\t") ||
    content.includes("\t__Secure-1PSID\t") ||
    content.includes("\t__Secure-3PSID\t");
  return (hasLoginInfo && hasSapisid) || (hasSapisid && hasPsid) || hasLoginInfo;
}

/**
 * Pick the cookie source that should actually be used.
 *
 * Precedence rules:
 * 1. A logged-in env cookie beats a guest/stale cookies.txt. This matters when
 *    an old `/cookies` upload sits on a Railway volume and the user later sets
 *    `YOUTUBE_COOKIE`: the env value must not be silently ignored.
 * 2. Otherwise a persisted file wins (it was uploaded explicitly via /cookies).
 * 3. If only env exists, use it.
 */
function getActiveCookies(): { content: string; path?: string; fromEnv: boolean } | null {
  const envRaw = getEnvCookies();
  const envContent = envRaw && envRaw.trim().length > 10 ? envRaw : undefined;

  const filePath = findCookiesFile();
  let fileContent = "";
  if (filePath) {
    try {
      fileContent = fs.readFileSync(filePath, "utf-8");
    } catch {}
  }

  const envLoggedIn = Boolean(envContent && cookieContentLooksLoggedIn(envContent));
  const fileLoggedIn = Boolean(fileContent && cookieContentLooksLoggedIn(fileContent));

  if (envContent && (!fileContent || (envLoggedIn && !fileLoggedIn))) {
    return { content: envContent, fromEnv: true };
  }
  if (fileContent) {
    return { content: fileContent, path: filePath || undefined, fromEnv: false };
  }
  if (envContent) {
    return { content: envContent, fromEnv: true };
  }
  return null;
}

// Helper to extract visitor_data (VISITOR_INFO1_LIVE) from cookies or env
export function getVisitorDataFromCookies(): string | undefined {
  if (process.env.YOUTUBE_VISITOR_DATA && process.env.YOUTUBE_VISITOR_DATA.trim()) {
    return process.env.YOUTUBE_VISITOR_DATA.trim();
  }
  if (process.env.VISITOR_DATA && process.env.VISITOR_DATA.trim()) {
    return process.env.VISITOR_DATA.trim();
  }

  const activeCookies = getActiveCookies();
  const rawContent = activeCookies?.content || "";

  if (rawContent) {
    const lines = rawContent.split(/\r?\n/);
    for (const line of lines) {
      const parts = line.trim().split("\t");
      if (parts.length >= 7 && parts[5] === "VISITOR_INFO1_LIVE") {
        return parts[6].trim();
      }
    }
  }

  return undefined;
}

// Extract PO Token from environment variables or cookies.txt (critical for YouTube bot detection bypass)
export function getPoTokenFromCookies(): string | undefined {
  const envPo = process.env.YOUTUBE_PO_TOKEN?.trim() || process.env.PO_TOKEN?.trim();
  if (envPo) return envPo;

  const rawContent = getActiveCookies()?.content || "";

  if (rawContent) {
    const lines = rawContent.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      // Match comment line like: # po_token: <token> or # POT: <token>
      const commentMatch = trimmed.match(/^#\s*(?:po_token|pot)\s*[:=]\s*(.+)$/i);
      if (commentMatch) {
        return commentMatch[1].trim();
      }
      const parts = trimmed.split("\t");
      if (parts.length >= 7) {
        const name = parts[5].toUpperCase();
        if (name === "PO_TOKEN" || name === "POT" || name === "__SECURE-POT") {
          return parts[6].trim();
        }
      }
    }
  }

  return undefined;
}

// Valid player clients for yt-dlp 2026.x:
// web, web_safari, web_embedded, web_music, web_creator, mweb, ios, visionos,
// android, android_vr, tv, tv_downgraded, tv_samsung, tv_simply
// NOTE: "tv_embedded" was removed upstream — passing it makes extraction fail.
// Automatically injects PO Token (from env or cookies.txt) and visitor_data
export function getYtExtractorArgs(hasCookies?: boolean, clientOverride?: string): string[] {
  const customClient = clientOverride || process.env.YOUTUBE_PLAYER_CLIENT?.trim();
  // Datacenter IPs (Railway) without cookies get blocked on "default" (web). Use android,android_vr as default when cookies are absent.
  const playerClients = customClient || (hasCookies ? "default" : "android,android_vr");
  const parts: string[] = [`player_client=${playerClients}`];

  const poToken = getPoTokenFromCookies();
  const visitorData = process.env.YOUTUBE_VISITOR_DATA?.trim() || process.env.VISITOR_DATA?.trim() || getVisitorDataFromCookies();

  if (poToken) {
    const formattedToken = poToken.includes("+") ? poToken : `web+${poToken}`;
    parts.push(`po_token=${formattedToken}`);
  }
  if (visitorData) {
    parts.push(`visitor_data=${visitorData}`);
  }

  return ["--extractor-args", `youtube:${parts.join(";")}`];
}

// Optional external bgutil POT provider (local server runs on 127.0.0.1:4416 by default)
export function getPotProviderArgs(): string[] {
  const baseUrl = process.env.YOUTUBE_POT_PROVIDER_URL?.trim() || "http://127.0.0.1:4416";
  return ["--extractor-args", `youtubepot-bgutilhttp:base_url=${baseUrl}`];
}

// Quick health probe for the POT provider (used by /check diagnostics)
export async function checkPotProvider(): Promise<{ reachable: boolean; url: string; version?: string }> {
  const baseUrl = process.env.YOUTUBE_POT_PROVIDER_URL?.trim() || "http://127.0.0.1:4416";
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/ping`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { reachable: false, url: baseUrl };
    const data: any = await res.json().catch(() => ({}));
    return { reachable: true, url: baseUrl, version: data?.version };
  } catch {
    return { reachable: false, url: baseUrl };
  }
}

// ---------------------------------------------------------------------------
// Structured YouTube failure diagnostics
//
// Every playback failure ends up as ONE copy-pasteable block prefixed with
// [YT-FAIL]. The block is written to the logs verbatim, kept in memory for
// `/check` (and `/logs`), and a compact version is shown to the user. That way
// troubleshooting does not depend on guessing which tier failed or why.
// ---------------------------------------------------------------------------

export interface TierFailureDiagnostics {
  attempt: number;
  tier: number;
  clients: string;
  cookies: boolean;
  elapsedMs: number;
  stage: "yt-dlp" | "ffmpeg" | "timeout" | "spawn" | "unknown";
  ytdlpExitCode?: number | null;
  ffmpegExitCode?: number | null;
  ytdlpStderr?: string;
  ffmpegStderr?: string;
  reason: string;
}

export interface YtFailureDiagnostic {
  full: string;
  short: string;
}

export interface LastYtFailure {
  at: string;
  videoId?: string;
  url: string;
  report: string;
}

let lastYtFailure: LastYtFailure | null = null;
let cachedYtDlpVersion: string | undefined;

export function getLastYtFailure(): LastYtFailure | null {
  return lastYtFailure;
}

/**
 * Turn raw child-process stderr into a few readable lines: drop ANSI colors,
 * download progress noise, and duplicate lines, then prefer real error lines.
 */
export function cleanProcessStderr(raw: string, maxLines = 6): string {
  if (!raw) return "";

  const lines = raw
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\[(download|info|debug)\]/i.test(line))
    .filter((line) => !/^frame=\s*\d+/i.test(line) && !/^size=\s*\d+/i.test(line))
    .filter((line) => !/^time=\S+/i.test(line));

  const important = lines.filter((line) =>
    /(error|warning|denied|forbidden|403|401|429|not a bot|sign in|unable|failed|timed? ?out|no such file)/i.test(line)
  );

  const picked = (important.length ? important : lines).slice(-maxLines);
  const unique = [...new Set(picked)];
  return unique.join(" ⏎ ").slice(0, 1200);
}

function summarizeYtdlpError(raw: string): string {
  const cleaned = cleanProcessStderr(raw, 4);
  return cleaned ? cleaned.split(" ⏎ ")[0].slice(0, 400) : "";
}

function getYtDlpVersion(ytdlpPath: string): string {
  if (cachedYtDlpVersion) return cachedYtDlpVersion;
  try {
    const res = spawnSync(ytdlpPath, ["--version"], { timeout: 2500, encoding: "utf-8" });
    if (res.status === 0 && res.stdout) {
      cachedYtDlpVersion = String(res.stdout).trim().split("\n")[0];
    }
  } catch {}
  return cachedYtDlpVersion || "unknown";
}

/**
 * Build the full diagnostic block (for logs / attached .txt) plus a compact
 * version (for the Discord error message). Never throws.
 */
export async function buildYtFailureReport(input: {
  url: string;
  videoId?: string;
  seekSeconds: number;
  attempts: number;
  botCheck: boolean;
  tiers: Array<{ clients: string; timeoutMs: number }>;
  failures: TierFailureDiagnostics[];
  ytdlpPath: string;
}): Promise<YtFailureDiagnostic> {
  let cookie: { hasCookies: boolean; path?: string; loggedIn: boolean; cookieCount: number } = {
    hasCookies: false,
    loggedIn: false,
    cookieCount: 0,
  };
  let pot: { reachable: boolean; url: string; version?: string } = { reachable: false, url: "unknown" };

  try {
    cookie = getCookieAuthInfo();
  } catch {}
  try {
    pot = await checkPotProvider();
  } catch {}

  const proxy = process.env.YTDLP_PROXY?.trim() || process.env.YOUTUBE_PROXY?.trim() || "none";
  const ytdlpVersion = getYtDlpVersion(input.ytdlpPath);
  const cookieLabel = cookie.hasCookies
    ? `yes | login=${cookie.loggedIn ? "YES" : "NO (guest)"} | entries=${cookie.cookieCount} | ${cookie.path || "env"}`
    : "none";
  const potLabel = `${pot.reachable ? `reachable v${pot.version || "?"}` : "UNREACHABLE"} | ${pot.url}`;

  const header: string[] = [
    `time       : ${new Date().toISOString()}`,
    `url        : ${input.url}`,
    `videoId    : ${input.videoId || "n/a"}${input.seekSeconds ? ` | seek=${input.seekSeconds}s` : ""}`,
    `attempts   : ${input.attempts}`,
    `bot-check  : ${input.botCheck ? "YES — IP diblokir, butuh cookies login / proxy residential" : "no"}`,
    `cookies    : ${cookieLabel}`,
    `pot        : ${potLabel}`,
    `proxy      : ${proxy}`,
    `yt-dlp     : ${ytdlpVersion}`,
    `node       : ${process.version} | ${process.platform}/${process.arch}`,
    `tiers      : ${input.tiers.map((t, i) => `T${i + 1}=${t.clients}(${t.timeoutMs}ms)`).join(" | ")}`,
  ];

  const failureLines: string[] = [];
  for (const f of input.failures.slice(-12)) {
    const exits = [
      f.ytdlpExitCode !== undefined && f.ytdlpExitCode !== null ? `yt-dlp-exit=${f.ytdlpExitCode}` : "",
      f.ffmpegExitCode !== undefined && f.ffmpegExitCode !== null ? `ffmpeg-exit=${f.ffmpegExitCode}` : "",
    ].filter(Boolean).join(" | ");
    failureLines.push(
      `[T${f.tier} ${f.clients} | attempt=${f.attempt} | cookies=${f.cookies ? "yes" : "no"} | ` +
      `${f.elapsedMs}ms | stage=${f.stage}${exits ? ` | ${exits}` : ""}]`
    );
    failureLines.push(`  reason: ${f.reason.replace(/\s+/g, " ")}`);
    if (f.ytdlpStderr) failureLines.push(`  yt-dlp: ${f.ytdlpStderr}`);
    if (f.ffmpegStderr) failureLines.push(`  ffmpeg: ${f.ffmpegStderr}`);
  }

  const full = [
    "==================== [YT-FAIL] ====================",
    ...header,
    "--- failures (terakhir) ---",
    ...(failureLines.length ? failureLines : ["  (tidak ada detail tier)"]),
    "===================================================",
  ].join("\n");

  const short = [
    `[YT-FAIL] video=${input.videoId || "n/a"} bot-check=${input.botCheck ? "YES" : "no"} ` +
      `cookies=${cookie.hasCookies ? (cookie.loggedIn ? `login(${cookie.cookieCount})` : `guest(${cookie.cookieCount})`) : "none"} ` +
      `pot=${pot.reachable ? "ok" : "DOWN"} proxy=${proxy === "none" ? "none" : "set"} yt-dlp=${ytdlpVersion}`,
    ...input.failures.slice(-3).map((f) => `T${f.tier} ${f.clients}: ${f.reason}`),
  ].filter(Boolean).join("\n").slice(0, 900);

  return { full, short };
}

// Common yt-dlp flags for Railway/datacenter environments
function getCommonYtDlpFlags(): string[] {
  const flags = [
    "--force-ipv4",
    "--no-check-certificates",
    "--js-runtimes", "node",
    ...getPotProviderArgs(),
  ];

  // Optional egress proxy (residential proxy bypasses YouTube's datacenter IP checks)
  const proxy = process.env.YTDLP_PROXY?.trim() || process.env.YOUTUBE_PROXY?.trim();
  if (proxy) {
    flags.push("--proxy", proxy);
  }

  return flags;
}

const YT_EXTRACTOR_ARGS = getYtExtractorArgs();

export type MusicSource = "youtube" | "youtube_music" | "spotify" | "soundcloud" | "search";

export type PlaybackMode = "auto" | "mirror" | "ytdlp";

export interface TrackMetadata {
  title: string;
  artist: string;
  duration: string;
  durationSec?: number;
  url: string;
  thumbnail?: string;
  source: MusicSource;
  sourceBadge: string;
  sourceColor: number;
  requesterName: string;
  requesterId: string;
  rawTrackUrl?: string;
  hasPlaylistParam?: boolean;
  // Audio stream resolver with optional seek offset in seconds
  createStream: (seekSeconds?: number) => Promise<any>;
}

export interface ResolvedMusicResult {
  isPlaylist: boolean;
  playlistTitle?: string;
  playlistUrl?: string;
  playlistThumbnail?: string;
  playlistCount?: number;
  tracks: TrackMetadata[];
}

export interface GuildSession {
  guildId: string;
  voiceChannelId: string;
  textChannel?: TextBasedChannel;
  connection: VoiceConnection;
  player: AudioPlayer;
  currentTrack: TrackMetadata | null;
  currentResource: any | null;
  queue: TrackMetadata[];
  isPlaying: boolean;
  isPaused: boolean;
  isSeeking: boolean;
  seekOffsetSec: number;
  previewMessage?: Message | null;
  queuePage?: number;
  /** Timestamp when the current resource actually started playing */
  playbackStartedAt?: number;
  /** Tier label of the resource currently playing (for diagnostics) */
  currentTier?: string;
  /** Set while the bot itself stops the player (prevents false "stream died" reports) */
  manualStop?: boolean;
  /** Last error reported by the audio player / stream (for diagnostics) */
  lastStreamError?: string;
  /** Discord user id that opened the current music panel; only they may close it. */
  panelOwnerId?: string;
}

const sessions = new Map<string, GuildSession>();

// Rate-limiting / Cooldown maps to prevent command spamming
const userCooldowns = new Map<string, number>();
const guildCooldowns = new Map<string, number>();

export function checkUserCooldown(userId: string, action: string, cooldownMs: number = 2500): number | null {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const lastTime = userCooldowns.get(key) || 0;
  const elapsed = now - lastTime;
  if (elapsed < cooldownMs) {
    return Math.ceil((cooldownMs - elapsed) / 1000);
  }
  userCooldowns.set(key, now);
  return null;
}

export function checkGuildActionCooldown(guildId: string, action: string, cooldownMs: number = 1500): number | null {
  const key = `${guildId}:${action}`;
  const now = Date.now();
  const lastTime = guildCooldowns.get(key) || 0;
  const elapsed = now - lastTime;
  if (elapsed < cooldownMs) {
    return Math.ceil((cooldownMs - elapsed) / 1000);
  }
  guildCooldowns.set(key, now);
  return null;
}

export function safeDestroyVoiceConnection(conn?: VoiceConnection | null): void {
  if (!conn) return;
  try {
    if (conn.state?.status !== VoiceConnectionStatus.Destroyed) {
      conn.destroy();
    }
  } catch (err) {
    logger.debug({ err }, "Ignored non-fatal VoiceConnection destroy error");
  }
}

// Cached yt-dlp path to avoid repeated checks / downloads
let cachedYtDlpPath: string | null = null;

export function clearCachedYtDlpPath(): void {
  cachedYtDlpPath = null;
}

// Ensure yt-dlp binary is available
export async function getOrDownloadYtDlp(): Promise<string> {
  if (cachedYtDlpPath) return cachedYtDlpPath;

  const isWin = process.platform === "win32";
  const cmdName = isWin ? "yt-dlp.exe" : "yt-dlp";

  // 1. Check if yt-dlp is available in system PATH directly
  try {
    const test = spawnSync(cmdName, ["--version"], { timeout: 2000, encoding: "utf-8" });
    if (test.status === 0) {
      const version = String(test.stdout || "").trim().split("\n")[0];
      if (version) cachedYtDlpVersion = version;
      cachedYtDlpPath = cmdName;
      logger.info({ cmd: cmdName, version }, "Found working yt-dlp in system PATH");
      return cmdName;
    }
  } catch {}

  // 2. Check local bin/ directory
  const binDir = path.join(process.cwd(), "bin");
  const localYtDlp = path.join(binDir, cmdName);
  if (fs.existsSync(localYtDlp)) {
    try {
      if (!isWin) fs.chmodSync(localYtDlp, 0o755);
    } catch {}
    cachedYtDlpPath = localYtDlp;
    getYtDlpVersion(localYtDlp);
    return localYtDlp;
  }

  // 3. Check known Linux paths (Pterodactyl container, pip --user, pipx, nixpacks, standard)
  const homeDir = os.homedir();
  const sysCandidates = isWin
    ? [path.join(process.env.APPDATA || "", "Python", "Scripts", "yt-dlp.exe")]
    : [
        path.join(homeDir, ".local", "bin", "yt-dlp"),
        "/home/container/.local/bin/yt-dlp",
        "/root/.local/bin/yt-dlp",
        "/usr/local/bin/yt-dlp",
        "/usr/bin/yt-dlp",
        "/bin/yt-dlp",
      ];

  for (const sysPath of sysCandidates) {
    if (sysPath && fs.existsSync(sysPath)) {
      try {
        if (!isWin) fs.chmodSync(sysPath, 0o755);
      } catch {}
      cachedYtDlpPath = sysPath;
      getYtDlpVersion(sysPath);
      logger.info({ path: sysPath }, "Found existing yt-dlp binary");
      return sysPath;
    }
  }

  // 4. Fallback: download if not found anywhere
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const downloadUrl = isWin
    ? "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe"
    : "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp";

  logger.info({ isWin, downloadUrl }, "yt-dlp not found locally, downloading latest release...");
  try {
    const res = await fetch(downloadUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Failed to download yt-dlp binary (HTTP ${res.status})`);
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(localYtDlp, Buffer.from(buffer));
    if (!isWin) {
      try {
        fs.chmodSync(localYtDlp, 0o755);
      } catch {}
    }
    logger.info("yt-dlp downloaded and ready!");
    cachedYtDlpPath = localYtDlp;
    return localYtDlp;
  } catch (err) {
    logger.error({ err }, "Failed to download yt-dlp binary");
    return cmdName;
  }
}

// Ensure yt-dlp is updated to the latest nightly version (critical for YouTube anti-bot patches)
let ytDlpUpdatedOnce = false;
let ytDlpUpdatingPromise: Promise<void> | null = null;

export async function ensureYtDlpUpdated(): Promise<void> {
  if (ytDlpUpdatedOnce) return;
  if (ytDlpUpdatingPromise) return ytDlpUpdatingPromise;

  ytDlpUpdatingPromise = (async () => {
    // In the Docker image yt-dlp is already installed/updated at build time and
    // entrypoint.sh re-injects the POT plugin. Skipping the runtime update avoids
    // blocking the event loop with spawnSync() and never risks wiping the plugin.
    if (process.env.SKIP_YTDLP_UPDATE === "true") {
      logger.info("Skipping runtime yt-dlp update (SKIP_YTDLP_UPDATE=true)");
      ytDlpUpdatedOnce = true;
      return;
    }

    logger.info("Checking yt-dlp version...");
    const isWin = process.platform === "win32";

    const updateCommands = isWin
      ? [
          { cmd: "python", args: ["-m", "pip", "install", "--upgrade", "--pre", "yt-dlp"] },
          { cmd: "pip", args: ["install", "--upgrade", "--pre", "yt-dlp"] },
        ]
      : [
          // 1. Primary command for container / Linux
          { cmd: "pip3", args: ["install", "--upgrade", "--pre", "yt-dlp"] },
          // 2. Fallback for Pterodactyl container permission: pip install --user --upgrade --pre yt-dlp
          { cmd: "pip", args: ["install", "--user", "--upgrade", "--pre", "yt-dlp"] },
          { cmd: "pip3", args: ["install", "--user", "--upgrade", "--pre", "yt-dlp"] },
          { cmd: "pip3", args: ["install", "--break-system-packages", "--upgrade", "--pre", "yt-dlp"] },
          // 3. Fallback pipx
          { cmd: "pipx", args: ["upgrade", "--pip-args=--pre", "yt-dlp"] },
          { cmd: "pipx", args: ["upgrade", "yt-dlp"] },
          // 4. python3 -m pip fallback
          { cmd: "python3", args: ["-m", "pip", "install", "--user", "--upgrade", "--pre", "yt-dlp"] },
        ];

    let updated = false;
    for (const step of updateCommands) {
      try {
        const res = spawnSync(step.cmd, step.args, {
          timeout: 45_000,
          stdio: "pipe",
          encoding: "utf-8",
        });
        if (res.status === 0) {
          updated = true;
          clearCachedYtDlpPath();
          break;
        }
      } catch {}
    }

    // 5. Fallback: yt-dlp --update-to nightly for standalone binary release
    const ytdlpPath = await getOrDownloadYtDlp();
    if (!updated) {
      try {
        spawnSync(ytdlpPath, ["--update-to", "nightly"], {
          timeout: 30_000,
          stdio: "pipe",
        });
        clearCachedYtDlpPath();
      } catch {}
    }

    // 6. Determine final version and log
    try {
      const finalYtDlp = await getOrDownloadYtDlp();
      const verProc = spawnSync(finalYtDlp, ["--version"], {
        timeout: 5_000,
        stdio: "pipe",
        encoding: "utf-8",
      });
      const version = verProc.stdout?.trim() || "unknown";
      logger.info({ version }, `yt-dlp updated to ${version}`);
      ytDlpUpdatedOnce = true;
    } catch (verErr) {
      logger.warn({ verErr }, "Failed to inspect yt-dlp version");
    }
  })().finally(() => {
    ytDlpUpdatingPromise = null;
  });

  return ytDlpUpdatingPromise;
}

export const autoUpdateYtDlp = ensureYtDlpUpdated;
// SoundCloud Integration Toggle (temporary disable per user request)
export const ENABLE_SOUNDCLOUD = false;

// Initialize SoundCloud free client id for play-dl
let scInitialized = false;
export async function initSoundCloud(): Promise<void> {
  if (!ENABLE_SOUNDCLOUD) return;
  if (scInitialized) return;
  try {
    const scClientId = await playdl.getFreeClientID();
    await playdl.setToken({ soundcloud: { client_id: scClientId } });
    scInitialized = true;
    logger.info("SoundCloud initialized for music streaming");
  } catch (err) {
    logger.warn({ err }, "Could not initialize SoundCloud client ID");
  }
}

// Extract Spotify Track Metadata
async function getSpotifyTrackInfo(url: string): Promise<{ title: string; artist: string; duration: string; durationSec?: number; thumbnail?: string } | null> {
  const trackIdMatch = url.match(/spotify\.com(?:\/intl-[a-z]{2})?\/track\/([a-zA-Z0-9]+)/i);
  if (!trackIdMatch) return null;
  const trackId = trackIdMatch[1];

  let title = "";
  let artist = "";
  let duration = "3:30";
  let durationSec: number | undefined;
  let thumbnail: string | undefined;

  // 1. Try Spotify Embed __NEXT_DATA__
  try {
    const res = await fetch(`https://open.spotify.com/embed/track/${trackId}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)" },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const html = await res.text();
      const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
      if (nextMatch) {
        const data = JSON.parse(nextMatch[1]);
        const entity = data.props?.pageProps?.state?.data?.entity;
        if (entity && entity.name) {
          title = entity.name;
          artist = entity.artists?.map((a: any) => a.name).join(", ") || "";
          if (entity.duration) {
            durationSec = Math.round(Number(entity.duration) / 1000);
            duration = formatDuration(durationSec);
          }
          thumbnail = entity.coverArt?.sources?.[0]?.url;
        }
      }
    }
  } catch (err) {
    logger.debug({ err }, "Spotify embed parsing error");
  }

  // 2. Try Spotify oEmbed fallback if title missing
  if (!title || !thumbnail) {
    try {
      const oembedRes = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (oembedRes.ok) {
        const data = (await oembedRes.json()) as any;
        if (!title && data.title) {
          const parsed = parseTitleAndArtist(data.title, data.author_name);
          title = parsed.title;
          if (!artist) artist = parsed.artist;
        }
        if (!thumbnail && data.thumbnail_url) thumbnail = data.thumbnail_url;
      }
    } catch {}
  }

  if (title) {
    const parsed = parseTitleAndArtist(title, artist);
    return { title: parsed.title, artist: parsed.artist, duration, durationSec, thumbnail };
  }
  return null;
}

// Extract Spotify Playlist or Album Metadata & Track List via Embed API
export async function getSpotifyPlaylistOrAlbum(url: string): Promise<{
  title: string;
  type: "playlist" | "album";
  thumbnail?: string;
  tracks: Array<{ title: string; artist: string; durationSec?: number; url: string }>;
} | null> {
  const match = url.match(/spotify\.com(?:\/intl-[a-z]{2})?\/(playlist|album)\/([a-zA-Z0-9]+)/i);
  if (!match) return null;

  const type = match[1].toLowerCase() as "playlist" | "album";
  const id = match[2];

  try {
    const res = await fetch(`https://open.spotify.com/embed/${type}/${id}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const html = await res.text();
    const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (!nextMatch) return null;

    const data = JSON.parse(nextMatch[1]);
    const entity = data.props?.pageProps?.state?.data?.entity;
    if (!entity) return null;

    const title = entity.name || (type === "album" ? "Spotify Album" : "Spotify Playlist");
    const thumbnail = entity.coverArt?.sources?.[0]?.url || entity.images?.[0]?.url;
    const rawTrackList = (entity.trackList || []) as any[];

    const tracks = rawTrackList.slice(0, 100).map((t) => {
      const trackId = t.uri ? t.uri.replace("spotify:track:", "") : "";
      const trackUrl = trackId ? `https://open.spotify.com/track/${trackId}` : url;
      const durationSec = typeof t.duration === "number" && t.duration > 0 ? Math.round(t.duration / 1000) : undefined;
      return {
        title: t.title || "Spotify Track",
        artist: t.subtitle || "",
        durationSec,
        url: trackUrl,
      };
    });

    return {
      title,
      type,
      thumbnail,
      tracks,
    };
  } catch (err) {
    logger.warn({ err, url }, "Failed to extract Spotify playlist/album via embed");
    return null;
  }
}

// Record labels and lyric channels that should not be used as the artist name
const KNOWN_LABELS = [
  "smtown", "jyp entertainment", "hybe labels", "yg entertainment", "yg family", "1thek",
  "stone music", "starship", "cube entertainment", "fnc official", "bighit",
  "sony music", "universal music", "warner music", "atlantic records", "columbia records",
  "republic records", "interscope", "rca records", "def jam", "virgin music",
  "musica studios", "trinity optima production", "aquarius musikindo", "nagaswara",
  "gp records", "emotion entertainment", "pro-m", "mynd records",
  "7clouds", "taj tracks", "aqua music", "pillows", "cassiopeia", "unique vibes",
  "indolirik", "lirik lagu", "chillhop music", "chilledcow", "lofigirl"
];

export function isRecordLabelOrLyricChannel(author?: string): boolean {
  if (!author) return false;
  const low = author.toLowerCase().trim();
  return KNOWN_LABELS.some((label) => low.includes(label));
}

// Clean artist name: strip " - Topic", "VEVO", "Official", "@handle", etc.
export function cleanArtistName(raw: string): string {
  if (!raw) return "";
  let a = raw.trim();
  a = a.replace(/(\s*[-_]?\s*topic|\s*[-_]?\s*vevo|\s*[-_]?\s*official|\s*[-_]?\s*channel|\s*records?)$/i, "");
  a = a.replace(/^@/, "");
  return a.trim();
}

// Clean track title: strip clutter like (Official Music Video), [4K], etc.
export function cleanTrackTitle(title: string): string {
  if (!title) return "";
  let t = title;
  t = t.replace(/\[\s*(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visualizer|remaster(?:ed)?|hd|4k|mv)\s*\]/gi, " ");
  t = t.replace(/\(\s*(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visualizer|remaster(?:ed)?|hd|4k|movie\s+ver\.?|mv)\s*\)/gi, " ");
  t = t.replace(/\b(?:official\s+video|official\s+music\s+video|official\s+audio|lyric\s+video|visualizer|mv)\b/gi, " ");
  t = t.replace(/[【】「」『』]/g, " ");
  t = t.replace(/\s+/g, " ");
  return t.trim();
}

// Format duration from seconds or string into mm:ss or hh:mm:ss
export function formatDuration(secOrStr: number | string | undefined | null): string {
  if (secOrStr === undefined || secOrStr === null || secOrStr === "") {
    return "Audio";
  }
  if (typeof secOrStr === "string") {
    if (secOrStr === "Audio" || secOrStr === "Live" || secOrStr === "Video/Audio") {
      return secOrStr;
    }
    if (/^\d+:\d{2}(?::\d{2})?$/.test(secOrStr.trim())) {
      return secOrStr.trim();
    }
    const parsed = parseInt(secOrStr, 10);
    if (!isNaN(parsed) && parsed > 0) {
      secOrStr = parsed;
    } else {
      return "Audio";
    }
  }
  const totalSec = Math.max(0, Math.round(secOrStr));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Parse duration string (e.g. "3:59", "3.59", "1:02:15") into total seconds
export function parseDurationToSec(str?: string | null): number | undefined {
  if (!str) return undefined;
  const clean = str.trim();
  const parts = clean.split(/[:.]/).map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return undefined;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return undefined;
}

// Parse Title & Artist accurately so artist name never stays as generic "Artist" or "Artis"
export function parseTitleAndArtist(rawTitle: string, fallbackAuthor?: string): { title: string; artist: string } {
  const t = rawTitle.trim();
  const a = fallbackAuthor ? cleanArtistName(fallbackAuthor) : "";

  // 1. Quoted patterns: Artist "Song Title", Artist 'Song Title', Artist 「Song Title」, etc.
  const quoteMatch = t.match(/^([^"'\u300C\u300E\u3010]{2,40})\s*["'\u300C\u300E\u3010]([^"'\u300D\u300F\u3011]+)["'\u300D\u300F\u3011]/i);
  if (quoteMatch) {
    const candidateArtist = cleanArtistName(quoteMatch[1].replace(/\s*\([^)]*\)/g, ""));
    const candidateTitle = quoteMatch[2].trim();
    if (candidateArtist && !isRecordLabelOrLyricChannel(candidateArtist)) {
      return {
        artist: candidateArtist,
        title: cleanTrackTitle(candidateTitle) || candidateTitle,
      };
    }
  }

  // 2. Standard Separator: "Artist - Title" or "Title - Artist" or "Artist: Title"
  const separatorMatch = t.match(/^([^–\-:]{2,50})\s*[-–:]\s*(.+)$/);
  if (separatorMatch) {
    const left = separatorMatch[1].trim();
    const right = separatorMatch[2].trim();

    const rightIsTitleIndicators = /\b(?:official|remix|feat|ft|audio|video|ver|cover|mv)\b/i.test(right);
    const leftIsTitleIndicators = /\b(?:official|remix|feat|ft|audio|video|ver|cover|mv)\b/i.test(left);

    // If fallback author matches right side, it was Title - Artist
    if (a && right.toLowerCase().includes(a.toLowerCase()) && !isRecordLabelOrLyricChannel(a)) {
      return {
        artist: cleanArtistName(a),
        title: cleanTrackTitle(left) || left,
      };
    }

    if (!leftIsTitleIndicators && (rightIsTitleIndicators || !left.includes("\""))) {
      const parsedArtist = cleanArtistName(left);
      if (!isRecordLabelOrLyricChannel(parsedArtist)) {
        return {
          artist: parsedArtist,
          title: cleanTrackTitle(right) || right,
        };
      }
    }
  }

  // 3. Check if title starts with the fallbackAuthor
  if (a && !isRecordLabelOrLyricChannel(a) && !/^(artist|artis|youtube|unknown|soundcloud|youtube\s+music)$/i.test(a)) {
    let cleanedT = cleanTrackTitle(t);
    if (cleanedT.toLowerCase().startsWith(a.toLowerCase())) {
      cleanedT = cleanedT.slice(a.length).replace(/^[\s\-–:]+/, "").trim();
    }
    return {
      artist: a,
      title: cleanedT || cleanTrackTitle(t) || t,
    };
  }

  return {
    artist: a && !isRecordLabelOrLyricChannel(a) && !/^(artist|artis|unknown)$/i.test(a) ? a : "Artis Musik",
    title: cleanTrackTitle(t) || t,
  };
}

// Extract 11-character YouTube video ID from various YouTube & YouTube Music link formats
export function extractYouTubeVideoId(url: string): string | null {
  const m = url.match(
    /(?:music\.youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/i
  );
  if (m) return m[1];
  const queryParamMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/i);
  return queryParamMatch ? queryParamMatch[1] : null;
}

// Extract YouTube / YouTube Music metadata via public oEmbed
async function getYouTubeOEmbed(urlOrVideoId: string): Promise<{ title: string; author: string; thumbnail?: string } | null> {
  try {
    const videoId = extractYouTubeVideoId(urlOrVideoId) || (urlOrVideoId.length === 11 ? urlOrVideoId : null);
    const targetUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : urlOrVideoId;
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = (await res.json()) as any;
      return {
        title: data.title,
        author: data.author_name || "",
        thumbnail: data.thumbnail_url,
      };
    }
  } catch {}
  return null;
}

// Extract full YouTube metadata via yt-dlp (preserves exact duration, title, uploader)
async function getYtDlpMetadata(
  url: string,
  ytdlpPath: string,
  timeoutMs: number = 15000,
  overrideCookieArgs?: string[]
): Promise<{
  id: string;
  url: string;
  title: string;
  artist: string;
  duration: string;
  durationSec?: number;
  thumbnail?: string;
} | null> {
  const cookieArgs = overrideCookieArgs !== undefined ? overrideCookieArgs : getYtDlpCookieArgs();
  return new Promise((resolve) => {
    let resolved = false;
    const proc = spawn(ytdlpPath, [
      ...getCommonYtDlpFlags(),
      ...cookieArgs,
      ...getYtExtractorArgs(cookieArgs.length > 0),
      "--dump-single-json",
      "--no-playlist",
      "--no-warnings",
      url,
    ]);

    let raw = "";
    proc.stdout.on("data", (d) => (raw += d.toString()));

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          proc.kill("SIGKILL");
        } catch {}
        resolve(null);
      }
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        if (code === 0 && raw.trim()) {
          try {
            const j = JSON.parse(raw.trim());
            const videoId = j.id || "";
            const rawTitle = j.title || "YouTube Audio";
            const rawAuthor = j.uploader || j.channel || j.artist || "";
            const parsed = parseTitleAndArtist(rawTitle, rawAuthor);
            const durationSec = typeof j.duration === "number" && j.duration > 0 ? Math.round(j.duration) : undefined;
            const duration = durationSec ? formatDuration(durationSec) : "Audio";
            const thumbnail = j.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined);

            return resolve({
              id: videoId,
              url: j.webpage_url || url,
              title: parsed.title || rawTitle,
              artist: parsed.artist && !isRecordLabelOrLyricChannel(parsed.artist) ? parsed.artist : rawAuthor || "Artis YouTube",
              duration,
              durationSec,
              thumbnail,
            });
          } catch {}
        }
        resolve(null);
      }
    });

    proc.on("error", () => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });
  });
}

// Fast and complete YouTube metadata resolver
export async function getYouTubeMetadata(urlOrVideoId: string, ytdlpPath?: string): Promise<{
  id: string;
  url: string;
  title: string;
  artist: string;
  duration: string;
  durationSec?: number;
  thumbnail?: string;
}> {
  const videoId = extractYouTubeVideoId(urlOrVideoId) || (urlOrVideoId.length === 11 ? urlOrVideoId : null);
  const targetUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : urlOrVideoId;
  const binPath = ytdlpPath || (await getOrDownloadYtDlp());

  // 1. Try fast YouTube oEmbed first (fastest, lightweight, no yt-dlp delay)
  const oembed = await getYouTubeOEmbed(targetUrl);
  if (oembed && videoId) {
    const parsed = parseTitleAndArtist(oembed.title, oembed.author);
    return {
      id: videoId,
      url: targetUrl,
      title: parsed.title,
      artist: parsed.artist || oembed.author || "Artis YouTube",
      duration: "Audio",
      durationSec: undefined,
      thumbnail: oembed.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  }

  // 2. Try yt-dlp second (for exact duration and detailed metadata)
  try {
    const ytdlpMeta = await getYtDlpMetadata(targetUrl, binPath, 4000);
    if (ytdlpMeta) {
      return ytdlpMeta;
    }
  } catch {}

  // 2. Try playdl.video_info
  try {
    const info = await playdl.video_info(targetUrl);
    if (info && info.video_details) {
      const rawTitle = info.video_details.title || "YouTube Audio";
      const rawAuthor = info.video_details.channel?.name || "";
      const parsed = parseTitleAndArtist(rawTitle, rawAuthor);
      const durationSec = info.video_details.durationInSec;
      const duration = info.video_details.durationRaw || formatDuration(durationSec);
      const thumbnail =
        info.video_details.thumbnails?.[0]?.url ||
        (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined);
      return {
        id: videoId || info.video_details.id || "",
        url: targetUrl,
        title: parsed.title,
        artist: parsed.artist && !isRecordLabelOrLyricChannel(parsed.artist) ? parsed.artist : rawAuthor || "Artis YouTube",
        duration,
        durationSec,
        thumbnail,
      };
    }
  } catch {}

  // 3. Fallback to YouTube oEmbed (if not already tried)
  const oembedFallback = await getYouTubeOEmbed(targetUrl);
  if (oembedFallback) {
    const parsed = parseTitleAndArtist(oembedFallback.title, oembedFallback.author);
    return {
      id: videoId || "",
      url: targetUrl,
      title: parsed.title,
      artist: parsed.artist || oembedFallback.author || "Artis YouTube",
      duration: "Audio",
      durationSec: undefined,
      thumbnail: oembedFallback.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined),
    };
  }

  // 4. Fallback to generic data
  return {
    id: videoId || "",
    url: targetUrl,
    title: "YouTube Audio",
    artist: "Artis YouTube",
    duration: "Audio",
    durationSec: undefined,
    thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined,
  };
}

// Extract YouTube Playlist items using yt-dlp flat-playlist mode
export async function getYouTubePlaylist(url: string, ytdlpPath: string, timeoutMs: number = 15000): Promise<{
  title: string;
  thumbnail?: string;
  tracks: Array<{ id: string; title: string; artist: string; durationSec?: number; url: string; thumbnail?: string }>;
} | null> {
  const listMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
  const listId = listMatch ? listMatch[1] : null;
  if (!listId) return null;

  // Mixes (RD...) cannot be extracted cleanly with --flat-playlist
  if (/^RD/i.test(listId)) {
    logger.warn({ listId }, "Skipping flat-playlist for YouTube Mix (dynamic mix)");
    return null;
  }

  // Canonical playlist URL to prevent yt-dlp from getting stuck on &index= or watch?v=
  const cleanPlaylistUrl = `https://www.youtube.com/playlist?list=${listId}`;

  return new Promise((resolve) => {
    let resolved = false;
    const cookieArgs = getYtDlpCookieArgs();
    const commonFlags = getCommonYtDlpFlags();
    const extractorArgs = getYtExtractorArgs(cookieArgs.length > 0);

    const proc = spawn(ytdlpPath, [
      ...commonFlags,
      "--flat-playlist",
      "--dump-single-json",
      "--no-warnings",
      "--playlist-end", "100",
      ...cookieArgs,
      ...extractorArgs,
      cleanPlaylistUrl,
    ]);

    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { proc.kill("SIGKILL"); } catch {}
        resolve(null);
      }
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        if (code === 0 && stdout.trim()) {
          try {
            const data = JSON.parse(stdout.trim());
            const title = data.title || "YouTube Playlist";
            const thumbnail = data.thumbnails?.[0]?.url;
            const entries = (data.entries || []) as any[];

            const tracks = entries
              .filter((e) => e && (e.id || e.url))
              .map((e) => {
                const videoId = e.id || "";
                const videoUrl = e.url && e.url.startsWith("http") ? e.url : (videoId ? `https://www.youtube.com/watch?v=${videoId}` : cleanPlaylistUrl);
                const rawTitle = e.title || "YouTube Audio";
                const rawUploader = e.uploader || e.channel || "Artis YouTube";
                const parsed = parseTitleAndArtist(rawTitle, rawUploader);
                const durationSec = typeof e.duration === "number" && e.duration > 0 ? Math.round(e.duration) : undefined;
                const videoThumb = e.thumbnails?.[e.thumbnails.length - 1]?.url || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined);

                return {
                  id: videoId,
                  title: parsed.title || rawTitle,
                  artist: parsed.artist && !isRecordLabelOrLyricChannel(parsed.artist) ? parsed.artist : rawUploader,
                  durationSec,
                  url: videoUrl,
                  thumbnail: videoThumb,
                };
              });

            if (tracks.length > 0) {
              return resolve({ title, thumbnail, tracks });
            }
          } catch (jsonErr) {
            logger.warn({ jsonErr }, "Failed to parse YouTube playlist JSON from yt-dlp");
          }
        }
        resolve(null);
      }
    });

    proc.on("error", () => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });
  });
}

// Check if YouTube cookies or authentication is present
export function hasYouTubeCookies(): boolean {
  if (getActiveCookies()) return true;
  const bearer = process.env.YOUTUBE_OAUTH_TOKEN || process.env.YT_DLP_OAUTH_TOKEN;
  if (bearer && bearer.trim().length > 10) return true;
  return false;
}

// Helper to check for YouTube cookies (from file or environment variable)
export function getYtDlpCookieArgs(): string[] {
  // Prefer a logged-in env cookie over a stale/guest file; otherwise the
  // persisted file (Railway volume) wins. See getActiveCookies().
  const active = getActiveCookies();
  if (active) {
    if (!active.fromEnv && active.path) {
      return ["--cookies", active.path];
    }

    const tmpCookiePath = path.join(os.tmpdir(), "porsche_chan_youtube_cookies.txt");
    try {
      const normalized = sanitizeNetscapeCookies(
        active.content.includes("\\n")
          ? active.content.replace(/\\n/g, "\n").replace(/\\t/g, "\t")
          : active.content
      );
      fs.writeFileSync(tmpCookiePath, normalized, "utf-8");
      return ["--cookies", tmpCookiePath];
    } catch (err) {
      logger.warn({ err }, "Could not write temporary youtube cookie file");
    }
  }

  // 3. OAuth bearer token support
  const bearer = process.env.YOUTUBE_OAUTH_TOKEN || process.env.YT_DLP_OAUTH_TOKEN;
  if (bearer && bearer.trim()) {
    return ["--add-header", `Authorization: Bearer ${bearer.trim()}`];
  }

  return [];
}

// Save uploaded or pasted cookies and return Base64 for Railway environment variables
// Sanitize Netscape cookies by removing ephemeral tracking ST-* cookies that bloat size from 3KB to 50KB+
export function sanitizeNetscapeCookies(rawCookies: string): string {
  const lines = rawCookies.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('#')) return true;
    const parts = trimmed.split('\t');
    if (parts.length >= 7) {
      const cookieName = parts[5];
      // Strip noisy search/stream click-tracking cookies (ST-*) that bloat size & cause Railway env var errors
      if (cookieName && cookieName.startsWith('ST-')) return false;
    }
    return true;
  });
  return filtered.join('\n');
}

export function saveUploadedCookies(cookieData: string | Buffer): {
  success: boolean;
  base64: string;
  cookiePath: string;
  count: number;
} {
  const content = Buffer.isBuffer(cookieData)
    ? cookieData.toString("utf-8")
    : cookieData;

  let trimmed = content.trim();

  // If user uploaded a .txt file containing base64 encoded cookies, decode it first
  if (!trimmed.includes("\t") && !trimmed.includes("youtube.com") && trimmed.length > 50) {
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf-8");
      if (decoded.includes("youtube.com") || decoded.includes("\t") || decoded.includes("# Netscape")) {
        trimmed = decoded.trim();
      }
    } catch {}
  }

  if (!trimmed.includes("youtube.com") && !trimmed.includes(".youtube.com") && !trimmed.includes("# Netscape")) {
    throw new Error("File cookies tidak valid. Pastikan file berformat Netscape cookies.txt atau file .txt berisi kode base64 cookies yang valid.");
  }

  // Strip noisy ST-* tracking cookies to keep file lightweight and fast
  trimmed = sanitizeNetscapeCookies(trimmed);

  const cookiePath = path.join(process.cwd(), "cookies.txt");
  fs.writeFileSync(cookiePath, trimmed, "utf-8");

  // Persist to a Railway volume (if mounted) so redeploys don't wipe the upload
  for (const dir of getPersistentCookiesDirs()) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "cookies.txt"), trimmed, "utf-8");
    } catch (err) {
      logger.warn({ err, dir }, "Could not persist cookies to volume directory");
    }
  }

  // Also write to tmpdir
  const tmpCookiePath = path.join(os.tmpdir(), "porsche_chan_youtube_cookies.txt");
  try {
    fs.writeFileSync(tmpCookiePath, trimmed, "utf-8");
  } catch {}

  const base64 = Buffer.from(trimmed, "utf-8").toString("base64");
  const count = (trimmed.match(/youtube\.com/g) || []).length;

  return {
    success: true,
    base64,
    cookiePath,
    count,
  };
}

// Inspect the active cookies to tell whether they belong to a logged-in account.
// Guest cookies are usually not enough to bypass YouTube's datacenter bot check.
export function getCookieAuthInfo(): {
  hasCookies: boolean;
  path?: string;
  fromEnv?: boolean;
  loggedIn: boolean;
  cookieCount: number;
} {
  const active = getActiveCookies();
  const content = active?.content || "";

  const cookieCount = (content.match(/youtube\.com/g) || []).length;

  return {
    hasCookies: Boolean(active),
    path: active?.path,
    fromEnv: active?.fromEnv,
    loggedIn: cookieContentLooksLoggedIn(content),
    cookieCount,
  };
}

// Get current cookies status
export function getCookieStatus(): {
  active: boolean;
  source: string;
  detail: string;
} {
  const info = getCookieAuthInfo();
  if (info.hasCookies) {
    return {
      active: true,
      source: info.fromEnv
        ? "Environment Variable (YOUTUBE_COOKIE)"
        : info.path
          ? `cookies.txt (${info.path})`
          : "Environment Variable (YOUTUBE_COOKIE)",
      detail: info.loggedIn
        ? `Login akun terdeteksi (${info.cookieCount} entri YouTube).`
        : `Cookies terpasang (${info.cookieCount} entri) TAPI tidak ada LOGIN_INFO/SAPISID — ini cookies guest, biasanya belum cukup untuk IP Railway. Export ulang cookies saat sudah login YouTube.`,
    };
  }

  const bearer = process.env.YOUTUBE_OAUTH_TOKEN || process.env.YT_DLP_OAUTH_TOKEN;
  if (bearer && bearer.trim().length > 10) {
    return {
      active: true,
      source: "OAuth Token (YOUTUBE_OAUTH_TOKEN)",
      detail: "Bearer token aktif.",
    };
  }

  return {
    active: false,
    source: "Belum Ada",
    detail: "Belum ada cookies atau token yang aktif. Gunakan /cookies untuk memasang.",
  };
}

// Create audio stream from direct URL using FFmpeg to 48kHz stereo raw PCM with seek support
export function createPCMStreamFromUrl(audioUrl: string, seekSeconds: number = 0) {
  const args = [
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ];
  if (seekSeconds > 0) {
    args.push("-ss", seekSeconds.toString());
  }
  args.push("-i", audioUrl, "-f", "s16le", "-ar", "48000", "-ac", "2", "-loglevel", "error", "pipe:1");

  const ffmpeg = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
  ffmpeg.stderr.on("data", (d) => {
    logger.debug({ msg: d.toString() }, "FFmpeg PCM stderr");
  });
  ffmpeg.stdout.on("error", () => {});
  ffmpeg.on("error", (err) => {
    logger.warn({ err }, "FFmpeg PCM stream process error");
  });
  return ffmpeg;
}

// Create AudioResource from a track URL (SoundCloud / direct) with seek support
export async function createAudioResourceFromTrackUrl(trackUrl: string, seekSeconds: number = 0): Promise<any> {
  if (seekSeconds > 0) {
    try {
      const s = await playdl.stream(trackUrl, { seek: seekSeconds });
      if (s?.stream) {
        s.stream.on("error", (err) => logger.warn({ err, trackUrl }, "play-dl stream error (seek)"));
      }
      return createAudioResource(s.stream, { inputType: s.type });
    } catch {
      // Fallback: spawn FFmpeg with -ss to seek into the stream
      const s = await playdl.stream(trackUrl);
      if (s?.stream) {
        s.stream.on("error", (err) => logger.warn({ err, trackUrl }, "play-dl stream error (pipe)"));
      }
      const ffmpeg = spawn(FFMPEG_BIN, [
        "-ss", seekSeconds.toString(),
        "-i", "pipe:0",
        "-ar", "48000",
        "-ac", "2",
        "-f", "s16le",
        "-loglevel", "error",
        "pipe:1",
      ], { stdio: ["pipe", "pipe", "ignore"] });
      ffmpeg.stdin.on("error", () => {});
      ffmpeg.stdout.on("error", () => {});
      s.stream.pipe(ffmpeg.stdin);
      return createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
    }
  } else {
    const s = await playdl.stream(trackUrl);
    if (s?.stream) {
      s.stream.on("error", (err) => logger.warn({ err, trackUrl }, "play-dl stream error"));
    }
    return createAudioResource(s.stream, { inputType: s.type });
  }
}

// Fast extraction of direct audio URL using yt-dlp with timeout protection and optional cookies
async function getDirectAudioUrlWithYtDlp(
  url: string,
  ytdlpPath: string,
  timeoutMs: number = 15000,
  overrideCookieArgs?: string[]
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let resolved = false;
    let directUrl = "";

    const cookieArgs = overrideCookieArgs !== undefined ? overrideCookieArgs : getYtDlpCookieArgs();
    const commonFlags = getCommonYtDlpFlags();
    const procArgs = [
      ...commonFlags,
      ...cookieArgs,
      ...getYtExtractorArgs(cookieArgs.length > 0),
      "-g", "-f", "ba/ba*/18/b/best",
      "--no-playlist",
      "--no-warnings",
      url,
    ];
    const proc = spawn(ytdlpPath, procArgs);

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          proc.kill("SIGKILL");
        } catch {}
        resolve(null);
      }
    }, timeoutMs);

    proc.stdout.on("data", (d) => (directUrl += d.toString()));

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        if (code === 0 && directUrl.trim()) {
          const lines = directUrl.trim().split("\n").map(l => l.trim()).filter(l => l.startsWith("http"));
          if (lines.length > 0) {
            // Pick audio stream if multiple lines
            return resolve(lines[lines.length - 1]);
          }
        }
        resolve(null);
      }
    });

    proc.on("error", () => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });
  });
}

// Terms indicating unofficial versions, covers, live concert, or altered speeds
const UNWANTED_TERMS = [
  "remix", "tik tok", "tiktok", "pop punk", "rock cover", "cover", "slowed",
  "reverb", "sped up", "speed up", "nightcore", "instrumental", "karaoke",
  "amapiano", "hardstyle", "mashup", "parodi", "parody", "guitar cover", "drum cover",
  "fingerstyle", "1 hour", "1hour", "loop", "bass boosted", "bootleg",
  "full album", "compilation", "playlist", "live", "concert", "tour",
  "festival", "fancam", "amv", "reaction", "tutorial", "how to play", "chords"
];

// Precision candidate scoring algorithm to pick the true original song
export function scoreTrackCandidate(
  targetTitle: string,
  targetArtist: string,
  targetDurationSec: number | undefined,
  candidate: any,
  rank: number = 0
): number {
  const cName = (candidate.name || (candidate as any).title || "").toLowerCase();
  const cUser = ((candidate.user?.name || candidate.user?.username || candidate.publisher?.artist || "")).toLowerCase();
  const dur = candidate.durationInSec || Math.round(((candidate as any).durationInMs || 0) / 1000) || candidate.duration || 0;
  const targetLower = `${targetTitle} ${targetArtist}`.toLowerCase();

  // Rule 0a: Discard active live streams (unless user explicitly requested "live" or "radio")
  if ((candidate.isLive || dur === 0) && !targetLower.includes("live") && !targetLower.includes("radio")) {
    return -1000;
  }

  // Rule 0b: Discard extreme outliers (<40s snippets or >900s compilations unless requested)
  if (dur > 0 && (dur < 40 || dur > 900) && !/\b(mix|compilation|loop|1 hour|1hour|full album|extended|mashup)\b/i.test(targetLower)) {
    return -1000;
  }

  // Base score with natural YouTube ranking advantage (higher position from search gets a head start)
  let score = 100 + (rank >= 0 ? Math.max(0, 60 - rank * 15) : 0);

  // 1. Heavy penalty for unwanted keywords with regex word boundaries (avoids false positives on "edition", "discover", etc.)
  for (const junk of UNWANTED_TERMS) {
    const escaped = junk.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i");
    if (!regex.test(targetLower) && regex.test(cName)) {
      score -= 100;
    }
  }

  // 2. Official release title bonuses
  if (/\b(official\s+music\s+video|official\s+video|official\s+audio|official\s+mv|\bmv\b)\b/i.test(cName)) {
    score += 50;
  } else if (/\b(official\s+lyric\s+video|lyric\s+video)\b/i.test(cName)) {
    score += 35;
  } else if (/\b(visualizer|audio)\b/i.test(cName)) {
    score += 20;
  } else if (/\blyrics?\b/i.test(cName)) {
    score += 10;
  }

  // 3. Official Artist Channel / Verified Channel / Topic Channel BONUS
  const isTopic = cUser.endsWith(" - topic") || cUser.endsWith("-topic");
  const isVevo = cUser.includes("vevo");
  if (candidate.isOfficialArtist || isTopic || isVevo) {
    score += 80;
  } else if (candidate.isVerified) {
    score += 40;
  }

  // 4. Keyword matching from target title and artist
  const cleanT = `${targetTitle} ${targetArtist}`.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const tWords = cleanT.split(/\s+/).filter((w) => w.length >= 2 && !/^(the|and|dan|with|feat|ft|official|audio|video|lyrics?)$/i.test(w));
  let matchedWords = 0;
  for (const w of tWords) {
    if (cName.includes(w) || cUser.includes(w)) matchedWords++;
  }
  if (tWords.length > 0) {
    score += Math.round((matchedWords / tWords.length) * 50);
    if (matchedWords === tWords.length) {
      score += 25; // Bonus for 100% keyword match
    }
  }

  // 5. Duration matching with high precision
  if (targetDurationSec && targetDurationSec > 30) {
    const diff = Math.abs(dur - targetDurationSec);
    if (diff <= 6) score += 60;
    else if (diff <= 15) score += 40;
    else if (diff <= 30) score += 20;
    else if (diff > 50) score -= 60;
    else if (diff > 90) score -= 140;
  } else {
    // Standard song duration bonus (approx 1m50s to 6m30s)
    if (dur >= 110 && dur <= 390) {
      score += 20;
    }
  }

  return score;
}

// Search YouTube using yt-dlp with multi-candidate scoring to pick the true original song
export interface YouTubeSearchResult {
  id: string;
  url: string;
  title: string;
  artist: string;
  duration: string;
  durationSec?: number;
  thumbnail?: string;
}

async function searchYouTubeInternal(
  query: string,
  ytdlpPath: string,
  targetTitle?: string,
  targetArtist?: string,
  targetDurationSec?: number
): Promise<YouTubeSearchResult> {
  return new Promise((resolve, reject) => {
    const cookieArgs = getYtDlpCookieArgs();
    const proc = spawn(ytdlpPath, [
      ...getCommonYtDlpFlags(),
      ...cookieArgs,
      ...YT_EXTRACTOR_ARGS,
      "--dump-single-json",
      "--no-warnings",
      "--flat-playlist",
      `ytsearch8:${query}`,
    ]);

    let raw = "";
    proc.stdout.on("data", (d) => (raw += d.toString()));

    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
      reject(new Error(`Timeout saat mencari lagu di YouTube untuk "${query}"`));
    }, 6000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      try {
        const trimmed = raw.trim();
        const json = JSON.parse(trimmed);
        const entries = (json.entries || []) as any[];
        if (!entries || entries.length === 0) {
          return reject(new Error(`Tidak menemukan lagu di YouTube untuk "${query}"`));
        }

        const candidateTargetTitle = targetTitle || cleanTrackTitle(query);
        const candidateTargetArtist = targetArtist || "";

        const scored = entries
          .map((e, index) => ({
            entry: e,
            score: scoreTrackCandidate(candidateTargetTitle, candidateTargetArtist, targetDurationSec, {
              name: e.title,
              user: { name: e.uploader || e.channel },
              durationInSec: e.duration,
              isOfficialArtist: Boolean(e.channel_is_verified || (e.uploader || e.channel || "").endsWith(" - Topic") || (e.uploader || e.channel || "").toLowerCase().includes("vevo")),
              isVerified: Boolean(e.channel_is_verified),
              isLive: Boolean(e.is_live || e.live_status === "is_live"),
            }, index),
          }))
          .sort((a, b) => b.score - a.score);

        const best = scored[0].entry;
        const rawTitle = best.title || query;
        const rawUploader = best.uploader || best.channel || "";
        const parsed = parseTitleAndArtist(rawTitle, rawUploader);
        const durSec = best.duration ? Math.round(best.duration) : undefined;
        const durStr = durSec ? formatDuration(durSec) : "3:30";
        const videoId = best.id;
        const videoUrl = best.url && best.url.startsWith("http")
          ? best.url
          : `https://www.youtube.com/watch?v=${videoId}`;

        const thumb =
          best.thumbnails && best.thumbnails.length > 0
            ? best.thumbnails[best.thumbnails.length - 1].url
            : videoId
            ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
            : undefined;

        resolve({
          id: videoId,
          url: videoUrl,
          title: parsed.title || rawTitle,
          artist: parsed.artist && !isRecordLabelOrLyricChannel(parsed.artist) ? parsed.artist : rawUploader || "Artis YouTube",
          duration: durStr,
          durationSec: durSec,
          thumbnail: thumb,
        });
      } catch (err) {
        reject(new Error(`Gagal memproses data lagu dari YouTube untuk "${query}"`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Fast, direct HTML scraper for YouTube search results (executes in <1s, 100% genuine YouTube, avoids bot-check and Python startup overhead)
async function searchYouTubeViaDirectScrape(
  query: string,
  targetTitle?: string,
  targetArtist?: string,
  targetDurationSec?: number
): Promise<YouTubeSearchResult | null> {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    let jsonStr: string | null = null;
    const match = text.match(/(?:window\[['"]ytInitialData['"]\]|ytInitialData)\s*=\s*({.+?});\s*(?:<\/script>|var\s+)/);
    if (match) {
      jsonStr = match[1];
    } else {
      const altMatch = text.match(/ytInitialData\s*=\s*({.+?});/);
      if (altMatch) jsonStr = altMatch[1];
    }
    if (!jsonStr) return null;

    const data = JSON.parse(jsonStr);
    const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    const entries: any[] = [];
    for (const s of sections) {
      const items = s.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const v = item.videoRenderer;
        if (v && v.videoId) {
          const rawTitle = v.title?.runs?.[0]?.text || "";
          const rawAuthor = v.ownerText?.runs?.[0]?.text || "";
          const durText = v.lengthText?.simpleText || "";
          const durSec = durText ? parseDurationToSec(durText) : undefined;
          const badgeText = (v.ownerBadges?.[0]?.metadataBadgeRenderer?.tooltip || "").toLowerCase();
          const badgeStyle = (v.ownerBadges?.[0]?.metadataBadgeRenderer?.style || "").toLowerCase();
          const isOfficialArtist = badgeText.includes("artis") || badgeText.includes("artist") || badgeStyle.includes("artist");
          const isVerified = badgeText.includes("verified") || badgeText.includes("terverifikasi") || badgeStyle.includes("verified");
          const isLive = v.badges?.some((b: any) =>
            b.metadataBadgeRenderer?.style === "BADGE_STYLE_TYPE_LIVE_NOW" ||
            (b.metadataBadgeRenderer?.label || "").toLowerCase().includes("live")
          ) || false;
          const thumb = v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

          entries.push({
            id: v.videoId,
            title: rawTitle,
            uploader: rawAuthor,
            duration: durSec,
            durationRaw: durText ? durText.replace(".", ":") : "Audio",
            thumbnail: thumb,
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            isOfficialArtist,
            isVerified,
            isLive,
          });
          if (entries.length >= 10) break;
        }
      }
      if (entries.length >= 10) break;
    }

    if (entries.length === 0) return null;

    const candidateTargetTitle = targetTitle || cleanTrackTitle(query);
    const candidateTargetArtist = targetArtist || "";

    const scored = entries
      .map((e, index) => ({
        entry: e,
        score: scoreTrackCandidate(candidateTargetTitle, candidateTargetArtist, targetDurationSec, {
          name: e.title,
          user: { name: e.uploader },
          durationInSec: e.duration,
          isOfficialArtist: e.isOfficialArtist,
          isVerified: e.isVerified,
          isLive: e.isLive,
        }, index),
      }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0].entry;
    const parsed = parseTitleAndArtist(best.title, best.uploader);

    logger.info({ id: best.id, title: best.title }, "Found YouTube track via direct fast search");
    return {
      id: best.id,
      url: best.url,
      title: parsed.title || best.title,
      artist: parsed.artist && !isRecordLabelOrLyricChannel(parsed.artist) ? parsed.artist : best.uploader || "Artis YouTube",
      duration: best.durationRaw || (best.duration ? formatDuration(best.duration) : "3:30"),
      durationSec: best.duration,
      thumbnail: best.thumbnail,
    };
  } catch (err) {
    logger.debug({ err }, "Direct YouTube search scrape error");
    return null;
  }
}

export async function searchYouTubeWithYtDlp(
  query: string,
  ytdlpPath: string,
  targetTitle?: string,
  targetArtist?: string,
  targetDurationSec?: number
): Promise<YouTubeSearchResult> {
  // 1. Primary: Direct Fast YouTube Scrape (<1s, pure YouTube, high precision, no bot checks)
  try {
    const directResult = await searchYouTubeViaDirectScrape(query, targetTitle, targetArtist, targetDurationSec);
    if (directResult) {
      return directResult;
    }
  } catch (err) {
    logger.debug({ err }, "Direct YouTube fast search failed, trying yt-dlp internal search");
  }

  // 2. Secondary: yt-dlp internal search
  try {
    return await searchYouTubeInternal(query, ytdlpPath, targetTitle, targetArtist, targetDurationSec);
  } catch (err) {
    logger.warn({ err, query }, "yt-dlp search failed or timed out, trying play-dl search fallback");
    try {
      const searchResults = await playdl.search(query, { limit: 8 });
      if (searchResults && searchResults.length > 0) {
        const candidateTargetTitle = targetTitle || cleanTrackTitle(query);
        const candidateTargetArtist = targetArtist || "";

        const scored = searchResults
          .map((item, index) => {
            const rawTitle = item.title || query;
            const rawUploader = item.channel?.name || "";
            const isTopic = rawUploader.endsWith(" - Topic") || rawUploader.endsWith("-Topic");
            const isVevo = rawUploader.toLowerCase().includes("vevo");
            return {
              item,
              score: scoreTrackCandidate(candidateTargetTitle, candidateTargetArtist, targetDurationSec, {
                name: rawTitle,
                user: { name: rawUploader },
                durationInSec: item.durationInSec,
                isOfficialArtist: Boolean(isTopic || isVevo),
                isVerified: false,
                isLive: item.live || false,
              }, index),
            };
          })
          .sort((a, b) => b.score - a.score);

        const best = scored[0].item;
        const rawTitle = best.title || query;
        const rawUploader = best.channel?.name || "";
        const parsed = parseTitleAndArtist(rawTitle, rawUploader);
        const durSec = best.durationInSec || 210;
        return {
          id: best.id || "",
          url: best.url,
          title: parsed.title || rawTitle,
          artist: parsed.artist && !isRecordLabelOrLyricChannel(parsed.artist) ? parsed.artist : rawUploader || "Artis YouTube",
          duration: formatDuration(durSec),
          durationSec: durSec,
          thumbnail: best.thumbnails?.[0]?.url,
        };
      }
    } catch (fallbackErr) {
      logger.error({ fallbackErr }, "play-dl search fallback also failed");
    }

    if (ENABLE_SOUNDCLOUD) {
      // Tertiary fallback: search SoundCloud directly
      try {
        const scClientId = await playdl.getFreeClientID();
        await playdl.setToken({ soundcloud: { client_id: scClientId } });
        const scResults = await playdl.search(query, { source: { soundcloud: "tracks" }, limit: 5 });
        if (scResults && scResults.length > 0) {
          const scoredSc = scResults
            .map((scTrack: any, idx: number) => ({
              scTrack,
              score: scoreTrackCandidate(query, "", targetDurationSec, {
                name: scTrack.name || scTrack.title,
                user: { name: scTrack.user?.name || scTrack.artist },
                durationInSec: scTrack.durationInSec,
              }, idx),
            }))
            .filter(s => s.score >= 120)
            .sort((a, b) => b.score - a.score);

          if (scoredSc.length > 0) {
            const bestSc: any = scoredSc[0].scTrack;
            logger.info({ title: bestSc.name || bestSc.title, score: scoredSc[0].score }, "Found verified track via SoundCloud search fallback");
            return {
              id: String(bestSc.id || ""),
              url: bestSc.url,
              title: bestSc.name || bestSc.title || query,
              artist: bestSc.user?.name || bestSc.artist || "SoundCloud Artist",
              duration: bestSc.durationRaw || formatDuration(bestSc.durationInSec) || "3:30",
              durationSec: bestSc.durationInSec,
              thumbnail: bestSc.thumbnail || bestSc.thumbnails?.[0]?.url,
            };
          }
        }
      } catch (scSearchErr) {
        logger.warn({ scSearchErr }, "SoundCloud search fallback failed");
      }
    }

    throw err;
  }
}

// Helper for validating piped yt-dlp -> ffmpeg stream with fast failover
function tryPipedStream(
  ytdlpPath: string,
  ytdlpArgs: string[],
  seekSeconds: number,
  timeoutMs: number = 15000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    let ytdlp: any;
    let ffmpeg: any;

    let ytdlpStderr = "";
    let ffmpegStderr = "";
    let ytdlpExitCode: number | null = null;
    let ffmpegExitCode: number | null = null;
    let timer: NodeJS.Timeout | null = null;

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        if (ytdlp && !ytdlp.killed) ytdlp.kill("SIGKILL");
      } catch {}
      try {
        if (ffmpeg && !ffmpeg.killed) ffmpeg.kill("SIGKILL");
      } catch {}
    };

    // Everything a failure report needs, captured at the moment of failure.
    const buildDiagnostics = (stage: TierFailureDiagnostics["stage"]) => ({
      stage,
      elapsedMs: Date.now() - startedAt,
      ytdlpExitCode,
      ffmpegExitCode,
      ytdlpStderr: cleanProcessStderr(ytdlpStderr),
      ffmpegStderr: cleanProcessStderr(ffmpegStderr),
    });

    const fail = (stage: TierFailureDiagnostics["stage"], message: string, cause?: any) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cleanup();
      const error: any = cause instanceof Error ? cause : new Error(message);
      if (!error.message || error.message === "undefined") error.message = message;
      error.diagnostics = buildDiagnostics(stage);
      reject(error);
    };

    try {
      ytdlp = spawn(ytdlpPath, ytdlpArgs, { stdio: ["ignore", "pipe", "pipe"] });
      ytdlp.stderr.on("data", (d: Buffer) => {
        ytdlpStderr = (ytdlpStderr + d.toString()).slice(-4000);
      });

      // FFmpeg arguments optimized for raw pipe streaming (no seek flags on pipe:0)
      const ffmpegArgs: string[] = [
        "-analyzeduration", "5000000",
        "-probesize", "65536",
        "-fflags", "+igndts",
        "-flags", "low_delay",
        "-loglevel", "error",
        "-i", "pipe:0",
        "-f", "s16le",
        "-ar", "48000",
        "-ac", "2",
        "pipe:1"
      ];
      ffmpeg = spawn(FFMPEG_BIN, ffmpegArgs, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (spawnErr: any) {
      return fail("spawn", `Gagal menjalankan proses stream: ${spawnErr?.message || spawnErr}`, spawnErr);
    }

    // Catch EPIPE on stdout/stdin to prevent backpressure crashes
    ytdlp.stdout.on("error", (err: any) => {
      if (err?.code !== "EPIPE") {
        logger.warn({ err }, "yt-dlp stdout error");
      }
    });
    ffmpeg.stdin.on("error", (err: any) => {
      if (err?.code !== "EPIPE") {
        logger.warn({ err }, "ffmpeg stdin error");
      }
    });
    ffmpeg.stdout.on("error", (err: any) => {
      if (err?.code !== "EPIPE") {
        logger.warn({ err }, "ffmpeg stdout error");
      }
    });

    ffmpeg.stderr.on("data", (d: Buffer) => {
      ffmpegStderr = (ffmpegStderr + d.toString()).slice(-4000);
    });
    ffmpeg.stderr.on("error", () => {});

    // Pipe yt-dlp stdout into ffmpeg. End ffmpeg's stdin when yt-dlp finishes so
    // FFmpeg flushes the tail of the track and the player advances the queue.
    ytdlp.stdout.pipe(ffmpeg.stdin);

    const getErrorDetail = () => {
      const ytErr = summarizeYtdlpError(ytdlpStderr);
      const ffErr = cleanProcessStderr(ffmpegStderr, 2);
      const parts: string[] = [];
      if (ytdlpExitCode !== null) parts.push(`yt-dlp exit ${ytdlpExitCode}`);
      if (ffmpegExitCode !== null) parts.push(`ffmpeg exit ${ffmpegExitCode}`);
      if (ytErr) parts.push(`yt-dlp: ${ytErr}`);
      if (ffErr) parts.push(`ffmpeg: ${ffErr}`);
      return parts.join(" — ").slice(0, 700) || "stream berhenti tanpa detail error";
    };

    timer = setTimeout(() => {
      fail("timeout", `Piped audio stream timeout (${timeoutMs}ms) — tidak ada data audio dari YouTube`);
    }, timeoutMs);

    ytdlp.on("error", (err: any) => {
      if (!settled) {
        fail("spawn", `yt-dlp gagal dijalankan: ${err?.message || err}`, err);
      } else {
        cleanup();
      }
    });

    ffmpeg.on("error", (err: any) => {
      if (!settled) {
        fail("spawn", `FFmpeg gagal dijalankan: ${err?.message || err}`, err);
      } else {
        cleanup();
      }
    });

    ytdlp.on("close", (code: number) => {
      ytdlpExitCode = code;
      if (!settled && code !== 0) {
        const summary = summarizeYtdlpError(ytdlpStderr);
        fail("yt-dlp", `yt-dlp exited with error code ${code}${summary ? `: ${summary}` : ""}`);
      }
    });

    ffmpeg.on("close", (code: number) => {
      ffmpegExitCode = code;
      if (!settled && code !== 0) {
        const summary = cleanProcessStderr(ffmpegStderr, 2);
        fail("ffmpeg", `FFmpeg exited with error code ${code}${summary ? `: ${summary}` : ""}`);
      } else if (settled) {
        cleanup();
      }
    });

    const onData = (chunk: Buffer) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        ffmpeg.stdout.removeListener("data", onData);
        const pt = new PassThrough();
        pt.write(chunk);
        ffmpeg.stdout.pipe(pt);

        pt.on("close", cleanup);
        pt.on("end", cleanup);
        pt.on("error", cleanup);
        pt.on("finish", cleanup);

        const resource = createAudioResource(pt, { inputType: StreamType.Raw });
        (resource as any)._cleanupProcesses = cleanup;
        (resource as any)._getErrorDetail = getErrorDetail;
        (resource as any)._diagnostics = buildDiagnostics("unknown");
        resolve(resource);
      }
    };
    ffmpeg.stdout.on("data", onData);
  });
}

// Helper for validating direct HTTPS stream piped through FFmpeg with fast failover
function tryPipedUrlStream(
  audioUrl: string,
  seekSeconds: number,
  timeoutMs: number = 12000
): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ffmpeg: any;
    let ffmpegStderr = "";

    try {
      const args = [
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "3",
        "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ];
      if (seekSeconds > 0) {
        args.push("-ss", seekSeconds.toString());
      }
      args.push("-i", audioUrl, "-f", "s16le", "-ar", "48000", "-ac", "2", "-loglevel", "error", "pipe:1");
      ffmpeg = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (spawnErr) {
      return reject(spawnErr);
    }

    ffmpeg.stderr?.on("data", (d: Buffer) => {
      ffmpegStderr = (ffmpegStderr + d.toString()).slice(-2000);
    });
    ffmpeg.stderr?.on("error", () => {});
    ffmpeg.stdout.on("error", () => {});

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ffmpeg.kill("SIGKILL"); } catch {}
        reject(new Error("Direct URL stream timeout / HTTP 403"));
      }
    }, timeoutMs);

    ffmpeg.on("error", (err: any) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    ffmpeg.on("close", (code: number | null, signal: string | null) => {
      if (!settled && code !== 0) {
        settled = true;
        clearTimeout(timer);
        const detail = cleanProcessStderr(ffmpegStderr, 2) || (signal ? `signal ${signal}` : `exit code ${code}`);
        reject(new Error(`FFmpeg exited: ${detail}`));
      }
    });

    const onData = (chunk: Buffer) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        ffmpeg.stdout.removeListener("data", onData);
        const pt = new PassThrough();
        pt.write(chunk);
        ffmpeg.stdout.pipe(pt);

        const cleanup = () => {
          try { ffmpeg.kill("SIGKILL"); } catch {}
        };
        pt.on("close", cleanup);
        pt.on("end", cleanup);
        pt.on("error", cleanup);

        const resource = createAudioResource(pt, { inputType: StreamType.Raw });
        (resource as any)._cleanupProcesses = cleanup;
        resolve(resource);
      }
    };
    ffmpeg.stdout.on("data", onData);
  });
}

/**
 * Streams audio from an HTTP/HTTPS URL by fetching it directly in Node.js and piping
 * the raw bytes into FFmpeg stdin.
 *
 * Why this is essential for datacenter deployments (e.g. Railway):
 * 1. Node.js native fetch handles modern TLS, certificates, redirects, and browser
 *    headers seamlessly across all environments.
 * 2. It rejects before wasting resources if the stream redirects to `googlevideo.com`
 *    (which datacenter IPs cannot stream without cookies).
 * 3. FFmpeg only decodes audio from stdin without touching the network, avoiding
 *    FFmpeg HTTPS timeouts, TLS failures, and SIGPIPE / null exit codes.
 * 4. Stderr is captured so any decoding error is reported with rich detail.
 */
export function tryPipedFetchStream(
  audioUrl: string,
  seekSeconds: number = 0,
  timeoutMs: number = 15000,
  options?: { disallowGooglevideo?: boolean; referer?: string }
): Promise<any> {
  return new Promise(async (resolve, reject) => {
    let settled = false;
    let ffmpeg: any = null;
    const abortController = new AbortController();
    let ffmpegStderr = "";
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      try {
        abortController.abort();
      } catch {}
      try {
        if (ffmpeg && !ffmpeg.killed) ffmpeg.kill("SIGKILL");
      } catch {}
    };

    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Piped fetch stream timeout (${timeoutMs}ms)`));
      }
    }, timeoutMs);

    try {
      let referer = options?.referer;
      if (!referer) {
        try {
          referer = new URL(audioUrl).origin;
        } catch {}
      }

      const fetchRes = await fetch(audioUrl, {
        signal: abortController.signal,
        redirect: "follow",
        headers: {
          "user-agent": MIRROR_USER_AGENT,
          accept: "*/*",
          "accept-encoding": "identity",
          ...(referer ? { referer } : {}),
        },
      });

      if (!fetchRes.ok) {
        throw new Error(`HTTP ${fetchRes.status} ${fetchRes.statusText}`);
      }

      const finalHost = new URL(fetchRes.url || audioUrl).hostname.toLowerCase();
      if (options?.disallowGooglevideo && finalHost.endsWith("googlevideo.com")) {
        throw new Error("stream redirected to googlevideo.com (datacenter IP blocked)");
      }

      if (!fetchRes.body) {
        throw new Error("stream response has no body");
      }

      const args = [];
      if (seekSeconds > 0) {
        args.push("-ss", seekSeconds.toString());
      }
      args.push("-i", "pipe:0", "-f", "s16le", "-ar", "48000", "-ac", "2", "-loglevel", "error", "pipe:1");

      ffmpeg = spawn(FFMPEG_BIN, args, { stdio: ["pipe", "pipe", "pipe"] });

      ffmpeg.stdin.on("error", (err: any) => {
        if (err?.code !== "EPIPE") logger.debug({ err }, "FFmpeg stdin error");
      });
      ffmpeg.stdout.on("error", (err: any) => {
        if (err?.code !== "EPIPE") logger.debug({ err }, "FFmpeg stdout error");
      });
      ffmpeg.stderr.on("data", (d: Buffer) => {
        ffmpegStderr = (ffmpegStderr + d.toString()).slice(-2000);
      });
      ffmpeg.stderr.on("error", () => {});

      ffmpeg.on("error", (err: any) => {
        if (!settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          cleanup();
          reject(err);
        }
      });

      ffmpeg.on("close", (code: number | null, signal: string | null) => {
        if (!settled && code !== 0) {
          settled = true;
          if (timer) clearTimeout(timer);
          cleanup();
          const detail = cleanProcessStderr(ffmpegStderr, 2) || (signal ? `signal ${signal}` : `exit code ${code}`);
          reject(new Error(`FFmpeg exited: ${detail}`));
        }
      });

      const nodeStream = Readable.fromWeb(fetchRes.body as any);
      nodeStream.on("error", (err: any) => {
        if (!settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          cleanup();
          reject(new Error(`Stream read error: ${err?.message || err}`));
        }
      });
      nodeStream.pipe(ffmpeg.stdin);

      const onData = (chunk: Buffer) => {
        if (!settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          ffmpeg.stdout.removeListener("data", onData);

          const pt = new PassThrough();
          pt.write(chunk);
          ffmpeg.stdout.pipe(pt);

          pt.on("close", cleanup);
          pt.on("end", cleanup);
          pt.on("error", cleanup);

          const resource = createAudioResource(pt, { inputType: StreamType.Raw });
          (resource as any)._cleanupProcesses = cleanup;
          resolve(resource);
        }
      };
      ffmpeg.stdout.on("data", onData);
    } catch (err: any) {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        cleanup();
        reject(err);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Public mirror fallback (no YouTube cookies required)
//
// Datacenter IPs (Railway, VPS) are routinely flagged by YouTube's bot-check,
// which no PO token can bypass. Public Invidious/Piped instances do the
// extraction from their own IPs and proxy the audio bytes, so the bot only has
// to talk to the mirror. This is the last-resort tier: when cookies are present
// the normal yt-dlp path usually wins and this tier is never reached.
// ---------------------------------------------------------------------------

type MirrorInstance = { kind: "invidious" | "piped"; base: string };

const DEFAULT_MIRROR_INSTANCES: MirrorInstance[] = [
  { kind: "invidious", base: "https://yt.chocolatemoo53.com" },
  { kind: "invidious", base: "https://inv.nadeko.net" },
  { kind: "invidious", base: "https://invidious.nerdvpn.de" },
  { kind: "invidious", base: "https://yewtu.be" },
  { kind: "piped", base: "https://pipedapi.kavin.rocks" },
  { kind: "piped", base: "https://api.piped.private.coffee" },
];

const MIRROR_WINNER_TTL_MS = 10 * 60 * 1000;
let mirrorWinner: { instance: MirrorInstance; at: number } | null = null;

function normalizeMirrorBase(raw: string): MirrorInstance {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const base = trimmed.replace(/\/api\/v1$/i, "");
  const kind: MirrorInstance["kind"] = /\/api\/v1$/i.test(trimmed) || /invidious/i.test(base)
    ? "invidious"
    : "piped";
  return { kind, base };
}

function getMirrorInstances(): MirrorInstance[] {
  const custom = (process.env.YOUTUBE_MIRROR_API || process.env.INVIDIOUS_INSTANCE || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const list = custom.length
    ? custom.map(normalizeMirrorBase)
    : [...DEFAULT_MIRROR_INSTANCES];

  // Try the instance that worked last time first, but keep the rest as backup.
  if (mirrorWinner && Date.now() - mirrorWinner.at < MIRROR_WINNER_TTL_MS) {
    const winnerBase = mirrorWinner.instance.base;
    return [
      mirrorWinner.instance,
      ...list.filter((entry) => entry.base !== winnerBase),
    ];
  }

  return list;
}

function getMirrorTimeoutMs(): number {
  const raw = Number(process.env.YOUTUBE_MIRROR_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 1000 ? Math.min(raw, 20_000) : 10_000;
}

async function fetchMirrorJson(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export type MirrorAudioCandidate = {
  url: string;
  source: string;
  detail: string;
  bitrate: number;
};

const MIRROR_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Audio itags that Invidious' `/latest_version` endpoint can redirect to.
// This endpoint often works when the URL returned by `/api/v1/videos` is
// already expired or rejected with 403 by the mirror's proxy.
const INVIDIOUS_AUDIO_ITAGS = ["140", "251", "250", "139", "249"];

function absoluteMirrorUrl(raw: string, base: string): string {
  try {
    return new URL(raw, base).toString();
  } catch {
    return raw;
  }
}

function buildInvidiousLatestVersionCandidates(
  instance: MirrorInstance,
  videoId: string
): { url: string; detail: string; bitrate: number }[] {
  return INVIDIOUS_AUDIO_ITAGS.slice(0, 3).map((itag) => ({
    url: `${instance.base}/latest_version?id=${videoId}&itag=${itag}`,
    detail: `latest_version itag ${itag}`,
    bitrate: 0,
  }));
}

async function resolveMirrorAudioFromInstance(
  instance: MirrorInstance,
  videoId: string,
  timeoutMs: number
): Promise<{ url: string; detail: string; bitrate: number }[]> {
  if (instance.kind === "invidious") {
    // `local=true` makes Invidious proxy the audio through its own host, which
    // is the whole point: Railway never talks to googlevideo directly.
    const json = await fetchMirrorJson(`${instance.base}/api/v1/videos/${videoId}?local=true`, timeoutMs);
    const formats = Array.isArray(json?.adaptiveFormats) ? json.adaptiveFormats : [];
    const apiFormats = formats
      .filter((format: any) => format?.url && /audio/i.test(String(format?.type || "")))
      .sort((a: any, b: any) => (Number(b?.bitrate) || 0) - (Number(a?.bitrate) || 0))
      .slice(0, 3)
      .map((format: any) => ({
        url: absoluteMirrorUrl(String(format.url), instance.base),
        detail: String(format.type || "audio"),
        bitrate: Number(format.bitrate) || 0,
      }));

    if (apiFormats.length) return apiFormats;
    // Fallback only if no proxied adaptiveFormats were returned
    return buildInvidiousLatestVersionCandidates(instance, videoId);
  }

  const json = await fetchMirrorJson(`${instance.base}/streams/${videoId}`, timeoutMs);
  const streams = Array.isArray(json?.audioStreams) ? json.audioStreams : [];
  return streams
    .filter((stream: any) => stream?.url)
    .sort((a: any, b: any) => (Number(b?.bitrate) || 0) - (Number(a?.bitrate) || 0))
    .slice(0, 3)
    .map((stream: any) => ({
      url: absoluteMirrorUrl(String(stream.url), instance.base),
      detail: String(stream.mimeType || "audio"),
      bitrate: Number(stream.bitrate) || 0,
    }));
}

/**
 * Quick reachability check for a mirror candidate. Follows redirects and reads
 * one small chunk, so Tier 8 only spends FFmpeg startup time on URLs that
 * actually answer with audio.
 */
export async function validateMirrorCandidate(
  candidate: MirrorAudioCandidate,
  timeoutMs: number = 8_000
): Promise<MirrorAudioCandidate & { finalUrl: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(candidate.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": MIRROR_USER_AGENT,
        accept: "*/*",
        range: "bytes=0-1023",
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const finalUrl = res.url || candidate.url;
    let finalHost = "";
    try {
      finalHost = new URL(finalUrl).hostname.toLowerCase();
    } catch {}

    if (finalHost.endsWith("googlevideo.com")) {
      throw new Error("redirected to googlevideo.com (datacenter IP blocked)");
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType && !/^(audio|video|application\/octet-stream)/.test(contentType)) {
      throw new Error(`content-type ${contentType.slice(0, 40)}`);
    }

    const reader = res.body?.getReader();
    if (reader) {
      await reader.read().catch(() => {});
      await reader.cancel().catch(() => {});
    }

    return {
      ...candidate,
      finalUrl: res.url || candidate.url,
      contentType: contentType || "unknown",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask every public mirror for playable audio URLs and return all candidates.
 *
 * Returning every format matters: one mirror can hand out several audio
 * formats, and the highest-bitrate URL is not always the one that actually
 * streams (expired signature, range rejection, blocked datacenter IP). Tier 8
 * tries them one by one instead of giving up after the first URL.
 */
export async function resolveMirrorAudioCandidates(
  videoId: string,
  timeoutMs: number = getMirrorTimeoutMs()
): Promise<MirrorAudioCandidate[]> {
  const instances = getMirrorInstances().slice(0, 8);
  if (!instances.length) return [];

  const attempts = await Promise.allSettled(
    instances.map(async (instance) => ({
      instance,
      found: await resolveMirrorAudioFromInstance(instance, videoId, timeoutMs),
    }))
  );

  const candidates: MirrorAudioCandidate[] = [];
  const seen = new Set<string>();

  for (const attempt of attempts) {
    if (attempt.status !== "fulfilled") continue;
    const { instance, found } = attempt.value;
    if (!found.length) continue;

    // Remember the first instance that returned audio so the next /play tries
    // it first (getMirrorInstances puts the winner at the front).
    if (!mirrorWinner || mirrorWinner.instance.base !== instance.base) {
      mirrorWinner = { instance, at: Date.now() };
    }

    for (const format of found) {
      if (seen.has(format.url)) continue;
      seen.add(format.url);
      candidates.push({ ...format, source: instance.base });
    }
  }

  return candidates;
}

/** Backwards-compatible helper: first playable mirror candidate, if any. */
export async function resolveMirrorAudioUrl(
  videoId: string,
  timeoutMs: number = getMirrorTimeoutMs()
): Promise<MirrorAudioCandidate | null> {
  const candidates = await resolveMirrorAudioCandidates(videoId, timeoutMs);
  return candidates[0] ?? null;
}

/**
 * End-to-end mirror probe for `/check`: resolves candidates and verifies that
 * at least one of them answers with audio from the current host (Railway).
 */
export async function probeMirrorForDiagnostics(videoId: string): Promise<{
  ok: boolean;
  candidates: number;
  valid: number;
  detail: string;
}> {
  const started = Date.now();
  try {
    const candidates = await resolveMirrorAudioCandidates(videoId);
    if (!candidates.length) {
      return {
        ok: false,
        candidates: 0,
        valid: 0,
        detail: `API mirror tidak mengembalikan audio (${Date.now() - started}ms)`,
      };
    }

    const probes = await Promise.allSettled(
      candidates.slice(0, 6).map((candidate) => validateMirrorCandidate(candidate))
    );
    const valid = probes.filter((probe) => probe.status === "fulfilled").length;
    const hosts = [
      ...new Set(
        candidates.map((candidate) => {
          try {
            return new URL(candidate.url).host;
          } catch {
            return candidate.source;
          }
        })
      ),
    ];

    return {
      ok: valid > 0,
      candidates: candidates.length,
      valid,
      detail: `${valid}/${candidates.length} kandidat valid • ${hosts.join(", ")} • ${Date.now() - started}ms`,
    };
  } catch (err: any) {
    return {
      ok: false,
      candidates: 0,
      valid: 0,
      detail: String(err?.message || err).slice(0, 200),
    };
  }
}

// Create AudioResource from YouTube with robust multi-tier live piped streaming architecture and auto-retry
export async function createAudioResourceFromYtDlp(
  urlOrQuery: string,
  seekSeconds: number = 0,
  ytdlpPath: string,
  fallbackSearchQuery?: string,
  mode: PlaybackMode = "auto"
): Promise<any> {
  const cookieArgs = getYtDlpCookieArgs();
  const cookieAuth = getCookieAuthInfo();
  const cookiesLoggedIn = cookieAuth.loggedIn;
  const commonFlags = getCommonYtDlpFlags();
  const videoId = extractYouTubeVideoId(urlOrQuery);
  const targetUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : urlOrQuery;

  logger.info(
    {
      mode,
      videoId: videoId || undefined,
      cookies: cookieAuth.hasCookies
        ? `${cookiesLoggedIn ? "login" : "guest"}(${cookieAuth.cookieCount})`
        : "none",
      cookieSource: cookieAuth.fromEnv ? "env" : cookieAuth.path ? "file" : "none",
    },
    `Playback start (mode=${mode})`
  );

  // Format priority: best audio, then format 18 (360p MP4+AAC), then best
  const fmtSelector = "ba/ba*/18/b/best";

  // Helper: build pipe args for a given set of extra flags
  const buildPipeArgs = (extraArgs: string[], useCookies = true) => [
    ...commonFlags,
    ...(useCookies ? cookieArgs : []),
    ...(FFMPEG_BIN ? ["--ffmpeg-location", FFMPEG_BIN] : []),
    ...(seekSeconds > 0 ? ["--download-sections", `*${seekSeconds}-inf`] : []),
    ...extraArgs,
    // Retry transient googlevideo 403/timeouts instead of dying mid-track
    "--retries", "5",
    "--fragment-retries", "5",
    "--extractor-retries", "2",
    "--socket-timeout", "15",
    "-q",
    "--no-warnings",
    "--no-progress",
    "-o", "-",
    "-f", fmtSelector,
    "--no-playlist",
    targetUrl,
  ];

  // Player-client tiers tuned for yt-dlp 2026.x ("tv_embedded" was removed upstream).
  // Android clients are placed first as they do NOT trigger the web-based "Sign in to confirm you're not a bot"
  // challenge on datacenter IPs (like Railway).
  const streamTiers: Array<{ clients: string; timeoutMs: number }> = cookieArgs.length > 0
    ? [
        { clients: "android,android_vr", timeoutMs: 20000 },
        { clients: "default", timeoutMs: 22000 },
        { clients: "android,web_embedded", timeoutMs: 18000 },
        { clients: "web_embedded", timeoutMs: 15000 },
        { clients: "tv_simply", timeoutMs: 15000 },
        { clients: "visionos,tv_downgraded", timeoutMs: 15000 },
      ]
    : [
        { clients: "android,android_vr", timeoutMs: 20000 },
        { clients: "android,web_embedded", timeoutMs: 18000 },
        { clients: "visionos,tv_downgraded", timeoutMs: 18000 },
        { clients: "web_embedded", timeoutMs: 15000 },
        { clients: "tv_simply", timeoutMs: 15000 },
        { clients: "default", timeoutMs: 22000 },
      ];

  const tierErrors: string[] = [];
  const tierFailures: TierFailureDiagnostics[] = [];
  let botCheckDetected = false;

  const tryMirrorStream = async (attempt: number): Promise<any> => {
    if (!videoId) {
      throw new Error("Mode mirror hanya tersedia untuk video YouTube.");
    }

    logger.info({ tier: 8, attempt }, "Attempting stream via public mirror fallback...");
    try {
      const candidates = await resolveMirrorAudioCandidates(videoId);
      if (!candidates.length) throw new Error("semua mirror publik menolak / tidak punya audio");

      // Validate candidates in parallel before paying FFmpeg startup cost.
      const probes = await Promise.allSettled(
        candidates.slice(0, 6).map((candidate) => validateMirrorCandidate(candidate))
      );

      const valid: Array<MirrorAudioCandidate & { finalUrl: string; contentType: string }> = [];
      const probeErrors: string[] = [];
      for (let index = 0; index < probes.length; index++) {
        const probe = probes[index];
        if (probe.status === "fulfilled") {
          valid.push(probe.value);
        } else {
          const candidate = candidates[index];
          let host = candidate.source;
          try {
            host = new URL(candidate.url).host;
          } catch {}
          probeErrors.push(`${host} [${candidate.detail}]: ${String(probe.reason?.message || probe.reason).slice(0, 100)}`);
        }
      }

      if (!valid.length) {
        throw new Error(`semua kandidat mirror tidak bisa diakses — ${probeErrors.join(" | ")}`);
      }

      const streamErrors: string[] = [];
      for (const candidate of valid) {
        let mirrorHost = candidate.source;
        try {
          mirrorHost = new URL(candidate.finalUrl).host;
        } catch {}

        try {
          const resource = await tryPipedFetchStream(candidate.finalUrl, seekSeconds, 15_000, {
            disallowGooglevideo: true,
            referer: candidate.source,
          });
          (resource as any)._tier = `tier 8 (mirror: ${mirrorHost})`;
          logger.info(
            {
              tier: 8,
              source: candidate.source,
              host: mirrorHost,
              detail: candidate.detail,
              contentType: candidate.contentType,
              bitrate: candidate.bitrate,
            },
            "Stream started successfully via public mirror"
          );
          return resource;
        } catch (streamErr: any) {
          const streamMsg = String(streamErr?.message || streamErr);
          streamErrors.push(`${mirrorHost} [${candidate.detail}]: ${streamMsg.slice(0, 100)}`);
          logger.warn(
            { tier: 8, source: candidate.source, host: mirrorHost, err: streamMsg },
            "Mirror candidate failed to stream, trying next candidate"
          );
        }
      }

      throw new Error(`semua kandidat mirror gagal stream — ${streamErrors.join(" | ")}`);
    } catch (err: any) {
      const rawMsg = String(err?.message || err);
      tierErrors.push(`T8 public-mirror: ${rawMsg}`);
      tierFailures.push({
        attempt,
        tier: 8,
        clients: "public-mirror",
        cookies: cookieArgs.length > 0,
        elapsedMs: 0,
        stage: "unknown",
        reason: rawMsg.slice(0, 500),
      });
      logger.warn({ tier: 8, attempt, err: rawMsg }, `Public mirror fallback failed: [${rawMsg}]`);
      const wrapped = new Error(rawMsg);
      (wrapped as any).botCheck = false;
      throw wrapped;
    }
  };

  const tryYtDlpStream = async (attempt: number): Promise<any> => {
    logger.info({ attempt, targetUrl }, `Attempting YouTube stream (Percobaan ${attempt}/2)...`);

    for (let i = 0; i < streamTiers.length; i++) {
      const tier = streamTiers[i];
      const useCookies = cookieArgs.length > 0;
      try {
        logger.info(
          { tier: i + 1, clients: tier.clients, cookies: useCookies },
          `Starting yt-dlp stream tier ${i + 1}: ${tier.clients}`
        );
        const resource = await tryPipedStream(
          ytdlpPath,
          buildPipeArgs(getYtExtractorArgs(useCookies, tier.clients), useCookies),
          seekSeconds,
          tier.timeoutMs
        );
        (resource as any)._tier = `tier ${i + 1} (${tier.clients})`;
        logger.info({ tier: i + 1, clients: tier.clients }, `Stream started successfully on tier ${i + 1}`);
        return resource;
      } catch (err: any) {
        const rawMsg = String(err?.message || err);
        if (/sign in to confirm|not a bot|confirm you(?:'|’)?re not a bot/i.test(rawMsg)) {
          botCheckDetected = true;
        }
        const diag = err?.diagnostics || {};
        tierFailures.push({
          attempt,
          tier: i + 1,
          clients: tier.clients,
          cookies: useCookies,
          elapsedMs: Number(diag.elapsedMs) || 0,
          stage: diag.stage || "unknown",
          ytdlpExitCode: diag.ytdlpExitCode ?? null,
          ffmpegExitCode: diag.ffmpegExitCode ?? null,
          ytdlpStderr: diag.ytdlpStderr || "",
          ffmpegStderr: diag.ffmpegStderr || "",
          reason: rawMsg.slice(0, 500),
        });
        const msg = `T${i + 1} ${tier.clients}: ${rawMsg}`;
        tierErrors.push(msg);
        logger.warn(
          { tier: i + 1, clients: tier.clients, stage: diag.stage, err: rawMsg },
          `Stream tier ${i + 1} failed: [${rawMsg}]`
        );

        // Bot-check is IP-level, not client-level: when the first (android)
        // tier already hits it, the remaining yt-dlp clients hit the same
        // wall. Stop burning ~10s and jump straight to the mirror fallback.
        if (botCheckDetected) {
          logger.warn(
            { tier: i + 1, clients: tier.clients },
            "Bot-check detected — skipping remaining yt-dlp clients"
          );
          break;
        }
      }
    }

    // After a bot-check, T6/T7 are guaranteed to fail too: T6 is yt-dlp
    // again and T7 (play-dl) throws an unhandled 429. Fail fast so the
    // orchestrator can jump straight to the mirror strategy.
    if (botCheckDetected) {
      const botError: any = new Error("YouTube bot-check terdeteksi — melewati T6/T7");
      botError.botCheck = true;
      throw botError;
    }

    // Tier 6: Direct URL extraction -> FFmpeg
    try {
      logger.info({ tier: 6 }, "Starting yt-dlp with client: direct_url");
      const directUrl = await getDirectAudioUrlWithYtDlp(targetUrl, ytdlpPath, 12000, cookieArgs);
      if (directUrl) {
        const resource = await tryPipedUrlStream(directUrl, seekSeconds, 12000);
        logger.info({ tier: 6 }, "Stream started successfully via direct URL pipe");
        return resource;
      }
      const noUrlMsg = "yt-dlp tidak mengembalikan URL audio (null)";
      tierErrors.push(`T6 direct-url: ${noUrlMsg}`);
      tierFailures.push({
        attempt,
        tier: 6,
        clients: "direct-url",
        cookies: cookieArgs.length > 0,
        elapsedMs: 0,
        stage: "unknown",
        reason: noUrlMsg,
      });
      logger.warn({ tier: 6 }, `Stream failed: [${noUrlMsg}]`);
    } catch (err: any) {
      const rawMsg = String(err?.message || err);
      tierErrors.push(`T6 direct-url: ${rawMsg}`);
      tierFailures.push({
        attempt,
        tier: 6,
        clients: "direct-url",
        cookies: cookieArgs.length > 0,
        elapsedMs: 0,
        stage: "unknown",
        reason: rawMsg.slice(0, 500),
      });
      logger.warn({ tier: 6, err: rawMsg }, `Stream failed: [${rawMsg}]`);
    }

    // Tier 7: play-dl streaming fallback (works without yt-dlp).
    try {
      logger.info({ tier: 7 }, "Attempting stream via play-dl fallback...");
      const resource = await createAudioResourceFromTrackUrl(targetUrl, seekSeconds);
      if (resource) {
        logger.info({ tier: 7 }, "Stream started successfully via play-dl fallback");
        return resource;
      }
    } catch (err: any) {
        const rawMsg = String(err?.message || err);
        tierErrors.push(`T7 play-dl: ${rawMsg}`);
        tierFailures.push({
          attempt,
          tier: 7,
          clients: "play-dl",
          cookies: cookieArgs.length > 0,
          elapsedMs: 0,
          stage: "unknown",
          reason: rawMsg.slice(0, 500),
        });
        logger.warn({ tier: 7, err: rawMsg }, `play-dl stream fallback failed: [${rawMsg}]`);
      }

    const detail = tierErrors.slice(-4).join(" | ");
    const streamError = new Error(`Semua tier streaming yt-dlp gagal memuat audio.${detail ? ` (${detail})` : ""}`);
    (streamError as any).botCheck = botCheckDetected;
    throw streamError;
  };

  const runYtDlp = async (): Promise<any> => {
    try {
      return await tryYtDlpStream(1);
    } catch (err1: any) {
      if (err1?.botCheck) throw err1;
      logger.warn({ err: err1?.message }, "yt-dlp stream failed. Retrying in 2 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return await tryYtDlpStream(2);
    }
  };

  const runMirror = async (): Promise<any> => {
    try {
      return await tryMirrorStream(1);
    } catch (err1: any) {
      logger.warn({ err: err1?.message }, "Mirror stream failed. Retrying once...");
      return await tryMirrorStream(2);
    }
  };

  // "auto" picks whichever route is most likely to work right now: verified
  // login cookies -> yt-dlp first; otherwise the mirror first, because a
  // datacenter IP will almost certainly hit YouTube's bot-check.
  const strategies: Array<{ name: "yt-dlp" | "mirror"; run: () => Promise<any> }> =
    mode === "mirror"
      ? [{ name: "mirror", run: runMirror }]
      : mode === "ytdlp"
        ? [{ name: "yt-dlp", run: runYtDlp }]
        : cookiesLoggedIn
          ? [
              { name: "yt-dlp", run: runYtDlp },
              { name: "mirror", run: runMirror },
            ]
          : [
              { name: "mirror", run: runMirror },
              { name: "yt-dlp", run: runYtDlp },
            ];

  let lastError: any;
  for (const strategy of strategies) {
    try {
      logger.info(
        { mode, strategy: strategy.name, cookiesLoggedIn },
        `Trying playback strategy: ${strategy.name}`
      );
      return await strategy.run();
    } catch (err: any) {
      lastError = err;
      logger.warn(
        { mode, strategy: strategy.name, botCheck: Boolean(err?.botCheck), err: err?.message },
        `Playback strategy ${strategy.name} failed`
      );
    }
  }

  {
    const err2 = lastError;
    const isBotCheck =
      Boolean(err2?.botCheck) ||
      /sign in to confirm|not a bot|confirm you(?:'|’)?re not a bot/i.test(String(err2?.message || ""));

    // One structured block for the logs, one compact block for the user.
    const diagnostic = await buildYtFailureReport({
      url: targetUrl,
      videoId: videoId || undefined,
      seekSeconds,
      attempts: strategies.length,
      botCheck: isBotCheck,
      tiers: streamTiers,
      failures: tierFailures,
      ytdlpPath,
    });

    lastYtFailure = {
      at: new Date().toISOString(),
      videoId: videoId || undefined,
      url: targetUrl,
      report: diagnostic.full,
    };

    logger.error(
      `YouTube playback failed — diagnostic report\n${diagnostic.full}\n` +
        `Semua strategi gagal (mode=${mode}). Detail singkat: ${String(err2?.message || err2).slice(0, 300)}`
    );

    const head = isBotCheck
      ? "YouTube memblokir IP server ini dengan verifikasi login (\"Sign in to confirm you're not a bot\"). " +
        "PO Token saja tidak cukup untuk IP datacenter seperti Railway, dan fallback mirror publik juga belum berhasil. " +
        "Upload cookies akun YouTube lewat `/cookies` (sekali saja) atau set env `YOUTUBE_COOKIE`, lalu coba `/play` lagi. " +
        "Kalau mirror biasanya berhasil, coba `/play` dengan opsi `mode: mirror`."
      : `Gagal memutar audio dari YouTube (mode=${mode}). YouTube memblokir IP server (403) atau provider PO Token tidak aktif. Jalankan \`/check\` untuk diagnosa.`;

    const error: any = new Error(
      `${head}\n\n${diagnostic.short}\n\n` +
      "Salin blok [YT-FAIL] di atas (atau jalankan `/check` untuk file diagnosa lengkap)."
    );
    error.botCheck = isBotCheck;
    error.report = diagnostic.full;
    error.shortReport = diagnostic.short;
    throw error;
  }
}

// Main Track Resolver: handles YouTube, YouTube Music, Spotify, SoundCloud, and Text Query (Prioritizing User Links)
// Resolve single track or full playlist/album (YouTube, Spotify, SoundCloud, or text search)
export async function resolveMusic(
  input: string,
  requester: { name: string; id: string },
  options?: { forcePlaylist?: boolean; mode?: PlaybackMode }
): Promise<ResolvedMusicResult> {
  const cleanInput = input.trim();
  const ytdlpPath = await getOrDownloadYtDlp();

  // 0. SOUNDCLOUD PLAYLIST / SET
  if (cleanInput.includes("soundcloud.com") && cleanInput.includes("/sets/")) {
    if (!ENABLE_SOUNDCLOUD) {
      throw new Error("❌ Dukungan SoundCloud sedang dinonaktifkan sementara. Silakan gunakan link YouTube, YouTube Music, atau Spotify ya~ (◡ ω ◡)");
    }
    try {
      const scInfo: any = await playdl.soundcloud(cleanInput);
      if (scInfo && scInfo.tracks && Array.isArray(scInfo.tracks) && scInfo.tracks.length > 0) {
        const tracks: TrackMetadata[] = scInfo.tracks.slice(0, 100).map((st: any) => ({
          title: st.name || st.title || "SoundCloud Track",
          artist: st.user?.name || st.artist || "SoundCloud Artist",
          duration: st.durationRaw || (st.durationInSec ? formatDuration(st.durationInSec) : "Audio"),
          durationSec: st.durationInSec,
          url: st.url || cleanInput,
          thumbnail: st.thumbnail || scInfo.thumbnail,
          source: "soundcloud" as MusicSource,
          sourceBadge: "🟠 SoundCloud Set",
          sourceColor: 0xff5500,
          requesterName: requester.name,
          requesterId: requester.id,
          rawTrackUrl: st.url || cleanInput,
          createStream: async (seekSeconds: number = 0) => {
            return createAudioResourceFromTrackUrl(st.url || cleanInput, seekSeconds);
          },
        }));

        return {
          isPlaylist: true,
          playlistTitle: scInfo.name || scInfo.title || "SoundCloud Playlist",
          playlistUrl: cleanInput,
          playlistThumbnail: scInfo.thumbnail,
          playlistCount: tracks.length,
          tracks,
        };
      }
    } catch (scErr) {
      logger.warn({ scErr }, "SoundCloud playlist resolution failed");
    }
  }

  // 1. SOUNDCLOUD DIRECT TRACK
  if (cleanInput.includes("soundcloud.com")) {
    if (!ENABLE_SOUNDCLOUD) {
      throw new Error("❌ Dukungan SoundCloud sedang dinonaktifkan sementara. Silakan gunakan link YouTube, YouTube Music, atau Spotify ya~ (◡ ω ◡)");
    }
    try {
      const scInfo: any = await playdl.soundcloud(cleanInput);
      if (scInfo && (scInfo.name || scInfo.title)) {
        return {
          isPlaylist: false,
          tracks: [
            {
              title: scInfo.name || scInfo.title || "SoundCloud Track",
              artist: scInfo.user?.name || scInfo.artist || "SoundCloud Artist",
              duration: scInfo.durationRaw || formatDuration(scInfo.durationInSec) || "Audio",
              durationSec: scInfo.durationInSec,
              url: cleanInput,
              thumbnail: scInfo.thumbnail || scInfo.thumbnails?.[0]?.url,
              source: "soundcloud",
              sourceBadge: "🟠 SoundCloud",
              sourceColor: 0xff5500,
              requesterName: requester.name,
              requesterId: requester.id,
              rawTrackUrl: cleanInput,
              createStream: async (seekSeconds: number = 0) => {
                return createAudioResourceFromTrackUrl(cleanInput, seekSeconds);
              },
            },
          ],
        };
      }
    } catch (scErr) {
      logger.warn({ scErr }, "SoundCloud direct link resolution failed");
    }
  }

  // 2. SPOTIFY PLAYLIST / ALBUM
  if (cleanInput.includes("spotify.com") && (cleanInput.includes("/playlist/") || cleanInput.includes("/album/"))) {
    const spPlaylist = await getSpotifyPlaylistOrAlbum(cleanInput);
    if (spPlaylist && spPlaylist.tracks.length > 0) {
      const isAlbum = spPlaylist.type === "album";
      const tracks: TrackMetadata[] = spPlaylist.tracks.map((t) => {
        const query = `${t.title} ${t.artist}`.trim();
        return {
          title: t.title,
          artist: t.artist || "Spotify Artist",
          duration: t.durationSec ? formatDuration(t.durationSec) : "3:30",
          durationSec: t.durationSec,
          url: t.url,
          thumbnail: spPlaylist.thumbnail,
          source: "spotify" as MusicSource,
          sourceBadge: isAlbum ? "💿 Spotify Album" : "🟢 Spotify Playlist",
          sourceColor: 0x1ed760,
          requesterName: requester.name,
          requesterId: requester.id,
          rawTrackUrl: t.url,
          createStream: async (seekSeconds: number = 0) => {
            const ytMatch = await searchYouTubeWithYtDlp(query, ytdlpPath, t.title, t.artist, t.durationSec);
            return createAudioResourceFromYtDlp(ytMatch.url, seekSeconds, ytdlpPath, query, options?.mode);
          },
        };
      });

      return {
        isPlaylist: true,
        playlistTitle: spPlaylist.title,
        playlistUrl: cleanInput,
        playlistThumbnail: spPlaylist.thumbnail,
        playlistCount: tracks.length,
        tracks,
      };
    }
  }

  // 3. SPOTIFY SINGLE TRACK
  if (cleanInput.includes("spotify.com")) {
    const spInfo = await getSpotifyTrackInfo(cleanInput);
    const title = spInfo?.title || "Spotify Track";
    const artist = spInfo?.artist || "";
    const durationSec = spInfo?.durationSec;
    const thumbnail = spInfo?.thumbnail;
    const query = `${title} ${artist}`.trim();

    const ytMatch = await searchYouTubeWithYtDlp(query, ytdlpPath, title, artist, durationSec);

    return {
      isPlaylist: false,
      tracks: [
        {
          title,
          artist: artist || ytMatch.artist,
          duration: durationSec ? formatDuration(durationSec) : ytMatch.duration,
          durationSec: durationSec || ytMatch.durationSec,
          url: cleanInput,
          thumbnail: thumbnail || ytMatch.thumbnail,
          source: "spotify",
          sourceBadge: "🟢 Spotify",
          sourceColor: 0x1ed760,
          requesterName: requester.name,
          requesterId: requester.id,
          rawTrackUrl: ytMatch.url,
          createStream: async (seekSeconds: number = 0) => {
            return createAudioResourceFromYtDlp(ytMatch.url, seekSeconds, ytdlpPath, query, options?.mode);
          },
        },
      ],
    };
  }

  // 4. YOUTUBE & YOUTUBE MUSIC (Differentiating Single Video vs Playlist)
  const isYouTube = /^(?:https?:\/\/)?(?:www\.|music\.)?(?:youtube\.com|youtu\.be)\//i.test(cleanInput);
  if (isYouTube) {
    const videoId = extractYouTubeVideoId(cleanInput);
    const listMatch = cleanInput.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
    const listId = listMatch ? listMatch[1] : null;
    const isMix = listId ? /^RD/i.test(listId) : false;
    const isPurePlaylistUrl = cleanInput.includes("/playlist?") || (!videoId && Boolean(listId));

    // Determine whether to play as a playlist:
    // - Pure playlist URL (e.g. /playlist?list=PL...) is ALWAYS a playlist.
    // - Video URL with playlist param (watch?v=...&list=PL...):
    //   If it's a Mix (RD...), YouTube mixes CANNOT be loaded as flat-playlists; always play single track.
    //   If it's a normal playlist (PL...), only load as playlist if forcePlaylist === true.
    //   Otherwise, play that single track cleanly with zero delay and add tip to embed.
    const shouldPlayAsPlaylist = isPurePlaylistUrl || (Boolean(listId) && !isMix && options?.forcePlaylist === true);

    if (shouldPlayAsPlaylist && listId) {
      const canonicalPlaylistUrl = `https://www.youtube.com/playlist?list=${listId}`;
      logger.info({ listId, canonicalPlaylistUrl }, "Resolving YouTube playlist");
      const ytPlaylist = await getYouTubePlaylist(canonicalPlaylistUrl, ytdlpPath);

      if (ytPlaylist && ytPlaylist.tracks.length > 0) {
        const isYtMusic = cleanInput.includes("music.youtube.com");
        const tracks: TrackMetadata[] = ytPlaylist.tracks.map((t) => ({
          title: t.title,
          artist: t.artist,
          duration: t.durationSec ? formatDuration(t.durationSec) : "Audio",
          durationSec: t.durationSec,
          url: t.url,
          thumbnail: t.thumbnail || (t.id ? `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg` : ytPlaylist.thumbnail),
          source: (isYtMusic ? "youtube_music" : "youtube") as MusicSource,
          sourceBadge: isYtMusic ? "🎵 YouTube Music Playlist" : "🔴 YouTube Playlist",
          sourceColor: isYtMusic ? 0xff2a54 : 0xff4655,
          requesterName: requester.name,
          requesterId: requester.id,
          rawTrackUrl: t.url,
          createStream: async (seekSeconds: number = 0) => {
            return createAudioResourceFromYtDlp(t.url, seekSeconds, ytdlpPath, `${t.title} ${t.artist}`, options?.mode);
          },
        }));

        return {
          isPlaylist: true,
          playlistTitle: ytPlaylist.title,
          playlistUrl: canonicalPlaylistUrl,
          playlistThumbnail: ytPlaylist.thumbnail || tracks[0]?.thumbnail,
          playlistCount: tracks.length,
          tracks,
        };
      } else if (isPurePlaylistUrl) {
        throw new Error("Playlist YouTube tidak dapat diakses (mungkin bersifat privat, kosong, atau dihapus).");
      }
      logger.warn({ listId }, "Playlist resolution failed or empty, falling back to single video");
    }

    // Single YouTube / YouTube Music Track
    if (videoId) {
      const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const ytMeta = await getYouTubeMetadata(canonicalUrl, ytdlpPath);
      const isYtMusic = cleanInput.includes("music.youtube.com");
      const hasPlaylist = Boolean(listId && !isMix);

      return {
        isPlaylist: false,
        tracks: [
          {
            title: ytMeta.title,
            artist: ytMeta.artist,
            duration: ytMeta.duration,
            durationSec: ytMeta.durationSec,
            url: canonicalUrl,
            thumbnail: ytMeta.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            source: isYtMusic ? "youtube_music" : "youtube",
            sourceBadge: isYtMusic ? "🎵 YouTube Music" : "🔴 YouTube",
            sourceColor: isYtMusic ? 0xff2a54 : 0xff4655,
            requesterName: requester.name,
            requesterId: requester.id,
            rawTrackUrl: canonicalUrl,
            hasPlaylistParam: hasPlaylist,
            createStream: async (seekSeconds: number = 0) => {
              return createAudioResourceFromYtDlp(canonicalUrl, seekSeconds, ytdlpPath, `${ytMeta.title} ${ytMeta.artist}`, options?.mode);
            },
          },
        ],
      };
    }
  }

  // 7. TEXT SEARCH WITH YOUTUBE CANDIDATE SCORING
  const ytMatch = await searchYouTubeWithYtDlp(cleanInput, ytdlpPath);

  return {
    isPlaylist: false,
    tracks: [
      {
        title: ytMatch.title,
        artist: ytMatch.artist,
        duration: ytMatch.duration,
        durationSec: ytMatch.durationSec,
        url: ytMatch.url,
        thumbnail: ytMatch.thumbnail,
        source: ytMatch.url.includes("soundcloud.com") ? "soundcloud" : "youtube",
        sourceBadge: ytMatch.url.includes("soundcloud.com") ? "🟠 SoundCloud" : "🔴 YouTube",
        sourceColor: ytMatch.url.includes("soundcloud.com") ? 0xff5500 : 0xff4655,
        requesterName: requester.name,
        requesterId: requester.id,
        rawTrackUrl: ytMatch.url,
        createStream: async (seekSeconds: number = 0) => {
          if (ytMatch.url.includes("soundcloud.com")) {
            return createAudioResourceFromTrackUrl(ytMatch.url, seekSeconds);
          }
          return createAudioResourceFromYtDlp(ytMatch.url, seekSeconds, ytdlpPath, `${ytMatch.title} ${ytMatch.artist}`, options?.mode);
        },
      },
    ],
  };
}

// Backward-compatible helper to resolve a single track
export async function resolveMusicTrack(
  input: string,
  requester: { name: string; id: string }
): Promise<TrackMetadata> {
  const result = await resolveMusic(input, requester);
  if (!result.tracks || result.tracks.length === 0) {
    throw new Error("Tidak menemukan lagu dari sumber tersebut.");
  }
  return result.tracks[0];
}

// Aesthetic Now Playing & Queue Embed Builder
export function buildNowPlayingEmbed(
  track: TrackMetadata,
  isQueue: boolean = false,
  currentPosSec: number = 0
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(track.sourceColor || 0xff4655)
    .setAuthor({
      name: isQueue ? "📋 Ditambahkan ke Antrean Musik ✨" : "🎶 Sekarang Memutar Musik ✨",
    })
    .setTitle(track.title ? (track.title.length > 250 ? track.title.substring(0, 247) + "..." : track.title) : "Musik")
    .setURL(track.url);

  const durationStr = track.duration?.trim() ? track.duration : "Audio";
  const artistStr = track.artist?.trim() ? track.artist : "Artis Musik";
  const requesterStr = track.requesterName || "Sahabat Porsche-chan";
  const platformStr = track.sourceBadge || "Audio";

  const totalSec = track.durationSec || 0;
  const progressBar = buildProgressBar(currentPosSec, totalSec, 14);
  const progressLine = !isQueue
    ? "\n\n`" + formatDuration(currentPosSec) + "` " + progressBar + " `" + durationStr + "`"
    : "";

  embed.setDescription(
    "> 👤 **Artis:** `" + artistStr + "`\n" +
    "> ⏱️ **Durasi:** `" + durationStr + "`\n" +
    "> 🌐 **Platform:** " + platformStr + "\n" +
    "> 🙋 **Diminta Oleh:** " + requesterStr +
    progressLine
  );

  if (track.thumbnail) {
    embed.setThumbnail(track.thumbnail);
  }

  const footerText = track.hasPlaylistParam
    ? "💡 Link ini berisi playlist! Gunakan opsi playlist: True di /play untuk memutar semua."
    : "Porsche-chan Music Engine • 48kHz Hi-Fi Stereo";

  embed
    .setFooter({ text: footerText })
    .setTimestamp();

  return embed;
}

// Build Aesthetic Playlist Embed (Now Playing or Queued)
export function buildPlaylistEmbed(
  result: ResolvedMusicResult,
  requesterName: string,
  isQueue: boolean = false
): EmbedBuilder {
  const firstTrack = result.tracks[0];
  const color = firstTrack?.sourceColor || 0xa78bfa;
  const rawTitle = (result.playlistTitle || "Playlist Musik").trim();
  const title = rawTitle.length > 250 ? rawTitle.substring(0, 247) + "..." : rawTitle;
  const url = result.playlistUrl || firstTrack?.url || "https://music.youtube.com";

  const firstTrackTitle = firstTrack?.title
    ? (firstTrack.title.length > 60 ? firstTrack.title.substring(0, 57) + "..." : firstTrack.title)
    : "Lagu";

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: isQueue ? "📋 Playlist Ditambahkan ke Antrean ✨" : "🎶 Memutar Playlist Musik ✨",
    })
    .setTitle(title)
    .setURL(url)
    .setDescription(
      "> 📊 **Total Lagu:** `" + result.tracks.length + " lagu`\n" +
      "> 🌐 **Platform:** " + (firstTrack?.sourceBadge || "Playlist") + "\n" +
      "> 🙋 **Diminta Oleh:** " + (requesterName || "Sahabat Porsche-chan") + "\n\n" +
      "**" + (isQueue ? "🎵 Lagu Pertama di Antrean:" : "▶️ Sedang Memutar (#1):") + "**\n" +
      "[" + firstTrackTitle + "](" + firstTrack.url + ")\n" +
      "`👤 " + (firstTrack.artist || "Unknown") + "` • `⏱️ " + (firstTrack.duration || "Audio") + "`"
    );

  if (result.tracks.length > 1) {
    const previewCount = Math.min(5, result.tracks.length - 1);
    const previewList = result.tracks
      .slice(1, 1 + previewCount)
      .map((t, idx) => {
        const shortT = t.title.length > 55 ? t.title.substring(0, 52) + "..." : t.title;
        const shortA = (t.artist || "Unknown").length > 30 ? (t.artist || "Unknown").substring(0, 27) + "..." : (t.artist || "Unknown");
        return "` " + (idx + 2) + " ` [" + shortT + "](" + t.url + ")\n　　└ `" + shortA + "` • `" + (t.duration || "Audio") + "`";
      })
      .join("\n");
    const remaining = result.tracks.length - (1 + previewCount);
    const extra = remaining > 0 ? "\n\n*...dan `" + remaining + "` lagu lainnya di antrean.*" : "";

    embed.addFields([
      {
        name: "📋 Lagu Berikutnya di Antrean",
        value: previewList + extra,
        inline: false,
      },
    ]);
  }

  const thumb = result.playlistThumbnail || firstTrack?.thumbnail;
  if (thumb) {
    embed.setThumbnail(thumb);
  }

  embed
    .setFooter({ text: "Porsche-chan Music Engine • Putar Playlist Otomatis Tanpa Jeda" })
    .setTimestamp();

  return embed;
}

// Helper to generate visual progress bar for Now Playing
export function buildProgressBar(currentSec: number, totalSec: number, length: number = 14): string {
  if (!totalSec || totalSec <= 0) return "🔘" + "▬".repeat(Math.max(1, length - 1));
  const progress = Math.min(1, Math.max(0, currentSec / totalSec));
  const progressIndex = Math.min(length - 1, Math.max(0, Math.round(progress * (length - 1))));
  const left = "▬".repeat(progressIndex);
  const right = "▬".repeat(length - 1 - progressIndex);
  return left + "🔘" + right;
}

// Interactive Music Playback Buttons: [ ⏪ -10s ] [ ⏸️ Jeda / ▶️ Lanjut ] [ ⏩ +10s ] [ ⏭️ Skip ] [ ⏹️ Berhenti ]
export function buildMusicControlRow(isPaused: boolean = false, disabled: boolean = false): ActionRowBuilder<ButtonBuilder> {
  const rewindBtn = new ButtonBuilder()
    .setCustomId("music_rewind_10")
    .setLabel("-10s")
    .setEmoji("⏪")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);

  const pauseResumeBtn = new ButtonBuilder()
    .setCustomId("music_pause_resume")
    .setLabel(isPaused ? "Lanjut" : "Jeda")
    .setEmoji(isPaused ? "▶️" : "⏸️")
    .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary)
    .setDisabled(disabled);

  const forwardBtn = new ButtonBuilder()
    .setCustomId("music_forward_10")
    .setLabel("+10s")
    .setEmoji("⏩")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);

  const skipBtn = new ButtonBuilder()
    .setCustomId("music_skip")
    .setLabel("Skip")
    .setEmoji("⏭️")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);

  const stopBtn = new ButtonBuilder()
    .setCustomId("music_stop")
    .setLabel("Berhenti")
    .setEmoji("⏹️")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(rewindBtn, pauseResumeBtn, forwardBtn, skipBtn, stopBtn);
}


export function buildMusicComponents(session: GuildSession): ActionRowBuilder<any>[] {
  const controlRow = buildMusicControlRow(session.isPaused, false);
  const rows: ActionRowBuilder<any>[] = [controlRow];

  if (session.queue.length > 0) {
    const page = session.queuePage || 0;
    const maxItems = 25;
    const totalPages = Math.ceil(session.queue.length / maxItems);
    // ensure page is valid
    const currentPage = Math.min(Math.max(0, page), Math.max(0, totalPages - 1));
    if (session.queuePage !== currentPage) session.queuePage = currentPage;

    const actionRow = new ActionRowBuilder<ButtonBuilder>();

    const shuffleBtn = new ButtonBuilder()
      .setCustomId("music_shuffle")
      .setLabel("Acak Antrean")
      .setEmoji("🔀")
      .setStyle(ButtonStyle.Primary);
    actionRow.addComponents(shuffleBtn);

    if (totalPages > 1) {
      const prevBtn = new ButtonBuilder()
        .setCustomId("music_queue_prev")
        .setLabel("Prev")
        .setEmoji("⬅️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0);
      
      const nextBtn = new ButtonBuilder()
        .setCustomId("music_queue_next")
        .setLabel("Next")
        .setEmoji("➡️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1);

      actionRow.addComponents(prevBtn, nextBtn);
    }
      
    rows.push(actionRow);

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("music_jump")
      .setPlaceholder(totalPages > 1 ? `Pilih lagu... (Hal. ${currentPage + 1}/${totalPages})` : "Pilih lagu untuk diputar selanjutnya...");

    const startIndex = currentPage * maxItems;
    const endIndex = Math.min(startIndex + maxItems, session.queue.length);
    
    for (let i = startIndex; i < endIndex; i++) {
      const track = session.queue[i];
      const titleStr = track.title || "Lagu";
      const title = titleStr.length > 50 ? titleStr.substring(0, 47) + "..." : titleStr;
      const artistStr = track.artist || "Unknown";
      const artist = artistStr.length > 50 ? artistStr.substring(0, 47) + "..." : artistStr;
      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(`${i + 1}. ${title}`)
          .setDescription(artist)
          .setValue(`jump_${i}`)
      );
    }
    
    const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
    rows.push(menuRow);
  }

  const ownerId = session.panelOwnerId || session.currentTrack?.requesterId;
  if (ownerId) {
    rows.push(buildCloseRow(ownerId, "music"));
  }

  return rows;
}

// Build Aesthetic Music Queue Embed
export function buildQueueEmbed(session: GuildSession): EmbedBuilder {
  const current = session.currentTrack;
  const embed = new EmbedBuilder()
    .setColor(current?.sourceColor || 0xa78bfa)
    .setAuthor({ name: "📋 ANTREAN MUSIK PORSCHE-CHAN" })
    .setTitle("Daftar Putar Musik Server")
    .setFooter({ text: "Total Antrean: " + session.queue.length + " lagu • Porsche-chan Music Engine" })
    .setTimestamp();

  if (current) {
    const elapsed = session.currentResource ? Math.floor(session.currentResource.playbackDuration / 1000) : 0;
    const currentPos = Math.max(0, (session.seekOffsetSec || 0) + elapsed);
    const totalSec = current.durationSec || 0;
    const bar = buildProgressBar(currentPos, totalSec, 14);

    embed.setDescription(
      "**▶️ Sedang Diputar:**\n" +
      "[" + current.title + "](" + current.url + ")\n" +
      "> 👤 `" + (current.artist || "Unknown") + "` • ⏱️ `" + (current.duration || "Audio") + "` • 🌐 " + current.sourceBadge + "\n" +
      "> 🙋 Diminta oleh: **" + (current.requesterName || "Sahabat") + "**\n\n" +
      "`" + formatDuration(currentPos) + "` " + bar + " `" + (current.duration || "0:00") + "`"
    );
    if (current.thumbnail) {
      embed.setThumbnail(current.thumbnail);
    }
  } else {
    embed.setDescription("*(Tidak ada lagu yang sedang diputar saat ini)*");
  }

  if (session.queue.length > 0) {
    const previewCount = Math.min(8, session.queue.length);
    const list = session.queue
      .slice(0, previewCount)
      .map((t, idx) => {
        const shortT = t.title.length > 55 ? t.title.substring(0, 52) + "..." : t.title;
        const shortA = (t.artist || "Unknown").length > 30 ? (t.artist || "Unknown").substring(0, 27) + "..." : (t.artist || "Unknown");
        return "` " + (idx + 1) + " ` [" + shortT + "](" + t.url + ")\n　　└ `" + shortA + "` • `" + (t.duration || "Audio") + "` • Diminta: **" + (t.requesterName || "Sahabat") + "**";
      })
      .join("\n");
    const remaining = session.queue.length - previewCount;
    const extra = remaining > 0 ? "\n\n*...dan `" + remaining + "` lagu lainnya di antrean.*" : "";
    embed.addFields([{ name: "⏳ Lagu Berikutnya di Antrean", value: list + extra, inline: false }]);
  } else {
    embed.addFields([{ name: "⏳ Antrean Berikutnya", value: "*Antrean kosong. Ketik `/play` untuk menambah lagu!*", inline: false }]);
  }

  return embed;
}

// Music Player Session Management
export class MusicService {
  public static getSession(guildId: string): GuildSession | undefined {
    return sessions.get(guildId);
  }

  public static async deletePreviewMessage(session?: GuildSession | null): Promise<void> {
    if (!session || !session.previewMessage) return;
    try {
      await session.previewMessage.delete().catch(() => {});
    } catch {}
    session.previewMessage = null;
  }

  /**
   * Tell the user WHY playback died instead of silently deleting the preview.
   * When `replacePreview` is false the message is sent separately (a new track
   * is about to take over the preview message).
   */
  public static async reportPlaybackFailure(
    session: GuildSession,
    track: TrackMetadata | null,
    reason: string,
    replacePreview = true,
    tierLabel?: string
  ): Promise<void> {
    const title = track?.title || "Lagu";
    const tier = tierLabel || session.currentTier;
    const cleanReason = String(reason || "unknown")
      .replace(/\s+/g, " ")
      .slice(0, 900);

    // Same copy-pasteable shape as the pre-stream failure report, so both kinds
    // of failure are easy to grep in Railway logs and easy to read in chat.
    const cookie = getCookieAuthInfo();
    const pot = await checkPotProvider().catch(() => ({ reachable: false, url: "unknown", version: undefined }));
    const block = [
      "==================== [YT-FAIL mid-stream] ====================",
      `time       : ${new Date().toISOString()}`,
      `track      : ${title}`,
      `url        : ${track?.url || "unknown"}`,
      `tier       : ${tier || "unknown"}`,
      `reason     : ${cleanReason}`,
      `cookies    : ${cookie.hasCookies ? `yes | login=${cookie.loggedIn ? "YES" : "NO (guest)"} | entries=${cookie.cookieCount}` : "none"}`,
      `pot        : ${pot.reachable ? `reachable v${pot.version || "?"}` : "UNREACHABLE"} | ${pot.url}`,
      `yt-dlp     : ${cachedYtDlpVersion || "unknown"}`,
      "==============================================================",
    ].join("\n");
    logger.error(block);
    lastYtFailure = {
      at: new Date().toISOString(),
      videoId: extractYouTubeVideoId(track?.url || "") || undefined,
      url: track?.url || "unknown",
      report: block,
    };

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("❌ Stream Terputus")
      .setDescription(
        `Gagal memutar **${title}**${tier ? ` • ${tier}` : ""}.\n` +
          `\`\`\`\n${cleanReason}\n\`\`\`\n` +
          `> Jalankan \`/check\` untuk diagnosa, atau \`/logs\` untuk laporan lengkap.`
      )
      .setFooter({ text: "Log lengkap tersimpan sebagai [YT-FAIL] di console" })
      .setTimestamp();

    if (!session.textChannel || !("send" in session.textChannel)) return;

    if (replacePreview) {
      await MusicService.sendOrReplacePreview(session, { embeds: [embed] });
      return;
    }

    const msg = await (session.textChannel as any).send({ embeds: [embed] }).catch(() => null);
    if (msg) setTimeout(() => msg.delete().catch(() => {}), 20_000);
  }

  public static async setPreviewMessage(session: GuildSession, newMessage: Message | null): Promise<void> {
    if (session.previewMessage && session.previewMessage.id !== newMessage?.id) {
      await MusicService.deletePreviewMessage(session);
    }
    session.previewMessage = newMessage;
  }

  public static async sendOrReplacePreview(
    session: GuildSession,
    payload: { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[] }
  ): Promise<Message | null> {
    if (session.previewMessage && session.textChannel && session.previewMessage.channelId === session.textChannel.id && session.previewMessage.editable) {
      try {
        await session.previewMessage.edit(payload);
        return session.previewMessage;
      } catch {}
    }
    await MusicService.deletePreviewMessage(session);
    if (session.textChannel && "send" in session.textChannel) {
      try {
        const msg = await (session.textChannel as any).send(payload).catch(() => null);
        session.previewMessage = msg;
        return msg;
      } catch (err) {
        logger.warn({ err }, "Failed to send music preview message");
      }
    }
    return null;
  }

  public static cleanupSessionProcesses(session?: GuildSession | null): void {
    if (!session) return;
    if (session.currentResource && typeof (session.currentResource as any)._cleanupProcesses === "function") {
      try {
        (session.currentResource as any)._cleanupProcesses();
      } catch {}
    }
  }

  public static async joinOrGetVoice(
    guild: Guild,
    voiceChannel: VoiceBasedChannel,
    textChannel?: TextBasedChannel
  ): Promise<GuildSession> {
    // Fail early with a useful message instead of joining and staying silent.
    const me = guild.members.me;
    if (me) {
      const perms = voiceChannel.permissionsFor(me);
      if (
        perms &&
        (!perms.has(PermissionFlagsBits.ViewChannel) ||
          !perms.has(PermissionFlagsBits.Connect) ||
          !perms.has(PermissionFlagsBits.Speak))
      ) {
        throw new Error(
          "Aku nggak punya izin **View Channel / Connect / Speak** di voice channel itu. Kasih izin dulu ya~ (๑•́ ₃ •̀๑)"
        );
      }
    }

    let session = sessions.get(guild.id);
    let connection = getVoiceConnection(guild.id);

    const isConnected =
      connection &&
      connection.state.status !== VoiceConnectionStatus.Destroyed &&
      connection.state.status !== VoiceConnectionStatus.Disconnected;

    const channelChanged = session && session.voiceChannelId !== voiceChannel.id;

    if (!connection || !isConnected || channelChanged) {
      if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
        safeDestroyVoiceConnection(connection);
      }
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection!, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection!, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          const currentSession = sessions.get(guild.id);
          MusicService.cleanupSessionProcesses(currentSession);
          safeDestroyVoiceConnection(connection);
          sessions.delete(guild.id);
        }
      });

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      } catch (connErr) {
        logger.error(
          { connErr, guildId: guild.id, channelId: voiceChannel.id },
          "Voice connection failed to become Ready within 15s"
        );
        safeDestroyVoiceConnection(connection);
        throw new Error(
          "Gagal terhubung ke voice channel (timeout). Cek izin Connect/Speak, region voice Discord, atau coba channel lain."
        );
      }
    }

    if (!session) {
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        },
      });

      connection.subscribe(player);

      session = {
        guildId: guild.id,
        voiceChannelId: voiceChannel.id,
        textChannel,
        connection,
        player,
        currentTrack: null,
        currentResource: null,
        queue: [],
        isPlaying: false,
        isPaused: false,
        isSeeking: false,
        seekOffsetSec: 0,
        previewMessage: null,
        queuePage: 0,
      };

      player.on(AudioPlayerStatus.Idle, async () => {
        if (session!.isSeeking) {
          session!.isSeeking = false;
          return;
        }

        // Snapshot before we clear the session so we can tell a normal ending
        // apart from a stream that died seconds after it started.
        const endedTrack = session!.currentTrack;
        const endedResource = session!.currentResource;
        const tier = session!.currentTier;
        const manual = session!.manualStop === true;
        session!.manualStop = false;

        const playedMs = Number(endedResource?.playbackDuration) || 0;
        const expectedMs = (endedTrack?.durationSec || 0) * 1000;
        const streamDetail =
          (typeof endedResource?._getErrorDetail === "function" ? String(endedResource._getErrorDetail()) : "") ||
          session!.lastStreamError ||
          "";

        const premature =
          !manual &&
          !!endedTrack &&
          ((playedMs < 2500 && (expectedMs === 0 || expectedMs > 10000)) ||
            (expectedMs > 30000 && playedMs < Math.min(15000, expectedMs * 0.5)));

        MusicService.cleanupSessionProcesses(session);
        logger.info(
          { guildId: guild.id, playedMs, expectedMs, tier, manual, premature, detail: streamDetail.slice(0, 200) },
          premature ? "Audio stream ended prematurely" : "Audio player is idle, advancing queue"
        );
        session!.isPlaying = false;
        session!.isPaused = false;
        session!.currentTrack = null;
        session!.currentResource = null;
        session!.seekOffsetSec = 0;
        session!.currentTier = undefined;
        session!.lastStreamError = undefined;

        if (premature) {
          const nextTrack = session!.queue.shift();
          const reason = streamDetail || "Stream berhenti sebelum lagu selesai (kemungkinan HTTP 403 / IP diblokir YouTube).";
          // If another track is waiting, report the failure in the channel and
          // immediately try the next one instead of silently killing the preview.
          await MusicService.reportPlaybackFailure(session!, endedTrack, reason, !nextTrack, tier);
          if (nextTrack) {
            await MusicService.playTrackInSession(session!, nextTrack);
          }
          return;
        }

        if (session!.queue.length > 0) {
          const nextTrack = session!.queue.shift()!;
          await MusicService.playTrackInSession(session!, nextTrack);
        } else {
          await MusicService.deletePreviewMessage(session);
        }
      });

      player.on("error", (error) => {
        // The player emits "idle" right after this, which is where queue
        // advancing and user-facing reporting happen. Just remember the detail.
        session!.lastStreamError = String((error as any)?.message || error);
        MusicService.cleanupSessionProcesses(session);
        logger.error({ guildId: guild.id, error }, "Audio player error encountered");
      });

      sessions.set(guild.id, session);
    } else {
      session.connection = connection;
      session.voiceChannelId = voiceChannel.id;
      if (textChannel) session.textChannel = textChannel;
      connection.subscribe(session.player);
    }

    return session;
  }

  public static async seekTrackInSession(session: GuildSession, targetSec: number): Promise<void> {
    if (!session.currentTrack) return;
    try {
      session.isSeeking = true;
      MusicService.cleanupSessionProcesses(session);
      const resource = await session.currentTrack.createStream(targetSec);
      session.seekOffsetSec = targetSec;
      session.currentResource = resource;
      session.currentTier = (resource as any)?._tier;
      session.playbackStartedAt = Date.now();
      session.manualStop = false;
      session.lastStreamError = undefined;
      session.player.play(resource);
      session.isPlaying = true;
      session.isPaused = false;
    } catch (err) {
      logger.error({ err, targetSec }, "Failed to seek track in session");
      session.isSeeking = false;
    }
  }

  private static async playTrackInSession(session: GuildSession, track: TrackMetadata): Promise<void> {
    try {
      MusicService.cleanupSessionProcesses(session);
      if (session.connection.state.status !== VoiceConnectionStatus.Ready && session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
        try {
          await entersState(session.connection, VoiceConnectionStatus.Ready, 5_000);
        } catch {}
      }
      session.connection.subscribe(session.player);

      const resource = await track.createStream(0);
      session.currentTrack = track;
      session.currentResource = resource;
      session.currentTier = (resource as any)?._tier;
      session.playbackStartedAt = Date.now();
      session.manualStop = false;
      session.lastStreamError = undefined;
      session.isPlaying = true;
      session.isPaused = false;
      session.isSeeking = false;
      session.seekOffsetSec = 0;
      session.player.play(resource);

      const embed = buildNowPlayingEmbed(track, false);
      await MusicService.sendOrReplacePreview(session, {
        embeds: [embed],
        components: buildMusicComponents(session),
      });
    } catch (err) {
      logger.error({ err, track: track.title }, "Failed to stream audio resource");
      session.isPlaying = false;
      session.currentTrack = null;
      session.currentResource = null;
      session.currentTier = undefined;
      const next = session.queue.shift();
      await MusicService.reportPlaybackFailure(
        session,
        track,
        String((err as Error)?.message || err),
        !next
      );
      if (next) {
        await MusicService.playTrackInSession(session, next);
      }
    }
  }

  public static async handlePlay(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.member as GuildMember | null;
    const voiceChannel = member?.voice?.channel;
    const guild = interaction.guild;

    if (!guild || !voiceChannel) {
      await interaction.reply({
        content: "❌ Masuk ke voice channel dulu ya sebelum minta putar musik! (๑•́ ₃ •̀๑)",
        ephemeral: true,
      });
      return;
    }

    const cd = checkUserCooldown(interaction.user.id, "music_command", 3000);
    if (cd !== null) {
      await interaction.reply({
        content: `⏳ Sabar ya! Tunggu **${cd} detik** lagi sebelum meminta lagu baru~ (๑•́ ₃ •̀๑)`,
        ephemeral: true,
      });
      return;
    }

    const queryOrUrl = interaction.options.getString("url", true);
    const forcePlaylist = interaction.options.getBoolean("playlist") ?? false;
    const modeOption = interaction.options.getString("mode");
    const mode: PlaybackMode = modeOption === "mirror" || modeOption === "ytdlp" ? modeOption : "auto";
    await interaction.deferReply();

    // 2-minute generous interaction timeout watchdog for heavy YouTube/yt-dlp resolution
    let timedOut = false;
    let completed = false;
    const timeoutHandle = setTimeout(async () => {
      if (completed) return;
      timedOut = true;
      try {
        await interaction.editReply("⏱️ **Waktu Proses Agak Lama:** YouTube sedang memproses resolusi lagu di server Railway. Mohon sebentar ya... (๑•̀ㅂ•́)و✧").catch(() => {});
      } catch {}
    }, 120000);

    try {
      const musicResult = await resolveMusic(queryOrUrl, {
        name: interaction.user.displayName || interaction.user.username,
        id: interaction.user.id,
      }, { forcePlaylist, mode });

      const textChannel = interaction.channel as TextBasedChannel;
      const session = await MusicService.joinOrGetVoice(guild, voiceChannel, textChannel);
      session.panelOwnerId = interaction.user.id;

      if (musicResult.isPlaylist) {
        if (session.isPlaying && session.currentTrack) {
          session.queue.push(...musicResult.tracks);
          const embed = buildPlaylistEmbed(musicResult, interaction.user.displayName || interaction.user.username, true);
          completed = true;
          clearTimeout(timeoutHandle);
          if (!timedOut) {
            await interaction.editReply({ embeds: [embed] });
            const noticeMsg = await interaction.fetchReply().catch(() => null);
            if (noticeMsg) setTimeout(() => noticeMsg.delete().catch(() => {}), 7_000);
          }
        } else {
          if (session.connection.state.status !== VoiceConnectionStatus.Ready && session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
            try {
              await entersState(session.connection, VoiceConnectionStatus.Ready, 5_000);
            } catch {}
          }
          session.connection.subscribe(session.player);

          const [firstTrack, ...queuedTracks] = musicResult.tracks;
          session.queue.push(...queuedTracks);

          session.currentTrack = firstTrack;
          session.isPlaying = true;
          session.isPaused = false;
          session.isSeeking = false;
          session.seekOffsetSec = 0;

          const embed = buildPlaylistEmbed(musicResult, interaction.user.displayName || interaction.user.username, false);
          await MusicService.deletePreviewMessage(session);
          completed = true;
          clearTimeout(timeoutHandle);
          if (!timedOut) {
            await interaction.editReply({
              embeds: [embed],
              components: buildMusicComponents(session),
            });
            session.previewMessage = await interaction.fetchReply().catch(() => null);
          }

          try {
            const resource = await firstTrack.createStream(0);
            session.currentResource = resource;
            session.currentTier = (resource as any)?._tier;
            session.playbackStartedAt = Date.now();
            session.manualStop = false;
            session.lastStreamError = undefined;
            session.player.play(resource);
          } catch (streamErr) {
            logger.error({ streamErr, track: firstTrack.title }, "Failed to start initial playlist stream");
            session.isPlaying = false;
            session.currentTrack = null;
            session.currentResource = null;
            const next = session.queue.shift();
            await MusicService.reportPlaybackFailure(
              session,
              firstTrack,
              String((streamErr as Error)?.message || streamErr),
              !next
            );
            if (next) await MusicService.playTrackInSession(session, next);
          }
        }
      } else {
        const track = musicResult.tracks[0];
        if (session.isPlaying && session.currentTrack) {
          session.queue.push(track);
          const embed = buildNowPlayingEmbed(track, true);
          completed = true;
          clearTimeout(timeoutHandle);
          if (!timedOut) {
            await interaction.editReply({ embeds: [embed] });
            const noticeMsg = await interaction.fetchReply().catch(() => null);
            if (noticeMsg) setTimeout(() => noticeMsg.delete().catch(() => {}), 7_000);
          }
        } else {
          if (session.connection.state.status !== VoiceConnectionStatus.Ready && session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
            try {
              await entersState(session.connection, VoiceConnectionStatus.Ready, 5_000);
            } catch {}
          }
          session.connection.subscribe(session.player);

          session.currentTrack = track;
          session.isPlaying = true;
          session.isPaused = false;
          session.isSeeking = false;
          session.seekOffsetSec = 0;

          const embed = buildNowPlayingEmbed(track, false);
          await MusicService.deletePreviewMessage(session);
          completed = true;
          clearTimeout(timeoutHandle);
          if (!timedOut) {
            await interaction.editReply({
              embeds: [embed],
              components: buildMusicComponents(session),
            });
            session.previewMessage = await interaction.fetchReply().catch(() => null);
          }

          try {
            const resource = await track.createStream(0);
            session.currentResource = resource;
            session.currentTier = (resource as any)?._tier;
            session.playbackStartedAt = Date.now();
            session.manualStop = false;
            session.lastStreamError = undefined;
            session.player.play(resource);
          } catch (streamErr) {
            logger.error({ streamErr, track: track.title }, "Failed to start track stream");
            // Reset session state to prevent zombie lock
            session.isPlaying = false;
            session.currentTrack = null;
            session.currentResource = null;
            const next = session.queue.shift();
            await MusicService.reportPlaybackFailure(
              session,
              track,
              String((streamErr as Error)?.message || streamErr || "Stream error"),
              !next
            );
            if (next) await MusicService.playTrackInSession(session, next);
          }
        }
      }
    } catch (err) {
      completed = true;
      clearTimeout(timeoutHandle);
      if (timedOut) return;
      logger.error({ err, queryOrUrl }, "Error resolving and playing track");
      await interaction.editReply(`❌ Gagal memutar musik: ${(err as Error).message || "Sumber tidak ditemukan"}`);
    }
  }

  public static async handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "❌ Command ini hanya bisa dipakai di server.", ephemeral: true });
      return;
    }

    const cd = checkGuildActionCooldown(guild.id, "music_stop", 2000);
    if (cd !== null) {
      await interaction.reply({
        content: `⏳ Tunggu **${cd} detik** sebelum menghentikan musik lagi ya~ (๑•́ ₃ •̀๑)`,
        ephemeral: true,
      });
      return;
    }

    const session = sessions.get(guild.id);
    if (!session || (!session.isPlaying && !session.currentTrack && session.queue.length === 0)) {
      await interaction.reply({
        content: "❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)",
        ephemeral: true,
      });
      return;
    }

    MusicService.cleanupSessionProcesses(session);
    session.queue = [];
    session.currentTrack = null;
    session.currentResource = null;
    session.isPlaying = false;
    session.isPaused = false;
    session.seekOffsetSec = 0;
    session.manualStop = true;
    session.player.stop(true);

    await MusicService.deletePreviewMessage(session);
    const stopMsg = await interaction.reply({
      content: "⏹️ Musik telah dihentikan dan antrean dibersihkan! (◡ ω ◡)",
      fetchReply: true,
    });
    setTimeout(() => stopMsg.delete().catch(() => {}), 4_000);
  }

  public static async handlePause(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "❌ Command ini hanya bisa dipakai di server.", ephemeral: true });
      return;
    }

    const cd = checkUserCooldown(interaction.user.id, "music_pause_resume", 2000);
    if (cd !== null) {
      await interaction.reply({
        content: `⏳ Tunggu **${cd} detik** sebelum jeda/lanjut lagi ya~ (๑•́ ₃ •̀๑)`,
        ephemeral: true,
      });
      return;
    }

    const session = sessions.get(guild.id);
    if (!session || !session.isPlaying || !session.currentTrack) {
      await interaction.reply({ content: "❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)", ephemeral: true });
      return;
    }

    if (session.isPaused) {
      await interaction.reply({ content: "⏸️ Musik sudah dalam keadaan dijeda!", ephemeral: true });
      return;
    }

    session.player.pause();
    session.isPaused = true;
    await interaction.reply({ content: `⏸️ Musik dijeda oleh **${interaction.user.displayName || interaction.user.username}**! (◡ ω ◡)` });
      const pauseMsg = await interaction.fetchReply();
      setTimeout(() => pauseMsg.delete().catch(() => {}), 5_000);
  }

  public static async handleResume(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "❌ Command ini hanya bisa dipakai di server.", ephemeral: true });
      return;
    }

    const cd = checkUserCooldown(interaction.user.id, "music_pause_resume", 2000);
    if (cd !== null) {
      await interaction.reply({
        content: `⏳ Tunggu **${cd} detik** sebelum jeda/lanjut lagi ya~ (๑•́ ₃ •̀๑)`,
        ephemeral: true,
      });
      return;
    }

    const session = sessions.get(guild.id);
    if (!session || !session.isPlaying || !session.currentTrack) {
      await interaction.reply({ content: "❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)", ephemeral: true });
      return;
    }

    if (!session.isPaused) {
      await interaction.reply({ content: "▶️ Musik sedang aktif berjalan!", ephemeral: true });
      return;
    }

    session.player.unpause();
    session.isPaused = false;
    await interaction.reply({ content: `▶️ Musik dilanjutkan oleh **${interaction.user.displayName || interaction.user.username}**! (๑˃ᴗ˂)ﻌ` });
      const resumeMsg = await interaction.fetchReply();
      setTimeout(() => resumeMsg.delete().catch(() => {}), 5_000);
  }

  public static async handleSeekCommand(interaction: ChatInputCommandInteraction, deltaSec: number): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "❌ Command ini hanya bisa dipakai di server.", ephemeral: true });
      return;
    }

    const cd = checkGuildActionCooldown(guild.id, "music_seek", 1000);
    if (cd !== null) {
      await interaction.reply({
        content: `⏳ Tunggu **${cd} detik** sebelum mengatur posisi musik lagi ya~ (๑•́ ₃ •̀๑)`,
        ephemeral: true,
      });
      return;
    }

    const session = sessions.get(guild.id);
    if (!session || !session.isPlaying || !session.currentTrack) {
      await interaction.reply({ content: "❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)", ephemeral: true });
      return;
    }

    const elapsed = session.currentResource ? Math.floor(session.currentResource.playbackDuration / 1000) : 0;
    const currentPos = Math.max(0, (session.seekOffsetSec || 0) + elapsed);
    const totalSec = session.currentTrack.durationSec || 300;
    const targetPos = Math.max(0, Math.min(totalSec - 2, currentPos + deltaSec));

    await interaction.deferReply();
    await MusicService.seekTrackInSession(session, targetPos);
    const label = deltaSec >= 0 ? `⏩ +${deltaSec}s` : `⏪ ${deltaSec}s`;
    await interaction.editReply({
      content: `${label}: Posisi musik sekarang di **${formatDuration(targetPos)}** (๑˃ᴗ˂)ﻌ`,
    });
  }

  
  public static async handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "❌ Menu ini hanya dapat digunakan di dalam server.", ephemeral: true });
      return;
    }

    const member = interaction.member as GuildMember | null;
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply({
        content: "❌ Kamu harus berada di voice channel untuk mengontrol musik! (๑•́ ₃ •̀๑)",
        ephemeral: true,
      });
      return;
    }

    const session = sessions.get(guild.id);
    if (!session || (!session.isPlaying && !session.currentTrack)) {
      await interaction.reply({
        content: "❌ Tidak ada musik yang sedang aktif diputar saat ini~ (๑•́ ₃ •̀๑)",
        ephemeral: true,
      });
      return;
    }

    const customId = interaction.customId;

    if (customId === "music_jump") {
      const value = interaction.values[0]; // e.g. "jump_3"
      if (!value.startsWith("jump_")) return;
      const index = parseInt(value.replace("jump_", ""), 10);
      if (isNaN(index) || index < 0 || index >= session.queue.length) {
        await interaction.reply({ content: "❌ Lagu yang dipilih tidak valid atau antrean sudah berubah~ (๑•́ ₃ •̀๑)", ephemeral: true });
        return;
      }

      // Remove songs before the selected index, so the selected song is next
      const targetTrack = session.queue[index];
      session.queue = session.queue.slice(index);
      
      MusicService.cleanupSessionProcesses(session);
      session.manualStop = true;
      session.player.stop(true); // Stop current track, will trigger Idle event and play the next (targetTrack)

      await interaction.update({ components: buildMusicComponents(session) }).catch(() => {});
      await interaction.followUp({
        content: `⏭️ Melompat ke lagu **${targetTrack.title}** oleh **${interaction.user.displayName || interaction.user.username}**! (๑˃ᴗ˂)ﻌ`,
        ephemeral: true,
      });
      return;
    }
  }

  public static async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "❌ Tombol ini hanya dapat digunakan di dalam server.", ephemeral: true });
      return;
    }

    const member = interaction.member as GuildMember | null;
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply({
        content: "❌ Kamu harus berada di voice channel untuk mengontrol musik! (๑•́ ₃ •̀๑)",
        ephemeral: true,
      });
      return;
    }

    const session = sessions.get(guild.id);
    if (!session || (!session.isPlaying && !session.currentTrack)) {
      await interaction.reply({
        content: "❌ Tidak ada musik yang sedang aktif diputar saat ini~ (๑•́ ₃ •̀๑)",
        ephemeral: true,
      });
      return;
    }

    const customId = interaction.customId;

    // Button debounce / cooldown per guild & button to prevent spamming
    const btnCd = checkGuildActionCooldown(guild.id, `btn_${customId}`, 1500);
    if (btnCd !== null) {
      await interaction.reply({
        content: `⏳ Sabar ya! Tunggu **${btnCd} detik** sebelum menekan tombol ini lagi~ (๑•́ ₃ •̀๑)`,
        ephemeral: true,
      }).catch(() => {});
      return;
    }

    // 1. Pause / Resume Toggle
    
    
    if (customId === "music_queue_prev" || customId === "music_queue_next") {
      if (customId === "music_queue_prev" && (session.queuePage || 0) > 0) {
        session.queuePage = (session.queuePage || 0) - 1;
      } else if (customId === "music_queue_next") {
        const totalPages = Math.ceil(session.queue.length / 25);
        if ((session.queuePage || 0) < totalPages - 1) {
          session.queuePage = (session.queuePage || 0) + 1;
        }
      }
      await interaction.update({ components: buildMusicComponents(session) }).catch(() => {});
      return;
    }

    if (customId === "music_shuffle") {
      if (session.queue.length > 1) {
        for (let i = session.queue.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [session.queue[i], session.queue[j]] = [session.queue[j], session.queue[i]];
        }
        await interaction.update({ components: buildMusicComponents(session) }).catch(() => {});
        const shuffleMsg = await interaction.followUp({
          content: `🔀 Antrean musik telah diacak oleh **${interaction.user.displayName || interaction.user.username}**! (๑˃ᴗ˂)ﻌ`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "❌ Antrean terlalu pendek untuk diacak~ (๑•́ ₃ •̀๑)",
          ephemeral: true,
        });
      }
      return;
    }

    if (customId === "music_pause_resume") {
      if (session.isPaused) {
        session.player.unpause();
        session.isPaused = false;
        await interaction.update({ components: buildMusicComponents(session) }).catch(() => {});
const followMsg = await interaction.followUp({
          content: `▶️ Musik dilanjutkan oleh **${interaction.user.displayName || interaction.user.username}**! (๑˃ᴗ˂)ﻌ`,
        });
        setTimeout(() => followMsg.delete().catch(() => {}), 5_000);
      } else {
        session.player.pause();
        session.isPaused = true;
        await interaction.update({ components: buildMusicComponents(session) }).catch(() => {});
        const pauseMsg = await interaction.followUp({
          content: `⏸️ Musik dijeda oleh **${interaction.user.displayName || interaction.user.username}**! (◡ ω ◡)`,
        });
        setTimeout(() => pauseMsg.delete().catch(() => {}), 5_000);
      }
      return;
    }

    // 2. Rewind 10s
    if (customId === "music_rewind_10") {
      const elapsed = session.currentResource ? Math.floor(session.currentResource.playbackDuration / 1000) : 0;
      const currentPos = Math.max(0, (session.seekOffsetSec || 0) + elapsed);
      const targetPos = Math.max(0, currentPos - 10);

      await interaction.deferUpdate();
      await MusicService.seekTrackInSession(session, targetPos);
      await interaction.followUp({
        content: `⏪ **-10s**: Posisi musik dimundurkan ke **${formatDuration(targetPos)}** oleh **${interaction.user.displayName || interaction.user.username}**! (๑˃ᴗ˂)ﻌ`,
      }).then(msg => { if (msg) setTimeout(() => msg.delete().catch(() => {}), 5_000); }).catch(() => {});
      return;
    }

    // 3. Forward 10s
    if (customId === "music_forward_10") {
      const elapsed = session.currentResource ? Math.floor(session.currentResource.playbackDuration / 1000) : 0;
      const currentPos = Math.max(0, (session.seekOffsetSec || 0) + elapsed);
      const totalSec = session.currentTrack?.durationSec || 300;
      const targetPos = Math.min(Math.max(0, totalSec - 2), currentPos + 10);

      await interaction.deferUpdate();
      await MusicService.seekTrackInSession(session, targetPos);
      await interaction.followUp({
        content: `⏩ **+10s**: Posisi musik dimajukan ke **${formatDuration(targetPos)}** oleh **${interaction.user.displayName || interaction.user.username}**! (๑˃ᴗ˂)ﻌ`,
      }).then(msg => { if (msg) setTimeout(() => msg.delete().catch(() => {}), 5_000); }).catch(() => {});
      return;
    }

    // 4. Stop
    if (customId === "music_stop") {
      MusicService.cleanupSessionProcesses(session);
      session.queue = [];
      session.currentTrack = null;
      session.currentResource = null;
      session.isPlaying = false;
      session.isPaused = false;
      session.seekOffsetSec = 0;
      session.manualStop = true;
      session.player.stop(true);

      await MusicService.deletePreviewMessage(session);
      await interaction.deferUpdate().catch(() => {});
      const stopMsg = await interaction.followUp({
        content: `⏹️ Musik telah dihentikan dan antrean dibersihkan oleh **${interaction.user.displayName || interaction.user.username}**! (◡ ω ◡)`,
      }).catch(() => null);
      if (stopMsg) setTimeout(() => stopMsg.delete().catch(() => {}), 4_000);
      return;
    }

    // 5. Skip
    if (customId === "music_skip") {
      await MusicService.handleSkip(interaction);
      return;
    }
  }

  public static async handleLeave(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "❌ Command ini hanya bisa dipakai di server.", ephemeral: true });
      return;
    }

    const session = sessions.get(guild.id);
    if (session) {
      MusicService.cleanupSessionProcesses(session);
      session.queue = [];
      session.currentTrack = null;
      session.currentResource = null;
      session.isPlaying = false;
      session.isPaused = false;
      try {
        session.player.stop(true);
      } catch {}
      safeDestroyVoiceConnection(session.connection);
      sessions.delete(guild.id);
    } else {
      const conn = getVoiceConnection(guild.id);
      safeDestroyVoiceConnection(conn);
    }

    await MusicService.deletePreviewMessage(session);
    const leaveMsg = await interaction.reply({
      content: "👋 Porsche-chan keluar dari voice channel. Sampai jumpa lagi~! (◡ ω ◡)",
      fetchReply: true,
    });
    setTimeout(() => leaveMsg.delete().catch(() => {}), 5_000);
  }

  public static async playFromMessage(
    message: Message,
    queryOrUrl: string,
    forcePlaylist: boolean = false,
    mode: PlaybackMode = "auto"
  ): Promise<void> {
    const member = message.member;
    const voiceChannel = member?.voice?.channel;
    const guild = message.guild;

    if (!guild || !voiceChannel) {
      await message.reply("❌ Masuk ke voice channel dulu ya sebelum minta putar musik! (๑•́ ₃ •̀๑)");
      return;
    }

    const cd = checkUserCooldown(message.author.id, "music_command", 3000);
    if (cd !== null) {
      const cdMsg = await message.reply(`⏳ Sabar ya **${message.author.displayName || message.author.username}**! Tunggu **${cd} detik** lagi sebelum meminta lagu baru~ (๑•́ ₃ •̀๑)`);
      setTimeout(() => cdMsg.delete().catch(() => {}), 4_000);
      return;
    }

    const loadingMsg = await message.reply("🔎 Mencari & menyiapkan audio... Tunggu sebentar ya~ (๑˃ᴗ˂)ﻌ");
    try {
      const musicResult = await resolveMusic(queryOrUrl, {
        name: message.author.displayName || message.author.username,
        id: message.author.id,
      }, { forcePlaylist, mode });

      const textChannel = message.channel as TextBasedChannel;
      const session = await MusicService.joinOrGetVoice(guild, voiceChannel, textChannel);
      session.panelOwnerId = message.author.id;

      if (musicResult.isPlaylist) {
        if (session.isPlaying && session.currentTrack) {
          session.queue.push(...musicResult.tracks);
          const embed = buildPlaylistEmbed(musicResult, message.author.displayName || message.author.username, true);
          await loadingMsg.edit({ content: null, embeds: [embed] });
          setTimeout(() => loadingMsg.delete().catch(() => {}), 7_000);
          setTimeout(() => message.delete().catch(() => {}), 7_000);
        } else {
          if (session.connection.state.status !== VoiceConnectionStatus.Ready && session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
            try {
              await entersState(session.connection, VoiceConnectionStatus.Ready, 5_000);
            } catch {}
          }
          session.connection.subscribe(session.player);

          const [firstTrack, ...queuedTracks] = musicResult.tracks;
          session.queue.push(...queuedTracks);

          session.currentTrack = firstTrack;
          session.isPlaying = true;
          session.isPaused = false;
          session.isSeeking = false;
          session.seekOffsetSec = 0;

          const embed = buildPlaylistEmbed(musicResult, message.author.displayName || message.author.username, false);
          await MusicService.deletePreviewMessage(session);
          await loadingMsg.edit({
            content: null,
            embeds: [embed],
            components: buildMusicComponents(session),
          });
          session.previewMessage = loadingMsg;
          setTimeout(() => message.delete().catch(() => {}), 3_000);

          try {
            const resource = await firstTrack.createStream(0);
            session.currentResource = resource;
            session.currentTier = (resource as any)?._tier;
            session.playbackStartedAt = Date.now();
            session.manualStop = false;
            session.lastStreamError = undefined;
            session.player.play(resource);
          } catch (streamErr) {
            logger.error({ streamErr, track: firstTrack.title }, "Failed to start initial playlist stream");
            session.isPlaying = false;
            session.currentTrack = null;
            session.currentResource = null;
            const next = session.queue.shift();
            await MusicService.reportPlaybackFailure(
              session,
              firstTrack,
              String((streamErr as Error)?.message || streamErr),
              !next
            );
            if (next) await MusicService.playTrackInSession(session, next);
          }
        }
      } else {
        const track = musicResult.tracks[0];
        if (session.isPlaying && session.currentTrack) {
          session.queue.push(track);
          const embed = buildNowPlayingEmbed(track, true);
          await loadingMsg.edit({ content: null, embeds: [embed] });
          setTimeout(() => loadingMsg.delete().catch(() => {}), 7_000);
          setTimeout(() => message.delete().catch(() => {}), 7_000);
        } else {
          if (session.connection.state.status !== VoiceConnectionStatus.Ready && session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
            try {
              await entersState(session.connection, VoiceConnectionStatus.Ready, 5_000);
            } catch {}
          }
          session.connection.subscribe(session.player);

          session.currentTrack = track;
          session.isPlaying = true;
          session.isPaused = false;
          session.isSeeking = false;
          session.seekOffsetSec = 0;

          const embed = buildNowPlayingEmbed(track, false);
          await MusicService.deletePreviewMessage(session);
          await loadingMsg.edit({
            content: null,
            embeds: [embed],
            components: buildMusicComponents(session),
          });
          session.previewMessage = loadingMsg;
          setTimeout(() => message.delete().catch(() => {}), 3_000);

          try {
            const resource = await track.createStream(0);
            session.currentResource = resource;
            session.currentTier = (resource as any)?._tier;
            session.playbackStartedAt = Date.now();
            session.manualStop = false;
            session.lastStreamError = undefined;
            session.player.play(resource);
          } catch (streamErr) {
            logger.error({ streamErr, track: track.title }, "Failed to start track stream");
            session.isPlaying = false;
            session.currentTrack = null;
            session.currentResource = null;
            const next = session.queue.shift();
            await MusicService.reportPlaybackFailure(
              session,
              track,
              String((streamErr as Error)?.message || streamErr || "Stream error"),
              !next
            );
            if (next) await MusicService.playTrackInSession(session, next);
          }
        }
      }
    } catch (err) {
      logger.error({ err, queryOrUrl }, "Error in playFromMessage");
      await loadingMsg.edit(`❌ Gagal memutar musik: ${(err as Error).message || "Sumber tidak ditemukan"}`);
    }
  }

  public static async stopFromMessage(message: Message): Promise<void> {
    const guild = message.guild;
    if (!guild) {
      await message.reply("❌ Command ini hanya bisa dipakai di server.");
      return;
    }

    const cd = checkGuildActionCooldown(guild.id, "music_stop", 2000);
    if (cd !== null) {
      const cdMsg = await message.reply(`⏳ Tunggu **${cd} detik** sebelum menghentikan musik lagi ya~ (๑•́ ₃ •̀๑)`);
      setTimeout(() => cdMsg.delete().catch(() => {}), 4_000);
      return;
    }
    const session = sessions.get(guild.id);
    if (!session || (!session.isPlaying && !session.currentTrack && session.queue.length === 0)) {
      await message.reply("❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)");
      return;
    }
    MusicService.cleanupSessionProcesses(session);
    session.queue = [];
    session.currentTrack = null;
    session.currentResource = null;
    session.isPlaying = false;
    session.isPaused = false;
    session.seekOffsetSec = 0;
    session.manualStop = true;
    session.player.stop(true);
    await MusicService.deletePreviewMessage(session);
    const stopMsg = await message.reply("⏹️ Musik telah dihentikan dan antrean dibersihkan! (◡ ω ◡)");
    setTimeout(() => stopMsg.delete().catch(() => {}), 4_000);
    setTimeout(() => message.delete().catch(() => {}), 4_000);
  }

  public static async pauseFromMessage(message: Message): Promise<void> {
    const guild = message.guild;
    if (!guild) return;

    const cd = checkUserCooldown(message.author.id, "music_pause_resume", 2000);
    if (cd !== null) {
      const cdMsg = await message.reply(`⏳ Tunggu **${cd} detik** sebelum jeda/lanjut lagi ya~ (๑•́ ₃ •̀๑)`);
      setTimeout(() => cdMsg.delete().catch(() => {}), 4_000);
      return;
    }
    const session = sessions.get(guild.id);
    if (!session || !session.isPlaying || !session.currentTrack) {
      await message.reply("❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)");
      return;
    }
    if (session.isPaused) {
      await message.reply("⏸️ Musik sudah dalam keadaan dijeda!");
      return;
    }
    session.player.pause();
    session.isPaused = true;
    const pauseMsg = await message.reply(`⏸️ Musik dijeda oleh **${message.author.displayName || message.author.username}**! (◡ ω ◡)`);
      setTimeout(() => pauseMsg.delete().catch(() => {}), 5_000);
  }

  public static async resumeFromMessage(message: Message): Promise<void> {
    const guild = message.guild;
    if (!guild) return;

    const cd = checkUserCooldown(message.author.id, "music_pause_resume", 2000);
    if (cd !== null) {
      const cdMsg = await message.reply(`⏳ Tunggu **${cd} detik** sebelum jeda/lanjut lagi ya~ (๑•́ ₃ •̀๑)`);
      setTimeout(() => cdMsg.delete().catch(() => {}), 4_000);
      return;
    }

    const session = sessions.get(guild.id);
    if (!session || !session.isPlaying || !session.currentTrack) {
      await message.reply("❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)");
      return;
    }
    if (!session.isPaused) {
      await message.reply("▶️ Musik sedang aktif berjalan!");
      return;
    }
    session.player.unpause();
    session.isPaused = false;
    const resumeMsg = await message.reply(`▶️ Musik dilanjutkan oleh **${message.author.displayName || message.author.username}**! (๑˃ᴗ˂)ﻌ`);
    setTimeout(() => resumeMsg.delete().catch(() => {}), 5_000);
  }

  public static async forwardFromMessage(message: Message, deltaSec: number = 10): Promise<void> {
    const guild = message.guild;
    if (!guild) return;

    const cd = checkGuildActionCooldown(guild.id, "music_seek", 1000);
    if (cd !== null) {
      const cdMsg = await message.reply(`⏳ Tunggu **${cd} detik** sebelum mengatur posisi musik lagi ya~ (๑•́ ₃ •̀๑)`);
      setTimeout(() => cdMsg.delete().catch(() => {}), 4_000);
      return;
    }
    const session = sessions.get(guild.id);
    if (!session || !session.isPlaying || !session.currentTrack) {
      await message.reply("❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)");
      return;
    }
    const elapsed = session.currentResource ? Math.floor(session.currentResource.playbackDuration / 1000) : 0;
    const currentPos = Math.max(0, (session.seekOffsetSec || 0) + elapsed);
    const totalSec = session.currentTrack.durationSec || 300;
    const targetPos = Math.min(Math.max(0, totalSec - 2), currentPos + deltaSec);
    await MusicService.seekTrackInSession(session, targetPos);
    const fwdMsg = await message.reply(`⏩ **+${deltaSec}s**: Posisi musik sekarang di **${formatDuration(targetPos)}** (๑˃ᴗ˂)ﻌ`);
    setTimeout(() => fwdMsg.delete().catch(() => {}), 4_000);
    setTimeout(() => message.delete().catch(() => {}), 4_000);
  }

  public static async rewindFromMessage(message: Message, deltaSec: number = 10): Promise<void> {
    const guild = message.guild;
    if (!guild) return;

    const cd = checkGuildActionCooldown(guild.id, "music_seek", 1000);
    if (cd !== null) {
      const cdMsg = await message.reply(`⏳ Tunggu **${cd} detik** sebelum mengatur posisi musik lagi ya~ (๑•́ ₃ •̀๑)`);
      setTimeout(() => cdMsg.delete().catch(() => {}), 4_000);
      return;
    }
    const session = sessions.get(guild.id);
    if (!session || !session.isPlaying || !session.currentTrack) {
      await message.reply("❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)");
      return;
    }
    const elapsed = session.currentResource ? Math.floor(session.currentResource.playbackDuration / 1000) : 0;
    const currentPos = Math.max(0, (session.seekOffsetSec || 0) + elapsed);
    const targetPos = Math.max(0, currentPos - deltaSec);
    await MusicService.seekTrackInSession(session, targetPos);
    const rwdMsg = await message.reply(`⏪ **-${deltaSec}s**: Posisi musik sekarang di **${formatDuration(targetPos)}** (๑˃ᴗ˂)ﻌ`);
    setTimeout(() => rwdMsg.delete().catch(() => {}), 4_000);
    setTimeout(() => message.delete().catch(() => {}), 4_000);
  }

  public static async handleSkip(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "❌ Command ini hanya bisa dipakai di server.", ephemeral: true });
      return;
    }

    const cd = checkGuildActionCooldown(guild.id, "music_skip", 1500);
    if (cd !== null) {
      await interaction.reply({
        content: `⏳ Tunggu **${cd} detik** sebelum skip lagu lagi ya~ (๑•́ ₃ •̀๑)`,
        ephemeral: true,
      }).catch(() => {});
      return;
    }
    const session = sessions.get(guild.id);
    if (!session || (!session.isPlaying && !session.currentTrack)) {
      await interaction.reply({ content: "❌ Tidak ada musik yang sedang diputar untuk di-skip~ (๑•́ ₃ •̀๑)", ephemeral: true });
      return;
    }

    MusicService.cleanupSessionProcesses(session);
    const skippedTitle = session.currentTrack?.title || "Lagu";
    const hasNext = session.queue.length > 0;
    const nextTitle = hasNext ? session.queue[0]?.title || "Lagu Berikutnya" : "";
    session.isSeeking = false;
    session.seekOffsetSec = 0;
    session.manualStop = true;
    session.player.stop(true);

    const replyContent = hasNext
      ? `⏭️ **${skippedTitle}** di-skip oleh **${interaction.user.displayName || interaction.user.username}**! Memutar: **${nextTitle}** (๑˃ᴗ˂)ﻌ`
      : `⏭️ **${skippedTitle}** di-skip oleh **${interaction.user.displayName || interaction.user.username}**. Antrean sudah kosong! (◡ ω ◡)`;

    if (interaction.isButton()) {
      await interaction.deferUpdate().catch(() => {});
      const follow = await interaction.followUp({ content: replyContent }).catch(() => null);
      if (follow) setTimeout(() => follow.delete().catch(() => {}), 4_000);
    } else {
      const rep = await interaction.reply({ content: replyContent, fetchReply: true });
      setTimeout(() => rep.delete().catch(() => {}), 4_000);
    }
  }

  public static async handleQueue(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "❌ Command ini hanya bisa dipakai di server.", ephemeral: true });
      return;
    }
    const session = sessions.get(guild.id);
    if (!session || (!session.isPlaying && !session.currentTrack && session.queue.length === 0)) {
      await interaction.reply({ content: "❌ Tidak ada antrean musik saat ini~ (๑•́ ₃ •̀๑)", ephemeral: true });
      return;
    }

    const embed = buildQueueEmbed(session);
    await interaction.reply({ embeds: [embed] });
  }

  public static async handleNowPlaying(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "❌ Command ini hanya bisa dipakai di server.", ephemeral: true });
      return;
    }
    const session = sessions.get(guild.id);
    if (!session || !session.isPlaying || !session.currentTrack) {
      await interaction.reply({ content: "❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)", ephemeral: true });
      return;
    }

    const track = session.currentTrack;
    const elapsed = session.currentResource ? Math.floor(session.currentResource.playbackDuration / 1000) : 0;
    const currentPos = Math.max(0, (session.seekOffsetSec || 0) + elapsed);

    const embed = buildNowPlayingEmbed(track, false, currentPos);
    session.panelOwnerId = interaction.user.id;
    await MusicService.deletePreviewMessage(session);
    await interaction.reply({ embeds: [embed], components: buildMusicComponents(session) });
    session.previewMessage = await interaction.fetchReply().catch(() => null);
  }

  public static async skipFromMessage(message: Message): Promise<void> {
    const guild = message.guild;
    if (!guild) return;

    const cd = checkGuildActionCooldown(guild.id, "music_skip", 1500);
    if (cd !== null) {
      const cdMsg = await message.reply(`⏳ Tunggu **${cd} detik** sebelum skip lagu lagi ya~ (๑•́ ₃ •̀๑)`);
      setTimeout(() => cdMsg.delete().catch(() => {}), 4_000);
      return;
    }
    const session = sessions.get(guild.id);
    if (!session || (!session.isPlaying && !session.currentTrack)) {
      await message.reply("❌ Tidak ada musik yang sedang diputar untuk di-skip~ (๑•́ ₃ •̀๑)");
      return;
    }

    MusicService.cleanupSessionProcesses(session);
    const skippedTitle = session.currentTrack?.title || "Lagu";
    if (session.queue.length > 0) {
      const nextTitle = session.queue[0]?.title || "Lagu Berikutnya";
      session.isSeeking = false;
      session.seekOffsetSec = 0;
      session.manualStop = true;
      session.player.stop(true);
      const skipMsg = await message.reply(`⏭️ Berhasil skip **${skippedTitle}**! Memutar: **${nextTitle}** (๑˃ᴗ˂)ﻌ`);
      setTimeout(() => skipMsg.delete().catch(() => {}), 4_000);
      setTimeout(() => message.delete().catch(() => {}), 4_000);
    } else {
      session.manualStop = true;
      session.player.stop(true);
      session.isPlaying = false;
      session.currentTrack = null;
      session.currentResource = null;
      await MusicService.deletePreviewMessage(session);
      const skipMsg = await message.reply(`⏭️ Berhasil skip **${skippedTitle}**. Antrean sudah kosong! (◡ ω ◡)`);
      setTimeout(() => skipMsg.delete().catch(() => {}), 4_000);
      setTimeout(() => message.delete().catch(() => {}), 4_000);
    }
  }

  public static async queueFromMessage(message: Message): Promise<void> {
    const guild = message.guild;
    if (!guild) return;
    const session = sessions.get(guild.id);
    if (!session || (!session.isPlaying && !session.currentTrack && session.queue.length === 0)) {
      await message.reply("❌ Tidak ada antrean musik saat ini~ (๑•́ ₃ •̀๑)");
      return;
    }

    const embed = buildQueueEmbed(session);
    await message.reply({ embeds: [embed] });
  }

  public static async nowPlayingFromMessage(message: Message): Promise<void> {
    const guild = message.guild;
    if (!guild) return;
    const session = sessions.get(guild.id);
    if (!session || !session.isPlaying || !session.currentTrack) {
      await message.reply("❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)");
      return;
    }

    const track = session.currentTrack;
    const elapsed = session.currentResource ? Math.floor(session.currentResource.playbackDuration / 1000) : 0;
    const currentPos = Math.max(0, (session.seekOffsetSec || 0) + elapsed);

    const embed = buildNowPlayingEmbed(track, false, currentPos);
    session.panelOwnerId = message.author.id;
    await MusicService.deletePreviewMessage(session);
    const npMsg = await message.reply({ embeds: [embed], components: buildMusicComponents(session) });
    session.previewMessage = npMsg;
    setTimeout(() => message.delete().catch(() => {}), 3_000);
  }
}
