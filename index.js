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

// Colours for different embed types
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

// ====== IN-MEMORY STORAGE ======

let nextCaseNumber = 1;

const cases = new Map();
const warnsCount = new Map();
const mutesCount = new Map();
const kicksCount = new Map();
const modNotes = new Map();
const userHistory = new Map();

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

// ====== COMMAND HANDLERS REGISTRY ======

const commandHandlers = new Map();

// Moderation commands
commandHandlers.set('ping', require('./commands/Moderation/ping'));
commandHandlers.set('ban', require('./commands/Moderation/ban'));
commandHandlers.set('mute', require('./commands/Moderation/mute'));
commandHandlers.set('kick', require('./commands/Moderation/kick'));
commandHandlers.set('channel', require('./commands/Moderation/channel'));
commandHandlers.set('modnote', require('./commands/Moderation/modnote'));
commandHandlers.set('role', require('./commands/Moderation/role'));
commandHandlers.set('warn', require('./commands/Moderation/warn'));
commandHandlers.set('history', require('./commands/Moderation/history'));
commandHandlers.set('reason', require('./commands/Moderation/reason'));

// Shared context for moderation commands
const moderationConstants = {
  ROLE_BOARD,
  ROLE_ADMIN,
  ROLE_MOD,
  MUTED_ROLE_ID,
  MOD_ACTION_CHANNEL_ID,
  ROLE_LOG_CHANNEL_ID,
  HISTORY_ALLOWED_CHANNELS,
  HISTORY_ALLOWED_CATEGORY_ID,
  NOTE_REASON_ALLOWED_CHANNELS,
  NOTE_REASON_ALLOWED_CATEGORY_ID,
  ROLE_MANAGEMENT_ROLES,
  ROLE_TEMP_ALLOWED,
  STAFF_ROLES,
  BOARD_ONLY,
  ADMIN_BOARD,
  COLORS,
};

const moderationState = {
  cases,
  warnsCount,
  mutesCount,
  kicksCount,
  modNotes,
  userHistory,
};

const moderationHelpers = {
  hasAnyRole,
  isChannelAllowedForHistoryOrNotes,
  isChannelAllowedForReason,
  parseDuration,
  addToHistory,
  getOrIncrement,
  getCaseNumber,
};

// ====== SLASH COMMAND DEFINITIONS ======

const slashCommands = [
  {
    name: 'ban',
    description: 'Manage bans',
    options: [
      {
        type: 1,
        name: 'add',
        description: 'Ban a member from the server',
        options: [
          { type: 6, name: 'user', description: 'User to ban', required: true },
          { type: 3, name: 'reason', description: 'Reason for the ban', required: true },
        ],
      },
      {
        type: 1,
        name: 'remove',
        description: 'Unban a user',
        options: [
          { type: 3, name: 'userid', description: 'ID of the user to unban', required: true },
          { type: 3, name: 'reason', description: 'Reason for unbanning', required: true },
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
            type: 6, // USER
            name: 'user',
            description: 'User to mute',
            required: true,
          },
          {
            type: 3, // STRING
            name: 'duration',
            description: 'Duration (e.g. 10m, 1h, 1d)',
            required: true,
          },
          {
            type: 3, // STRING
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
            type: 6, // USER
            name: 'user',
            description: 'User to unmute',
            required: true,
          },
          {
            type: 3, // STRING
            name: 'reason',
            description: 'Reason for unmuting',
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
      { type: 6, name: 'user', description: 'User to kick', required: true },
      { type: 3, name: 'reason', description: 'Reason for kick', required: true },
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
          { type: 3, name: 'reason', description: 'Reason for lockdown', required: true },
          {
            type: 7,
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
          { type: 3, name: 'reason', description: 'Reason for lifting lockdown', required: true },
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
          { type: 6, name: 'user', description: 'User to add note to', required: true },
          { type: 3, name: 'note', description: 'The note text', required: true },
        ],
      },
      {
        type: 1,
        name: 'remove',
        description: 'Remove a mod note from a user by note number',
        options: [
          { type: 6, name: 'user', description: 'User whose note to remove', required: true },
          { type: 4, name: 'number', description: 'Note number to remove', required: true },
          { type: 3, name: 'reason', description: 'Reason for removing this note', required: true },
        ],
      },
      {
        type: 1,
        name: 'show',
        description: 'Show all mod notes for a user',
        options: [
          { type: 6, name: 'user', description: 'User whose notes to show', required: true },
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
          { type: 6, name: 'user', description: 'User to add role to', required: true },
          { type: 8, name: 'role', description: 'Role to add', required: true },
          { type: 3, name: 'reason', description: 'Reason for adding role', required: true },
        ],
      },
      {
        type: 1,
        name: 'remove',
        description: 'Remove a role from a member',
        options: [
          { type: 6, name: 'user', description: 'User to remove role from', required: true },
          { type: 8, name: 'role', description: 'Role to remove', required: true },
          { type: 3, name: 'reason', description: 'Reason for removing role', required: true },
        ],
      },
      {
        type: 1,
        name: 'temp',
        description: 'Temporarily give a user a role',
        options: [
          { type: 6, name: 'user', description: 'User to give role to', required: true },
          { type: 8, name: 'role', description: 'Role to give', required: true },
          { type: 3, name: 'duration', description: 'How long (e.g. 1h, 1d)', required: true },
          { type: 3, name: 'reason', description: 'Reason', required: true },
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
          { type: 6, name: 'user', description: 'User to warn', required: true },
          { type: 3, name: 'reason', description: 'Reason for warning', required: true },
        ],
      },
      {
        type: 1,
        name: 'remove',
        description: 'Remove a warning from a user (one warn)',
        options: [
          { type: 6, name: 'user', description: 'User whose warn to remove', required: true },
          { type: 3, name: 'reason', description: 'Reason for removing warn', required: true },
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
      { type: 4, name: 'case', description: 'Case number to update', required: true },
      { type: 3, name: 'newreason', description: 'New reason', required: true },
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

// ====== LEGACY TEXT COMMAND ======

client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  if (message.content === '!ping') {
    return message.reply('Pong!');
  }
});

// ====== SLASH COMMAND DISPATCHER ======

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  const ctx = {
    client,
    constants: moderationConstants,
    state: moderationState,
    helpers: moderationHelpers,
  };

  const handler = commandHandlers.get(commandName);
  if (!handler) {
    return interaction.reply({
      content: 'This command is not implemented yet.',
      ephemeral: true,
    });
  }

  try {
    await handler.execute(interaction, ctx);
  } catch (err) {
    console.error(`Error running command "${commandName}":`, err);

    // Safe error reply – don't crash if already acknowledged
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: 'There was an error while executing this command.',
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: 'There was an error while executing this command.',
          ephemeral: true,
        });
      }
    } catch (err2) {
      if (err2.code !== 40060) {
        console.error('Failed to send error response:', err2);
      }
    }
  }
});

// ====== LOGIN ======

client.login(process.env.DISCORD_TOKEN);




