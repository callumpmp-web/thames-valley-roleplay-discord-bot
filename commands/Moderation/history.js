module.exports = {
  name: 'history',
  async execute(interaction) {
    return interaction.reply({
      content: 'The /history command is temporarily unavailable while the bot is being restructured.',
      ephemeral: true,
    });
  },
};

