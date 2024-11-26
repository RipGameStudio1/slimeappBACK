require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Импорт сервисов безопасности
const SecurityService = require('./services/SecurityService');
const TransactionManager = require('./services/TransactionManager');
const DataService = require('./services/DataService');

// Импорт middleware
const { validateRequest, schemas } = require('./middleware/validation');
const authMiddleware = require('./middleware/auth');
const rateLimiter = require('./middleware/rateLimiter');

const app = express();

// Базовые middleware
app.use(cors());
app.use(express.json());
app.use(helmet());
app.use('/api/', rateLimiter);

// Схема пользователя с улучшенной безопасностью
const UserSchema = new mongoose.Schema({
    userId: { 
        type: String, 
        required: true, 
        unique: true,
        index: true
    },
    limeAmount: { 
        type: Number, 
        default: 0,
        validate: {
            validator: Number.isFinite,
            message: 'Invalid lime amount'
        }
    },
    farmingCount: { 
        type: Number, 
        default: 0 
    },
    isActive: { 
        type: Boolean, 
        default: false 
    },
    startTime: { 
        type: Date, 
        default: null 
    },
    level: { 
        type: Number, 
        default: 1 
    },
    xp: { 
        type: Number, 
        default: 0 
    },
    lastUpdate: { 
        type: Date, 
        default: Date.now 
    },
    achievements: {
        firstFarm: { type: Boolean, default: false },
        speedDemon: { type: Boolean, default: false },
        millionaire: { type: Boolean, default: false }
    },
    encryptedData: {
        referralCode: {
            iv: String,
            encryptedData: String,
            authTag: String
        },
        totalReferralEarnings: {
            iv: String,
            encryptedData: String,
            authTag: String
        }
    },
    referrer: { 
        type: String, 
        default: null 
    },
    referrals: [{
        userId: String,
        joinDate: Date,
        earnings: { 
            type: Number, 
            default: 0 
        }
    }],
    lastDailyReward: { 
        type: Date, 
        default: null 
    },
    dailyRewardStreak: { 
        type: Number, 
        default: 0 
    },
    slimeNinjaAttempts: { 
        type: Number, 
        default: 5 
    },
    totalDailyStreak: { 
        type: Number, 
        default: 0 
    }
});

const User = mongoose.model('User', UserSchema);

// Подключение к MongoDB с улучшенными настройками безопасности
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    ssl: true,
    authSource: 'admin',
    retryWrites: true,
    w: 'majority'
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));
// Базовые маршруты с проверкой здоровья системы
app.get('/', (req, res) => {
    res.send('Backend is running');
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date(),
        port: process.env.PORT,
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        security: 'enabled'
    });
});

// Защищённый endpoint получения данных пользователя
app.get('/api/users/:userId', 
    authMiddleware,
    async (req, res) => {
        try {
            return await TransactionManager.executeInTransaction(async (session) => {
                let user = await User.findOne({ userId: req.params.userId }).session(session);
                
                if (!user) {
                    const referralCode = await SecurityService.generateSecureReferralCode();
                    const encryptedReferralCode = SecurityService.encrypt(referralCode);
                    
                    user = await User.create([{
                        userId: req.params.userId,
                        limeAmount: 0,
                        encryptedData: {
                            referralCode: encryptedReferralCode
                        }
                    }], { session });
                }

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
                        await user.save({ session });
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

                const decryptedUser = await DataService.decryptUserData(user);
                res.json(decryptedUser);
            });
        } catch (error) {
            console.error('Error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

// Защищённый endpoint начала фарминга
app.post('/api/users/:userId/start-farming',
    authMiddleware,
    validateRequest(schemas.farming),
    async (req, res) => {
        try {
            const result = await TransactionManager.executeInTransaction(async (session) => {
                const user = await User.findOne({ userId: req.params.userId }).session(session);
                
                if (!user) {
                    throw new Error('User not found');
                }

                if (user.isActive) {
                    throw new Error('Farming already in progress');
                }

                user.isActive = true;
                user.startTime = new Date();
                await user.save({ session });

                // Логирование действия
                await SecurityService.logUserAction(user.userId, 'start_farming', { timestamp: new Date() });

                return user;
            });

            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
);

// Защищённый endpoint ежедневной награды
app.post('/api/users/:userId/daily-reward',
    authMiddleware,
    async (req, res) => {
        try {
            const result = await TransactionManager.executeInTransaction(async (session) => {
                const user = await User.findOne({ userId: req.params.userId }).session(session);
                
                if (!user) {
                    throw new Error('User not found');
                }

                const now = new Date();
                const lastReward = user.lastDailyReward ? new Date(user.lastDailyReward) : null;

                if (!lastReward) {
                    user.dailyRewardStreak = 1;
                } else {
                    const lastRewardDate = new Date(lastReward.setHours(0, 0, 0, 0));
                    const todayDate = new Date(now.setHours(0, 0, 0, 0));
                    const daysDiff = Math.floor((todayDate - lastRewardDate) / (24 * 60 * 60 * 1000));

                    if (daysDiff === 1) {
                        user.dailyRewardStreak += 1;
                    } else if (daysDiff === 0) {
                        throw new Error('Already claimed today');
                    } else {
                        user.dailyRewardStreak = 1;
                    }
                }

                const rewardDay = Math.min(user.dailyRewardStreak, 7);
                const limeReward = rewardDay * 10;
                const attemptsReward = rewardDay;

                user.limeAmount += limeReward;
                user.slimeNinjaAttempts += attemptsReward;
                user.lastDailyReward = now;
                user.totalDailyStreak = Math.max(user.totalDailyStreak, user.dailyRewardStreak);

                await user.save({ session });

                return {
                    streak: user.dailyRewardStreak,
                    rewardDay: rewardDay,
                    limeReward,
                    attemptsReward,
                    totalLime: user.limeAmount,
                    totalAttempts: user.slimeNinjaAttempts
                };
            });

            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
);
// Защищённый endpoint обновления данных пользователя
app.put('/api/users/:userId',
    authMiddleware,
    validateRequest(schemas.user),
    async (req, res) => {
        try {
            const result = await TransactionManager.executeInTransaction(async (session) => {
                const user = await User.findOne({ userId: req.params.userId }).session(session);
                
                if (!user) {
                    throw new Error('User not found');
                }

                // Шифрование чувствительных данных
                if (req.body.achievements) {
                    const encryptedAchievements = SecurityService.encrypt(
                        JSON.stringify(req.body.achievements)
                    );
                    user.encryptedData.achievements = encryptedAchievements;
                }

                // Безопасное обновление обычных полей
                const allowedFields = ['limeAmount', 'level', 'xp', 'slimeNinjaAttempts'];
                allowedFields.forEach(field => {
                    if (req.body[field] !== undefined) {
                        user[field] = req.body[field];
                    }
                });

                user.lastUpdate = new Date();
                await user.save({ session });

                // Логирование обновления
                await SecurityService.logUserAction(user.userId, 'update_data', {
                    fields: Object.keys(req.body),
                    timestamp: new Date()
                });

                return await DataService.decryptUserData(user);
            });

            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
);

// Защищённый endpoint обновления попыток
app.post('/api/users/:userId/update-attempts',
    authMiddleware,
    validateRequest(schemas.user),
    async (req, res) => {
        try {
            const result = await TransactionManager.executeInTransaction(async (session) => {
                const user = await User.findOne({ userId: req.params.userId }).session(session);
                
                if (!user) {
                    throw new Error('User not found');
                }

                // Атомарное обновление попыток
                const updatedUser = await User.findOneAndUpdate(
                    { userId: req.params.userId },
                    { $set: { slimeNinjaAttempts: req.body.attempts } },
                    { 
                        new: true,
                        session,
                        runValidators: true
                    }
                );

                return updatedUser;
            });

            res.json({ attempts: result.slimeNinjaAttempts });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
);

// Защищённый endpoint реферальной системы
app.get('/api/users/:userId/referrals',
    authMiddleware,
    async (req, res) => {
        try {
            const user = await User.findOne({ userId: req.params.userId });
            
            if (!user) {
                throw new Error('User not found');
            }

            // Расшифровка реферального кода
            const decryptedReferralCode = user.encryptedData.referralCode 
                ? SecurityService.decrypt(user.encryptedData.referralCode)
                : null;

            const referralData = {
                referralCode: decryptedReferralCode,
                referralCount: user.referrals.length,
                totalEarnings: parseFloat(user.totalReferralEarnings || 0),
                referrals: user.referrals.map(ref => ({
                    userId: SecurityService.maskUserId(ref.userId),
                    joinDate: ref.joinDate,
                    earnings: parseFloat(ref.earnings)
                }))
            };

            res.json(referralData);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
);

// Защищённый endpoint для реферальной системы
app.post('/api/users/referral',
    authMiddleware,
    validateRequest(schemas.referral),
    async (req, res) => {
        try {
            await TransactionManager.executeInTransaction(async (session) => {
                const { referralCode, userId } = req.body;

                // Поиск реферера по зашифрованному коду
                const referrer = await User.findOne({
                    'encryptedData.referralCode.encryptedData': SecurityService.encrypt(referralCode).encryptedData
                }).session(session);

                if (!referrer) {
                    throw new Error('Invalid referral code');
                }

                const user = await User.findOne({ userId }).session(session);

                if (!user) {
                    throw new Error('User not found');
                }

                if (user.referrer) {
                    throw new Error('User already has a referrer');
                }

                // Безопасное обновление реферальных данных
                referrer.referrals.push({
                    userId: userId,
                    joinDate: new Date(),
                    earnings: 0
                });

                user.referrer = referrer.userId;

                await Promise.all([
                    referrer.save({ session }),
                    user.save({ session })
                ]);

                // Логирование реферальной операции
                await SecurityService.logUserAction(userId, 'referral_used', {
                    referrerId: referrer.userId,
                    timestamp: new Date()
                });
            });

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
);

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('Error:', err);
    
    // Безопасная обработка ошибок
    const safeError = {
        message: process.env.NODE_ENV === 'production' 
            ? 'Internal Server Error' 
            : err.message,
        status: err.status || 500,
        code: err.code || 'INTERNAL_ERROR'
    };

    // Логирование ошибки
    SecurityService.logError({
        error: err,
        request: {
            method: req.method,
            path: req.path,
            headers: req.headers,
            body: req.body
        },
        timestamp: new Date()
    });

    res.status(safeError.status).json(safeError);
});

// Настройка безопасного завершения работы
const gracefulShutdown = async (signal) => {
    console.log(`${signal} received`);
    
    try {
        // Завершение всех активных транзакций
        await TransactionManager.closeAllTransactions();
        
        // Закрытие соединения с базой данных
        await mongoose.connection.close(false);
        
        // Завершение работы сервера
        server.close(() => {
            console.log('Process terminated');
            process.exit(0);
        });
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
};

// Обработчики сигналов завершения
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Запуск сервера
const PORT = process.env.PORT || 8000;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
