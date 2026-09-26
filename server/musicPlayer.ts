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

// Dynamic extractor arguments:
// When cookies are present: web,mweb,ios (so YouTube honors web session cookies)
// When cookies are absent: ios,web,mweb (ios client avoids datacenter bot checks)
export function getYtExtractorArgs(hasCookies?: boolean): string[] {
  if (process.env.YOUTUBE_PLAYER_CLIENT && process.env.YOUTUBE_PLAYER_CLIENT.trim()) {
    return ["--extractor-args", `youtube:player_client=${process.env.YOUTUBE_PLAYER_CLIENT.trim()}`];
  }
  const cookiesPresent = hasCookies !== undefined ? hasCookies : hasYouTubeCookies();
  if (cookiesPresent) {
    return ["--extractor-args", "youtube:player_client=android,web,mweb"];
  }
  return ["--extractor-args", "youtube:player_client=android,web"];
}

const YT_EXTRACTOR_ARGS = getYtExtractorArgs();

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
      ...YT_EXTRACTOR_ARGS,
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

// Extract YouTube Playlist items using yt-dlp flat-playlist mode
export async function getYouTubePlaylist(url: string, ytdlpPath: string, timeoutMs: number = 10000): Promise<{
  title: string;
  thumbnail?: string;
  tracks: Array<{ id: string; title: string; artist: string; durationSec?: number; url: string }>;
} | null> {
  const isPlaylist = /youtube\.com\/(?:playlist\?list=|watch\?.*list=)|music\.youtube\.com\/(?:playlist\?list=|watch\?.*list=)/i.test(url);
  if (!isPlaylist) return null;

  return new Promise((resolve) => {
    let resolved = false;
    const cookieArgs = getYtDlpCookieArgs();
    const extractorArgs = getYtExtractorArgs(cookieArgs.length > 0);

    const proc = spawn(ytdlpPath, [
      "--flat-playlist",
      "--dump-single-json",
      "--no-warnings",
      "--playlist-end", "100",
      ...cookieArgs,
      ...extractorArgs,
      url,
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
                const videoUrl = e.url && e.url.startsWith("http") ? e.url : (videoId ? `https://www.youtube.com/watch?v=${videoId}` : url);
                const rawTitle = e.title || "YouTube Audio";
                const rawUploader = e.uploader || e.channel || "Artis YouTube";
                const parsed = parseTitleAndArtist(rawTitle, rawUploader);
                const durationSec = typeof e.duration === "number" && e.duration > 0 ? Math.round(e.duration) : undefined;

                return {
                  id: videoId,
                  title: parsed.title || rawTitle,
                  artist: parsed.artist && !isRecordLabelOrLyricChannel(parsed.artist) ? parsed.artist : rawUploader,
                  durationSec,
                  url: videoUrl,
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
  const localCookies = path.join(process.cwd(), "cookies.txt");
  if (fs.existsSync(localCookies)) {
    try {
      if (fs.statSync(localCookies).size > 10) return true;
    } catch {}
  }
  const appCookies = "/app/cookies.txt";
  if (fs.existsSync(appCookies)) {
    try {
      if (fs.statSync(appCookies).size > 10) return true;
    } catch {}
  }
  const fullCookies = path.join(process.cwd(), "cookies.full.txt");
  if (fs.existsSync(fullCookies)) {
    try {
      if (fs.statSync(fullCookies).size > 10) return true;
    } catch {}
  }
  const tmpCookies = path.join(os.tmpdir(), "porsche_chan_youtube_cookies.txt");
  if (fs.existsSync(tmpCookies)) {
    try {
      if (fs.statSync(tmpCookies).size > 10) return true;
    } catch {}
  }
  const envCookie = process.env.YOUTUBE_COOKIE || process.env.YOUTUBE_COOKIES || process.env.COOKIES || process.env.YOUTUBE_COOKIE_BASE64;
  if (envCookie && envCookie.trim().length > 10) return true;
  const bearer = process.env.YOUTUBE_OAUTH_TOKEN || process.env.YT_DLP_OAUTH_TOKEN;
  if (bearer && bearer.trim().length > 10) return true;
  return false;
}

// Helper to check for YouTube cookies (from file or environment variable)
export function getYtDlpCookieArgs(): string[] {
  // 1. Check cookies.txt in current working directory
  const localCookies = path.join(process.cwd(), "cookies.txt");
  if (fs.existsSync(localCookies)) {
    try {
      const stats = fs.statSync(localCookies);
      if (stats.size > 10) {
        return ["--cookies", localCookies];
      }
    } catch {}
  }

  // 2. Check /app/cookies.txt (Railway Docker container path)
  const appCookies = "/app/cookies.txt";
  if (fs.existsSync(appCookies)) {
    try {
      const stats = fs.statSync(appCookies);
      if (stats.size > 10) {
        return ["--cookies", appCookies];
      }
    } catch {}
  }

  // 3. Check cookies.full.txt as secondary fallback
  const fullCookies = path.join(process.cwd(), "cookies.full.txt");
  if (fs.existsSync(fullCookies)) {
    try {
      const stats = fs.statSync(fullCookies);
      if (stats.size > 10) {
        return ["--cookies", fullCookies];
      }
    } catch {}
  }

  // 4. Check temporary decoded cookies file if already written
  const tmpCookiePath = path.join(os.tmpdir(), "porsche_chan_youtube_cookies.txt");
  if (fs.existsSync(tmpCookiePath)) {
    try {
      const stats = fs.statSync(tmpCookiePath);
      if (stats.size > 10) {
        return ["--cookies", tmpCookiePath];
      }
    } catch {}
  }

  // 5. Check environment variable (supports raw Netscape text, escaped newlines, or base64 encoded)
  const envCookie = process.env.YOUTUBE_COOKIE || process.env.YOUTUBE_COOKIES || process.env.COOKIES || process.env.YOUTUBE_COOKIE_BASE64;
  if (envCookie && envCookie.trim()) {
    let cookieContent = envCookie.trim();
    // Strip quotes if user entered them in Railway variable value
    if ((cookieContent.startsWith('"') && cookieContent.endsWith('"')) || (cookieContent.startsWith("'") && cookieContent.endsWith("'"))) {
      cookieContent = cookieContent.slice(1, -1).trim();
    }
    // If user passed base64 encoded cookies to avoid newline formatting issues in Railway
    if (!cookieContent.includes("\t") && !cookieContent.startsWith("#") && cookieContent.length > 50) {
      try {
        const decoded = Buffer.from(cookieContent, "base64").toString("utf-8");
        if (decoded.includes("\t") || decoded.includes("youtube.com")) {
          cookieContent = decoded;
        }
      } catch {}
    }
    // Handle escaped \n or \t from environment variables
    if (cookieContent.includes("\\n")) {
      cookieContent = cookieContent.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    }

    try {
      fs.writeFileSync(tmpCookiePath, cookieContent, "utf-8");
      return ["--cookies", tmpCookiePath];
    } catch (err) {
      logger.warn({ err }, "Could not write temporary youtube cookie file");
    }
  }

  // 6. OAuth bearer token support
  const bearer = process.env.YOUTUBE_OAUTH_TOKEN || process.env.YT_DLP_OAUTH_TOKEN;
  if (bearer && bearer.trim()) {
    return ["--add-header", `Authorization: Bearer ${bearer.trim()}`];
  }

  return [];
}

// Save uploaded or pasted cookies and return Base64 for Railway environment variables
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

  const cookiePath = path.join(process.cwd(), "cookies.txt");
  fs.writeFileSync(cookiePath, trimmed, "utf-8");

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

// Get current cookies status
export function getCookieStatus(): {
  active: boolean;
  source: string;
  detail: string;
} {
  const localCookies = path.join(process.cwd(), "cookies.txt");
  if (fs.existsSync(localCookies)) {
    try {
      const stats = fs.statSync(localCookies);
      if (stats.size > 10) {
        return {
          active: true,
          source: "cookies.txt (Lokal / Uploaded)",
          detail: `File aktif (${stats.size} bytes).`,
        };
      }
    } catch {}
  }

  const envCookie = process.env.YOUTUBE_COOKIE || process.env.YOUTUBE_COOKIES || process.env.COOKIES || process.env.YOUTUBE_COOKIE_BASE64;
  if (envCookie && envCookie.trim().length > 10) {
    return {
      active: true,
      source: "Environment Variable (YOUTUBE_COOKIE)",
      detail: `Variabel terpasang di hosting (${envCookie.trim().length} karakter).`,
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
      "--extractor-args", "youtube:player_client=android",
      "-g", "-f", "18/ba/b/best",
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
      "--js-runtimes", "node",
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

    // Tertiary fallback: search SoundCloud directly (with candidate scoring to prevent inaccurate songs)
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
    let settled = false;
    let ytdlp: any;
    let ffmpeg: any;

    let ytdlpStderr = "";

    try {
      ytdlp = spawn(ytdlpPath, ytdlpArgs, { stdio: ["ignore", "pipe", "pipe"] });
      ytdlp.stderr.on("data", (d: Buffer) => {
        ytdlpStderr += d.toString();
      });

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
        const detail = ytdlpStderr.trim() ? `: ${ytdlpStderr.trim().slice(0, 300)}` : "";
        reject(new Error(`yt-dlp exited with error code ${code}${detail}`));
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
          try { ytdlp.kill("SIGKILL"); } catch {}
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

// Helper for validating direct HTTPS stream piped through FFmpeg with fast failover
function tryPipedUrlStream(
  audioUrl: string,
  seekSeconds: number,
  timeoutMs: number = 12000
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

// Create AudioResource from YouTube with multi-tier streaming architecture (Piped yt-dlp -> FFmpeg -> Direct URL -> SoundCloud fallback)
export async function createAudioResourceFromYtDlp(
  urlOrQuery: string,
  seekSeconds: number = 0,
  ytdlpPath: string,
  fallbackSearchQuery?: string
): Promise<any> {
  const cookieArgs = getYtDlpCookieArgs();
  const isDirectYouTubeLink = /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(urlOrQuery);

  // Tier 1: Android Client (Primary, bypasses 403 Forbidden and datacenter bot blocks)
  try {
    const ytdlpArgs = [
      "--js-runtimes", "node",
      ...cookieArgs,
      "--extractor-args", "youtube:player_client=android",
      "-q",
      "--no-warnings",
      "--no-progress",
      "-o", "-",
      "-f", "18/ba/b/best",
      "--no-playlist",
      urlOrQuery,
    ];
    const resource = await tryPipedStream(ytdlpPath, ytdlpArgs, seekSeconds, 6000);
    logger.info({ urlOrQuery }, "Started Tier 1 yt-dlp android pipe stream");
    return resource;
  } catch (err) {
    logger.warn({ err }, "Tier 1 yt-dlp android pipe failed, trying Tier 2 (android,web client)");
  }

  // Tier 2: Android + Web combo client
  try {
    const ytdlpArgs = [
      "--js-runtimes", "node",
      ...cookieArgs,
      "--extractor-args", "youtube:player_client=android,web",
      "-q",
      "--no-warnings",
      "--no-progress",
      "-o", "-",
      "-f", "18/ba/b/best",
      "--no-playlist",
      urlOrQuery,
    ];
    const resource = await tryPipedStream(ytdlpPath, ytdlpArgs, seekSeconds, 6000);
    logger.info({ urlOrQuery }, "Started Tier 2 yt-dlp android,web pipe stream");
    return resource;
  } catch (err) {
    logger.warn({ err }, "Tier 2 android,web pipe failed, trying Tier 3 (tv_embedded client)");
  }

  // Tier 3: tv_embedded / tv client (alternative datacenter bypass)
  try {
    const ytdlpArgs = [
      "--js-runtimes", "node",
      ...cookieArgs,
      "--extractor-args", "youtube:player_client=tv_embedded,tv",
      "-q",
      "--no-warnings",
      "--no-progress",
      "-o", "-",
      "-f", "18/ba/b/best",
      "--no-playlist",
      urlOrQuery,
    ];
    const resource = await tryPipedStream(ytdlpPath, ytdlpArgs, seekSeconds, 6000);
    logger.info({ urlOrQuery }, "Started Tier 3 yt-dlp tv_embedded pipe stream");
    return resource;
  } catch (err) {
    logger.warn({ err }, "Tier 3 tv_embedded pipe failed, trying Tier 4 (default extractor args)");
  }

  // Tier 4: Default Extractor Args
  try {
    const extractorArgs = getYtExtractorArgs(cookieArgs.length > 0);
    const ytdlpArgs = [
      "--js-runtimes", "node",
      ...cookieArgs,
      ...extractorArgs,
      "-q",
      "--no-warnings",
      "--no-progress",
      "-o", "-",
      "-f", "18/ba/b/best",
      "--no-playlist",
      urlOrQuery,
    ];
    const resource = await tryPipedStream(ytdlpPath, ytdlpArgs, seekSeconds, 6000);
    logger.info({ urlOrQuery }, "Started Tier 4 yt-dlp default extractor pipe stream");
    return resource;
  } catch (err) {
    logger.warn({ err }, "Tier 4 pipe stream failed, trying Tier 5 direct HTTPS URL");
  }

  // Tier 5: Direct HTTPS audio URL extracted by yt-dlp with chunk validation
  try {
    const directUrl = await getDirectAudioUrlWithYtDlp(urlOrQuery, ytdlpPath, 5000);
    if (directUrl) {
      logger.info({ urlOrQuery }, "Attempting Tier 5 yt-dlp direct HTTPS audio URL");
      const resource = await tryPipedUrlStream(directUrl, seekSeconds, 8000);
      logger.info({ urlOrQuery }, "Streaming via Tier 5 yt-dlp direct HTTPS audio URL");
      return resource;
    }
  } catch (err) {
    logger.warn({ err }, "Tier 5 direct URL failed");
  }

  // Tier 4: SoundCloud fallback audio stream (ultra-reliable when YouTube IP is challenged, scored for accuracy)
  const candidatesToSearch = [
    fallbackSearchQuery,
    urlOrQuery,
  ].filter(Boolean) as string[];

  const cleanCandidates: string[] = [];
  for (const raw of candidatesToSearch) {
    const stripped = raw
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/\b(Artis YouTube|YouTube Audio|Official Video|Official Music Video|Official Audio|Lyric Video|Full Album|Audio|Video)\b/gi, "")
      .replace(/[|•\-_\[\]\(\)#]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (stripped && stripped.length > 2) {
      cleanCandidates.push(stripped);
      // Also add just the first 3-5 words if long title
      const words = stripped.split(" ");
      if (words.length > 3) {
        cleanCandidates.push(words.slice(0, 3).join(" "));
      }
    }
  }

  // If candidate list is empty and user passed a YouTube URL, resolve title via public oEmbed
  if (cleanCandidates.length === 0 && (urlOrQuery.includes("youtube.com") || urlOrQuery.includes("youtu.be"))) {
    try {
      const oembed = await getYouTubeOEmbed(urlOrQuery);
      if (oembed && oembed.title) {
        const parsed = parseTitleAndArtist(oembed.title, oembed.author);
        cleanCandidates.push(`${parsed.title} ${parsed.artist}`.trim());
        cleanCandidates.push(parsed.title);
      }
    } catch {}
  }

  for (const q of cleanCandidates) {
    try {
      const scClientId = await playdl.getFreeClientID();
      await playdl.setToken({ soundcloud: { client_id: scClientId } });
      const res = await playdl.search(q, { source: { soundcloud: "tracks" }, limit: 5 });
      if (res && res.length > 0) {
        const scoredSc = res
          .map((item: any, idx: number) => ({
            item,
            score: scoreTrackCandidate(q, "", undefined, {
              name: item.name || item.title || "",
              user: { name: item.user?.name || item.artist || "" },
              durationInSec: item.durationInSec,
            }, idx),
          }))
          .filter((s) => s.score >= 120)
          .sort((a, b) => b.score - a.score);

        if (scoredSc.length > 0 && scoredSc[0].item.url) {
          logger.info({ query: q, scUrl: scoredSc[0].item.url, score: scoredSc[0].score }, "Streaming via verified SoundCloud fallback");
          return await createAudioResourceFromTrackUrl(scoredSc[0].item.url, seekSeconds);
        }
      }
    } catch (scErr) {
      logger.warn({ scErr }, "SoundCloud fallback candidate search failed");
    }
  }

  throw new Error("Gagal memutar audio dari semua sumber streaming.");
}

// Main Track Resolver: handles YouTube, YouTube Music, Spotify, SoundCloud, and Text Query (Prioritizing User Links)
// Resolve single track or full playlist/album (YouTube, Spotify, SoundCloud, or text search)
export async function resolveMusic(
  input: string,
  requester: { name: string; id: string }
): Promise<ResolvedMusicResult> {
  const cleanInput = input.trim();
  const ytdlpPath = await getOrDownloadYtDlp();

  // 0. SOUNDCLOUD PLAYLIST / SET
  if (cleanInput.includes("soundcloud.com") && cleanInput.includes("/sets/")) {
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
            return createAudioResourceFromYtDlp(ytMatch.url, seekSeconds, ytdlpPath, query);
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
            return createAudioResourceFromYtDlp(ytMatch.url, seekSeconds, ytdlpPath, query);
          },
        },
      ],
    };
  }

  // 4. YOUTUBE PLAYLIST (YouTube & YouTube Music)
  const isYtPlaylist = /youtube\.com\/(?:playlist\?list=|watch\?.*list=)|music\.youtube\.com\/(?:playlist\?list=|watch\?.*list=)/i.test(cleanInput);
  if (isYtPlaylist) {
    const ytPlaylist = await getYouTubePlaylist(cleanInput, ytdlpPath);
    if (ytPlaylist && ytPlaylist.tracks.length > 0) {
      const isYtMusic = cleanInput.includes("music.youtube.com");
      const tracks: TrackMetadata[] = ytPlaylist.tracks.map((t) => ({
        title: t.title,
        artist: t.artist,
        duration: t.durationSec ? formatDuration(t.durationSec) : "Audio",
        durationSec: t.durationSec,
        url: t.url,
        thumbnail: ytPlaylist.thumbnail || (t.id ? `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg` : undefined),
        source: (isYtMusic ? "youtube_music" : "youtube") as MusicSource,
        sourceBadge: isYtMusic ? "🎵 YouTube Music Playlist" : "🔴 YouTube Playlist",
        sourceColor: isYtMusic ? 0xff2a54 : 0xff4655,
        requesterName: requester.name,
        requesterId: requester.id,
        rawTrackUrl: t.url,
        createStream: async (seekSeconds: number = 0) => {
          return createAudioResourceFromYtDlp(t.url, seekSeconds, ytdlpPath, `${t.title} ${t.artist}`);
        },
      }));

      return {
        isPlaylist: true,
        playlistTitle: ytPlaylist.title,
        playlistUrl: cleanInput,
        playlistThumbnail: ytPlaylist.thumbnail,
        playlistCount: tracks.length,
        tracks,
      };
    }
  }

  // 5. YOUTUBE MUSIC SINGLE TRACK
  if (cleanInput.includes("music.youtube.com")) {
    const ytMeta = await getYouTubeMetadata(cleanInput);
    const canonicalUrl = ytMeta.url;

    return {
      isPlaylist: false,
      tracks: [
        {
          title: ytMeta.title,
          artist: ytMeta.artist,
          duration: ytMeta.duration,
          durationSec: ytMeta.durationSec,
          url: cleanInput,
          thumbnail: ytMeta.thumbnail,
          source: "youtube_music",
          sourceBadge: "🎵 YouTube Music",
          sourceColor: 0xff2a54,
          requesterName: requester.name,
          requesterId: requester.id,
          rawTrackUrl: canonicalUrl,
          createStream: async (seekSeconds: number = 0) => {
            return createAudioResourceFromYtDlp(canonicalUrl, seekSeconds, ytdlpPath, `${ytMeta.title} ${ytMeta.artist}`);
          },
        },
      ],
    };
  }

  // 6. YOUTUBE DIRECT SINGLE TRACK
  if (cleanInput.includes("youtube.com") || cleanInput.includes("youtu.be")) {
    const ytMeta = await getYouTubeMetadata(cleanInput);
    const canonicalUrl = ytMeta.url;

    return {
      isPlaylist: false,
      tracks: [
        {
          title: ytMeta.title,
          artist: ytMeta.artist,
          duration: ytMeta.duration,
          durationSec: ytMeta.durationSec,
          url: cleanInput,
          thumbnail: ytMeta.thumbnail,
          source: "youtube",
          sourceBadge: "🔴 YouTube",
          sourceColor: 0xff4655,
          requesterName: requester.name,
          requesterId: requester.id,
          rawTrackUrl: canonicalUrl,
          createStream: async (seekSeconds: number = 0) => {
            return createAudioResourceFromYtDlp(canonicalUrl, seekSeconds, ytdlpPath, `${ytMeta.title} ${ytMeta.artist}`);
          },
        },
      ],
    };
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
          return createAudioResourceFromYtDlp(ytMatch.url, seekSeconds, ytdlpPath, `${ytMatch.title} ${ytMatch.artist}`);
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

  embed
    .setFooter({ text: "Porsche-chan Music Engine • 48kHz Hi-Fi Stereo" })
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
        MusicService.cleanupSessionProcesses(session);
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
        MusicService.cleanupSessionProcesses(session);
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

    const cd = checkUserCooldown(interaction.user.id, "music_command", 3000);
    if (cd !== null) {
      await interaction.reply({
        content: `⏳ Sabar ya! Tunggu **${cd} detik** lagi sebelum meminta lagu baru~ (๑•́ ₃ •̀๑)`,
        ephemeral: true,
      });
      return;
    }

    const queryOrUrl = interaction.options.getString("url", true);
    await interaction.deferReply();

    try {
      const musicResult = await resolveMusic(queryOrUrl, {
        name: interaction.user.displayName || interaction.user.username,
        id: interaction.user.id,
      });

      const textChannel = interaction.channel as TextBasedChannel;
      const session = await MusicService.joinOrGetVoice(guild, voiceChannel, textChannel);

      if (musicResult.isPlaylist) {
        if (session.isPlaying && session.currentTrack) {
          session.queue.push(...musicResult.tracks);
          const embed = buildPlaylistEmbed(musicResult, interaction.user.displayName || interaction.user.username, true);
          await interaction.editReply({ embeds: [embed] });
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
          await interaction.editReply({
            embeds: [embed],
            components: [buildMusicControlRow(false)],
          });

          try {
            const resource = await firstTrack.createStream(0);
            session.currentResource = resource;
            session.player.play(resource);
          } catch (streamErr) {
            logger.error({ streamErr, track: firstTrack.title }, "Failed to start initial playlist stream");
            if (session.queue.length > 0) {
              const next = session.queue.shift()!;
              await MusicService.playTrackInSession(session, next);
            }
          }
        }
      } else {
        const track = musicResult.tracks[0];
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

          session.currentTrack = track;
          session.isPlaying = true;
          session.isPaused = false;
          session.isSeeking = false;
          session.seekOffsetSec = 0;

          const embed = buildNowPlayingEmbed(track, false);
          await interaction.editReply({
            embeds: [embed],
            components: [buildMusicControlRow(false)],
          });

          try {
            const resource = await track.createStream(0);
            session.currentResource = resource;
            session.player.play(resource);
          } catch (streamErr) {
            logger.error({ streamErr, track: track.title }, "Failed to start track stream");
            if (textChannel && "send" in textChannel) {
              await (textChannel as any).send(`❌ Gagal memutar lagu **${track.title}**: ${(streamErr as Error).message || "Stream error"}`).catch(() => {});
            }
            if (session.queue.length > 0) {
              const next = session.queue.shift()!;
              await MusicService.playTrackInSession(session, next);
            }
          }
        }
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
    await interaction.reply({ content: `▶️ Musik dilanjutkan oleh **${interaction.user.displayName || interaction.user.username}**! (o´∀\`o)` });
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
    if (customId === "music_pause_resume") {
      if (session.isPaused) {
        session.player.unpause();
        session.isPaused = false;
        await interaction.update({ components: [buildMusicControlRow(false)] }).catch(() => {});
const followMsg = await interaction.followUp({
          content: `▶️ Musik dilanjutkan oleh **${interaction.user.displayName || interaction.user.username}**! (o´∀\`o)`,
        });
        setTimeout(() => followMsg.delete().catch(() => {}), 5_000);
      } else {
        session.player.pause();
        session.isPaused = true;
        await interaction.update({ components: [buildMusicControlRow(true)] }).catch(() => {});
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
      });

      const textChannel = message.channel as TextBasedChannel;
      const session = await MusicService.joinOrGetVoice(guild, voiceChannel, textChannel);

      if (musicResult.isPlaylist) {
        if (session.isPlaying && session.currentTrack) {
          session.queue.push(...musicResult.tracks);
          const embed = buildPlaylistEmbed(musicResult, message.author.displayName || message.author.username, true);
          await loadingMsg.edit({ content: null, embeds: [embed] });
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
          await loadingMsg.edit({
            content: null,
            embeds: [embed],
            components: [buildMusicControlRow(false)],
          });

          try {
            const resource = await firstTrack.createStream(0);
            session.currentResource = resource;
            session.player.play(resource);
          } catch (streamErr) {
            logger.error({ streamErr, track: firstTrack.title }, "Failed to start initial playlist stream");
            if (session.queue.length > 0) {
              const next = session.queue.shift()!;
              await MusicService.playTrackInSession(session, next);
            }
          }
        }
      } else {
        const track = musicResult.tracks[0];
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

          session.currentTrack = track;
          session.isPlaying = true;
          session.isPaused = false;
          session.isSeeking = false;
          session.seekOffsetSec = 0;

          const embed = buildNowPlayingEmbed(track, false);
          await loadingMsg.edit({
            content: null,
            embeds: [embed],
            components: [buildMusicControlRow(false)],
          });

          try {
            const resource = await track.createStream(0);
            session.currentResource = resource;
            session.player.play(resource);
          } catch (streamErr) {
            logger.error({ streamErr, track: track.title }, "Failed to start track stream");
            if (textChannel && "send" in textChannel) {
              await (textChannel as any).send(`❌ Gagal memutar lagu **${track.title}**: ${(streamErr as Error).message || "Stream error"}`).catch(() => {});
            }
            if (session.queue.length > 0) {
              const next = session.queue.shift()!;
              await MusicService.playTrackInSession(session, next);
            }
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
    session.player.stop(true);
    await message.reply("⏹️ Musik telah dihentikan dan antrean dibersihkan! Porsche-chan tetap stay di VC ya~ (◡ ω ◡)");
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
    const resumeMsg = await message.reply(`▶️ Musik dilanjutkan oleh **${message.author.displayName || message.author.username}**! (o´∀\`o)`);
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
    await message.reply(`⏩ **+${deltaSec}s**: Posisi musik sekarang di **${formatDuration(targetPos)}** (๑˃ᴗ˂)ﻌ`);
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
    await message.reply(`⏪ **-${deltaSec}s**: Posisi musik sekarang di **${formatDuration(targetPos)}** (๑˃ᴗ˂)ﻌ`);
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
    await interaction.reply({ embeds: [embed], components: [buildMusicControlRow(session.isPaused)] });
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
    await message.reply({ embeds: [embed], components: [buildMusicControlRow(session.isPaused)] });
  }
}
