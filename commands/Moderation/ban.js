const { EmbedBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
  name: 'ban',
  async execute(interaction, { constants, state, helpers }) {
    const { STAFF_ROLES, BOARD_ONLY, COLORS, MOD_ACTION_CHANNEL_ID } = constants;
    const { cases, warnsCount, mutesCount, kicksCount, userHistory } = state;
    const { hasAnyRole, addToHistory, getOrIncrement, getCaseNumber } = helpers;

    const guild = interaction.guild;
    const member = interaction.member;
    const modActionChannel = guild.channels.cache.get(MOD_ACTION_CHANNEL_ID);

    const sub = interaction.options.getSubcommand();

    // /ban add
    if (sub === 'add') {
      if (!hasAnyRole(member, STAFF_ROLES)) {
        return interaction.reply({
          content:
            "You don't have the required role to use this command. Allowed: Moderator, Administrator, Board of Directors.",
          ephemeral: true,
        });
      }

      if (!guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        return interaction.reply({
          content: "I don't have Ban Members permission.",
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);

      const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return interaction.reply({
          content: "I couldn't find that user in this server.",
          ephemeral: true,
        });
      }

      if (targetUser.id === interaction.user.id) {
        return interaction.reply({ content: "You can't ban yourself.", ephemeral: true });
      }
      if (targetUser.id === interaction.client.user.id) {
        return interaction.reply({ content: "I can't ban myself.", ephemeral: true });
      }

      const caseNumber = getCaseNumber();
      const moderator = interaction.user;

      const dmEmbed = new EmbedBuilder()
        .setTitle('🚫 You have been banned')
        .setColor(COLORS.ban)
        .setDescription(
          `You have been banned from **Thames Valley Roleplay**.\n\n` +
            `**Reason:** ${reason}\n` +
            `**Responsible Moderator:** ${moderator.tag}\n\n` +
            `Thank you,\nBoard of Directors.`
        )
        .setTimestamp();

      await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

      await targetMember.ban({ reason });

      await interaction.reply({
        content: `🚨 **${targetUser.tag}** successfully banned. (Case #${caseNumber})`,
      });

      if (modActionChannel && modActionChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('🚫 User Banned')
          .setColor(COLORS.ban)
          .addFields(
            { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Reason', value: reason },
            {
              name: 'Responsible Moderator',
              value: `${moderator.tag} (<@${moderator.id}>)`,
            },
            { name: 'Case Number', value: `#${caseNumber}` }
          )
          .setTimestamp();

        const logMsg = await modActionChannel.send({ embeds: [embed] });

        const caseObj = {
          caseNumber,
          type: 'ban',
          userId: targetUser.id,
          moderatorId: moderator.id,
          reason,
          duration: null,
          timestamp: Date.now(),
          logChannelId: modActionChannel.id,
          logMessageId: logMsg.id,
        };
        cases.set(caseNumber, caseObj);
        addToHistory(targetUser.id, {
          ...caseObj,
          extra: {},
        });
      }

      getOrIncrement(warnsCount, targetUser.id, 0);
      getOrIncrement(mutesCount, targetUser.id, 0);
      getOrIncrement(kicksCount, targetUser.id, 0);

      return;
    }

    // /ban remove
    if (sub === 'remove') {
      if (!hasAnyRole(member, BOARD_ONLY)) {
        return interaction.reply({
          content: 'Only the Board of Directors can use this command.',
          ephemeral: true,
        });
      }

      if (!guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        return interaction.reply({
          content: "I don't have Ban Members permission.",
          ephemeral: true,
        });
      }

      const userId = interaction.options.getString('userid', true);
      const reason = interaction.options.getString('reason', true);
      const moderator = interaction.user;

      const existingBan = await guild.bans.fetch(userId).catch(() => null);
      const userTag = existingBan?.user?.tag || `User ID ${userId}`;

      try {
        await guild.bans.remove(userId, reason);

        await interaction.reply({
          content: `✅ Successfully unbanned **${userTag}** (ID: ${userId}).`,
        });

        const caseNumber = getCaseNumber();

        if (existingBan?.user) {
          const dmEmbed = new EmbedBuilder()
            .setTitle('✅ You have been unbanned')
            .setColor(COLORS.unban)
            .setDescription(
              `You have been unbanned in **Thames Valley Roleplay**.\n\n` +
                `**Reason for unban:** ${reason}\n` +
                `**Responsible Moderator:** ${moderator.tag}\n\n` +
                `Please acknowledge the reason and reflect on your behaviour.\n` +
                `We look forward to welcoming you back.\n\n` +
                `Thank you,\nBoard of Directors.`
            )
            .setTimestamp();

          await existingBan.user.send({ embeds: [dmEmbed] }).catch(() => {});
        }

        if (modActionChannel && modActionChannel.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle('✅ User Unbanned')
            .setColor(COLORS.unban)
            .addFields(
              { name: 'User', value: `${userTag}`, inline: true },
              { name: 'User ID', value: userId, inline: true },
              { name: 'Reason', value: reason },
              {
                name: 'Responsible Moderator',
                value: `${moderator.tag} (<@${moderator.id}>)`,
              },
              { name: 'Case Number', value: `#${caseNumber}` }
            )
            .setTimestamp();

          const logMsg = await modActionChannel.send({ embeds: [embed] });

          const caseObj = {
            caseNumber,
            type: 'unban',
            userId,
            moderatorId: moderator.id,
            reason,
            duration: null,
            timestamp: Date.now(),
            logChannelId: modActionChannel.id,
            logMessageId: logMsg.id,
          };
          cases.set(caseNumber, caseObj);
          addToHistory(userId, {
            ...caseObj,
            extra: {},
          });
        }
      } catch (err) {
        console.error(err);
        return interaction.reply({
          content:
            'I could not unban that user. Make sure the ID is correct and the user is actually banned.',
          ephemeral: true,
        });
      }

      return;
    }
  },
};

