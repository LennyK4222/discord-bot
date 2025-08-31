import { Client, GatewayIntentBits, EmbedBuilder, Partials, PermissionsBitField } from 'discord.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { getGuildConfig } from './configStore.js';
import { composeBanner } from './bannerComposer.js';
import { composeAnimatedBanner } from './animatedBannerComposer.js';

export async function startBot() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('Lipsește DISCORD_TOKEN în .env');

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages
    ],
    partials: [Partials.GuildMember, Partials.User]
  });

  // Guarded ready handler to support multiple discord.js versions
  let readyHandled = false;
  async function onClientReady() {
    if (readyHandled) return;
    readyHandled = true;
    console.log(`Bot conectat ca ${client.user.tag}`);

    // Register a simple guild-scoped /test command on startup.
    // We'll use bulk set if available for clarity; otherwise fall back to create.
    try {
      const commandData = {
        name: 'test',
        description: 'Trimite un mesaj de test (admin only)',
        options: [
          { name: 'channel', type: 7, description: 'Canal (override)', required: false },
          { name: 'type', type: 3, description: 'welcome sau goodbye', required: false, choices: [{ name: 'welcome', value: 'welcome' }, { name: 'goodbye', value: 'goodbye' }] }
        ]
      };

      let registered = 0;
      for (const [, guild] of client.guilds.cache) {
        try {
          // Some discord.js versions expose `commands.set` to bulk overwrite guild commands.
          if (guild.commands && typeof guild.commands.set === 'function') {
            await guild.commands.set([commandData]);
          } else {
            await guild.commands.create(commandData);
          }
          registered++;
        } catch (e) {
          console.warn('Could not register command for guild', guild.id, e?.message || e);
        }
      }
      console.log(`Slash commands (guild) registration attempted; registered in ${registered} guild(s)`);
    } catch (e) {
      console.error('Error registering commands', e);
    }
  }

  // Listen for both names to be compatible with discord.js v14/v15 changes.
  client.once('ready', onClientReady);
  client.once('clientReady', onClientReady);

  // Resolve banners directory for local attachments
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const bannersDir = path.join(__dirname, '..', 'data', 'banners');
  // Simple per-guild rate limiter for slash commands (ms)
  const lastTestAt = new Map();

  async function sendBanner(member, type) {
    const cfg = await getGuildConfig(member.guild.id);
    const isWelcome = type === 'welcome';

    const channelId = isWelcome ? cfg.welcomeChannelId : (cfg.goodbyeChannelId || cfg.welcomeChannelId);
    if (!channelId) return;

    const channel = await member.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const title = isWelcome ? 'Bine ai venit!' : 'La revedere!';
    const subtitle = member.user?.username || member.displayName || (isWelcome ? `@${member.id}` : 'un membru');
    const avatarUrl = member.user?.displayAvatarURL({ extension: 'png', size: 128 });
    const color = isWelcome ? 0x00bcd4 : 0xff7043;

    const backgroundFilePath = cfg.bannerFile ? path.join(bannersDir, cfg.bannerFile) : undefined;
    const isGifLocal = cfg.bannerFile ? path.extname(cfg.bannerFile).toLowerCase() === '.gif' : false;
    const isGifUrl = cfg.bannerUrl ? new URL(cfg.bannerUrl).pathname.toLowerCase().endsWith('.gif') : false;
    const useGif = isGifLocal || isGifUrl;

    const composer = useGif ? composeAnimatedBanner : composeBanner;
  // Send a lightweight quick message first so users see feedback immediately,
  // then compose and send the full banner asynchronously.
  try {
    // quick plain/text embed to appear fast
    const quick = { content: isWelcome ? `Bine ai venit, <@${member.id}>!` : `La revedere, ${member.user?.username || ''}!` };
    // send without awaiting heavy composition
    await channel.send(quick).catch(() => null);
  } catch (e) {
    // ignore quick send errors
  }

  // Compose and send the full banner in background
  (async () => {
    try {
      const composed = await composer({ backgroundFilePath, backgroundUrl: cfg.bannerUrl, title, subtitle, avatarUrl, layout: cfg.layout || {} });
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTimestamp(new Date())
        .setImage(`attachment://banner.${useGif ? 'gif' : 'png'}`);
      await channel.send({ embeds: [embed], files: [{ attachment: composed, name: `banner.${useGif ? 'gif' : 'png'}` }] }).catch(() => null);
    } catch (e) {
      console.error('Error composing/sending banner (async):', e);
    }
  })();
  }

  // Interaction handler for slash commands
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isCommand()) return;
      if (interaction.commandName !== 'test') return;

      // Permission check: user must be guild admin or have ManageGuild
      const member = interaction.member;
      const isAdmin = member && (member.permissions?.has?.(PermissionsBitField.Flags.Administrator) || member.permissions?.has?.(PermissionsBitField.Flags.ManageGuild) || interaction.guild?.ownerId === member.id);
      if (!isAdmin) {
        return interaction.reply({ content: 'Doar administratori pot folosi această comandă.', ephemeral: true });
      }

      // Rate limit per guild: 3s
      const gid = interaction.guild.id;
      const now = Date.now();
      const last = lastTestAt.get(gid) || 0;
      if (now - last < 3000) {
        return interaction.reply({ content: 'Comandă folosită prea repede. Așteaptă câteva secunde.', ephemeral: true });
      }
      lastTestAt.set(gid, now);

      await interaction.deferReply({ ephemeral: true });

      const type = interaction.options.getString('type') || 'welcome';
      const channelOpt = interaction.options.getChannel('channel');

      const guild = interaction.guild;
      const cfg = await getGuildConfig(guild.id);

      const targetChannel = channelOpt || (type === 'goodbye' ? (cfg.goodbyeChannelId ? await guild.channels.fetch(cfg.goodbyeChannelId).catch(()=>null) : null) : (cfg.welcomeChannelId ? await guild.channels.fetch(cfg.welcomeChannelId).catch(()=>null) : null));
      if (!targetChannel || !targetChannel.isTextBased()) {
        return interaction.editReply({ content: 'Canal invalid sau nu este text. Verifică configurarea sau alege un canal valid.' });
      }

      const title = type === 'goodbye' ? 'La revedere!' : 'Bine ai venit!';
      const subtitle = interaction.user.username;
      const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 128 });

      const bannersDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'banners');
      const backgroundFilePath = cfg.bannerFile ? path.join(bannersDir, cfg.bannerFile) : undefined;
      const isGifLocal = cfg.bannerFile ? path.extname(cfg.bannerFile).toLowerCase() === '.gif' : false;
      const isGifUrl = cfg.bannerUrl ? new URL(cfg.bannerUrl).pathname.toLowerCase().endsWith('.gif') : false;
      const useGif = isGifLocal || isGifUrl;

      const finalLayout = cfg.layout || {};
      const composer = useGif ? composeAnimatedBanner : composeBanner;
      const composed = await composer({ backgroundFilePath, backgroundUrl: cfg.bannerUrl, title, subtitle, avatarUrl, layout: finalLayout });

      const embed = new EmbedBuilder()
        .setColor(type === 'goodbye' ? 0xff7043 : 0x00bcd4)
        .setTimestamp(new Date())
        .setImage(`attachment://banner.${useGif ? 'gif' : 'png'}`);

      await targetChannel.send({ embeds: [embed], files: [{ attachment: composed, name: `banner.${useGif ? 'gif' : 'png'}` }] });

      await interaction.editReply({ content: 'Test trimis cu succes.' });
    } catch (e) {
      console.error('Interaction handler error', e);
      try { if (interaction.deferred || interaction.replied) await interaction.editReply({ content: 'Eroare la trimiterea testului.' }); else await interaction.reply({ content: 'Eroare la trimiterea testului.', ephemeral: true }); } catch {}
    }
  });

  client.on('guildMemberAdd', async (member) => {
    try {
      // Assign auto-role if configured
      try {
        const cfg = await getGuildConfig(member.guild.id);
        const autoRoleId = cfg.autoRoleId;
        if (autoRoleId) {
          const role = member.guild.roles.cache.get(autoRoleId) || await member.guild.roles.fetch(autoRoleId).catch(() => null);
          const me = member.guild.members.me;
          if (role && me && me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            // Ensure bot's highest role is above the target role
            const botHighest = me.roles.highest;
            if (botHighest && botHighest.position > role.position) {
              await member.roles.add(role).catch(e => console.warn('Failed to add auto role:', e));
            } else {
              console.warn('Cannot add auto role: bot role not high enough or missing permissions');
            }
          }
        }
      } catch (e) {
        console.error('Error assigning auto role:', e);
      }

      await sendBanner(member, 'welcome');
    } catch (e) {
      console.error('Eroare la welcome:', e);
    }
  });

  client.on('guildMemberRemove', async (member) => {
    try {
      await sendBanner(member, 'goodbye');
    } catch (e) {
      console.error('Eroare la goodbye:', e);
    }
  });

  await client.login(token);
  return client;
}
