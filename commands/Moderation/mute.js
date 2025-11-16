// commands/Moderation/mute.js
const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'mute',

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ client: any, constants: any, state: any, helpers: any }} ctx
   */
  async execute(interaction, ctx) {
    const { client, constants, state, helpers } = ctx;
    const {
      STAFF_ROLES,
      MUTED_ROLE_ID,
      COLORS,
      MOD_ACTION_CHANNEL_ID,
    } = constants;

    const {
      cases,
      mutesCount,
      userHistory,
    } = state;

    const {
      hasAnyRole,
      parseDuration,
      addToHistory,
      getOrIncrement,
      getCaseNumber,
    } = helpers;

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
            content:
              "You don't have the required role to use this command. Allowed: Moderator, Administrator, Board of Directors.",
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
            content: 'Invalid duration format. Use something like `10m`, `1h`, or `1d`.',
            ephemeral: true,
          });
          return;
        }

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
          await interaction.reply({
            content: "I couldn't find that user in this server.",
            ephemeral: true,
          });
          return;
        }

        const mutedRole = guild.roles.cache.get(MUTED_ROLE_ID);
        if (!mutedRole) {
          await interaction.reply({
            content: 'Muted role not found. Please create it and set its ID in the bot config.',
            ephemeral: true,
          });
          return;
        }

        const moderator = interaction.user;
        const caseNumber = getCaseNumber();
        const muteCount = getOrIncrement(mutesCount, targetUser.id, 1);

        // DM on mute
        const dmEmbed = new EmbedBuilder()
          .setTitle('🔇 You have been muted')
          .setColor(COLORS.mute)
          .setDescription(
            `You have been muted in **Thames Valley Roleplay**.\n\n` +
              `**Reason:** ${reason}\n` +
              `**Duration:** ${parsed.label}\n` +
              `**Responsible Moderator:** ${moderator.tag}\n\n` +
              `Please acknowledge the reason and reflect on your behaviour.\n` +
              `Further breaches of the rules will result in harsher punishment.\n` +
              `If you believe this decision was unfair, please feel free to open a ticket for the Board of Directors.\n\n` +
              `Thank you,\nBoard of Directors.`
          )
          .setTimestamp();

        await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

        // Add muted role
        await targetMember.roles.add(mutedRole, reason);

        // Main reply
        await interaction.reply({
          content: `🔇 **${targetUser.tag}** successfully muted for **${parsed.label}** (Case #${caseNumber}).`,
        });

        // Log mute
        let muteCaseObj = null;

        if (modActionChannel && modActionChannel.isTextBased()) {
          const logEmbed = new EmbedBuilder()
            .setTitle('🔇 User Muted')
            .setColor(COLORS.mute)
            .addFields(
              { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
              { name: 'User ID', value: targetUser.id, inline: true },
              { name: 'Reason', value: reason },
              { name: 'Duration', value: parsed.label },
              {
                name: 'Responsible Moderator',
                value: `${moderator.tag} (<@${moderator.id}>)`,
              },
              {
                name: 'Previous Mutes',
                value: String(muteCount - 1),
                inline: true,
              },
              { name: 'Case Number', value: `#${caseNumber}` }
            )
            .setTimestamp();

          const logMsg = await modActionChannel.send({ embeds: [logEmbed] });

          muteCaseObj = {
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

          cases.set(caseNumber, muteCaseObj);
        }

        // Add to user history
        if (muteCaseObj) {
          addToHistory(targetUser.id, muteCaseObj);
        }

        // === AUTO-UNMUTE AFTER DURATION ===
        setTimeout(async () => {
          try {
            const memberToUnmute = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!memberToUnmute) return;
            if (!memberToUnmute.roles.cache.has(MUTED_ROLE_ID)) return;

            // Remove muted role
            await memberToUnmute.roles.remove(
              MUTED_ROLE_ID,
              'Automatic unmute after mute duration elapsed'
            );

            // Create a new case for automatic unmute
            const autoCaseNumber = getCaseNumber();
            const autoReason = `Automatic unmute after ${parsed.label} mute. Original reason: ${reason}`;
            const botUser = client.user;

            // DM user about auto-unmute
            const autoDmEmbed = new EmbedBuilder()
              .setTitle('🔊 Your mute has expired')
              .setColor(COLORS.unmute)
              .setDescription(
                `Your mute in **Thames Valley Roleplay** has now expired.\n\n` +
                  `**Original Reason:** ${reason}\n` +
                  `**Mute Duration:** ${parsed.label}\n` +
                  `**Responsible Moderator for Mute:** ${moderator.tag}\n\n` +
                  `You are now free to talk in the Discord server as normal.\n` +
                  `Please bear the original reason in mind to avoid further action.\n\n` +
                  `Thank you,\nBoard of Directors.`
              )
              .setTimestamp();

            await targetUser.send({ embeds: [autoDmEmbed] }).catch(() => {});

            // Log auto-unmute
            if (modActionChannel && modActionChannel.isTextBased()) {
              const autoLogEmbed = new EmbedBuilder()
                .setTitle('🔊 User Automatically Unmuted')
                .setColor(COLORS.unmute)
                .addFields(
                  {
                    name: 'User',
                    value: `${targetUser.tag} (<@${targetUser.id}>)`,
                    inline: true,
                  },
                  { name: 'User ID', value: targetUser.id, inline: true },
                  { name: 'Reason', value: autoReason },
                  {
                    name: 'Unmuted By',
                    value: `${botUser.tag} (Automatic Timer)`,
                  },
                  { name: 'Case Number', value: `#${autoCaseNumber}` }
                )
                .setTimestamp();

              const autoLogMsg = await modActionChannel.send({ embeds: [autoLogEmbed] });

              const autoCaseObj = {
                caseNumber: autoCaseNumber,
                type: 'auto_unmute',
                userId: targetUser.id,
                moderatorId: botUser.id,
                reason: autoReason,
                duration: null,
                timestamp: Date.now(),
                logChannelId: modActionChannel.id,
                logMessageId: autoLogMsg.id,
              };

              cases.set(autoCaseNumber, autoCaseObj);
              addToHistory(targetUser.id, autoCaseObj);
            }
          } catch (e) {
            console.error('Error auto-unmuting user:', e);
          }
        }, parsed.ms);
      } catch (err) {
        console.error('Internal /mute add error:', err);
        if (!interaction.replied && !interaction.deferred) {
          await interaction
            .reply({
              content: 'There was an error while executing this command.',
              ephemeral: true,
            })
            .catch(() => {});
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
            content:
              "You don't have the required role to use this command. Allowed: Moderator, Administrator, Board of Directors.",
            ephemeral: true,
          });
          return;
        }

        const targetUser = interaction.options.getUser('user', true);
        const unmuteReason = interaction.options.getString('reason', true);

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
          await interaction.reply({
            content: "I couldn't find that user in this server.",
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

        if (!targetMember.roles.cache.has(MUTED_ROLE_ID)) {
          await interaction.reply({
            content: 'This user is not currently muted.',
            ephemeral: true,
          });
          return;
        }

        // Auto-fetch original mute reason from history
        let originalReason = 'Original mute reason not found.';
        const history = userHistory.get(targetUser.id) || [];
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          if (h.type === 'mute' && h.reason) {
            originalReason = h.reason;
            break;
          }
        }

        const moderator = interaction.user;
        const caseNumber = getCaseNumber();

        await targetMember.roles.remove(MUTED_ROLE_ID, unmuteReason);

        // DM user
        const dmEmbed = new EmbedBuilder()
          .setTitle('🔊 You have been unmuted')
          .setColor(COLORS.unmute)
          .setDescription(
            `You have been unmuted in **Thames Valley Roleplay**.\n\n` +
              `**Reason for unmute:** ${unmuteReason}\n` +
              `**Reason for original mute:** ${originalReason}\n` +
              `**Responsible Moderator:** ${moderator.tag}\n\n` +
              `You are now free to talk in the Discord Server as normal.\n` +
              `Please acknowledge the reason for the original mute and bear this in mind going forward.\n\n` +
              `Thank you,\nBoard of Directors.`
          )
          .setTimestamp();

        await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

        // Reply in channel
        await interaction.reply({
          content: `🔊 **${targetUser.tag}** successfully unmuted (Case #${caseNumber}).`,
        });

        // Log manual unmute
        if (modActionChannel && modActionChannel.isTextBased()) {
          const logEmbed = new EmbedBuilder()
            .setTitle('🔊 User Unmuted')
            .setColor(COLORS.unmute)
            .addFields(
              { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
              { name: 'User ID', value: targetUser.id, inline: true },
              { name: 'Reason for Unmute', value: unmuteReason },
              { name: 'Reason for Original Mute', value: originalReason },
              {
                name: 'Responsible Moderator',
                value: `${moderator.tag} (<@${moderator.id}>)`,
              },
              { name: 'Case Number', value: `#${caseNumber}` }
            )
            .setTimestamp();

          const logMsg = await modActionChannel.send({ embeds: [logEmbed] });

          const caseObj = {
            caseNumber,
            type: 'unmute',
            userId: targetUser.id,
            moderatorId: moderator.id,
            reason: unmuteReason,
            duration: null,
            timestamp: Date.now(),
            logChannelId: modActionChannel.id,
            logMessageId: logMsg.id,
          };

          cases.set(caseNumber, caseObj);
          addToHistory(targetUser.id, caseObj);
        }
      } catch (err) {
        console.error('Internal /mute remove error:', err);
        if (!interaction.replied && !interaction.deferred) {
          await interaction
            .reply({
              content: 'There was an error while executing this command.',
              ephemeral: true,
            })
            .catch(() => {});
        }
      }

      return;
    }

    // Fallback
    return interaction.reply({
      content: 'Unknown subcommand for /mute.',
      ephemeral: true,
    });
  },
};




