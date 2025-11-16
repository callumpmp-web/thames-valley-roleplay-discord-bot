module.exports = {
  name: 'ping',

  async execute(interaction) {
    const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);

    await interaction.editReply(
      `🏓 Pong!\n` +
      `Message latency: **${latency}ms**\n` +
      `API latency: **${apiLatency}ms**`
    );
  },
};

