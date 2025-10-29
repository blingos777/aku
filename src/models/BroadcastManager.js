const config = require('../../config');
const { MessageEmbed } = require('discord.js');
const { sleep, createLogger } = require('../utils/helpers');

const logger = createLogger('BroadcastManager');

class BroadcastManager {
    constructor() {
        this.clients = [];
        this.activeJobs = new Map();
        this.clientLoadMap = new Map();
    }

    async initialize(clients) {
        this.clients = clients;
        
        logger.info(`Initializing BroadcastManager with ${clients.length} clients`);
        
        const validClients = [];
        
        for (const client of clients) {
            try {
                if (!client || !client.user) {
                    logger.warn(`Skipping invalid client in initialization`);
                    continue;
                }
                
                this.clientLoadMap.set(client.user.id, 0);
                
                if (config.server.guildId) {
                    try {
                        await client.guilds.fetch(config.server.guildId);
                        validClients.push(client);
                        logger.info(`Client ${client.user.tag} validated with access to guild ID: ${config.server.guildId}`);
                    } catch (guildError) {
                        logger.warn(`Client ${client.user.tag} does not have access to guild ${config.server.guildId}: ${guildError.message}`);
                        validClients.push(client);
                    }
                } else {
                    validClients.push(client);
                    logger.info(`Client ${client.user.tag} initialized (no guild verification required)`);
                }
            } catch (error) {
                logger.error(`Error initializing client: ${error.message}`);
            }
        }
        
        if (validClients.length < clients.length) {
            logger.warn(`Only ${validClients.length} of ${clients.length} clients are valid`);
        }
        
        if (validClients.length === 0) {
            logger.error(`No valid clients available - broadcasting will not work!`);
        }
        
        this.clients = validClients;
        
        logger.info(`BroadcastManager initialized with ${this.clients.length} valid clients`);
        return this;
    }

    getLeastBusyClient() {
        if (this.clients.length === 0) {
            throw new Error('No clients available');
        }
        
        const clientEntries = [...this.clientLoadMap.entries()];
        clientEntries.sort((a, b) => a[1] - b[1]);
        
        const leastBusyClientId = clientEntries[0][0];
        return this.clients.find(client => client.user.id === leastBusyClientId);
    }

    incrementLoad(client) {
        const currentLoad = this.clientLoadMap.get(client.user.id) || 0;
        this.clientLoadMap.set(client.user.id, currentLoad + 1);
    }

    decrementLoad(client) {
        const currentLoad = this.clientLoadMap.get(client.user.id) || 0;
        if (currentLoad > 0) {
            this.clientLoadMap.set(client.user.id, currentLoad - 1);
        }
    }

    async startBroadcast(options) {
        const { interaction, members, message, lang, languages } = options;
        
        const totalMembers = members.size;
        const results = {
            totalMembers,
            successCount: 0,
            failureCount: 0,
            failedMembers: [],
            startTime: Date.now(),
            lastUIUpdate: Date.now(),
            processedCount: 0
        };
        
        const totalClients = this.clients.length;
        
        const validClients = this.clients.filter(client => client && client.user && client.user.id);
        const validClientCount = validClients.length;
        
        if (validClientCount < totalClients) {
            logger.warn(`Only ${validClientCount} of ${totalClients} clients are valid and will be used for broadcasting`);
        }
        
        if (validClientCount === 0) {
            logger.error('No valid clients available for broadcasting');
            return null;
        }
        
        const requestsPerSecond = config.broadcast.requestsPerSecond * validClientCount;
        const estimatedTimePerMember = (config.broadcast.cooldownTime + config.broadcast.memberCooldown) / validClientCount;
        const totalTime = estimatedTimePerMember * totalMembers;
        const minutes = Math.floor(totalTime / 60000);
        const seconds = Math.floor((totalTime % 60000) / 1000);

        const membersArray = [...members.values()];
        
        const memberChunks = this.distributeMembers(membersArray, validClientCount);
        
        memberChunks.forEach((chunk, index) => {
            logger.info(`Chunk ${index + 1}: ${chunk.length} members assigned to client ${validClients[index]?.user?.tag || 'Unknown'}`);
        });
        
        const progressEmbed = new MessageEmbed()
            .setColor(config.colors.primary)
            .setTitle(languages[lang].embeds.broadcast.processing)
            .setDescription(languages[lang].messages.startingBroadcast
                .replace('{0}', totalMembers))
            .addField('📊 Progress', '▪️ Initializing... 0%')
            .addField('🎯 Target Members', `${totalMembers}`, true)
            .addField('⏱️ Estimated Time', `${minutes}m ${seconds}s`, true)
            .addField('⚡ Speed', `~${requestsPerSecond} members/sec`, true)
            .addField('🤖 Clients', `${validClientCount} bots distributing work`, true)
            .setFooter(`Broadcast System by Wick Studio • ${validClients.map(c => c.user.tag).join(' | ')}`)
            .setTimestamp();

        await interaction.editReply({ embeds: [progressEmbed] });
        
        logger.info(`Starting broadcast to ${totalMembers} members using ${validClientCount} clients`);
        
        const promises = memberChunks.map((chunk, index) => {
            const clientToUse = validClients[index % validClientCount];
            
            logger.info(`Client ${clientToUse.user.tag} (${index % validClientCount + 1}/${validClientCount}) assigned ${chunk.length} members`);
            
            return this.processMemberChunk({
                client: clientToUse,
                members: chunk,
                message,
                results,
                interaction,
                lang,
                languages
            });
        });
        
        await Promise.all(promises);
        
        logger.info(`Broadcast completed. Success: ${results.successCount}, Failed: ${results.failureCount}`);
        
        return this.finalizeBroadcast({
            interaction,
            results,
            message,
            lang,
            languages
        });
    }
    
    distributeMembers(members, clientCount) {
        if (clientCount <= 0) {
            logger.error('No clients available for member distribution');
            return [members];
        }
        
        const chunks = Array(clientCount).fill().map(() => []);
        
        members.forEach((member, index) => {
            const targetChunkIndex = index % clientCount;
            chunks[targetChunkIndex].push(member);
        });
        
        let nonEmptyChunks = chunks.filter(chunk => chunk.length > 0);
        
        if (nonEmptyChunks.length < chunks.length) {
            logger.warn(`Only ${nonEmptyChunks.length} of ${chunks.length} clients will be used due to member distribution`);
        }
        
        logger.info(`Distributed ${members.length} members across ${chunks.length} clients: ${chunks.map(c => c.length).join(', ')}`);
        
        return chunks;
    }
    
    async processMemberChunk(options) {
        const {
            client,
            members,
            message,
            results,
            interaction,
            lang,
            languages
        } = options;
        
        if (!client || !client.user) {
            logger.error(`Invalid client provided for processing chunk of ${members.length} members`);
            
            for (const member of members) {
                results.failureCount++;
                results.failedMembers.push(`<@${member.id}>`);
                results.processedCount++;
            }
            
            return;
        }
        
        logger.info(`Client ${client.user.tag} (${client.user.id}) processing ${members.length} members`);
        
        try {
            await client.guilds.fetch(config.server.guildId);
        } catch (error) {
            logger.error(`Client ${client.user.tag} does not have access to the server: ${error.message}`);
        }
        
        for (const member of members) {
            try {
                this.incrementLoad(client);
                
                const messageWithMention = `${message}\n\n<@${member.id}>`;
                
                let user = null;
                try {
                    user = client.users.cache.get(member.id);
                    
                    if (!user) {
                        user = await client.users.fetch(member.id, { force: true }).catch(e => {
                            logger.warn(`Client ${client.user.tag} could not fetch user ${member.id}: ${e.message}`);
                            return null;
                        });
                    }
                } catch (fetchError) {
                    logger.warn(`Error fetching user ${member.id}: ${fetchError.message}`);
                }
                
                if (!user && member.user) {
                    user = member.user;
                }
                
                if (!user) {
                    throw new Error(`Could not fetch user with ID ${member.id}`);
                }
                
                await user.send(messageWithMention);
                results.successCount++;
                
                results.processedCount++;
                const progress = Math.floor((results.processedCount / results.totalMembers) * 100);
                const now = Date.now();

                if (progress % 5 === 0 || now - results.lastUIUpdate > 3000 || results.processedCount === 1) {
                    results.lastUIUpdate = now;
                    await this.updateProgressUI({
                        interaction,
                        results,
                        progress,
                        lang,
                        languages
                    });
                }
            } catch (error) {
                results.failureCount++;
                results.failedMembers.push(`<@${member.id}>`);
                
                let errorReason = "Unknown error occurred";
                
                if (error.code === 50007) {
                    errorReason = "DMs are closed";
                } else if (error.code === 50013) {
                    errorReason = "Missing permissions";
                } else if (error.code === 10003) {
                    errorReason = "Unknown user";
                } else if (error.message) {
                    errorReason = error.message.substring(0, 100);
                }
                
                logger.error(`Client ${client.user.tag} failed to send message to ${member.user?.tag || member.id}: ${errorReason}`);
                results.processedCount++;
            } finally {
                this.decrementLoad(client);
                
                await sleep(config.broadcast.cooldownTime / this.clients.length);
            }
        }
        
        logger.info(`Client ${client.user.tag} completed processing ${members.length} members`);
    }
    
    async updateProgressUI(options) {
        const { interaction, results, progress, lang, languages } = options;
        
        const getProgressBar = (percent) => {
            const filledCount = Math.floor(percent / 10);
            return '█'.repeat(filledCount) + '░'.repeat(10 - filledCount);
        };
        
        const elapsedTime = Date.now() - results.startTime;
        const processedCount = results.processedCount;
        const remainingCount = results.totalMembers - processedCount;
        
        let remainingTime = 0;
        let remainingMinutes = 0;
        let remainingSeconds = 0;
        
        if (processedCount > 0) {
            const avgTimePerMember = elapsedTime / processedCount;
            remainingTime = avgTimePerMember * remainingCount;
            remainingMinutes = Math.floor(remainingTime / 60000);
            remainingSeconds = Math.floor((remainingTime % 60000) / 1000);
        }
        
        const currentSpeed = processedCount > 0 
            ? Math.round(processedCount / (elapsedTime / 1000)) 
            : 0;
            
        const progressEmbed = new MessageEmbed()
            .setColor(config.colors.primary)
            .setTitle(languages[lang].embeds.broadcast.processing)
            .setDescription(`${getProgressBar(progress)} **${progress}%**`)
            .addField('📊 Status', 
                `▪️ Processing: **${processedCount}/${results.totalMembers}**\n` +
                `✅ Success: **${results.successCount}**\n` +
                `❌ Failed: **${results.failureCount}**`)
            .addField('⏱️ Time Remaining', `${remainingMinutes}m ${remainingSeconds}s`, true)
            .addField('⏰ Elapsed Time', `${Math.floor(elapsedTime / 60000)}m ${Math.floor((elapsedTime % 60000) / 1000)}s`, true)
            .addField('⚡ Current Speed', `~${currentSpeed} members/sec`, true)
            .addField('🤖 Active Clients', `${this.clients.length} bots`, true)
            .setFooter(`Broadcast System by Wick Studio • ${this.clients.map(c => c.user.tag).join(' | ')}`)
            .setTimestamp();
        
        try {
            await interaction.editReply({ embeds: [progressEmbed] });
        } catch (error) {
            logger.error('Failed to update progress UI:', error);
        }
    }
    
    async finalizeBroadcast(options) {
        const { interaction, results, message, lang, languages } = options;
        
        try {
            const getProgressBar = (percent) => {
                const filledCount = Math.floor(percent / 10);
                return '█'.repeat(filledCount) + '░'.repeat(10 - filledCount);
            };
            
            const totalTime = Date.now() - results.startTime;
            const averageSpeed = Math.round(results.totalMembers / (totalTime / 1000));
            
            const reportEmbed = this.createReportEmbed(results, message, lang, languages);
            
            if (config.server.reportChannelId) {
                try {
                    const reportChannel = await this.clients[0].channels.fetch(config.server.reportChannelId);
                    if (reportChannel) {
                        await reportChannel.send({ embeds: [reportEmbed] });
                    }
                } catch (error) {
                    logger.error(`Error sending broadcast report: ${error.message}`, error);
                }
            }

            const completionEmbed = new MessageEmbed()
                .setColor(config.colors.success)
                .setTitle(languages[lang].embeds.broadcast.completed)
                .setDescription(languages[lang].messages.completionMessage)
                .addFields([
                    {
                        name: '📊 Results', 
                        value: `${getProgressBar(Math.floor((results.successCount / results.totalMembers) * 100))} ${Math.floor((results.successCount / results.totalMembers) * 100)}%\n\n` +
                            `▪️ ${languages[lang].embeds.broadcast.totalMembers}: **${results.totalMembers}**\n` +
                            `✅ ${languages[lang].embeds.broadcast.successful}: **${results.successCount}**\n` +
                            `❌ ${languages[lang].embeds.broadcast.failed}: **${results.failureCount}**`
                    },
                    {
                        name: '⏰ Total Time', 
                        value: `${Math.floor(totalTime / 60000)}m ${Math.floor((totalTime % 60000) / 1000)}s`, 
                        inline: true
                    },
                    {
                        name: '⚡ Average Speed', 
                        value: `~${averageSpeed} members/sec`, 
                        inline: true
                    }
                ])
                .setFooter({ text: `${languages[lang].system.broadcastSystem} • ${this.clients.map(c => c.user.tag).join(' | ')}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [completionEmbed] });
        } catch (error) {
            logger.error('Failed to finalize broadcast:', error);
        }
        
        return results;
    }

    createReportEmbed(results, message, lang, languages) {
        const { successCount, failureCount, failedMembers } = results;
        
        const reportEmbed = new MessageEmbed()
            .setColor(config.colors.warning)
            .setTitle('📊 ' + languages[lang].embeds.broadcast.report)
            .setDescription(`Broadcast report for ${results.totalMembers} members.`)
            .addFields([
                {
                    name: '📝 Message', 
                    value: message.length > 200 ? 
                        message.slice(0, 200) + '...' : 
                        message
                },
                {
                    name: '📊 Results',
                    value: `▪️ Total Members: **${results.totalMembers}**\n` +
                        `✅ Successful: **${successCount}**\n` +
                        `❌ Failed: **${failureCount}**`
                }
            ])
            .setFooter({ text: `Broadcast System by Wick Studio • ${this.clients.map(c => c.user.tag).join(' | ')}` })
            .setTimestamp();

        if (failedMembers.length > 0) {
            const MAX_EMBED_FIELD_LENGTH = 1024;
            const MAX_MEMBERS_PER_FIELD = 30;
            const MAX_FAILED_FIELDS = 5;
            
            const formattedFailedMembers = failedMembers.map(member => {
                if (typeof member === 'string') {
                    if (member.startsWith('<@')) {
                        const userId = member.replace(/[<@!>]/g, '');
                        try {
                            const user = this.clients[0].users.cache.get(userId);
                            if (user) return `${user.username}#${user.discriminator}`;
                        } catch (e) {}
                    }
                    return member;
                }
                
                try {
                    if (member.user) return `${member.user.username}#${member.user.discriminator}`;
                    if (member.username) return `${member.username}#${member.discriminator}`;
                } catch (e) {}
                
                return String(member);
            });
            
            if (failedMembers.length > MAX_MEMBERS_PER_FIELD * MAX_FAILED_FIELDS) {
                reportEmbed.addFields([{
                    name: languages[lang].embeds.broadcast.failedMembers,
                    value: `Too many failed members (${failedMembers.length}) to display. First ${MAX_MEMBERS_PER_FIELD} members:\n` + 
                           formattedFailedMembers.slice(0, MAX_MEMBERS_PER_FIELD).join(', ')
                }]);
                
                reportEmbed.addFields([{
                    name: '📋 Full List',
                    value: 'Check the console logs for the complete list of failed members.'
                }]);
                
                logger.info(`Failed members (${failedMembers.length}): ${formattedFailedMembers.join(', ')}`);
            } else {
                const chunks = [];
                let currentChunk = [];
                
                for (const member of formattedFailedMembers) {
                    if (currentChunk.length >= MAX_MEMBERS_PER_FIELD) {
                        chunks.push(currentChunk);
                        currentChunk = [member];
                    } else {
                        currentChunk.push(member);
                    }
                }
                
                if (currentChunk.length > 0) {
                    chunks.push(currentChunk);
                }
                
                for (let i = 0; i < Math.min(chunks.length, MAX_FAILED_FIELDS); i++) {
                    reportEmbed.addFields([{
                        name: i === 0 ? 
                            languages[lang].embeds.broadcast.failedMembers : 
                            languages[lang].embeds.broadcast.failedMembersContinued + ` (${i+1}/${chunks.length})`,
                        value: chunks[i].join(', ')
                    }]);
                }
                
                if (chunks.length > MAX_FAILED_FIELDS) {
                    const remainingCount = failedMembers.length - (MAX_FAILED_FIELDS * MAX_MEMBERS_PER_FIELD);
                    reportEmbed.addFields([{
                        name: '📋 Additional Failed Members',
                        value: `... and ${remainingCount} more. Check the console logs for the full list.`
                    }]);
                    
                    logger.info(`All failed members (${failedMembers.length}): ${formattedFailedMembers.join(', ')}`);
                }
            }
        }
        
        return reportEmbed;
    }
}

module.exports = new BroadcastManager();
