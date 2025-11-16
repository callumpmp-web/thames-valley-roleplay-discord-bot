module.exports = {
  name: 'reason',
  async execute(interaction) {
    return interaction.reply({
      content: 'The /reason command is temporarily unavailable while the bot is being restructured.',
      ephemeral: true,
    });
  },
};

