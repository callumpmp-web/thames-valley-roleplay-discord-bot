// commands/Moderation/mute.js
const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'mute',

  async execute(interaction, ctx) {
    const { constants, state, helpers } = ctx;
    const { STAFF_ROLES, MUTED_ROLE_ID, COLORS, MOD_ACTION_CHANNEL_ID } = constants;
    const { cases, mutesCount } = state;
    const { hasAnyRole, parseDuration, addToHistory, getOrIncrement, getCaseNumber } = helpers;

    const guild = interaction.guild;
    const modActionChannel = guild.channels.cache.get(MOD_ACTION_CHANNEL_ID);

    const sub = interaction.options.getSubcommand();

    // ===========================
    // /mute add
    // ===========================
    if (sub === 'add') {
      try {
        if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
          await interaction.reply({
            content: "You don't have permission to use this command.",
            ephemeral: true,
          });
          return;
        }

        const targetUser = interaction.options.getUser('user', true);
        const durationStr = interaction.options.getString('duration', true);
        const reason = interaction.options.getString('reason', true);

        const parsed = parseDuration(durationStr);
        if (!parsed) {
          await interaction.reply({
            content: 'Invalid duration format. Example: 10m, 1h, 1d.',
            ephemeral: true,
          });
          return;
        }

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
          await interaction.reply({
            content: "I couldn't find that user in the server.",
            ephemeral: true,
          });
          return;
        }

        const mutedRole = guild.roles.cache.get(MUTED_ROLE_ID);
        if (!mutedRole) {
          await interaction.reply({
            content: 'Muted role not found.',
            ephemeral: true,
          });
          return;
        }

        const moderator = interaction.user;
        const caseNumber = getCaseNumber();
        const muteCount = getOrIncrement(mutesCount, targetUser.id, 1);

        // DM
        const dmEmbed = new EmbedBuilder()
          .setTitle('🔇 You have been muted')
          .setColor(COLORS.mute)
          .setDescription(
            `**Reason:** ${reason}\n**Duration:** ${parsed.label}\n**Moderator:** ${moderator.tag}`
          );
        await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

        // Apply mute
        await targetMember.roles.add(MUTED_ROLE_ID, reason);

        // MAIN REPLY (only once)
        await interaction.reply(
          `🔇 **${targetUser.tag}** has been muted for **${parsed.label}** (Case #${caseNumber}).`
        );

        // Logging
        if (modActionChannel) {
          const logEmbed = new EmbedBuilder()
            .setTitle('🔇 User Muted')
            .setColor(COLORS.mute)
            .addFields(
              { name: 'User', value: `${targetUser.tag} (${targetUser.id})` },
              { name: 'Reason', value: reason },
              { name: 'Duration', value: parsed.label },
              { name: 'Moderator', value: moderator.tag },
              { name: 'Previous Mutes', value: String(muteCount - 1) },
              { name: 'Case Number', value: `#${caseNumber}` },
            )
            .setTimestamp();

          const logMsg = await modActionChannel.send({ embeds: [logEmbed] });

          const caseObj = {
            caseNumber,
            type: 'mute',
            userId: targetUser.id,
            moderatorId: moderator.id,
            reason,
            duration: parsed.label,
            timestamp: Date.now(),
            logChannelId: modActionChannel.id,
            logMessageId: logMsg.id,
          };

          cases.set(caseNumber, caseObj);
          addToHistory(targetUser.id, caseObj);
        }

        // automatic unmute (safe)
        setTimeout(async () => {
          const m = await guild.members.fetch(targetUser.id).catch(() => null);
          if (!m) return;
          if (!m.roles.cache.has(MUTED_ROLE_ID)) return;
          await m.roles.remove(MUTED_ROLE_ID, 'Automatic unmute');
        }, parsed.ms);

      } catch (err) {
        console.error('Internal /mute add error:', err);
        if (!interaction.replied) {
          await interaction.reply({
            content: 'An internal error occurred.',
            ephemeral: true,
          }).catch(() => {});
        }
      }

      return;
    }

    // ===========================
    // /mute remove
    // ===========================
    if (sub === 'remove') {
      try {
        if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
          await interaction.reply({
            content: "You don't have permission to use this command.",
            ephemeral: true,
          });
          return;
        }

        const targetUser = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', true);
        const originalReason = interaction.options.getString('originalreason', true);

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
          await interaction.reply({
            content: "I couldn't find that user.",
            ephemeral: true,
          });
          return;
        }

        if (!targetMember.roles.cache.has(MUTED_ROLE_ID)) {
          await interaction.reply({
            content: "This user is not muted.",
            ephemeral: true,
          });
          return;
        }

        const moderator = interaction.user;
        const caseNumber = getCaseNumber();

        await targetMember.roles.remove(MUTED_ROLE_ID, reason);

        // DM
        const dmEmbed = new EmbedBuilder()
          .setTitle('🔊 You have been unmuted')
          .setColor(COLORS.unmute)
          .setDescription(
            `**Unmuted for:** ${reason}\n**Original Mute Reason:** ${originalReason}\n**Moderator:** ${moderator.tag}`
          );
        await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

        // MAIN REPLY
        await interaction.reply(
          `🔊 **${targetUser.tag}** has been unmuted (Case #${caseNumber}).`
        );

      } catch (err) {
        console.error('Internal /mute remove error:', err);
        if (!interaction.replied) {
          await interaction.reply({
            content: 'An internal error occurred.',
            ephemeral: true,
          }).catch(() => {});
        }
      }

      return;
    }

    // fallback
    return interaction.reply({
      content: 'Unknown subcommand.',
      ephemeral: true,
    });
  },
};




