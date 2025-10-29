module.exports = {
    bot: {
        tokens: [
          process.env.DISCORD_TOKEN, // 👈 يقرأ من البيئة في Render
        ].filter(Boolean),

        defaultLanguage: 'ar', // ar | en لغة البوت
        
        activity: {
            name: 'aKuNdIsKo', // رسالة حالة البوت
            type: 'WATCHING', // PLAYING, STREAMING, LISTENING, WATCHING, COMPETING
            status: 'dnd' // online, idle, dnd, invisible
        }
    },
    server: {
        guildId: 'ID',         // ايدي السيرفر
        broadcastRoleId: 'ID', // ايدي الرول اللي يستخدم عليها البوت
        reportChannelId: 'ID' // ايدي الروم اللي يرسل فيه البوت التقارير
    },
    broadcast: {
        cooldownTime: 1000, // لا تلعب فيها
        memberCooldown: 100, // لا تلعب فيها
        requestsPerSecond: 1 // لا تلعب فيها
    },

    colors: {
        primary: '#5865F2',    // Discord Blue (used for standard messages)
        success: '#57F287',    // Green (used for successful operations)
        warning: '#FEE75C',    // Yellow (used for warnings)
        error: '#ED4245',      // Red (used for errors)
        neutral: '#5D5D5D'     // Gray (used for neutral messages)
    }

};


