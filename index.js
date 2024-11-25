const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

// Middleware для проверки состояния подключения
app.use(async (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
            error: 'Database connection is not ready',
            readyState: mongoose.connection.readyState
        });
    }
    next();
});

const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    limeAmount: { type: Number, default: 0 },
    farmingCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: false },
    startTime: { type: Date, default: null },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    lastUpdate: { type: Date, default: Date.now },
    achievements: {
        firstFarm: { type: Boolean, default: false },
        speedDemon: { type: Boolean, default: false },
        millionaire: { type: Boolean, default: false }
    },
    referralCode: { type: String, unique: true },
    referrer: { type: String, default: null },
    referrals: [{
        userId: String,
        joinDate: Date,
        earnings: { type: Number, default: 0 }
    }],
    totalReferralEarnings: { type: Number, default: 0 },
    lastDailyReward: { type: Date, default: null },
    dailyRewardStreak: { type: Number, default: 0 },
    slimeNinjaAttempts: { type: Number, default: 5 },
    totalDailyStreak: { type: Number, default: 0 }
});

const User = mongoose.model('User', UserSchema);

const connectWithRetry = () => {
    mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        family: 4,
        maxPoolSize: 10,
        connectTimeoutMS: 30000,
        retryWrites: true
    }).then(async () => {
        console.log('Connected to MongoDB');
        try {
            await User.createIndexes();
            console.log('Indexes created successfully');
        } catch (error) {
            console.error('Error creating indexes:', error);
        }
    }).catch(err => {
        console.error('MongoDB connection error:', err);
        console.log('Retrying connection in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
    });
};

// Обработчики событий подключения MongoDB
mongoose.connection.on('connected', () => {
    console.log('Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
    console.error('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('Mongoose disconnected from MongoDB');
});

// Запуск подключения
connectWithRetry();

async function updateUserSchema(user) {
    const defaultValues = {
        limeAmount: 0,
        farmingCount: 0,
        isActive: false,
        startTime: null,
        level: 1,
        xp: 0,
        lastUpdate: Date.now(),
        achievements: {
            firstFarm: false,
            speedDemon: false,
            millionaire: false
        },
        referralCode: user.referralCode || await generateReferralCode(),
        referrer: null,
        referrals: [],
        totalReferralEarnings: 0,
        lastDailyReward: null,
        dailyRewardStreak: 0,
        slimeNinjaAttempts: 5,
        totalDailyStreak: 0
    };

    let needsUpdate = false;
    const updates = {};

    for (const [key, value] of Object.entries(defaultValues)) {
        if (user[key] === undefined) {
            updates[key] = value;
            needsUpdate = true;
        }
    }

    if (!user.achievements || typeof user.achievements !== 'object') {
        updates.achievements = defaultValues.achievements;
        needsUpdate = true;
    } else {
        for (const [key, value] of Object.entries(defaultValues.achievements)) {
            if (user.achievements[key] === undefined) {
                if (!updates.achievements) updates.achievements = { ...user.achievements };
                updates.achievements[key] = value;
                needsUpdate = true;
            }
        }
    }

    if (needsUpdate) {
        console.log(`Updating schema for user ${user.userId}`);
        return await User.findOneAndUpdate(
            { userId: user.userId },
            { $set: updates },
            { new: true }
        );
    }
    return user;
}

async function checkAndUpdateAchievements(user) {
    let achievementsUpdated = false;
    const updates = {};

    // First Farm Achievement
    if (!user.achievements.firstFarm && user.farmingCount > 0) {
        updates['achievements.firstFarm'] = true;
        achievementsUpdated = true;
    }

    // Speed Demon Achievement
    if (!user.achievements.speedDemon && user.level >= 5) {
        updates['achievements.speedDemon'] = true;
        achievementsUpdated = true;
    }

    // Millionaire Achievement
    if (!user.achievements.millionaire && user.limeAmount >= 1000000) {
        updates['achievements.millionaire'] = true;
        achievementsUpdated = true;
    }

    if (achievementsUpdated) {
        const updatedUser = await User.findOneAndUpdate(
            { userId: user.userId },
            { $set: updates },
            { new: true }
        );
        return {
            user: updatedUser,
            newAchievements: Object.keys(updates).map(key => key.replace('achievements.', ''))
        };
    }

    return { user, newAchievements: [] };
}

async function generateReferralCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code;
    let isUnique = false;
    while (!isUnique) {
        code = '';
        for (let i = 0; i < 8; i++) {
            code += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        const existingUser = await User.findOne({ referralCode: code });
        if (!existingUser) {
            isUnique = true;
        }
    }
    return code;
}

// Routes
app.get('/', (req, res) => {
    res.send('Backend is running');
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date(),
        port: PORT,
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

app.get('/api/users/:userId', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            throw new Error('Database connection is not ready');
        }

        let user = await User.findOne({ userId: req.params.userId });
        if (!user) {
            const referralCode = await generateReferralCode();
            user = await User.create({ userId: req.params.userId, referralCode });
        }

        user = await updateUserSchema(user);

        if (user.isActive && user.startTime) {
            const now = Date.now();
            const startTime = new Date(user.startTime).getTime();
            const elapsedTime = now - startTime;
            const farmingDuration = 30 * 1000;
            const baseAmount = user.limeAmount;
            const totalReward = 70;

            if (elapsedTime >= farmingDuration) {
                user.limeAmount = baseAmount + totalReward;
                user.xp += totalReward * 0.1;
                user.isActive = false;
                user.startTime = null;
                await user.save();
            } else {
                const progress = (elapsedTime / farmingDuration) * 100;
                const currentEarned = (totalReward * elapsedTime) / farmingDuration;
                const currentXpEarned = currentEarned * 0.1;
                return res.json({
                    ...user.toObject(),
                    currentProgress: {
                        progress,
                        currentLimeAmount: baseAmount + currentEarned,
                        currentXp: user.xp + currentXpEarned,
                        remainingTime: Math.ceil((farmingDuration - elapsedTime) / 1000)
                    }
                });
            }
        }
        res.json(user);
    } catch (error) {
        console.error('Error:', error);
        if (error.message === 'Database connection is not ready') {
            return res.status(503).json({
                error: 'Service temporarily unavailable',
                details: 'Database connection issue'
            });
        }
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/users/:userId/start-farming', async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.isActive) {
            return res.status(400).json({ error: 'Farming already in progress' });
        }

        user.isActive = true;
        user.startTime = new Date();
        user.farmingCount = (user.farmingCount || 0) + 1;
        await user.save();

        // Проверяем достижения после начала фарминга
        const { user: updatedUser, newAchievements } = await checkAndUpdateAchievements(user);

        res.json({
            ...updatedUser.toObject(),
            newAchievements
        });
    } catch (error) {
        console.error('Error starting farming:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/users/:userId/daily-reward', async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const now = new Date();
        const lastReward = user.lastDailyReward ? new Date(user.lastDailyReward) : null;
        let newStreak = 1;

        if (lastReward) {
            // Установим время на начало дня для корректного сравнения
            const lastRewardDate = new Date(lastReward);
            lastRewardDate.setHours(0, 0, 0, 0);
            
            const todayDate = new Date(now);
            todayDate.setHours(0, 0, 0, 0);
            
            const daysDiff = Math.floor((todayDate - lastRewardDate) / (24 * 60 * 60 * 1000));

            if (daysDiff === 0) {
                return res.status(400).json({ 
                    error: 'Already claimed today',
                    nextReward: new Date(lastRewardDate.getTime() + 24 * 60 * 60 * 1000)
                });
            } else if (daysDiff === 1) {
                // Продолжаем серию
                newStreak = user.dailyRewardStreak + 1;
            }
            // Если разница больше 1 дня, начинаем новую серию (newStreak = 1)
        }

        // Ограничиваем серию максимум 7 днями
        const rewardDay = Math.min(newStreak, 7);
        const limeReward = rewardDay * 10;
        const attemptsReward = rewardDay;

        // Обновляем данные пользователя
        user.dailyRewardStreak = newStreak;
        user.limeAmount += limeReward;
        user.slimeNinjaAttempts += attemptsReward;
        user.lastDailyReward = now;
        user.totalDailyStreak = Math.max(user.totalDailyStreak || 0, newStreak);

        await user.save();

        res.json({
            success: true,
            streak: newStreak,
            rewardDay: rewardDay,
            limeReward: limeReward,
            attemptsReward: attemptsReward,
            totalLime: user.limeAmount,
            totalAttempts: user.slimeNinjaAttempts,
            nextReward: new Date(now.getTime() + 24 * 60 * 60 * 1000)
        });

    } catch (error) {
        console.error('Error in daily reward:', error);
        res.status(500).json({ 
            error: 'Failed to process daily reward',
            details: error.message 
        });
    }
});
app.put('/api/users/:userId', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            throw new Error('Database connection is not ready');
        }

        const updateData = { ...req.body };
        if (updateData.achievements) {
            const user = await User.findOne({ userId: req.params.userId });
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            user.achievements = { ...user.achievements, ...updateData.achievements };
            const savedUser = await user.save();
            return res.json(savedUser);
        }

        const updatedUser = await User.findOneAndUpdate(
            { userId: req.params.userId },
            { $set: updateData },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(updatedUser);
    } catch (error) {
        console.error('Error updating user:', error);
        if (error.message === 'Database connection is not ready') {
            return res.status(503).json({
                error: 'Service temporarily unavailable',
                details: 'Database connection issue'
            });
        }
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/users/:userId/update-attempts', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            throw new Error('Database connection is not ready');
        }

        const { attempts } = req.body;
        if (typeof attempts !== 'number' || attempts < 0) {
            return res.status(400).json({
                error: 'Invalid attempts value',
                currentAttempts: (await User.findOne({ userId: req.params.userId })).slimeNinjaAttempts
            });
        }

        const user = await User.findOneAndUpdate(
            { userId: req.params.userId },
            { $set: { slimeNinjaAttempts: attempts } },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ attempts: user.slimeNinjaAttempts });
    } catch (error) {
        console.error('Error updating attempts:', error);
        if (error.message === 'Database connection is not ready') {
            return res.status(503).json({
                error: 'Service temporarily unavailable',
                details: 'Database connection issue'
            });
        }
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users/:userId/referrals', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            throw new Error('Database connection is not ready');
        }

        const user = await User.findOne({ userId: req.params.userId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            referralCode: user.referralCode,
            referralCount: user.referrals.length,
            totalEarnings: user.totalReferralEarnings,
            referrals: user.referrals
        });
    } catch (error) {
        console.error('Error in referrals endpoint:', error);
        if (error.message === 'Database connection is not ready') {
            return res.status(503).json({
                error: 'Service temporarily unavailable',
                details: 'Database connection issue'
            });
        }
        res.status(500).json({ error: error.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Server initialization
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});

// Graceful shutdown handlers
process.on('SIGTERM', () => {
    console.log('SIGTERM received');
    server.close(() => {
        mongoose.connection.close(false, () => {
            console.log('Process terminated');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received');
    server.close(() => {
        mongoose.connection.close(false, () => {
            console.log('Process terminated');
            process.exit(0);
        });
    });
});

// Добавляем обработчик необработанных ошибок
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Gracefully shutdown the server
    server.close(() => {
        mongoose.connection.close(false, () => {
            process.exit(1);
        });
    });
});

// Добавляем периодическую проверку подключения к базе данных
setInterval(() => {
    if (mongoose.connection.readyState !== 1) {
        console.log('Database connection lost, attempting to reconnect...');
        connectWithRetry();
    }
}, 30000); // Проверка каждые 30 секунд

// Добавляем роут для проверки статуса сервера
app.get('/status', (req, res) => {
    res.json({
        status: 'ok',
        dbConnection: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        uptime: process.uptime(),
        timestamp: new Date(),
        memory: process.memoryUsage(),
        version: process.version
    });
});

// Добавляем middleware для логирования запросов
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
    });
    next();
});

// Добавляем обработчик для очистки неактивных сессий фарминга
setInterval(async () => {
    try {
        const thirtySecondsAgo = new Date(Date.now() - 30000);
        await User.updateMany(
            {
                isActive: true,
                startTime: { $lt: thirtySecondsAgo }
            },
            {
                $set: {
                    isActive: false,
                    startTime: null
                }
            }
        );
    } catch (error) {
        console.error('Error cleaning inactive farming sessions:', error);
    }
}, 60000); // Проверка каждую минуту
