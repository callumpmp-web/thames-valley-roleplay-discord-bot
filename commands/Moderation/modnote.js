module.exports = {
  name: 'modnote',
  async execute(interaction) {
    return interaction.reply({
      content: 'The /modnote command is temporarily unavailable while the bot is being restructured.',
      ephemeral: true,
    });
  },
};

