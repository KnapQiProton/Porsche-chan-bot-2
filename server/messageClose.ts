import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
} from "discord.js";
import { logger } from "./logger";

/**
 * Shared "Tutup" button for every interactive panel (music, image, illust,
 * think). The requester id is embedded in the custom id, so ownership keeps
 * working after message edits and bot restarts.
 *
 * Only the requester may delete the message. Everyone else gets an ephemeral
 * warning. A short per-message cooldown prevents double-click / racing
 * requests while the delete is being processed.
 */
const CLOSE_COOLDOWN_MS = 5_000;
const CLOSE_ID_PATTERN = /^[a-z]+_close:.+$/i;

const closeCooldowns = new Map<string, number>();

export function buildCloseButton(ownerId: string, panel: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${panel}_close:${ownerId}`)
    .setLabel("Tutup")
    .setEmoji("✖️")
    .setStyle(ButtonStyle.Danger);
}

export function buildCloseRow(ownerId: string, panel: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buildCloseButton(ownerId, panel));
}

export function isCloseButton(customId: string): boolean {
  return CLOSE_ID_PATTERN.test(customId);
}

export async function handleMessageCloseButton(interaction: ButtonInteraction): Promise<void> {
  const [, ownerId = ""] = interaction.customId.split(":");
  const owner = ownerId.trim();

  if (!owner) {
    await interaction.reply({
      content: "⚠️ Tombol ini tidak punya pemilik yang valid.",
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  if (interaction.user.id !== owner) {
    await interaction.reply({
      content:
        `❌ Hanya <@${owner}> yang boleh menutup pesan ini. ` +
        "Kalau kamu butuh panel sendiri, jalankan command-nya lagi ya~ (๑•́ ₃ •̀๑)",
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  const messageId = interaction.message.id;
  const now = Date.now();
  const blockedUntil = closeCooldowns.get(messageId) ?? 0;

  if (now < blockedUntil) {
    const waitSec = Math.max(1, Math.ceil((blockedUntil - now) / 1000));
    await interaction.reply({
      content: `⏳ Tunggu **${waitSec} detik** lagi sebelum menutup pesan ini~`,
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  // Lock this message for a few seconds so rapid clicks don't race the delete.
  closeCooldowns.set(messageId, now + CLOSE_COOLDOWN_MS);
  if (closeCooldowns.size > 200) {
    for (const [id, until] of closeCooldowns) {
      if (until <= now) closeCooldowns.delete(id);
    }
  }

  // Acknowledge first; deleting the source message is not a valid response.
  await interaction.deferUpdate().catch(() => {});

  try {
    await interaction.message.delete();
  } catch (error) {
    logger.warn({ error }, "Gagal menghapus pesan lewat tombol tutup");
    await interaction.followUp({
      content:
        "⚠️ Gagal menghapus pesan. Mungkin sudah dihapus, atau bot tidak punya izin **Manage Messages**.",
      ephemeral: true,
    }).catch(() => {});
  }
}
