import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { handleYtFixCommand } from "../server/ytDiagnostics";

export const data = new SlashCommandBuilder()
  .setName("check")
  .setDescription("Auto-Diagnose & Auto-Fix masalah pemutar YouTube (yt-dlp) di server / Pterodactyl");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await handleYtFixCommand(interaction);
}

export { handleYtFixCommand as handleCheckCommand };
