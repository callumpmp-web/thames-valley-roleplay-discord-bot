module.exports = {
  name: 'channel',
  async execute(interaction) {
    return interaction.reply({
      content: 'The /channel command is temporarily unavailable while the bot is being restructured.',
      ephemeral: true,
    });
  },
};

