import { spawnSync } from "child_process";

export async function runYtDlpUpdate(): Promise<string> {
  console.log("Checking yt-dlp version...");

  const isWin = process.platform === "win32";
  let updated = false;

  // 1. Try pipx upgrade
  try {
    const pipx = spawnSync("pipx", ["upgrade", "--pip-args=--pre", "yt-dlp"], {
      timeout: 60_000,
      stdio: "inherit",
    });
    if (pipx.status === 0) {
      updated = true;
    }
  } catch {}

  // 2. Try python pip upgrade if pipx failed
  if (!updated) {
    const pyCandidates = isWin ? ["python", "python3"] : ["python3", "python"];
    for (const py of pyCandidates) {
      try {
        const pip = spawnSync(py, ["-m", "pip", "install", "--upgrade", "--pre", "yt-dlp"], {
          timeout: 60_000,
          stdio: "inherit",
        });
        if (pip.status === 0) {
          updated = true;
          break;
        }
      } catch {}
    }
  }

  // 3. Fallback: yt-dlp self update for binary releases
  const cmdName = isWin ? "yt-dlp.exe" : "yt-dlp";
  try {
    spawnSync(cmdName, ["--update-to", "nightly"], {
      timeout: 30_000,
      stdio: "ignore",
    });
  } catch {}

  // 4. Retrieve version
  let version = "unknown";
  try {
    const ver = spawnSync(cmdName, ["--version"], {
      timeout: 5000,
      stdio: "pipe",
      encoding: "utf-8",
    });
    version = ver.stdout?.trim() || "unknown";
  } catch {}

  console.log(`yt-dlp updated to ${version}`);
  return version;
}

if (process.argv[1]?.endsWith("update-ytdlp.ts") || process.argv[1]?.endsWith("update-ytdlp.cjs") || process.argv[1]?.endsWith("update-ytdlp.js")) {
  runYtDlpUpdate().catch(err => {
    console.error("Failed to update yt-dlp:", err);
    process.exit(1);
  });
}
