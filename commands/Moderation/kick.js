module.exports = {
  name: 'kick',
  async execute(interaction) {
    return interaction.reply({
      content: 'The /kick command is temporarily unavailable while the bot is being restructured.',
      ephemeral: true,
    });
  },
};

