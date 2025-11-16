module.exports = {
  name: 'warn',
  async execute(interaction) {
    return interaction.reply({
      content: 'The /warn command is temporarily unavailable while the bot is being restructured.',
      ephemeral: true,
    });
  },
};

