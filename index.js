const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./config');
const { createLogger } = require('./src/utils/helpers');
const languageManager = require('./src/models/LanguageManager');
const broadcastManager = require('./src/models/BroadcastManager');
const broadcastController = require('./src/controllers/BroadcastController');

const logger = createLogger('Main');

// ✅ تعريف تعويض لـ Intents.FLAGS عشان يشتغل الكود القديم
const Intents = {
    FLAGS: {
        GUILDS: GatewayIntentBits.Guilds,
        GUILD_MESSAGES: GatewayIntentBits.GuildMessages,
        GUILD_MEMBERS: GatewayIntentBits.GuildMembers,
        GUILD_PRESENCES: GatewayIntentBits.GuildPresences,
        DIRECT_MESSAGES: GatewayIntentBits.DirectMessages
    }
};

// ✅ تعريف Partials يدوي بنفس الأسلوب
const PartialsMap = {
    CHANNEL: Partials.Channel
};

languageManager.setDefaultLanguage(config.bot.defaultLanguage);

const clients = [];

const initializeClients = async () => {
    logger.info('Initializing broadcast clients...');

    if (!config.bot.tokens || config.bot.tokens.length === 0) {
        logger.error('No bot tokens found in configuration. Please add at least one token.');
        process.exit(1);
    }

    let successfulLogins = 0;

    for (const token of config.bot.tokens) {
        if (!token) {
            logger.warn('Empty token found in configuration, skipping');
            continue;
        }

        const client = new Client({
            intents: [
                Intents.FLAGS.GUILDS,
                Intents.FLAGS.GUILD_MESSAGES,
                Intents.FLAGS.GUILD_MEMBERS,
                Intents.FLAGS.GUILD_PRESENCES,
                Intents.FLAGS.DIRECT_MESSAGES
            ],
            partials: [PartialsMap.CHANNEL]
        });

        setupEventListeners(client);

        try {
            await client.login(token);
            clients.push(client);
            successfulLogins++;
            logger.info(`Client logged in: ${client.user.tag} (${successfulLogins}/${config.bot.tokens.filter(Boolean).length})`);
        } catch (error) {
            logger.error(`Failed to login with token: ${token.substring(0, 8)}... Error: ${error.message}`);
        }
    }

    if (clients.length > 0) {
        await broadcastManager.initialize(clients);
        logger.info(`Successfully initialized ${clients.length} clients for broadcasting`);
    } else {
        logger.error('No clients were able to log in. Please check your tokens in config.js');
        process.exit(1);
    }
};

const setupEventListeners = (client) => {
    client.once('ready', () => {
        logger.info(`Client ready: ${client.user.tag}`);

        client.user.setPresence({
            activities: [{
                name: config.bot.activity.name,
                type: config.bot.activity.type
            }],
            status: config.bot.activity.status,
        });
    });

    client.on('error', (error) => {
        logger.error(`Client error: ${client.user?.tag || 'Unknown'}`, error);
    });

    client.on('warn', (warning) => {
        logger.warn(`Client warning: ${client.user?.tag || 'Unknown'}`, warning);
    });

    client.on('messageCreate', async (message) => {
        if (clients.length > 0 && client !== clients[0]) return;
        if (message.author.bot) return;

        if (message.content === '-wick') {
            if (!message.guild || message.guild.id !== config.server.guildId) {
                return message.reply(languageManager.translate('messages.invalidGuild'));
            }

            try {
                logger.info('Fetching guild members for test command...');
                await message.guild.members.fetch();
                const members = message.guild.members.cache.filter(member => !member.user.bot);
                logger.info(`Test Command: Fetched ${members.size} members.`);

                const totalBots = clients.length;
                const estimatedSpeed = config.broadcast.requestsPerSecond * totalBots;
                const estimatedTime = Math.ceil(members.size / estimatedSpeed);

                message.reply(languageManager.translate('messages.testResults',
                    members.size,
                    totalBots,
                    estimatedSpeed,
                    estimatedTime));
            } catch (error) {
                logger.error('Error fetching members during test command:', error);
                message.reply(languageManager.translate('messages.testError'));
            }
            return;
        }

        if (message.content === '-language') {
            await broadcastController.handleLanguageCommand(message);
            return;
        }

        if (message.content.startsWith('-lang ')) {
            const langCode = message.content.split(' ')[1]?.toLowerCase();
            if (langCode && languageManager.getAllLanguages()[langCode]) {
                languageManager.setDefaultLanguage(langCode);
                message.reply(languageManager.translate('system.languageUpdated',
                    languageManager.getLanguage().language.native));
                logger.info(`Language changed to ${langCode} by ${message.author.tag}`);
            } else {
                message.reply(languageManager.translate('system.invalidLanguage'));
            }
            return;
        }

        if (message.content.startsWith('-bc ')) {
            await broadcastController.handleCommand(message);
            return;
        }
    });

    client.on('interactionCreate', async (interaction) => {
        if (clients.length > 0 && client !== clients[0]) return;

        if (interaction.isButton()) {
            await broadcastController.handleButtonInteraction(interaction);
            return;
        }

        if (interaction.isStringSelectMenu()) {
            await broadcastController.handleSelectMenuInteraction(interaction);
            return;
        }
    });
};

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

(async () => {
    logger.info('Starting Wick Broadcast system...');

    try {
        await initializeClients();
        console.log(`
██╗    ██╗██╗ ██████╗██╗  ██╗    ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗ 
██║    ██║██║██╔════╝██║ ██╔╝    ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
██║ █╗ ██║██║██║     █████╔╝     ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
██║███╗██║██║██║     ██╔═██╗     ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
╚███╔███╔╝██║╚██████╗██║  ██╗    ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
 ╚══╝╚══╝ ╚═╝ ╚═════╝╚═╝  ╚═╝    ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ 
                                         Made by Wick Studio
                                       https://discord.gg/wicks
`);
    } catch (error) {
        logger.error('Failed to initialize application:', error);
        process.exit(1);
    }
})();
