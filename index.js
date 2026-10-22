import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const distDir = path.join(process.cwd(), "dist");
const serverFile = path.join(distDir, "server.cjs");

// Cek apakah file build dist/server.cjs sudah ada
if (!fs.existsSync(serverFile)) {
  console.log("==================================================");
  console.log("[Bootstrap] Folder 'dist' atau 'dist/server.cjs' belum ada.");
  console.log("[Bootstrap] Menjalankan build otomatis untuk Pterodactyl...");
  console.log("==================================================");

  let buildSuccess = false;

  // 1. Coba pnpm run build terlebih dahulu
  try {
    console.log("[Bootstrap] Mencoba build dengan pnpm...");
    const pnpmRes = spawnSync("pnpm", ["run", "build"], {
      stdio: "inherit",
      shell: true,
    });
    if (pnpmRes.status === 0) {
      buildSuccess = true;
      console.log("[Bootstrap] Build dengan pnpm berhasil!");
    } else {
      console.warn(`[Bootstrap] pnpm selesai dengan kode keluar ${pnpmRes.status}. Beralih ke npm...`);
    }
  } catch (err) {
    console.warn("[Bootstrap] pnpm tidak tersedia atau gagal dijalankan:", err.message);
  }

  // 2. Fallback ke npm run build jika pnpm gagal atau tidak tersedia
  if (!buildSuccess) {
    try {
      console.log("[Bootstrap] Menjalankan fallback build dengan npm...");
      const npmRes = spawnSync("npm", ["run", "build"], {
        stdio: "inherit",
        shell: true,
      });
      if (npmRes.status === 0) {
        buildSuccess = true;
        console.log("[Bootstrap] Build dengan npm berhasil!");
      } else {
        console.error(`[Bootstrap] npm run build gagal dengan kode keluar ${npmRes.status}.`);
      }
    } catch (err) {
      console.error("[Bootstrap] npm gagal dijalankan:", err.message);
    }
  }

  // Verifikasi akhir apakah file target benar-benar terbentuk
  if (!fs.existsSync(serverFile)) {
    console.error("==================================================");
    console.error("[Bootstrap] ERROR FATAL: Build gagal menghasilkan 'dist/server.cjs'!");
    console.error("[Bootstrap] Periksa log error di atas dan pastikan semua dependencies terinstall.");
    console.error("==================================================");
    process.exit(1);
  }
}

// Jalankan server yang sudah di-build
console.log("[Bootstrap] Memulai bot dari dist/server.cjs...");
require(serverFile);
