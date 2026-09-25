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
} from "discord.js";
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { PassThrough } from "stream";
import playdl from "play-dl";
import ytdl from "@distube/ytdl-core";
import ffmpegStatic from "ffmpeg-static";
import { logger } from "./logger";

// Resolve FFmpeg path (support both bundled ffmpeg-static and system binary)
export const FFMPEG_BIN = (ffmpegStatic && fs.existsSync(ffmpegStatic) ? ffmpegStatic : "ffmpeg") as string;
if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
  const ffmpegDir = path.dirname(ffmpegStatic);
  if (!process.env.PATH?.includes(ffmpegDir)) {
    process.env.PATH = `${ffmpegDir}${path.delimiter}${process.env.PATH || ""}`;
  }
}

export type MusicSource = "youtube" | "youtube_music" | "spotify" | "soundcloud" | "search";

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
  // Audio stream resolver with optional seek offset in seconds
  createStream: (seekSeconds?: number) => Promise<any>;
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
}

const sessions = new Map<string, GuildSession>();

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

// Ensure yt-dlp binary is available
export async function getOrDownloadYtDlp(): Promise<string> {
  if (cachedYtDlpPath) return cachedYtDlpPath;

  const isWin = process.platform === "win32";
  const cmdName = isWin ? "yt-dlp.exe" : "yt-dlp";

  // 1. Check if yt-dlp is available in system PATH directly
  try {
    const test = spawnSync(cmdName, ["--version"], { timeout: 2000, stdio: "ignore" });
    if (test.status === 0) {
      cachedYtDlpPath = cmdName;
      logger.info({ cmd: cmdName }, "Found working yt-dlp in system PATH");
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
    return localYtDlp;
  }

  // 3. Check known Linux paths (pipx, nixpacks, standard)
  const sysCandidates = isWin
    ? [path.join(process.env.APPDATA || "", "Python", "Scripts", "yt-dlp.exe")]
    : [
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
      logger.info({ path: sysPath }, "Found existing yt-dlp binary");
      return sysPath;
    }
  }

  // 4. Fallback: download if not found anywhere
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const downloadUrl = isWin
    ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

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

// Initialize SoundCloud free client id for play-dl
let scInitialized = false;
export async function initSoundCloud(): Promise<void> {
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
async function getYtDlpMetadata(url: string, ytdlpPath: string, timeoutMs: number = 6000): Promise<{
  id: string;
  url: string;
  title: string;
  artist: string;
  duration: string;
  durationSec?: number;
  thumbnail?: string;
} | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const cookieArgs = getYtDlpCookieArgs();
    const proc = spawn(ytdlpPath, [
      "--js-runtimes", "node",
      ...cookieArgs,
      "--extractor-args", "youtube:player_client=android,web,mweb",
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

  // 1. Try yt-dlp first (most accurate for exact duration, title, uploader & thumbnail)
  try {
    const ytdlpMeta = await getYtDlpMetadata(targetUrl, binPath);
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

  // 3. Fallback to YouTube oEmbed
  const oembed = await getYouTubeOEmbed(targetUrl);
  if (oembed) {
    const parsed = parseTitleAndArtist(oembed.title, oembed.author);
    return {
      id: videoId || "",
      url: targetUrl,
      title: parsed.title,
      artist: parsed.artist || oembed.author || "Artis YouTube",
      duration: "Audio",
      durationSec: undefined,
      thumbnail: oembed.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined),
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

// Helper to check for YouTube cookies (from file or environment variable)
function getYtDlpCookieArgs(): string[] {
  // 1. Check cookies.txt first (standard filename used by users and browser extensions)
  const localCookies = path.join(process.cwd(), "cookies.txt");
  if (fs.existsSync(localCookies)) {
    try {
      const stats = fs.statSync(localCookies);
      if (stats.size > 10) {
        return ["--cookies", localCookies];
      }
    } catch {}
  }

  // 2. Check cookies.full.txt as secondary fallback
  const fullCookies = path.join(process.cwd(), "cookies.full.txt");
  if (fs.existsSync(fullCookies)) {
    try {
      const stats = fs.statSync(fullCookies);
      if (stats.size > 10) {
        return ["--cookies", fullCookies];
      }
    } catch {}
  }

  // 3. Check environment variable (cross-platform temp path)
  if (process.env.YOUTUBE_COOKIE && process.env.YOUTUBE_COOKIE.trim()) {
    const tmpCookiePath = path.join(os.tmpdir(), "porsche_chan_youtube_cookies.txt");
    try {
      fs.writeFileSync(tmpCookiePath, process.env.YOUTUBE_COOKIE.trim(), "utf-8");
      return ["--cookies", tmpCookiePath];
    } catch (err) {
      logger.warn({ err }, "Could not write temporary youtube cookie file");
    }
  }
  return [];
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
      return createAudioResource(s.stream, { inputType: s.type });
    } catch {
      // Fallback: spawn FFmpeg with -ss to seek into the stream
      const s = await playdl.stream(trackUrl);
      const ffmpeg = spawn(FFMPEG_BIN, [
        "-ss", seekSeconds.toString(),
        "-i", "pipe:0",
        "-ar", "48000",
        "-ac", "2",
        "-f", "s16le",
        "-loglevel", "error",
        "pipe:1",
      ], { stdio: ["pipe", "pipe", "ignore"] });
      s.stream.pipe(ffmpeg.stdin);
      return createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
    }
  } else {
    const s = await playdl.stream(trackUrl);
    return createAudioResource(s.stream, { inputType: s.type });
  }
}

// Fast extraction of direct audio URL using yt-dlp with timeout protection and optional cookies
async function getDirectAudioUrlWithYtDlp(url: string, ytdlpPath: string, timeoutMs: number = 6000): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let resolved = false;
    let directUrl = "";

    const cookieArgs = getYtDlpCookieArgs();
    const procArgs = [
      "--js-runtimes", "node",
      ...cookieArgs,
      "--extractor-args", "youtube:player_client=android,web,mweb",
      "-g", "-f", "bestaudio/ba/ba*/b/best",
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

// Terms indicating unofficial versions, covers, or altered speeds
const UNWANTED_TERMS = [
  "remix", "tik tok", "tiktok", "pop punk", "rock cover", "cover", "slowed",
  "reverb", "sped up", "speed up", "nightcore", "instrumental", "karaoke",
  "amapiano", "hardstyle", "mashup", "parodi", "guitar cover", "drum cover",
  "fingerstyle", "1 hour", "1hour", "loop", "bass boosted", "edit", "dj",
  "x dj", "prod.", "ft. dj", "bootleg", "full album", "compilation", "playlist"
];

// Precision candidate scoring algorithm to pick the true original song
export function scoreTrackCandidate(
  targetTitle: string,
  targetArtist: string,
  targetDurationSec: number | undefined,
  candidate: any
): number {
  const cName = (candidate.name || (candidate as any).title || "").toLowerCase();
  const cUser = ((candidate.user?.name || candidate.user?.username || candidate.publisher?.artist || "")).toLowerCase();
  const dur = candidate.durationInSec || Math.round(((candidate as any).durationInMs || 0) / 1000) || 0;

  // Rule 0: Discard extreme outliers (snippets < 50s or loops/compilations > 720s)
  if (dur > 0 && (dur < 50 || dur > 720)) return -1000;

  let score = 100;
  const targetLower = `${targetTitle} ${targetArtist}`.toLowerCase();

  // 1. Heavy penalty for unwanted keywords if not requested by user
  for (const junk of UNWANTED_TERMS) {
    if (!targetLower.includes(junk) && cName.includes(junk)) {
      score -= 100;
    }
  }

  // 2. Penalty for unnecessary bracket clutter if original title has none
  if (!targetLower.includes("[") && cName.includes("[")) score -= 25;
  if (!targetLower.includes("(") && cName.includes("(")) score -= 15;

  // 3. Match title keywords
  const cleanT = targetTitle.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const tWords = cleanT.split(/\s+/).filter((w) => w.length >= 2);
  let matchedTitleWords = 0;
  for (const w of tWords) {
    if (cName.includes(w)) matchedTitleWords++;
  }
  if (tWords.length > 0) {
    score += Math.round((matchedTitleWords / tWords.length) * 70);
  }

  // 4. Match artist keywords
  if (targetArtist && !/^(artis musik|unknown)$/i.test(targetArtist)) {
    const cleanA = targetArtist.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
    const aWords = cleanA.split(/\s+/).filter((w) => w.length >= 2);
    let matchedArtistWords = 0;
    for (const w of aWords) {
      if (cName.includes(w) || cUser.includes(w)) matchedArtistWords++;
    }
    if (aWords.length > 0) {
      score += Math.round((matchedArtistWords / aWords.length) * 60);
    }
  }

  // 5. Duration matching with high precision
  if (targetDurationSec && targetDurationSec > 30) {
    const diff = Math.abs(dur - targetDurationSec);
    if (diff <= 12) score += 50;
    else if (diff <= 30) score += 25;
    else if (diff > 60) score -= 90;
    else if (diff > 120) score -= 180;
  } else {
    if (dur >= 130 && dur <= 310) score += 25;
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
      "--js-runtimes", "node",
      ...cookieArgs,
      "--extractor-args", "youtube:player_client=android,web,mweb",
      "--dump-single-json",
      "--no-warnings",
      "--flat-playlist",
      `ytsearch5:${query}`,
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
          .map((e) => ({
            entry: e,
            score: scoreTrackCandidate(candidateTargetTitle, candidateTargetArtist, targetDurationSec, {
              name: e.title,
              user: { name: e.uploader || e.channel },
              durationInSec: e.duration,
            }),
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

export async function searchYouTubeWithYtDlp(
  query: string,
  ytdlpPath: string,
  targetTitle?: string,
  targetArtist?: string,
  targetDurationSec?: number
): Promise<YouTubeSearchResult> {
  try {
    return await searchYouTubeInternal(query, ytdlpPath, targetTitle, targetArtist, targetDurationSec);
  } catch (err) {
    logger.warn({ err, query }, "yt-dlp search failed or timed out, trying play-dl search fallback");
    try {
      const searchResults = await playdl.search(query, { limit: 5 });
      if (searchResults && searchResults.length > 0) {
        const first = searchResults[0];
        const rawTitle = first.title || query;
        const rawUploader = first.channel?.name || "";
        const parsed = parseTitleAndArtist(rawTitle, rawUploader);
        const durSec = first.durationInSec || 210;
        return {
          id: first.id || "",
          url: first.url,
          title: parsed.title || rawTitle,
          artist: parsed.artist && !isRecordLabelOrLyricChannel(parsed.artist) ? parsed.artist : rawUploader || "Artis YouTube",
          duration: formatDuration(durSec),
          durationSec: durSec,
          thumbnail: first.thumbnails?.[0]?.url,
        };
      }
    } catch (fallbackErr) {
      logger.error({ fallbackErr }, "play-dl search fallback also failed");
    }

    // Secondary fallback: search SoundCloud directly (highly reliable on datacenter IPs)
    try {
      const scClientId = await playdl.getFreeClientID();
      await playdl.setToken({ soundcloud: { client_id: scClientId } });
      const scResults = await playdl.search(query, { source: { soundcloud: "tracks" }, limit: 1 });
      if (scResults && scResults.length > 0) {
        const scTrack: any = scResults[0];
        logger.info({ title: scTrack.name || scTrack.title }, "Found track via SoundCloud search fallback");
        return {
          id: String(scTrack.id || ""),
          url: scTrack.url,
          title: scTrack.name || scTrack.title || query,
          artist: scTrack.user?.name || scTrack.artist || "SoundCloud Artist",
          duration: scTrack.durationRaw || formatDuration(scTrack.durationInSec) || "3:30",
          durationSec: scTrack.durationInSec,
          thumbnail: scTrack.thumbnail || scTrack.thumbnails?.[0]?.url,
        };
      }
    } catch (scSearchErr) {
      logger.warn({ scSearchErr }, "SoundCloud search fallback failed");
    }

    throw err;
  }
}

// Helper for validating piped yt-dlp -> ffmpeg stream with fast failover
function tryPipedStream(
  ytdlpPath: string,
  ytdlpArgs: string[],
  seekSeconds: number,
  timeoutMs: number = 4000
): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ytdlp: any;
    let ffmpeg: any;

    try {
      ytdlp = spawn(ytdlpPath, ytdlpArgs, { stdio: ["ignore", "pipe", "ignore"] });
      const ffmpegArgs: string[] = [
        "-analyzeduration", "0",
        "-loglevel", "error",
      ];
      if (seekSeconds > 0) {
        ffmpegArgs.push("-ss", seekSeconds.toString());
      }
      ffmpegArgs.push("-i", "pipe:0", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1");
      ffmpeg = spawn(FFMPEG_BIN, ffmpegArgs, { stdio: ["pipe", "pipe", "ignore"] });
    } catch (spawnErr) {
      return reject(spawnErr);
    }

    ytdlp.stdout.on("error", () => {});
    ffmpeg.stdin.on("error", () => {});
    ffmpeg.stdout.on("error", () => {});

    ytdlp.stdout.pipe(ffmpeg.stdin);

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ytdlp.kill("SIGKILL"); } catch {}
        try { ffmpeg.kill("SIGKILL"); } catch {}
        reject(new Error("Piped audio stream timeout"));
      }
    }, timeoutMs);

    ytdlp.on("error", (err: any) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try { ffmpeg.kill("SIGKILL"); } catch {}
        reject(err);
      }
    });

    ffmpeg.on("error", (err: any) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try { ytdlp.kill("SIGKILL"); } catch {}
        reject(err);
      }
    });

    ytdlp.on("close", (code: number) => {
      if (!settled && code !== 0) {
        settled = true;
        clearTimeout(timer);
        try { ffmpeg.kill("SIGKILL"); } catch {}
        reject(new Error(`yt-dlp exited with error code ${code}`));
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
        resolve(createAudioResource(pt, { inputType: StreamType.Raw }));
      }
    };
    ffmpeg.stdout.on("data", onData);
  });
}

// Helper for validating direct HTTPS stream piped through FFmpeg with fast failover
function tryPipedUrlStream(
  audioUrl: string,
  seekSeconds: number,
  timeoutMs: number = 3500
): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ffmpeg: any;

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
      ffmpeg = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch (spawnErr) {
      return reject(spawnErr);
    }

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

    ffmpeg.on("close", (code: number) => {
      if (!settled && code !== 0) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`FFmpeg exited with error code ${code}`));
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
        resolve(createAudioResource(pt, { inputType: StreamType.Raw }));
      }
    };
    ffmpeg.stdout.on("data", onData);
  });
}

// Create AudioResource from YouTube with multi-tier streaming architecture (Piped yt-dlp -> FFmpeg -> Direct URL -> SoundCloud fallback)
export async function createAudioResourceFromYtDlp(
  urlOrQuery: string,
  seekSeconds: number = 0,
  ytdlpPath: string,
  fallbackSearchQuery?: string
): Promise<any> {
  const cookieArgs = getYtDlpCookieArgs();

  // Tier 1: Direct yt-dlp stdout pipe into FFmpeg raw PCM (Primary, fastest)
  try {
    const ytdlpArgs = [
      "--js-runtimes", "node",
      ...cookieArgs,
      "--extractor-args", "youtube:player_client=android,web,mweb",
      "-q",
      "--no-warnings",
      "--no-progress",
      "-o", "-",
      "-f", "ba/ba*/b/best",
      "--no-playlist",
      urlOrQuery,
    ];
    const resource = await tryPipedStream(ytdlpPath, ytdlpArgs, seekSeconds, 3500);
    logger.info({ urlOrQuery }, "Started Tier 1 yt-dlp stdout pipe stream");
    return resource;
  } catch (err) {
    logger.warn({ err }, "Tier 1 yt-dlp pipe stream failed, trying Tier 2");
  }

  // Tier 2: Clean session without cookies (in case cookies are expired or challenged)
  if (cookieArgs.length > 0) {
    try {
      const ytdlpArgs = [
        "--js-runtimes", "node",
        "--extractor-args", "youtube:player_client=android,web,mweb",
        "-q",
        "--no-warnings",
        "--no-progress",
        "-o", "-",
        "-f", "ba/ba*/b/best",
        "--no-playlist",
        urlOrQuery,
      ];
      const resource = await tryPipedStream(ytdlpPath, ytdlpArgs, seekSeconds, 3500);
      logger.info({ urlOrQuery }, "Started Tier 2 yt-dlp clean session pipe stream");
      return resource;
    } catch (err) {
      logger.warn({ err }, "Tier 2 clean session pipe stream failed, trying Tier 3");
    }
  }

  // Tier 3: Direct HTTPS audio URL extracted by yt-dlp with chunk validation
  try {
    const directUrl = await getDirectAudioUrlWithYtDlp(urlOrQuery, ytdlpPath, 5000);
    if (directUrl) {
      logger.info({ urlOrQuery }, "Attempting Tier 3 yt-dlp direct HTTPS audio URL");
      const resource = await tryPipedUrlStream(directUrl, seekSeconds, 3500);
      logger.info({ urlOrQuery }, "Streaming via Tier 3 yt-dlp direct HTTPS audio URL");
      return resource;
    }
  } catch (err) {
    logger.warn({ err }, "Tier 3 direct URL failed, proceeding to Tier 4 SoundCloud fallback");
  }

  // Tier 4: SoundCloud fallback audio stream (ultra-reliable when YouTube IP is challenged)
  const candidatesToSearch = [
    fallbackSearchQuery,
    urlOrQuery,
  ].filter(Boolean) as string[];

  const cleanCandidates: string[] = [];
  for (const raw of candidatesToSearch) {
    const stripped = raw
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/\b(Artis YouTube|Official Video|Official Music Video|Official Audio|Lyric Video|Full Album|Audio|Video)\b/gi, "")
      .replace(/[|•\-_\[\]\(\)#]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (stripped) {
      cleanCandidates.push(stripped);
      // Also add just the first 3-5 words if long title
      const words = stripped.split(" ");
      if (words.length > 3) {
        cleanCandidates.push(words.slice(0, 3).join(" "));
      }
    }
  }

  for (const q of cleanCandidates) {
    try {
      const scClientId = await playdl.getFreeClientID();
      await playdl.setToken({ soundcloud: { client_id: scClientId } });
      const res = await playdl.search(q, { source: { soundcloud: "tracks" }, limit: 1 });
      if (res && res.length > 0 && res[0].url) {
        logger.info({ query: q, scUrl: res[0].url }, "Streaming via SoundCloud fallback audio stream");
        return await createAudioResourceFromTrackUrl(res[0].url, seekSeconds);
      }
    } catch (scErr) {
      logger.warn({ scErr }, "SoundCloud fallback candidate search failed");
    }
  }

  throw new Error("Gagal memutar audio dari semua sumber streaming.");
}

// Main Track Resolver: handles YouTube, YouTube Music, Spotify, SoundCloud, and Text Query (Prioritizing User Links)
export async function resolveMusicTrack(
  input: string,
  requester: { name: string; id: string }
): Promise<TrackMetadata> {
  const cleanInput = input.trim();
  const ytdlpPath = await getOrDownloadYtDlp();

  // 0. SOUNDCLOUD DIRECT LINK
  if (cleanInput.includes("soundcloud.com")) {
    try {
      const scInfo: any = await playdl.soundcloud(cleanInput);
      if (scInfo && (scInfo.name || scInfo.title)) {
        return {
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
        };
      }
    } catch (scErr) {
      logger.warn({ scErr }, "SoundCloud direct link resolution failed");
    }
  }

  // 1. SPOTIFY LINK (PRIORITAS LINK SPOTIFY USER -> RESOLVE METADATA & STREAM)
  if (cleanInput.includes("spotify.com")) {
    const spInfo = await getSpotifyTrackInfo(cleanInput);
    const title = spInfo?.title || "Spotify Track";
    const artist = spInfo?.artist || "";
    const durationSec = spInfo?.durationSec;
    const thumbnail = spInfo?.thumbnail;
    const query = `${title} ${artist}`.trim();

    const ytMatch = await searchYouTubeWithYtDlp(query, ytdlpPath, title, artist, durationSec);

    return {
      title,
      artist: artist || ytMatch.artist,
      duration: durationSec ? formatDuration(durationSec) : ytMatch.duration,
      durationSec: durationSec || ytMatch.durationSec,
      url: cleanInput,
      thumbnail: thumbnail || ytMatch.thumbnail,
      source: "spotify",
      sourceBadge: "🟢 Spotify",
      sourceColor: 0x1db954,
      requesterName: requester.name,
      requesterId: requester.id,
      rawTrackUrl: ytMatch.url,
      createStream: async (seekSeconds: number = 0) => {
        return createAudioResourceFromYtDlp(ytMatch.url, seekSeconds, ytdlpPath, query);
      },
    };
  }

  // 2. YOUTUBE MUSIC LINK (PRIORITAS LINK YOUTUBE MUSIC USER)
  if (cleanInput.includes("music.youtube.com")) {
    const ytMeta = await getYouTubeMetadata(cleanInput);
    const canonicalUrl = ytMeta.url;

    return {
      title: ytMeta.title,
      artist: ytMeta.artist,
      duration: ytMeta.duration,
      durationSec: ytMeta.durationSec,
      url: cleanInput,
      thumbnail: ytMeta.thumbnail,
      source: "youtube_music",
      sourceBadge: "🎵 YouTube Music",
      sourceColor: 0xff334b,
      requesterName: requester.name,
      requesterId: requester.id,
      rawTrackUrl: canonicalUrl,
      createStream: async (seekSeconds: number = 0) => {
        return createAudioResourceFromYtDlp(canonicalUrl, seekSeconds, ytdlpPath, `${ytMeta.title} ${ytMeta.artist}`);
      },
    };
  }

  // 3. YOUTUBE DIRECT LINK (PRIORITAS LINK YOUTUBE USER)
  if (cleanInput.includes("youtube.com") || cleanInput.includes("youtu.be")) {
    const ytMeta = await getYouTubeMetadata(cleanInput);
    const canonicalUrl = ytMeta.url;

    return {
      title: ytMeta.title,
      artist: ytMeta.artist,
      duration: ytMeta.duration,
      durationSec: ytMeta.durationSec,
      url: cleanInput,
      thumbnail: ytMeta.thumbnail,
      source: "youtube",
      sourceBadge: "🔴 YouTube",
      sourceColor: 0xff0000,
      requesterName: requester.name,
      requesterId: requester.id,
      rawTrackUrl: canonicalUrl,
      createStream: async (seekSeconds: number = 0) => {
        return createAudioResourceFromYtDlp(canonicalUrl, seekSeconds, ytdlpPath, `${ytMeta.title} ${ytMeta.artist}`);
      },
    };
  }

  // 4. QUERY PENCARIAN TEKS DENGAN YOUTUBE CANDIDATE SCORING
  const ytMatch = await searchYouTubeWithYtDlp(cleanInput, ytdlpPath);

  return {
    title: ytMatch.title,
    artist: ytMatch.artist,
    duration: ytMatch.duration,
    durationSec: ytMatch.durationSec,
    url: ytMatch.url,
    thumbnail: ytMatch.thumbnail,
    source: ytMatch.url.includes("soundcloud.com") ? "soundcloud" : "youtube",
    sourceBadge: ytMatch.url.includes("soundcloud.com") ? "🟠 SoundCloud" : "🔴 YouTube",
    sourceColor: ytMatch.url.includes("soundcloud.com") ? 0xff5500 : 0xff0000,
    requesterName: requester.name,
    requesterId: requester.id,
    rawTrackUrl: ytMatch.url,
    createStream: async (seekSeconds: number = 0) => {
      if (ytMatch.url.includes("soundcloud.com")) {
        return createAudioResourceFromTrackUrl(ytMatch.url, seekSeconds);
      }
      return createAudioResourceFromYtDlp(ytMatch.url, seekSeconds, ytdlpPath, `${ytMatch.title} ${ytMatch.artist}`);
    },
  };
}

// Build Music Embed
export function buildNowPlayingEmbed(track: TrackMetadata, isQueue: boolean = false): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(track.sourceColor)
    .setTitle(isQueue ? "📋 Ditambahkan ke Antrean Musik ✨" : "🎶 Sekarang Memutar Musik ✨")
    .setDescription(`**[${track.title}](${track.url})**`)
    .addFields(
      { name: "👤 Artis / Channel", value: track.artist?.trim() ? track.artist : "Artis Musik", inline: true },
      { name: "⏱️ Durasi", value: track.duration?.trim() ? track.duration : "3:30", inline: true },
      { name: "🌐 Sumber", value: track.sourceBadge, inline: true },
      { name: "🙋 Diminta Oleh", value: track.requesterName || "Sahabat Porsche-chan", inline: true }
    )
    .setFooter({ text: "Porsche-chan Music Engine • Suara Jernih 48kHz Stereo" })
    .setTimestamp();

  if (track.thumbnail) {
    embed.setThumbnail(track.thumbnail);
  }

  return embed;
}

// Helper to generate visual progress bar for Now Playing
export function buildProgressBar(currentSec: number, totalSec: number, length: number = 16): string {
  if (!totalSec || totalSec <= 0) return "🔘" + "─".repeat(length - 1);
  const progress = Math.min(1, Math.max(0, currentSec / totalSec));
  const progressIndex = Math.round(progress * (length - 1));
  const bar = "─".repeat(progressIndex) + "🔘" + "─".repeat(length - 1 - progressIndex);
  return bar;
}

// Interactive Music Playback Buttons: [ ⏸️ Pause / ▶️ Resume ] [ ⏭️ Skip ] [ ⏹️ Stop ]
export function buildMusicControlRow(isPaused: boolean = false, disabled: boolean = false): ActionRowBuilder<ButtonBuilder> {
  const pauseResumeBtn = new ButtonBuilder()
    .setCustomId("music_pause_resume")
    .setLabel(isPaused ? "Resume" : "Pause")
    .setEmoji(isPaused ? "▶️" : "⏸️")
    .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary)
    .setDisabled(disabled);

  const skipBtn = new ButtonBuilder()
    .setCustomId("music_skip")
    .setLabel("Skip")
    .setEmoji("⏭️")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);

  const stopBtn = new ButtonBuilder()
    .setCustomId("music_stop")
    .setLabel("Stop")
    .setEmoji("⏹️")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(pauseResumeBtn, skipBtn, stopBtn);
}

// Music Player Session Management
export class MusicService {
  public static getSession(guildId: string): GuildSession | undefined {
    return sessions.get(guildId);
  }

  public static async joinOrGetVoice(
    guild: Guild,
    voiceChannel: VoiceBasedChannel,
    textChannel?: TextBasedChannel
  ): Promise<GuildSession> {
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
          safeDestroyVoiceConnection(connection);
          sessions.delete(guild.id);
        }
      });

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 7_000);
      } catch (connErr) {
        logger.warn({ connErr, guildId: guild.id }, "Voice connection takes longer than 7s to become Ready");
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
      };

      player.on(AudioPlayerStatus.Idle, async () => {
        if (session!.isSeeking) {
          session!.isSeeking = false;
          return;
        }
        logger.info({ guildId: guild.id }, "Audio player is idle, advancing queue");
        session!.isPlaying = false;
        session!.isPaused = false;
        session!.currentTrack = null;
        session!.currentResource = null;
        session!.seekOffsetSec = 0;

        if (session!.queue.length > 0) {
          const nextTrack = session!.queue.shift()!;
          await MusicService.playTrackInSession(session!, nextTrack);
        }
      });

      player.on("error", (error) => {
        logger.error({ guildId: guild.id, error }, "Audio player error encountered");
        if (session!.isSeeking) {
          session!.isSeeking = false;
          return;
        }
        session!.isPlaying = false;
        session!.isPaused = false;
        session!.currentTrack = null;
        session!.currentResource = null;
        session!.seekOffsetSec = 0;
        if (session!.queue.length > 0) {
          const nextTrack = session!.queue.shift()!;
          MusicService.playTrackInSession(session!, nextTrack).catch(() => {});
        }
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
      const resource = await session.currentTrack.createStream(targetSec);
      session.seekOffsetSec = targetSec;
      session.currentResource = resource;
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
      if (session.connection.state.status !== VoiceConnectionStatus.Ready && session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
        try {
          await entersState(session.connection, VoiceConnectionStatus.Ready, 5_000);
        } catch {}
      }
      session.connection.subscribe(session.player);

      const resource = await track.createStream(0);
      session.currentTrack = track;
      session.currentResource = resource;
      session.isPlaying = true;
      session.isPaused = false;
      session.isSeeking = false;
      session.seekOffsetSec = 0;
      session.player.play(resource);

      if (session.textChannel && "send" in session.textChannel) {
        const embed = buildNowPlayingEmbed(track, false);
        await (session.textChannel as any).send({
          embeds: [embed],
          components: [buildMusicControlRow(false)],
        }).catch(() => {});
      }
    } catch (err) {
      logger.error({ err, track: track.title }, "Failed to stream audio resource");
      if (session.textChannel && "send" in session.textChannel) {
        await (session.textChannel as any).send(`❌ Gagal memutar lagu **${track.title}**: ${(err as Error).message}`).catch(() => {});
      }
      if (session.queue.length > 0) {
        const next = session.queue.shift()!;
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

    const queryOrUrl = interaction.options.getString("url", true);
    await interaction.deferReply();

    try {
      const track = await resolveMusicTrack(queryOrUrl, {
        name: interaction.user.displayName || interaction.user.username,
        id: interaction.user.id,
      });

      const textChannel = interaction.channel as TextBasedChannel;
      const session = await MusicService.joinOrGetVoice(guild, voiceChannel, textChannel);

      if (session.isPlaying && session.currentTrack) {
        session.queue.push(track);
        const embed = buildNowPlayingEmbed(track, true);
        await interaction.editReply({ embeds: [embed] });
      } else {
        if (session.connection.state.status !== VoiceConnectionStatus.Ready && session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
          try {
            await entersState(session.connection, VoiceConnectionStatus.Ready, 5_000);
          } catch {}
        }
        session.connection.subscribe(session.player);

        const resource = await track.createStream(0);
        session.currentTrack = track;
        session.currentResource = resource;
        session.isPlaying = true;
        session.isPaused = false;
        session.isSeeking = false;
        session.seekOffsetSec = 0;
        session.player.play(resource);

        const embed = buildNowPlayingEmbed(track, false);
        await interaction.editReply({
          embeds: [embed],
          components: [buildMusicControlRow(false)],
        });
      }
    } catch (err) {
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

    const session = sessions.get(guild.id);
    if (!session || (!session.isPlaying && !session.currentTrack && session.queue.length === 0)) {
      await interaction.reply({
        content: "❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)",
        ephemeral: true,
      });
      return;
    }

    session.queue = [];
    session.currentTrack = null;
    session.currentResource = null;
    session.isPlaying = false;
    session.isPaused = false;
    session.seekOffsetSec = 0;
    session.player.stop(true);

    await interaction.reply({
      content: "⏹️ Musik telah dihentikan dan antrean dibersihkan! Porsche-chan tetap stay di VC ya~ (◡ ω ◡)",
    });
  }

  public static async handlePause(interaction: ChatInputCommandInteraction): Promise<void> {
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

    if (session.isPaused) {
      await interaction.reply({ content: "⏸️ Musik sudah dalam keadaan dijeda!", ephemeral: true });
      return;
    }

    session.player.pause();
    session.isPaused = true;
    await interaction.reply({ content: `⏸️ Musik dijeda oleh **${interaction.user.displayName || interaction.user.username}**! (◡ ω ◡)` });
  }

  public static async handleResume(interaction: ChatInputCommandInteraction): Promise<void> {
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

    if (!session.isPaused) {
      await interaction.reply({ content: "▶️ Musik sedang aktif berjalan!", ephemeral: true });
      return;
    }

    session.player.unpause();
    session.isPaused = false;
    await interaction.reply({ content: `▶️ Musik dilanjutkan oleh **${interaction.user.displayName || interaction.user.username}**! (o´∀\`o)` });
  }

  public static async handleSeekCommand(interaction: ChatInputCommandInteraction, deltaSec: number): Promise<void> {
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

    // 1. Pause / Resume Toggle
    if (customId === "music_pause_resume") {
      if (session.isPaused) {
        session.player.unpause();
        session.isPaused = false;
        await interaction.update({ components: [buildMusicControlRow(false)] }).catch(() => {});
        await interaction.followUp({
          content: `▶️ Musik dilanjutkan oleh **${interaction.user.displayName || interaction.user.username}**! (o´∀\`o)`,
        }).catch(() => {});
      } else {
        session.player.pause();
        session.isPaused = true;
        await interaction.update({ components: [buildMusicControlRow(true)] }).catch(() => {});
        await interaction.followUp({
          content: `⏸️ Musik dijeda oleh **${interaction.user.displayName || interaction.user.username}**! (◡ ω ◡)`,
        }).catch(() => {});
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
      }).catch(() => {});
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
      }).catch(() => {});
      return;
    }

    // 4. Stop
    if (customId === "music_stop") {
      session.queue = [];
      session.currentTrack = null;
      session.currentResource = null;
      session.isPlaying = false;
      session.isPaused = false;
      session.seekOffsetSec = 0;
      session.player.stop(true);

      await interaction.update({ components: [buildMusicControlRow(false, true)] }).catch(() => {});
      await interaction.followUp({
        content: `⏹️ Musik telah dihentikan dan antrean dibersihkan oleh **${interaction.user.displayName || interaction.user.username}**! (◡ ω ◡)`,
      }).catch(() => {});
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

    await interaction.reply({
      content: "👋 Porsche-chan keluar dari voice channel. Sampai jumpa lagi~! (◡ ω ◡)",
    });
  }

  public static async playFromMessage(message: Message, queryOrUrl: string): Promise<void> {
    const member = message.member;
    const voiceChannel = member?.voice?.channel;
    const guild = message.guild;

    if (!guild || !voiceChannel) {
      await message.reply("❌ Masuk ke voice channel dulu ya sebelum minta putar musik! (๑•́ ₃ •̀๑)");
      return;
    }

    const loadingMsg = await message.reply("🔎 Mencari & menyiapkan audio... Tunggu sebentar ya~ (๑˃ᴗ˂)ﻌ");
    try {
      const track = await resolveMusicTrack(queryOrUrl, {
        name: message.author.displayName || message.author.username,
        id: message.author.id,
      });

      const textChannel = message.channel as TextBasedChannel;
      const session = await MusicService.joinOrGetVoice(guild, voiceChannel, textChannel);

      if (session.isPlaying && session.currentTrack) {
        session.queue.push(track);
        const embed = buildNowPlayingEmbed(track, true);
        await loadingMsg.edit({ content: null, embeds: [embed] });
      } else {
        if (session.connection.state.status !== VoiceConnectionStatus.Ready && session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
          try {
            await entersState(session.connection, VoiceConnectionStatus.Ready, 5_000);
          } catch {}
        }
        session.connection.subscribe(session.player);

        const resource = await track.createStream(0);
        session.currentTrack = track;
        session.currentResource = resource;
        session.isPlaying = true;
        session.isPaused = false;
        session.isSeeking = false;
        session.seekOffsetSec = 0;
        session.player.play(resource);

        const embed = buildNowPlayingEmbed(track, false);
        await loadingMsg.edit({
          content: null,
          embeds: [embed],
          components: [buildMusicControlRow(false)],
        });
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
    const session = sessions.get(guild.id);
    if (!session || (!session.isPlaying && !session.currentTrack && session.queue.length === 0)) {
      await message.reply("❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)");
      return;
    }
    session.queue = [];
    session.currentTrack = null;
    session.currentResource = null;
    session.isPlaying = false;
    session.isPaused = false;
    session.seekOffsetSec = 0;
    session.player.stop(true);
    await message.reply("⏹️ Musik telah dihentikan dan antrean dibersihkan! Porsche-chan tetap stay di VC ya~ (◡ ω ◡)");
  }

  public static async pauseFromMessage(message: Message): Promise<void> {
    const guild = message.guild;
    if (!guild) return;
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
    await message.reply(`⏸️ Musik dijeda oleh **${message.author.displayName || message.author.username}**! (◡ ω ◡)`);
  }

  public static async resumeFromMessage(message: Message): Promise<void> {
    const guild = message.guild;
    if (!guild) return;
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
    await message.reply(`▶️ Musik dilanjutkan oleh **${message.author.displayName || message.author.username}**! (o´∀\`o)`);
  }

  public static async forwardFromMessage(message: Message, deltaSec: number = 10): Promise<void> {
    const guild = message.guild;
    if (!guild) return;
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
    await message.reply(`⏩ **+${deltaSec}s**: Posisi musik sekarang di **${formatDuration(targetPos)}** (๑˃ᴗ˂)ﻌ`);
  }

  public static async rewindFromMessage(message: Message, deltaSec: number = 10): Promise<void> {
    const guild = message.guild;
    if (!guild) return;
    const session = sessions.get(guild.id);
    if (!session || !session.isPlaying || !session.currentTrack) {
      await message.reply("❌ Tidak ada musik yang sedang diputar saat ini~ (๑•́ ₃ •̀๑)");
      return;
    }
    const elapsed = session.currentResource ? Math.floor(session.currentResource.playbackDuration / 1000) : 0;
    const currentPos = Math.max(0, (session.seekOffsetSec || 0) + elapsed);
    const targetPos = Math.max(0, currentPos - deltaSec);
    await MusicService.seekTrackInSession(session, targetPos);
    await message.reply(`⏪ **-${deltaSec}s**: Posisi musik sekarang di **${formatDuration(targetPos)}** (๑˃ᴗ˂)ﻌ`);
  }

  public static async handleSkip(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "❌ Command ini hanya bisa dipakai di server.", ephemeral: true });
      return;
    }
    const session = sessions.get(guild.id);
    if (!session || (!session.isPlaying && !session.currentTrack)) {
      await interaction.reply({ content: "❌ Tidak ada musik yang sedang diputar untuk di-skip~ (๑•́ ₃ •̀๑)", ephemeral: true });
      return;
    }

    const skippedTitle = session.currentTrack?.title || "Lagu";
    if (session.queue.length > 0) {
      const nextTrack = session.queue.shift()!;
      session.isSeeking = false;
      session.seekOffsetSec = 0;
      session.player.stop(true);
      await MusicService.playTrackInSession(session, nextTrack);
      const replyContent = `⏭️ Berhasil skip **${skippedTitle}**! Memutar: **${nextTrack.title}** (๑˃ᴗ˂)ﻌ`;
      if (interaction.isButton()) {
        await interaction.reply({ content: replyContent });
      } else {
        await interaction.reply({ content: replyContent });
      }
    } else {
      session.player.stop(true);
      session.isPlaying = false;
      session.currentTrack = null;
      session.currentResource = null;
      const replyContent = `⏭️ Berhasil skip **${skippedTitle}**. Antrean sudah kosong! (◡ ω ◡)`;
      if (interaction.isButton()) {
        await interaction.reply({ content: replyContent });
      } else {
        await interaction.reply({ content: replyContent });
      }
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

    const current = session.currentTrack;
    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("📋 Antrean Musik Porsche-chan ✨")
      .setDescription(current ? `🎶 **Sedang Memutar:**\n**[${current.title}](${current.url})** | \`${current.duration}\` (diminta oleh ${current.requesterName})` : "Tidak ada lagu yang sedang aktif.")
      .setFooter({ text: `Total lagu di antrean: ${session.queue.length}` })
      .setTimestamp();

    if (session.queue.length > 0) {
      const list = session.queue.slice(0, 10).map((t, idx) => `**${idx + 1}.** [${t.title}](${t.url}) - \`${t.duration}\` (${t.requesterName})`).join("\n");
      const extra = session.queue.length > 10 ? `\n*...dan ${session.queue.length - 10} lagu lainnya.*` : "";
      embed.addFields([{ name: "Lagu Berikutnya", value: list + extra, inline: false }]);
    }

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
    const totalSec = track.durationSec || 0;
    const bar = buildProgressBar(currentPos, totalSec);

    const embed = buildNowPlayingEmbed(track, false);
    embed.addFields([
      {
        name: "⏱️ Progres",
        value: `\`${formatDuration(currentPos)}\` ${bar} \`${track.duration}\``,
        inline: false,
      },
    ]);

    await interaction.reply({ embeds: [embed], components: [buildMusicControlRow(session.isPaused)] });
  }

  public static async skipFromMessage(message: Message): Promise<void> {
    const guild = message.guild;
    if (!guild) return;
    const session = sessions.get(guild.id);
    if (!session || (!session.isPlaying && !session.currentTrack)) {
      await message.reply("❌ Tidak ada musik yang sedang diputar untuk di-skip~ (๑•́ ₃ •̀๑)");
      return;
    }

    const skippedTitle = session.currentTrack?.title || "Lagu";
    if (session.queue.length > 0) {
      const nextTrack = session.queue.shift()!;
      session.isSeeking = false;
      session.seekOffsetSec = 0;
      session.player.stop(true);
      await MusicService.playTrackInSession(session, nextTrack);
      await message.reply(`⏭️ Berhasil skip **${skippedTitle}**! Memutar: **${nextTrack.title}** (๑˃ᴗ˂)ﻌ`);
    } else {
      session.player.stop(true);
      session.isPlaying = false;
      session.currentTrack = null;
      session.currentResource = null;
      await message.reply(`⏭️ Berhasil skip **${skippedTitle}**. Antrean sudah kosong! (◡ ω ◡)`);
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

    const current = session.currentTrack;
    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("📋 Antrean Musik Porsche-chan ✨")
      .setDescription(current ? `🎶 **Sedang Memutar:**\n**[${current.title}](${current.url})** | \`${current.duration}\` (diminta oleh ${current.requesterName})` : "Tidak ada lagu yang sedang aktif.")
      .setFooter({ text: `Total lagu di antrean: ${session.queue.length}` })
      .setTimestamp();

    if (session.queue.length > 0) {
      const list = session.queue.slice(0, 10).map((t, idx) => `**${idx + 1}.** [${t.title}](${t.url}) - \`${t.duration}\` (${t.requesterName})`).join("\n");
      const extra = session.queue.length > 10 ? `\n*...dan ${session.queue.length - 10} lagu lainnya.*` : "";
      embed.addFields([{ name: "Lagu Berikutnya", value: list + extra, inline: false }]);
    }

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
    const totalSec = track.durationSec || 0;
    const bar = buildProgressBar(currentPos, totalSec);

    const embed = buildNowPlayingEmbed(track, false);
    embed.addFields([
      {
        name: "⏱️ Progres",
        value: `\`${formatDuration(currentPos)}\` ${bar} \`${track.duration}\``,
        inline: false,
      },
    ]);

    await message.reply({ embeds: [embed], components: [buildMusicControlRow(session.isPaused)] });
  }
}
