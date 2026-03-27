// ═══════════════════════════════════════════════════════
//  a1ex GP Tool — Discord Key Management Bot
//  
//  Setup:
//  1. Go to discord.com/developers → New Application → Bot
//  2. Copy your bot token
//  3. Set environment variables (see below)
//  4. Invite bot to your server with admin permissions
//  5. npm install discord.js express crypto fs
//  6. node bot.js
// ═══════════════════════════════════════════════════════

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits } = require('discord.js')
const express = require('express')
const crypto = require('crypto')
const fs = require('fs')

// ── CONFIG ────────────────────────────────────────────
const BOT_TOKEN     = process.env.BOT_TOKEN     || 'YOUR_BOT_TOKEN_HERE'
const CLIENT_ID     = process.env.CLIENT_ID     || 'YOUR_CLIENT_ID_HERE'
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null   // only this role can use commands (optional)
const GUILD_ID      = process.env.GUILD_ID      || null   // your server ID (faster command registration)

// ── KEYS DATABASE ─────────────────────────────────────
const KEYS_FILE = './keys.json'

function loadKeys() {
  try { if(fs.existsSync(KEYS_FILE)) return JSON.parse(fs.readFileSync(KEYS_FILE,'utf8')) } catch(e) {}
  return {}
}
function saveKeys(keys) { fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2)) }
let KEYS = loadKeys()

// ── KEY GENERATOR ─────────────────────────────────────
function generateKey() {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase()
  return `A1EX-${seg()}-${seg()}-${seg()}`
}

// ── DISCORD BOT ───────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] })

// Slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('generate')
    .setDescription('Generate license keys')
    .addIntegerOption(o => o.setName('amount').setDescription('How many keys (default 1, max 25)').setMinValue(1).setMaxValue(25))
    .addStringOption(o => o.setName('expires').setDescription('Expiry date e.g. 2026-12-31 (optional)'))
    .addUserOption(o => o.setName('user').setDescription('Send keys to this user via DM (optional)')),

  new SlashCommandBuilder()
    .setName('lookup')
    .setDescription('Look up a license key')
    .addStringOption(o => o.setName('key').setDescription('The key to look up').setRequired(true)),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Reset HWID for a key (allow new machine)')
    .addStringOption(o => o.setName('key').setDescription('The key to reset').setRequired(true)),

  new SlashCommandBuilder()
    .setName('revoke')
    .setDescription('Revoke a license key permanently')
    .addStringOption(o => o.setName('key').setDescription('The key to revoke').setRequired(true)),

  new SlashCommandBuilder()
    .setName('listkeys')
    .setDescription('List all keys (shows summary)'),

  new SlashCommandBuilder()
    .setName('keyinfo')
    .setDescription('Show info about the key system'),
]

// Register slash commands
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN)
  try {
    console.log('Registering slash commands...')
    const route = GUILD_ID
      ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
      : Routes.applicationCommands(CLIENT_ID)
    await rest.put(route, { body: commands.map(c => c.toJSON()) })
    console.log('✓ Commands registered')
  } catch(e) { console.error('Failed to register commands:', e) }
}

// Check if user has admin role
function isAdmin(interaction) {
  if(!ADMIN_ROLE_ID) return interaction.member.permissions.has(PermissionFlagsBits.Administrator)
  return interaction.member.roles.cache.has(ADMIN_ROLE_ID)
}

client.once('ready', () => {
  console.log(`✓ Bot logged in as ${client.user.tag}`)
  registerCommands()
})

client.on('interactionCreate', async interaction => {
  if(!interaction.isChatInputCommand()) return

  // Admin check
  if(!isAdmin(interaction)) {
    return interaction.reply({
      embeds: [errorEmbed('No Permission', 'You need admin permissions to use this command.')],
      ephemeral: true
    })
  }

  const { commandName } = interaction

  // ── /generate ───────────────────────────────────────
  if(commandName === 'generate') {
    const amount  = interaction.options.getInteger('amount') || 1
    const expires = interaction.options.getString('expires') || null
    const user    = interaction.options.getUser('user') || null

    if(expires && isNaN(Date.parse(expires))) {
      return interaction.reply({ embeds: [errorEmbed('Invalid Date', 'Use format: YYYY-MM-DD e.g. 2026-12-31')], ephemeral: true })
    }

    const newKeys = []
    for(let i = 0; i < amount; i++) {
      const key = generateKey()
      KEYS[key] = {
        hwid: null,
        expires,
        createdAt: new Date().toISOString(),
        createdBy: interaction.user.tag,
        createdById: interaction.user.id,
        assignedTo: user ? user.tag : null,
        assignedToId: user ? user.id : null,
      }
      newKeys.push(key)
    }
    saveKeys(KEYS)

    const keyList = newKeys.map(k => `\`${k}\``).join('\n')
    const embed = new EmbedBuilder()
      .setColor(0xe8621a)
      .setTitle(`🔑 ${amount} Key${amount > 1 ? 's' : ''} Generated`)
      .setDescription(keyList)
      .addFields(
        { name: '👤 Generated By', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
        { name: '🎯 Assigned To',  value: user ? `<@${user.id}> (${user.tag})` : 'Not assigned', inline: true },
        { name: '⏳ Expires',      value: expires || 'Never', inline: true },
        { name: '📊 Status',       value: '🔓 Unused — locks to machine on first activation', inline: false },
      )
      .setFooter({ text: `a1ex GP Tool Key System` })
      .setTimestamp()

    await interaction.reply({ embeds: [embed], ephemeral: true })

    // DM the keys to the user if specified
    if(user) {
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor(0xe8621a)
          .setTitle('🔑 Your a1ex GP Tool License Key')
          .setDescription(keyList)
          .addFields(
            { name: 'Expires', value: expires || 'Never', inline: true },
            { name: 'Sent By', value: interaction.user.tag, inline: true },
          )
          .setFooter({ text: 'Keep this key safe — it will lock to your machine on first use' })
        await user.send({ embeds: [dmEmbed] })
        await interaction.followUp({ content: `✓ Key(s) sent to ${user.tag} via DM`, ephemeral: true })
      } catch(e) {
        await interaction.followUp({ content: `⚠ Could not DM ${user.tag} — they may have DMs disabled`, ephemeral: true })
      }
    }
  }

  // ── /lookup ──────────────────────────────────────────
  else if(commandName === 'lookup') {
    const key = interaction.options.getString('key').toUpperCase()
    const keyData = KEYS[key]

    if(!keyData) {
      return interaction.reply({ embeds: [errorEmbed('Key Not Found', `\`${key}\` does not exist`)], ephemeral: true })
    }

    const expired = keyData.expires && new Date(keyData.expires) < new Date()
    const pc = keyData.pcInfo

    // Build PC info string
    let pcString = 'Not yet activated'
    if(pc) {
      pcString = [
        pc.hostname  ? `💻 **PC Name:** ${pc.hostname}`   : null,
        pc.os        ? `🖥 **OS:** ${pc.os}`               : null,
        pc.cpu       ? `⚙️ **CPU:** ${pc.cpu}`             : null,
        pc.cores     ? `🔢 **Cores:** ${pc.cores}`         : null,
        pc.ram       ? `🧠 **RAM:** ${pc.ram}`             : null,
        pc.arch      ? `📐 **Arch:** ${pc.arch}`           : null,
      ].filter(Boolean).join('\n')
    }

    const embed = new EmbedBuilder()
      .setColor(expired ? 0xff6b6b : keyData.hwid ? 0x2dd4a0 : 0xe8621a)
      .setTitle('🔍 Key Lookup')
      .addFields(
        { name: 'Key',        value: `\`${key}\``,                                                                         inline: false },
        { name: 'Status',     value: expired ? '❌ Expired' : keyData.hwid ? '✅ Active (HWID locked)' : '🔓 Not yet used', inline: true  },
        { name: 'Expires',    value: keyData.expires || 'Never',                                                            inline: true  },
        { name: 'Created By', value: keyData.createdBy || 'Unknown',                                                        inline: true  },
        { name: 'Assigned To',value: keyData.assignedTo || 'Not assigned',                                                  inline: true  },
        { name: 'Activated',  value: keyData.activatedAt ? new Date(keyData.activatedAt).toLocaleString() : 'Not yet',      inline: true  },
        { name: 'Last Seen',  value: keyData.lastSeen    ? new Date(keyData.lastSeen).toLocaleString()    : 'Never',         inline: true  },
        { name: '🖥 PC Information', value: pcString,                                                                       inline: false },
        { name: 'HWID',       value: keyData.hwid ? `\`${keyData.hwid.substring(0,16)}...\`` : 'Not locked yet',            inline: false },
      )
      .setTimestamp()

    interaction.reply({ embeds: [embed], ephemeral: true })
  }

  // ── /reset ───────────────────────────────────────────
  else if(commandName === 'reset') {
    const key = interaction.options.getString('key').toUpperCase()

    if(!KEYS[key]) {
      return interaction.reply({ embeds: [errorEmbed('Key Not Found', `\`${key}\` does not exist`)], ephemeral: true })
    }

    const oldHWID = KEYS[key].hwid
    KEYS[key].hwid = null
    saveKeys(KEYS)

    const embed = new EmbedBuilder()
      .setColor(0x2dd4a0)
      .setTitle('✅ HWID Reset')
      .setDescription(`Key \`${key}\` has been unlinked from its machine.`)
      .addFields({ name: 'Old HWID', value: oldHWID ? `\`${oldHWID.substring(0,16)}...\`` : 'None' })
      .setFooter({ text: `Reset by ${interaction.user.tag}` })
      .setTimestamp()

    interaction.reply({ embeds: [embed], ephemeral: true })
  }

  // ── /revoke ──────────────────────────────────────────
  else if(commandName === 'revoke') {
    const key = interaction.options.getString('key').toUpperCase()

    if(!KEYS[key]) {
      return interaction.reply({ embeds: [errorEmbed('Key Not Found', `\`${key}\` does not exist`)], ephemeral: true })
    }

    delete KEYS[key]
    saveKeys(KEYS)

    const embed = new EmbedBuilder()
      .setColor(0xff6b6b)
      .setTitle('🗑 Key Revoked')
      .setDescription(`Key \`${key}\` has been permanently revoked.`)
      .setFooter({ text: `Revoked by ${interaction.user.tag}` })
      .setTimestamp()

    interaction.reply({ embeds: [embed], ephemeral: true })
  }

  // ── /listkeys ────────────────────────────────────────
  else if(commandName === 'listkeys') {
    const total    = Object.keys(KEYS).length
    const locked   = Object.values(KEYS).filter(k => k.hwid).length
    const unlocked = total - locked
    const expired  = Object.values(KEYS).filter(k => k.expires && new Date(k.expires) < new Date()).length

    const recent = Object.entries(KEYS).slice(-10).reverse().map(([k, v]) => {
      const status = v.hwid ? '🟢' : '🔓'
      const who = v.assignedTo ? ` → ${v.assignedTo}` : ''
      const by = v.createdBy ? ` (by ${v.createdBy})` : ''
      return `${status} \`${k}\`${who}${by}`
    }).join('\n') || 'No keys yet'

    const embed = new EmbedBuilder()
      .setColor(0xe8621a)
      .setTitle('📋 Key Database Summary')
      .addFields(
        { name: 'Total Keys',      value: total.toString(),    inline: true },
        { name: 'Active (locked)', value: locked.toString(),   inline: true },
        { name: 'Unlocked',        value: unlocked.toString(), inline: true },
        { name: 'Expired',         value: expired.toString(),  inline: true },
        { name: 'Last 10 Keys',    value: recent,              inline: false },
      )
      .setFooter({ text: '🟢 = locked to machine  🔓 = not yet used' })
      .setTimestamp()

    interaction.reply({ embeds: [embed], ephemeral: true })
  }

  // ── /keyinfo ─────────────────────────────────────────
  else if(commandName === 'keyinfo') {
    const embed = new EmbedBuilder()
      .setColor(0xe8621a)
      .setTitle('ℹ️ a1ex GP Tool Key System')
      .setDescription('HWID-locked license system for a1ex GP Tool')
      .addFields(
        { name: 'Commands', value:
          '`/generate [amount] [expires] [user]` — Create keys\n' +
          '`/lookup <key>` — Check a key\'s status\n' +
          '`/reset <key>` — Reset HWID (new machine)\n' +
          '`/revoke <key>` — Delete a key permanently\n' +
          '`/listkeys` — Show database summary'
        },
        { name: 'Key Format', value: '`A1EX-XXXX-XXXX-XXXX`', inline: true },
        { name: 'HWID Lock', value: 'Locks on first use', inline: true },
      )

    interaction.reply({ embeds: [embed], ephemeral: true })
  }
})

function errorEmbed(title, desc) {
  return new EmbedBuilder().setColor(0xff6b6b).setTitle('❌ ' + title).setDescription(desc)
}

// ── KEY VALIDATION HTTP SERVER ────────────────────────
// This runs alongside the bot to validate keys from the app
const httpApp = express()
httpApp.use(express.json())

// Allow requests from Electron app
httpApp.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept')
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  if(req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

httpApp.post('/validate', (req, res) => {
  const { key, hwid, pcInfo } = req.body
  if(!key || !hwid) return res.json({ valid: false, reason: 'Missing key or hwid' })

  const k = key.toUpperCase()
  const keyData = KEYS[k]
  if(!keyData) return res.json({ valid: false, reason: 'Key not found' })
  if(keyData.expires && new Date(keyData.expires) < new Date())
    return res.json({ valid: false, reason: 'Key expired' })

  if(keyData.hwid === null) {
    // First activation — lock HWID and save PC info
    KEYS[k].hwid = hwid
    KEYS[k].activatedAt = new Date().toISOString()
    KEYS[k].pcInfo = pcInfo || null
    saveKeys(KEYS)
    return res.json({ valid: true, message: 'Activated' })
  }

  if(keyData.hwid !== hwid) return res.json({ valid: false, reason: 'Key locked to different machine' })

  // Update PC info and last seen on every launch
  KEYS[k].pcInfo = pcInfo || KEYS[k].pcInfo
  KEYS[k].lastSeen = new Date().toISOString()
  saveKeys(KEYS)
  return res.json({ valid: true, message: 'Valid' })
})

httpApp.get('/', (req, res) => res.json({ status: 'ok' }))

const PORT = process.env.PORT || 3000
httpApp.listen(PORT, () => console.log(`✓ HTTP server on port ${PORT}`))

// Start bot
client.login(BOT_TOKEN)
