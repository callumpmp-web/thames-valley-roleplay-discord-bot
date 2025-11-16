require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  Partials,
  EmbedBuilder,
} = require('discord.js');

// ====== CONFIG ======

const GUILD_ID = process.env.GUILD_ID;

// Core moderation roles
const ROLE_BOARD = '1436754003689209956';
const ROLE_ADMIN = '1439397202018566257';
const ROLE_MOD = '1437064375717330944';

// Muted role
const MUTED_ROLE_ID = '1437939077939724368';

// Logging / mod channels
const MOD_ACTION_CHANNEL_ID = '1437099267796762635';
const ROLE_LOG_CHANNEL_ID = '1439402059068604537';
const HISTORY_ALLOWED_CHANNELS = [
  '1439405051625082880', // history channel
  '1437099267796762635', // mod action
  '1437098668497830112', // mod chat
];
const HISTORY_ALLOWED_CATEGORY_ID = '1436865112748064819';

// Same allowed channels and category for /modnote show and /reason
const NOTE_REASON_ALLOWED_CHANNELS = HISTORY_ALLOWED_CHANNELS;
const NOTE_REASON_ALLOWED_CATEGORY_ID = HISTORY_ALLOWED_CATEGORY_ID;

// Roles allowed for role add/remove/temp
const ROLE_MANAGEMENT_ROLES = [
  '1437061345072644218',
  '1436889453384958112',
  '1436889336963534901',
  '1437061403734446151',
  '1436889403061698741',
  '1436889300821348453',
  '1437061436416462874',
  '1436889366537568367',
  '1436889252473344020',
  ROLE_MOD,
  ROLE_ADMIN,
  ROLE_BOARD,
];

// Role temp special roles
const ROLE_TEMP_ALLOWED = [ROLE_ADMIN, ROLE_BOARD];

// Allowed for bans, mutes, kicks, warns, modnotes
const STAFF_ROLES = [ROLE_MOD, ROLE_ADMIN, ROLE_BOARD];
const BOARD_ONLY = [ROLE_BOARD];
const ADMIN_BOARD = [ROLE_ADMIN, ROLE_BOARD];

// Colours for different embed types (just picked distinct ones)
const COLORS = {
  ban: 0xff0000,
  unban: 0x00ff99,
  mute: 0xffa500,
  unmute: 0x00ffff,
  kick: 0xff66ff,
  channelLock: 0x9933ff,
  channelUnlock: 0x33ccff,
  modnoteAdd: 0xffff00,
  modnoteRemove: 0xcc9900,
  modnoteShow: 0xffffff,
  warnAdd: 0xff5555,
  warnRemove: 0x55ff55,
  history: 0x9999ff,
  reasonUpdate: 0x00ffcc,
  roleAdd: 0x00cc66,
  roleRemove: 0xcc6600,
  roleTemp: 0x66ccff,
};

// ====== SIMPLE IN-MEMORY STORAGE ======

// Global case numbers for actions (ban, unban, mute, unmute, kick, warn add/remove, etc.)
let nextCaseNumber = 1;

// Map caseNumber -> case object
const cases = new Map();
/*
  {
    caseNumber,
    type, // 'ban', 'unban', 'mute', 'unmute', 'kick', 'warn_add', 'warn_remove', etc.
    userId,
    moderatorId,
    reason,
    duration, // if applicable
    timestamp,
    logChannelId,
    logMessageId,
  }
*/

// Per-user counts
const warnsCount = new Map(); // userId -> number
const mutesCount = new Map(); // userId -> number
const kicksCount = new Map(); // userId -> number

// Mod notes per user
const modNotes = new Map(); // userId -> array of { number, text, moderatorId, timestamp }

// Full history per user (for /history)
const userHistory = new Map();
/*
  userHistory.set(userId, [
    { caseNumber, type, reason, moderatorId, timestamp, extra: { ... } }
  ])
*/

// ====== HELPERS ======

function hasAnyRole(member, roleIds) {
  if (!member || !member.roles || !member.roles.cache) return false;
  return member.roles.cache.some((r) => roleIds.includes(r.id));
}

function isChannelAllowedForHistoryOrNotes(channel) {
  if (!channel || !channel.guild) return false;
  if (HISTORY_ALLOWED_CHANNELS.includes(channel.id)) return true;
  if (channel.parentId && channel.parentId === HISTORY_ALLOWED_CATEGORY_ID) return true;
  return false;
}

function isChannelAllowedForReason(channel) {
  if (!channel || !channel.guild) return false;
  if (NOTE_REASON_ALLOWED_CHANNELS.includes(channel.id)) return true;
  if (channel.parentId && channel.parentId === NOTE_REASON_ALLOWED_CATEGORY_ID) return true;
  return false;
}

// duration format: 10m, 2h, 30s, 1d
function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  let ms = amount * 1000;
  let label = `${amount} second${amount === 1 ? '' : 's'}`;

  if (unit === 'm') {
    ms = amount * 60 * 1000;
    label = `${amount} minute${amount === 1 ? '' : 's'}`;
  } else if (unit === 'h') {
    ms = amount * 60 * 60 * 1000;
    label = `${amount} hour${amount === 1 ? '' : 's'}`;
  } else if (unit === 'd') {
    ms = amount * 24 * 60 * 60 * 1000;
    label = `${amount} day${amount === 1 ? '' : 's'}`;
  }

  return { ms, label };
}

function addToHistory(userId, entry) {
  if (!userHistory.has(userId)) {
    userHistory.set(userId, []);
  }
  userHistory.get(userId).push(entry);
}

function getOrIncrement(map, userId, delta = 1) {
  const current = map.get(userId) || 0;
  const updated = current + delta;
  map.set(userId, updated);
  return updated;
}

function getCaseNumber() {
  const num = nextCaseNumber;
  nextCaseNumber += 1;
  return num;
}

// ====== CLIENT SETUP ======

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const PREFIX = '!';

// ====== SLASH COMMAND DEFINITIONS ======

const slashCommands = [
  {
    name: 'ban',
    description: 'Manage bans',
    options: [
      {
        type: 1, // SUB_COMMAND
        name: 'add',
        description: 'Ban a member from the server',
        options: [
          {
            type: 6, // USER
            name: 'user',
            description: 'User to ban',
            required: true,
          },
          {
            type: 3, // STRING
            name: 'reason',
            description: 'Reason for the ban',
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: 'remove',
        description: 'Unban a user',
        options: [
          {
            type: 3,
            name: 'userid',
            description: 'ID of the user to unban',
            required: true,
          },
          {
            type: 3,
            name: 'reason',
            description: 'Reason for unbanning',
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: 'mute',
    description: 'Manage mutes',
    options: [
      {
        type: 1,
        name: 'add',
        description: 'Mute a user (via Muted role)',
        options: [
          {
            type: 6,
            name: 'user',
            description: 'User to mute',
            required: true,
          },
          {
            type: 3,
            name: 'duration',
            description: 'Duration (e.g. 10m, 1h, 1d)',
            required: true,
          },
          {
            type: 3,
            name: 'reason',
            description: 'Reason for mute',
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: 'remove',
        description: 'Unmute a user (remove Muted role)',
        options: [
          {
            type: 6,
            name: 'user',
            description: 'User to unmute',
            required: true,
          },
          {
            type: 3,
            name: 'reason',
            description: 'Reason for unmuting',
            required: true,
          },
          {
            type: 3,
            name: 'originalreason',
            description: 'Reason for original mute',
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: 'kick',
    description: 'Kick a member',
    options: [
      {
        type: 6,
        name: 'user',
        description: 'User to kick',
        required: true,
      },
      {
        type: 3,
        name: 'reason',
        description: 'Reason for kick',
        required: true,
      },
      {
        type: 3,
        name: 'duration',
        description: 'Suggested duration (for DM text, e.g. reflect period)',
        required: false,
      },
    ],
  },
  {
    name: 'channel',
    description: 'Lock or unlock channels',
    options: [
      {
        type: 1,
        name: 'lock',
        description: 'Lock a channel (disable sending messages)',
        options: [
          {
            type: 3,
            name: 'reason',
            description: 'Reason for lockdown',
            required: true,
          },
          {
            type: 7, // CHANNEL
            name: 'channel',
            description: 'Channel to lock (defaults to current)',
            required: false,
          },
        ],
      },
      {
        type: 1,
        name: 'unlock',
        description: 'Unlock a locked channel',
        options: [
          {
            type: 3,
            name: 'reason',
            description: 'Reason for lifting lockdown',
            required: true,
          },
          {
            type: 7,
            name: 'channel',
            description: 'Channel to unlock (defaults to current)',
            required: false,
          },
        ],
      },
    ],
  },
  {
    name: 'modnote',
    description: 'Manage mod notes',
    options: [
      {
        type: 1,
        name: 'add',
        description: 'Add a mod note to a user',
        options: [
          {
            type: 6,
            name: 'user',
            description: 'User to add note to',
            required: true,
          },
          {
            type: 3,
            name: 'note',
            description: 'The note text',
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: 'remove',
        description: 'Remove a mod note from a user by note number',
        options: [
          {
            type: 6,
            name: 'user',
            description: 'User whose note to remove',
            required: true,
          },
          {
            type: 4,
            name: 'number',
            description: 'Note number to remove',
            required: true,
          },
          {
            type: 3,
            name: 'reason',
            description: 'Reason for removing this note',
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: 'show',
        description: 'Show all mod notes for a user',
        options: [
          {
            type: 6,
            name: 'user',
            description: 'User whose notes to show',
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: 'ping',
    description: 'Check bot latency',
  },
  {
    name: 'role',
    description: 'Manage roles on members',
    options: [
      {
        type: 1,
        name: 'add',
        description: 'Add a role to a member',
        options: [
          {
            type: 6,
            name: 'user',
            description: 'User to add role to',
            required: true,
          },
          {
            type: 8,
            name: 'role',
            description: 'Role to add',
            required: true,
          },
          {
            type: 3,
            name: 'reason',
            description: 'Reason for adding role',
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: 'remove',
        description: 'Remove a role from a member',
        options: [
          {
            type: 6,
            name: 'user',
            description: 'User to remove role from',
            required: true,
          },
          {
            type: 8,
            name: 'role',
            description: 'Role to remove',
            required: true,
          },
          {
            type: 3,
            name: 'reason',
            description: 'Reason for removing role',
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: 'temp',
        description: 'Temporarily give a user a role',
        options: [
          {
            type: 6,
            name: 'user',
            description: 'User to give role to',
            required: true,
          },
          {
            type: 8,
            name: 'role',
            description: 'Role to give',
            required: true,
          },
          {
            type: 3,
            name: 'duration',
            description: 'How long (e.g. 1h, 1d)',
            required: true,
          },
          {
            type: 3,
            name: 'reason',
            description: 'Reason',
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: 'warn',
    description: 'Manage warnings',
    options: [
      {
        type: 1,
        name: 'add',
        description: 'Warn a user',
        options: [
          {
            type: 6,
            name: 'user',
            description: 'User to warn',
            required: true,
          },
          {
            type: 3,
            name: 'reason',
            description: 'Reason for warning',
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: 'remove',
        description: 'Remove a warning from a user (one warn)',
        options: [
          {
            type: 6,
            name: 'user',
            description: 'User whose warn to remove',
            required: true,
          },
          {
            type: 3,
            name: 'reason',
            description: 'Reason for removing warn',
            required: true,
          },
          {
            type: 3,
            name: 'originalreason',
            description: 'Reason for original warn',
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: 'history',
    description: 'Show full moderation history for a user',
    options: [
      {
        type: 6,
        name: 'user',
        description: 'User to view history for',
        required: true,
      },
    ],
  },
  {
    name: 'reason',
    description: 'Update the reason for a case number',
    options: [
      {
        type: 4,
        name: 'case',
        description: 'Case number to update',
        required: true,
      },
      {
        type: 3,
        name: 'newreason',
        description: 'New reason',
        required: true,
      },
    ],
  },
];

// ====== READY EVENT & SLASH REGISTRATION ======

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  if (!GUILD_ID) {
    console.log('No GUILD_ID found in .env; not registering slash commands.');
    return;
  }

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.log('Could not find guild with GUILD_ID. Is the bot in the server?');
    return;
  }

  try {
    await guild.commands.set(slashCommands);
    console.log('✅ Registered all slash commands in guild.');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

// ====== LEGACY TEXT COMMAND (for sanity check) ======

client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  if (message.content === '!ping') {
    return message.reply('Pong!');
  }
});

// ====== SLASH COMMAND HANDLER ======

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // Helper: fetch mod-action channel
  const guild = interaction.guild;
  const modActionChannel = guild.channels.cache.get(MOD_ACTION_CHANNEL_ID);
  const roleLogChannel = guild.channels.cache.get(ROLE_LOG_CHANNEL_ID);

  // Helper: check staff perms
  const member = interaction.member;

  // /ping
  if (commandName === 'ping') {
    const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);
    return interaction.editReply(
      `🏓 Pong!\nMessage latency: **${latency}ms**\nAPI latency: **${apiLatency}ms**`
    );
  }

  // /ban
  if (commandName === 'ban') {
    const sub = interaction.options.getSubcommand();

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
      if (targetUser.id === client.user.id) {
        return interaction.reply({ content: "I can't ban myself.", ephemeral: true });
      }

      // Case number
      const caseNumber = getCaseNumber();
      const moderator = interaction.user;

      // DM the user (embed)
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

      // Ban them
      await targetMember.ban({ reason });

      await interaction.reply({
        content: `🔨 **${targetUser.tag}** successfully banned. (Case #${caseNumber})`,
      });

      // Log embed
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

        // Save case
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

      getOrIncrement(warnsCount, targetUser.id, 0); // ensure init
      getOrIncrement(mutesCount, targetUser.id, 0);
      getOrIncrement(kicksCount, targetUser.id, 0);

      return;
    }

    if (sub === 'remove') {
      // /ban remove (unban)
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

      // Try fetch ban first
      const existingBan = await guild.bans.fetch(userId).catch(() => null);
      const userTag = existingBan?.user?.tag || `User ID ${userId}`;

      try {
        await guild.bans.remove(userId, reason);

        await interaction.reply({
          content: `✅ Successfully unbanned **${userTag}** (ID: ${userId}).`,
        });

        const caseNumber = getCaseNumber();

        // DM user (embed)
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

        // Log embed
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
  }

  // /mute
  if (commandName === 'mute') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      if (!hasAnyRole(member, STAFF_ROLES)) {
        return interaction.reply({
          content:
            "You don't have the required role to use this command. Allowed: Moderator, Administrator, Board of Directors.",
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser('user', true);
      const durationStr = interaction.options.getString('duration', true);
      const reason = interaction.options.getString('reason', true);

      const parsed = parseDuration(durationStr);
      if (!parsed) {
        return interaction.reply({
          content: 'Invalid duration format. Use something like `10m`, `1h`, or `1d`.',
          ephemeral: true,
        });
      }

      const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return interaction.reply({
          content: "I couldn't find that user in this server.",
          ephemeral: true,
        });
      }

      const mutedRole = guild.roles.cache.get(MUTED_ROLE_ID);
      if (!mutedRole) {
        return interaction.reply({
          content: 'Muted role not found. Please create it and set its ID in the bot config.',
          ephemeral: true,
        });
      }

      const moderator = interaction.user;
      const caseNumber = getCaseNumber();
      const newMuteCount = getOrIncrement(mutesCount, targetUser.id, 1);

      // DM embed
      const dmEmbed = new EmbedBuilder()
        .setTitle('🔇 You have been muted')
        .setColor(COLORS.mute)
        .setDescription(
          `You have been muted in **Thames Valley Roleplay**.\n\n` +
            `**Reason:** ${reason}\n` +
            `**Duration:** ${parsed.label}\n` +
            `**Responsible Moderator:** ${moderator.tag}\n\n` +
            `Please acknowledge the reason and reflect on your behaviour.\n` +
            `Further breaches of the rules will result in harsher punishment.\n` +
            `If you believe this decision was unfair, please feel free to open a ticket for the Board of Directors.\n\n` +
            `Thank you,\nBoard of Directors.`
        )
        .setTimestamp();

      await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

      // Add muted role
      await targetMember.roles.add(mutedRole, reason);

      await interaction.reply({
        content: `🔇 **${targetUser.tag}** successfully muted for **${parsed.label}** (Case #${caseNumber}).`,
      });

      // Log embed
      if (modActionChannel && modActionChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('🔇 User Muted')
          .setColor(COLORS.mute)
          .addFields(
            { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Reason', value: reason },
            {
              name: 'Duration',
              value: parsed.label,
            },
            {
              name: 'Responsible Moderator',
              value: `${moderator.tag} (<@${moderator.id}>)`,
            },
            {
              name: 'Previous Mutes',
              value: String(newMuteCount - 1),
              inline: true,
            },
            { name: 'Case Number', value: `#${caseNumber}` }
          )
          .setTimestamp();

        const logMsg = await modActionChannel.send({ embeds: [embed] });

        const caseObj = {
          caseNumber,
          type: 'mute',
          userId: targetUser.id,
          moderatorId: moderator.id,
          reason,
          duration: parsed.label,
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

      // Schedule unmute (non-persistent)
      setTimeout(async () => {
        try {
          const memberToUnmute = await guild.members.fetch(targetUser.id).catch(() => null);
          if (!memberToUnmute) return;
          if (!memberToUnmute.roles.cache.has(MUTED_ROLE_ID)) return;

          await memberToUnmute.roles.remove(MUTED_ROLE_ID, 'Automatic unmute after duration');
        } catch (e) {
          console.error('Error auto-unmuting:', e);
        }
      }, parsed.ms);

      return;
    }

    if (sub === 'remove') {
      if (!hasAnyRole(member, STAFF_ROLES)) {
        return interaction.reply({
          content:
            "You don't have the required role to use this command. Allowed: Moderator, Administrator, Board of Directors.",
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      const originalReason = interaction.options.getString('originalreason', true);
      const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return interaction.reply({
          content: "I couldn't find that user in this server.",
          ephemeral: true,
        });
      }

      const mutedRole = guild.roles.cache.get(MUTED_ROLE_ID);
      if (!mutedRole) {
        return interaction.reply({
          content: 'Muted role not found.',
          ephemeral: true,
        });
      }

      if (!targetMember.roles.cache.has(MUTED_ROLE_ID)) {
        return interaction.reply({
          content: 'This user is not currently muted.',
          ephemeral: true,
        });
      }

      const moderator = interaction.user;
      const caseNumber = getCaseNumber();

      await targetMember.roles.remove(MUTED_ROLE_ID, reason);

      // DM embed
      const dmEmbed = new EmbedBuilder()
        .setTitle('🔊 You have been unmuted')
        .setColor(COLORS.unmute)
        .setDescription(
          `You have been unmuted in **Thames Valley Roleplay**.\n\n` +
            `**Reason for unmute:** ${reason}\n` +
            `**Reason for original mute:** ${originalReason}\n` +
            `**Responsible Moderator:** ${moderator.tag}\n\n` +
            `You are now free to talk in the Discord Server as normal.\n` +
            `As mentioned when you were muted, please acknowledge the reason and reflect on your behaviour.\n` +
            `Further breaches of the rules will result in harsher punishment.\n\n` +
            `Thank you,\nBoard of Directors.`
        )
        .setTimestamp();

      await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

      await interaction.reply({
        content: `🔊 **${targetUser.tag}** successfully unmuted (Case #${caseNumber}).`,
      });

      // Log embed
      if (modActionChannel && modActionChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('🔊 User Unmuted')
          .setColor(COLORS.unmute)
          .addFields(
            { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Reason for Unmute', value: reason },
            { name: 'Reason for Original Mute', value: originalReason },
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
          type: 'unmute',
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

      return;
    }
  }

  // /kick
  if (commandName === 'kick') {
    if (!hasAnyRole(member, STAFF_ROLES)) {
      return interaction.reply({
        content:
          "You don't have the required role to use this command. Allowed: Moderator, Administrator, Board of Directors.",
        ephemeral: true,
      });
    }

    if (!guild.members.me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return interaction.reply({
        content: "I don't have Kick Members permission.",
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    const durationStr = interaction.options.getString('duration') || 'N/A';

    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return interaction.reply({
        content: "I couldn't find that user in this server.",
        ephemeral: true,
      });
    }

    const moderator = interaction.user;
    const caseNumber = getCaseNumber();
    const newKickCount = getOrIncrement(kicksCount, targetUser.id, 1);

    // DM embed
    const dmEmbed = new EmbedBuilder()
      .setTitle('👢 You have been kicked')
      .setColor(COLORS.kick)
      .setDescription(
        `You have been kicked from **Thames Valley Roleplay**.\n\n` +
          `**Reason:** ${reason}\n` +
          `**Duration:** ${durationStr}\n` +
          `**Responsible Moderator:** ${moderator.tag}\n\n` +
          `Please acknowledge the reason and reflect on your behaviour.\n` +
          `Further breaches of the rules will result in harsher punishment.\n` +
          `If you believe this decision was unfair, please feel free to open a ticket for the Board of Directors.\n\n` +
          `NOTE: This is a kick, and therefore you are free to join back to the server at any time.\n\n` +
          `Thank you,\nBoard of Directors.`
      )
      .setTimestamp();

    await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

    await targetMember.kick(reason);

    await interaction.reply({
      content: `👢 **${targetUser.tag}** successfully kicked (Case #${caseNumber}).`,
    });

    // Log embed
    if (modActionChannel && modActionChannel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle('👢 User Kicked')
        .setColor(COLORS.kick)
        .addFields(
          { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
          { name: 'User ID', value: targetUser.id, inline: true },
          { name: 'Reason', value: reason },
          {
            name: 'Responsible Moderator',
            value: `${moderator.tag} (<@${moderator.id}>)`,
          },
          {
            name: 'Previous Kicks',
            value: String(newKickCount - 1),
            inline: true,
          },
          { name: 'Case Number', value: `#${caseNumber}` }
        )
        .setTimestamp();

      const logMsg = await modActionChannel.send({ embeds: [embed] });

      const caseObj = {
        caseNumber,
        type: 'kick',
        userId: targetUser.id,
        moderatorId: moderator.id,
        reason,
        duration: durationStr,
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

    return;
  }

  // /channel lock/unlock
  if (commandName === 'channel') {
    const sub = interaction.options.getSubcommand();

    if (!hasAnyRole(member, ADMIN_BOARD)) {
      return interaction.reply({
        content: 'Only Administrator and Board of Directors can use this command.',
        ephemeral: true,
      });
    }

    const targetChannel =
      interaction.options.getChannel('channel') || interaction.channel;

    const reason = interaction.options.getString('reason', true);
    const moderator = interaction.user;
    const everyoneRole = guild.roles.everyone;
    const caseNumber = getCaseNumber();

    if (sub === 'lock') {
      await targetChannel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: false,
      });

      await interaction.reply({
        content: `🔒 Channel ${targetChannel} locked (Case #${caseNumber}).`,
      });

      // Log embed (mod-action)
      if (modActionChannel && modActionChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('🔒 Channel Locked')
          .setColor(COLORS.channelLock)
          .addFields(
            { name: 'Channel', value: `${targetChannel} (${targetChannel.id})` },
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
          type: 'channel_lock',
          userId: null,
          moderatorId: moderator.id,
          reason,
          duration: null,
          timestamp: Date.now(),
          logChannelId: modActionChannel.id,
          logMessageId: logMsg.id,
        };
        cases.set(caseNumber, caseObj);
      }

      // Embed in affected channel
      const channelEmbed = new EmbedBuilder()
        .setTitle('🚨 Lockdown in effect')
        .setColor(COLORS.channelLock)
        .setDescription(
          `Lockdown in effect.\n\n` +
            `**Locked by:** ${moderator.tag} (<@${moderator.id}>)\n` +
            `**Reason:** ${reason}\n\n` +
            `Due to breach of server rules, this channel is locked down.\n` +
            `Users are not able to type in this channel until it is unlocked.\n\n` +
            `Please use this time to acknowledge the reason for the lockdown and reflect on your actions.\n` +
            `This channel will be unlocked at the discretion of the Administration Team and Board of Directors.\n\n` +
            `Thank you,\nBoard of Directors.`
        )
        .setTimestamp();

      if (targetChannel.isTextBased()) {
        await targetChannel.send({ embeds: [channelEmbed] }).catch(() => {});
      }

      return;
    }

    if (sub === 'unlock') {
      await targetChannel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: null,
      });

      await interaction.reply({
        content: `🔓 Channel ${targetChannel} unlocked (Case #${caseNumber}).`,
      });

      // Log embed (mod-action)
      if (modActionChannel && modActionChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('🔓 Channel Unlocked')
          .setColor(COLORS.channelUnlock)
          .addFields(
            { name: 'Channel', value: `${targetChannel} (${targetChannel.id})` },
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
          type: 'channel_unlock',
          userId: null,
          moderatorId: moderator.id,
          reason,
          duration: null,
          timestamp: Date.now(),
          logChannelId: modActionChannel.id,
          logMessageId: logMsg.id,
        };
        cases.set(caseNumber, caseObj);
      }

      // Embed in affected channel
      const channelEmbed = new EmbedBuilder()
        .setTitle('✅ Lockdown lifted')
        .setColor(COLORS.channelUnlock)
        .setDescription(
          `Lockdown lifted.\n\n` +
            `**Unlocked by:** ${moderator.tag} (<@${moderator.id}>)\n` +
            `**Reason:** ${reason}\n\n` +
            `You are now free to continue typing as normal.\n` +
            `Please acknowledge the reason for the lockdown and bear this in mind going forward.\n` +
            `Failure to abide by the rules will lead to similar or harsher disciplinary action.\n\n` +
            `Thank you,\nBoard of Directors.`
        )
        .setTimestamp();

      if (targetChannel.isTextBased()) {
        await targetChannel.send({ embeds: [channelEmbed] }).catch(() => {});
      }

      return;
    }
  }

  // /modnote
  if (commandName === 'modnote') {
    const sub = interaction.options.getSubcommand();

    if (!hasAnyRole(member, STAFF_ROLES)) {
      if (sub === 'remove' && !hasAnyRole(member, ADMIN_BOARD)) {
        // Board/Admin only for remove, but staff check fails anyway
      }
      return interaction.reply({
        content:
          "You don't have the required role to use this command. Allowed: Moderator, Administrator, Board of Directors.",
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user', true);

    // /modnote add
    if (sub === 'add') {
      const noteText = interaction.options.getString('note', true);
      const moderator = interaction.user;

      if (!modNotes.has(targetUser.id)) {
        modNotes.set(targetUser.id, []);
      }
      const notesArray = modNotes.get(targetUser.id);
      const noteNumber = notesArray.length + 1;

      const noteObj = {
        number: noteNumber,
        text: noteText,
        moderatorId: moderator.id,
        timestamp: Date.now(),
      };
      notesArray.push(noteObj);

      // Log embed
      if (modActionChannel && modActionChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('📝 Mod Note Added')
          .setColor(COLORS.modnoteAdd)
          .addFields(
            { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Note #', value: String(noteNumber), inline: true },
            { name: 'Note', value: noteText },
            {
              name: 'Responsible Moderator',
              value: `${moderator.tag} (<@${moderator.id}>)`,
            }
          )
          .setTimestamp();

        await modActionChannel.send({ embeds: [embed] });
      }

      await interaction.reply({
        content: `📝 Modnote #${noteNumber} successfully added to **${targetUser.tag}**.`,
      });

      return;
    }

    // /modnote remove
    if (sub === 'remove') {
      if (!hasAnyRole(member, ADMIN_BOARD)) {
        return interaction.reply({
          content: 'Only Administrator and Board of Directors can remove mod notes.',
          ephemeral: true,
        });
      }

      const number = interaction.options.getInteger
        ? interaction.options.getInteger('number', true)
        : parseInt(interaction.options.get('number').value, 10);
      const reason = interaction.options.getString('reason', true);
      const moderator = interaction.user;

      const notesArray = modNotes.get(targetUser.id) || [];
      const noteIndex = notesArray.findIndex((n) => n.number === number);
      if (noteIndex === -1) {
        return interaction.reply({
          content: `No mod note #${number} found for this user.`,
          ephemeral: true,
        });
      }

      const [removedNote] = notesArray.splice(noteIndex, 1);

      // Re-number future notes
      notesArray.forEach((n, idx) => {
        n.number = idx + 1;
      });

      // Log embed
      if (modActionChannel && modActionChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('🗑️ Mod Note Removed')
          .setColor(COLORS.modnoteRemove)
          .addFields(
            { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Note Number Removed', value: String(number), inline: true },
            { name: 'Note Text', value: removedNote.text },
            { name: 'Reason for Removal', value: reason },
            {
              name: 'Responsible Moderator',
              value: `${moderator.tag} (<@${moderator.id}>)`,
            }
          )
          .setTimestamp();

        await modActionChannel.send({ embeds: [embed] });
      }

      await interaction.reply({
        content: `🗑️ Modnote #${number} successfully removed from **${targetUser.tag}**.`,
      });

      return;
    }

    // /modnote show
    if (sub === 'show') {
      if (!isChannelAllowedForHistoryOrNotes(interaction.channel)) {
        return interaction.reply({
          content: 'This command can only be used in staff/mod/history channels.',
          ephemeral: true,
        });
      }

      const notesArray = modNotes.get(targetUser.id) || [];
      if (notesArray.length === 0) {
        return interaction.reply({
          content: `No mod notes found for **${targetUser.tag}**.`,
          ephemeral: true,
        });
      }

      const lines = notesArray.map((note) => {
        const date = new Date(note.timestamp).toLocaleString();
        return `**#${note.number}** (${date}) by <@${note.moderatorId}>:\n${note.text}`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`📝 Mod Notes for ${targetUser.tag}`)
        .setColor(COLORS.modnoteShow)
        .addFields(
          { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
          { name: 'User ID', value: targetUser.id, inline: true },
          {
            name: 'Notes',
            value: lines.join('\n\n'),
          }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return;
    }
  }

  // /role
  if (commandName === 'role') {
    const sub = interaction.options.getSubcommand();

    const modHasRolePerm = hasAnyRole(member, ROLE_MANAGEMENT_ROLES);
    if (!modHasRolePerm) {
      return interaction.reply({
        content: 'You do not have permission to manage roles with this command.',
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user', true);
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return interaction.reply({
        content: "I couldn't find that user in this server.",
        ephemeral: true,
      });
    }

    const role = interaction.options.getRole('role', true);
    const reason = interaction.options.getString('reason', sub === 'temp' ? false : true);
    const durationStr = sub === 'temp'
      ? interaction.options.getString('duration', true)
      : null;

    // Ensure role hierarchy
    const executorHighest = member.roles.highest;
    const botHighest = guild.members.me.roles.highest;

    if (executorHighest.comparePositionTo(role) <= 0 && member.id !== guild.ownerId) {
      return interaction.reply({
        content: "You can't manage a role that is higher or equal to your highest role.",
        ephemeral: true,
      });
    }

    if (botHighest.comparePositionTo(role) <= 0) {
      return interaction.reply({
        content: "I can't manage that role because it is higher than or equal to my highest role.",
        ephemeral: true,
      });
    }

    const moderator = interaction.user;

    if (sub === 'add') {
      const caseNumber = getCaseNumber();

      await targetMember.roles.add(role, reason);

      await interaction.reply({
        content: `✅ Successfully added ${role} to **${targetUser.tag}** (Case #${caseNumber}).`,
      });

      // DM
      const dmEmbed = new EmbedBuilder()
        .setTitle('🎖️ New Role Granted')
        .setColor(COLORS.roleAdd)
        .setDescription(
          `Congratulations, you have been added the ${role} role in **Thames Valley Roleplay**.\n\n` +
            `**Reason:** ${reason}\n` +
            `**Responsible Person:** ${moderator.tag}\n\n` +
            `Thank you,\nBoard of Directors.`
        )
        .setTimestamp();

      await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

      // Log
      if (roleLogChannel && roleLogChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('🎖️ Role Added')
          .setColor(COLORS.roleAdd)
          .addFields(
            { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Role', value: `${role}`, inline: true },
            { name: 'Reason', value: reason },
            {
              name: 'Responsible Person',
              value: `${moderator.tag} (<@${moderator.id}>)`,
            },
            { name: 'Case Number', value: `#${caseNumber}` }
          )
          .setTimestamp();

        const logMsg = await roleLogChannel.send({ embeds: [embed] });

        const caseObj = {
          caseNumber,
          type: 'role_add',
          userId: targetUser.id,
          moderatorId: moderator.id,
          reason,
          duration: null,
          timestamp: Date.now(),
          logChannelId: roleLogChannel.id,
          logMessageId: logMsg.id,
        };
        cases.set(caseNumber, caseObj);
        addToHistory(targetUser.id, {
          ...caseObj,
          extra: { roleId: role.id },
        });
      }

      return;
    }

    if (sub === 'remove') {
      const caseNumber = getCaseNumber();

      await targetMember.roles.remove(role, reason);

      await interaction.reply({
        content: `✅ Successfully removed ${role} from **${targetUser.tag}** (Case #${caseNumber}).`,
      });

      // DM
      const dmEmbed = new EmbedBuilder()
        .setTitle('🎖️ Role Removed')
        .setColor(COLORS.roleRemove)
        .setDescription(
          `You have had the ${role} role in **Thames Valley Roleplay** removed.\n\n` +
            `**Reason:** ${reason}\n` +
            `**Responsible Person:** ${moderator.tag}\n\n` +
            `Please cease from using the skills and training taught as part of this role when playing on the server.\n` +
            `If you believe this decision to be unfair, please open a ticket directed to the Board of Directors.\n\n` +
            `Thank you,\nBoard of Directors.`
        )
        .setTimestamp();

      await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

      // Log
      if (roleLogChannel && roleLogChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('🎖️ Role Removed')
          .setColor(COLORS.roleRemove)
          .addFields(
            { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Role', value: `${role}`, inline: true },
            { name: 'Reason', value: reason },
            {
              name: 'Responsible Person',
              value: `${moderator.tag} (<@${moderator.id}>)`,
            },
            { name: 'Case Number', value: `#${caseNumber}` }
          )
          .setTimestamp();

        const logMsg = await roleLogChannel.send({ embeds: [embed] });

        const caseObj = {
          caseNumber,
          type: 'role_remove',
          userId: targetUser.id,
          moderatorId: moderator.id,
          reason,
          duration: null,
          timestamp: Date.now(),
          logChannelId: roleLogChannel.id,
          logMessageId: logMsg.id,
        };
        cases.set(caseNumber, caseObj);
        addToHistory(targetUser.id, {
          ...caseObj,
          extra: { roleId: role.id },
        });
      }

      return;
    }

    if (sub === 'temp') {
      if (!hasAnyRole(member, ROLE_TEMP_ALLOWED)) {
        return interaction.reply({
          content: 'Only Administrator and Board of Directors may use /role temp.',
          ephemeral: true,
        });
      }

      const durationStr2 = interaction.options.getString('duration', true);
      const reason2 = interaction.options.getString('reason', true);

      const parsed = parseDuration(durationStr2);
      if (!parsed) {
        return interaction.reply({
          content: 'Invalid duration format. Use something like `10m`, `1h`, or `1d`.',
          ephemeral: true,
        });
      }

      const caseNumber = getCaseNumber();

      await targetMember.roles.add(role, reason2);

      await interaction.reply({
        content: `✅ Successfully added ${role} to **${targetUser.tag}** for **${parsed.label}** (Case #${caseNumber}).`,
      });

      // DM
      const dmEmbed = new EmbedBuilder()
        .setTitle('🎖️ Temporary Role Granted')
        .setColor(COLORS.roleTemp)
        .setDescription(
          `Congratulations, you have temporarily been added the ${role} role in **Thames Valley Roleplay**.\n\n` +
            `**Reason:** ${reason2}\n` +
            `**Duration:** ${parsed.label}\n` +
            `**Responsible Person:** ${moderator.tag}\n\n` +
            `Please note that this is a temporary role and will be removed after the designated time period.\n` +
            `Using the features of this role after this time period can and will result in disciplinary action.\n\n` +
            `Thank you,\nBoard of Directors.`
        )
        .setTimestamp();

      await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

      // Log
      if (roleLogChannel && roleLogChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('🎖️ Temporary Role Added')
          .setColor(COLORS.roleTemp)
          .addFields(
            { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Role', value: `${role}`, inline: true },
            { name: 'Reason', value: reason2 },
            {
              name: 'Responsible Person',
              value: `${moderator.tag} (<@${moderator.id}>)`,
            },
            { name: 'Duration', value: parsed.label, inline: true },
            { name: 'Case Number', value: `#${caseNumber}` }
          )
          .setTimestamp();

        const logMsg = await roleLogChannel.send({ embeds: [embed] });

        const caseObj = {
          caseNumber,
          type: 'role_temp',
          userId: targetUser.id,
          moderatorId: moderator.id,
          reason: reason2,
          duration: parsed.label,
          timestamp: Date.now(),
          logChannelId: roleLogChannel.id,
          logMessageId: logMsg.id,
        };
        cases.set(caseNumber, caseObj);
        addToHistory(targetUser.id, {
          ...caseObj,
          extra: { roleId: role.id },
        });
      }

      // schedule role removal
      setTimeout(async () => {
        try {
          const memberToEdit = await guild.members.fetch(targetUser.id).catch(() => null);
          if (!memberToEdit) return;
          if (!memberToEdit.roles.cache.has(role.id)) return;
          await memberToEdit.roles.remove(role, 'Temporary role duration expired');
        } catch (e) {
          console.error('Error auto-removing temp role:', e);
        }
      }, parsed.ms);

      return;
    }
  }

  // /warn
  if (commandName === 'warn') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      if (!hasAnyRole(member, STAFF_ROLES)) {
        return interaction.reply({
          content:
            "You don't have the required role to use this command. Allowed: Moderator, Administrator, Board of Directors.",
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      const moderator = interaction.user;

      const newWarnCount = getOrIncrement(warnsCount, targetUser.id, 1);
      const caseNumber = getCaseNumber();

      // DM embed
      const dmEmbed = new EmbedBuilder()
        .setTitle('⚠️ You have been warned')
        .setColor(COLORS.warnAdd)
        .setDescription(
          `You have been warned in **Thames Valley Roleplay**.\n\n` +
            `**Reason:** ${reason}\n` +
            `**Number of Warns:** ${newWarnCount}\n` +
            `**Responsible Moderator:** ${moderator.tag}\n\n` +
            `Please acknowledge the reason and reflect on your behaviour.\n` +
            `Further breaches of the rules will result in harsher punishment.\n` +
            `If you believe this decision was unfair, please feel free to open a ticket for the Board of Directors.\n\n` +
            `Thank you,\nBoard of Directors.`
        )
        .setTimestamp();

      await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

      await interaction.reply({
        content: `⚠️ **${targetUser.tag}** successfully warned (Warns: ${newWarnCount}, Case #${caseNumber}).`,
      });

      // Log embed
      if (modActionChannel && modActionChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('⚠️ User Warned')
          .setColor(COLORS.warnAdd)
          .addFields(
            { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Reason', value: reason },
            {
              name: 'Responsible Moderator',
              value: `${moderator.tag} (<@${moderator.id}>)`,
            },
            {
              name: 'Number of Warns',
              value: String(newWarnCount),
              inline: true,
            },
            { name: 'Case Number', value: `#${caseNumber}` }
          )
          .setTimestamp();

        const logMsg = await modActionChannel.send({ embeds: [embed] });

        const caseObj = {
          caseNumber,
          type: 'warn_add',
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
          extra: { warns: newWarnCount },
        });
      }

      return;
    }

    if (sub === 'remove') {
      if (!hasAnyRole(member, ADMIN_BOARD)) {
        return interaction.reply({
          content: 'Only Administrator and Board of Directors can remove warnings.',
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      const originalReason = interaction.options.getString('originalreason', true);
      const moderator = interaction.user;

      const currentWarn = warnsCount.get(targetUser.id) || 0;
      if (currentWarn <= 0) {
        return interaction.reply({
          content: 'This user currently has no recorded warns.',
          ephemeral: true,
        });
      }

      const newCount = Math.max(0, currentWarn - 1);
      warnsCount.set(targetUser.id, newCount);
      const caseNumber = getCaseNumber();

      // DM plain text (as requested)
      const dmText =
        `You have had your warning removed in **Thames Valley Roleplay**.\n\n` +
        `**Reason for original warn:** ${originalReason}\n` +
        `**Reason for removal:** ${reason}\n` +
        `**Number of Warns:** ${newCount}\n` +
        `**Responsible Moderator:** ${moderator.tag}\n\n` +
        `Thank you,\nBoard of Directors`;

      await targetUser.send(dmText).catch(() => {});

      await interaction.reply({
        content: `✅ Successfully removed a warning from **${targetUser.tag}** (Warns: ${newCount}, Case #${caseNumber}).`,
      });

      // Log embed
      if (modActionChannel && modActionChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('✅ Warning Removed')
          .setColor(COLORS.warnRemove)
          .addFields(
            { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Reason for Original Warn', value: originalReason },
            { name: 'Reason for Removal', value: reason },
            {
              name: 'Responsible Moderator',
              value: `${moderator.tag} (<@${moderator.id}>)`,
            },
            {
              name: 'Updated Warn Count',
              value: String(newCount),
            },
            { name: 'Case Number', value: `#${caseNumber}` }
          )
          .setTimestamp();

        const logMsg = await modActionChannel.send({ embeds: [embed] });

        const caseObj = {
          caseNumber,
          type: 'warn_remove',
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
          extra: { warns: newCount },
        });
      }

      return;
    }
  }

  // /history
  if (commandName === 'history') {
    if (!hasAnyRole(member, STAFF_ROLES)) {
      return interaction.reply({
        content:
          "You don't have the required role to use this command. Allowed: Moderator, Administrator, Board of Directors.",
        ephemeral: true,
      });
    }

    if (!isChannelAllowedForHistoryOrNotes(interaction.channel)) {
      return interaction.reply({
        content: 'This command can only be used in staff/mod/history channels.',
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user', true);
    const history = userHistory.get(targetUser.id) || [];

    if (history.length === 0) {
      return interaction.reply({
        content: `No moderation history found for **${targetUser.tag}**.`,
        ephemeral: true,
      });
    }

    const lines = history
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((h) => {
        const date = new Date(h.timestamp).toLocaleString();
        return `**Case #${h.caseNumber}** [${h.type}] (${date})\nReason: ${h.reason}`;
      });

    const embed = new EmbedBuilder()
      .setTitle(`📜 History for ${targetUser.tag}`)
      .setColor(COLORS.history)
      .addFields(
        { name: 'User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
        { name: 'User ID', value: targetUser.id, inline: true },
        {
          name: 'Cases',
          value: lines.join('\n\n').slice(0, 4000) || '(too many to display)',
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    return;
  }

  // /reason
  if (commandName === 'reason') {
    if (!hasAnyRole(member, STAFF_ROLES)) {
      return interaction.reply({
        content:
          "You don't have the required role to use this command. Allowed: Moderator, Administrator, Board of Directors.",
        ephemeral: true,
      });
    }

    if (!isChannelAllowedForReason(interaction.channel)) {
      return interaction.reply({
        content: 'This command can only be used in staff/mod/history channels.',
        ephemeral: true,
      });
    }

    const caseNumber = interaction.options.getInteger
      ? interaction.options.getInteger('case', true)
      : parseInt(interaction.options.get('case').value, 10);
    const newReason = interaction.options.getString('newreason', true);

    const caseObj = cases.get(caseNumber);
    if (!caseObj) {
      return interaction.reply({
        content: `No case found with number #${caseNumber}.`,
        ephemeral: true,
      });
    }

    const oldReason = caseObj.reason;
    caseObj.reason = newReason;

    // Also update in userHistory
    const historyArr = userHistory.get(caseObj.userId) || [];
    for (const h of historyArr) {
      if (h.caseNumber === caseNumber) {
        h.reason = newReason;
      }
    }

    // Try to edit original log embed
    if (caseObj.logChannelId && caseObj.logMessageId) {
      try {
        const channel = client.channels.cache.get(caseObj.logChannelId);
        if (channel && channel.isTextBased()) {
          const msg = await channel.messages.fetch(caseObj.logMessageId);
          if (msg && msg.embeds && msg.embeds[0]) {
            const oldEmbed = msg.embeds[0];
            const newEmbed = EmbedBuilder.from(oldEmbed).setFields(
              oldEmbed.fields.map((f) =>
                f.name.toLowerCase() === 'reason'
                  ? { ...f, value: newReason }
                  : f
              )
            );
            await msg.edit({ embeds: [newEmbed] });
          }
        }
      } catch (e) {
        console.error('Failed to edit old case embed:', e);
      }
    }

    // Log update embed in mod-action channel
    if (modActionChannel && modActionChannel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle('✏️ Case Reason Updated')
        .setColor(COLORS.reasonUpdate)
        .addFields(
          { name: 'Case Number', value: `#${caseNumber}`, inline: true },
          { name: 'User ID', value: String(caseObj.userId || 'N/A'), inline: true },
          { name: 'Event Type', value: caseObj.type || 'unknown' },
          { name: 'Original Reason', value: oldReason || 'N/A' },
          { name: 'Updated Reason', value: newReason },
          {
            name: 'Updated By',
            value: `${interaction.user.tag} (<@${interaction.user.id}>)`,
          }
        )
        .setTimestamp();

      await modActionChannel.send({ embeds: [embed] });
    }

    await interaction.reply({
      content: `✏️ Successfully updated reason for case #${caseNumber}.`,
    });
    return;
  }
});

// ====== LOGIN ======

client.login(process.env.DISCORD_TOKEN);


