import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { searchWeb, formatWebSearchSnippets } from "../lib/webSearch";
import { generateText, buildPersona, CREATOR_ID } from "../server/bot";
import { logger } from "../server/logger";

export const data = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Cari informasi fakta terkini di internet secara real-time")
  .addStringOption((opt) =>
    opt
      .setName("query")
      .setDescription("Pertanyaan atau topik yang ingin dicari di internet")
      .setRequired(true)
  );

export async function handleSearchCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const query =
    interaction.options.getString("query") ||
    interaction.options.getString("pertanyaan") ||
    "";

  if (!query.trim()) {
    await interaction.reply({
      content: "❌ Masukkan pertanyaan atau kata kunci yang ingin dicari ya~",
      ephemeral: true,
    });
    return;
  }

  // Tampilkan status awal "🔍 Sedang mencari di internet..."
  await interaction.reply({
    content: `🔍 Sedang mencari di internet tentang **"${query}"**...`,
  });

  try {
    const results = await searchWeb(query, 5000);

    if (results.length === 0) {
      await interaction.editReply({
        content: "Maaf, aku tidak menemukan informasi yang jelas tentang itu~ (๑•́ ₃ •̀๑)",
      });
      return;
    }

    const snippetsText = formatWebSearchSnippets(results);
    const searchPrompt =
      `Berdasarkan hasil pencarian berikut:\n\n${snippetsText}\n\n` +
      `Jawab pertanyaan user: '${query}' dengan singkat, padat, dan sertakan sumbernya. ` +
      `Jika hasil pencarian tidak relevan, katakan 'Maaf, aku tidak menemukan informasi yang jelas tentang itu~'.`;

    const isCreator = interaction.user.id === CREATOR_ID;
    const systemPrompt = buildPersona(isCreator);
    const { text: answer, model: modelName } = await generateText(
      [{ role: "user", text: searchPrompt }],
      systemPrompt
    );

    const truncatedAnswer = answer.length > 3800 ? `${answer.slice(0, 3797)}...` : answer;

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle(`🔍 Hasil Pencarian: ${query}`.slice(0, 256))
      .setDescription(truncatedAnswer || "Maaf, aku tidak menemukan informasi yang jelas tentang itu~")
      .addFields(
        results.slice(0, 3).map((r, i) => ({
          name: `🌐 Sumber ${i + 1}: ${r.title}`.slice(0, 256),
          value: `${r.snippet}\n🔗 [Buka Sumber](${r.url})`.slice(0, 1024),
          inline: false,
        }))
      )
      .setFooter({
        text: `Porsche-chan Real-Time Web Search${modelName ? ` • AI: ${modelName}` : ""}`,
      })
      .setTimestamp();

    await interaction.editReply({
      content: null,
      embeds: [embed],
    });
  } catch (err) {
    logger.error({ err, query }, "Error executing /search command");
    await interaction.editReply({
      content: "❌ Maaf, terjadi kendala saat mencari di internet. Coba beberapa saat lagi ya~",
    });
  }
}

export { handleSearchCommand as execute };
