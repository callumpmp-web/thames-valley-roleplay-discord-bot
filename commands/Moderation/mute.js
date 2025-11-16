module.exports = {
  name: 'mute',
  async execute(interaction) {
    return interaction.reply({
      content: 'The /mute command is temporarily unavailable while the bot is being restructured.',
      ephemeral: true,
    });
  },
};

