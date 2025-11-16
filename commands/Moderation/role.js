module.exports = {
  name: 'role',
  async execute(interaction) {
    return interaction.reply({
      content: 'The /role command is temporarily unavailable while the bot is being restructured.',
      ephemeral: true,
    });
  },
};

