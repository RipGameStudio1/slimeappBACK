require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const SecurityService = require('./services/SecurityService');
const TransactionManager = require('./services/TransactionManager');
const DataService = require('./services/DataService');
const { validateRequest, schemas } = require('./middleware/validation');
const authMiddleware = require('./middleware/auth');
const rateLimiter = require('./middleware/rateLimiter');

const app = express();

// Базовые middleware
app.use(express.json());

// Улучшенная настройка helmet
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    dnsPrefetchControl: true,
    frameguard: { action: "deny" },
    hidePoweredBy: true,
    hsts: true,
    ieNoOpen: true,
    noSniff: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xssFilter: true,
}));

// Улучшенная настройка CORS
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400
}));

// Rate limiting
app.use('/api/', rateLimiter);

// Глобальный middleware для санитизации входных данных
app.use((req, res, next) => {
    if (req.body) {
        req.body = Object.entries(req.body).reduce((acc, [key, value]) => {
            acc[key] = SecurityService.sanitizeInput(value);
            return acc;
        }, {});
    }
    if (req.params) {
        req.params = Object.entries(req.params).reduce((acc, [key, value]) => {
            acc[key] = SecurityService.sanitizeInput(value);
            return acc;
        }, {});
    }
    next();
});

// Схема пользователя
const UserSchema = new mongoose.Schema({
    userId: { 
        type: String, 
        required: true, 
        unique: true,
        index: true,
        validate: {
            validator: function(v) {
                return /^[a-zA-Z0-9_-]+$/.test(v);
            },
            message: 'Invalid user ID format'
        }
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
        default: 0,
        validate: {
            validator: Number.isInteger,
            message: 'Farming count must be an integer'
        }
    },
    isActive: { type: Boolean, default: false },
    startTime: { type: Date, default: null },
    level: { 
        type: Number, 
        default: 1,
        validate: {
            validator: Number.isInteger,
            message: 'Level must be an integer'
        }
    },
    xp: { 
        type: Number, 
        default: 0,
        validate: {
            validator: Number.isFinite,
            message: 'Invalid XP amount'
        }
    },
    lastUpdate: { type: Date, default: Date.now },
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
        default: null,
        validate: {
            validator: function(v) {
                return v === null || /^[a-zA-Z0-9_-]+$/.test(v);
            },
            message: 'Invalid referrer ID format'
        }
    },
    referrals: [{
        userId: String,
        joinDate: Date,
        earnings: { 
            type: Number, 
            default: 0,
            validate: {
                validator: Number.isFinite,
                message: 'Invalid earnings amount'
            }
        }
    }],
    lastDailyReward: { type: Date, default: null },
    dailyRewardStreak: { 
        type: Number, 
        default: 0,
        validate: {
            validator: Number.isInteger,
            message: 'Streak must be an integer'
        }
    },
    slimeNinjaAttempts: { 
        type: Number, 
        default: 5,
        validate: {
            validator: Number.isInteger,
            message: 'Attempts must be an integer'
        }
    },
    totalDailyStreak: { 
        type: Number, 
        default: 0,
        validate: {
            validator: Number.isInteger,
            message: 'Total streak must be an integer'
        }
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
    w: 'majority',
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Базовые маршруты
app.get('/', (req, res) => {
    res.send('Backend is running');
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date(),
        port: process.env.PORT,
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        security: 'enabled',
        version: process.env.APP_VERSION || '1.0.0'
    });
});

// Получение данных пользователя
app.get('/api/users/:userId', authMiddleware, async (req, res) => {
    try {
        const sanitizedUserId = SecurityService.sanitizeInput(req.params.userId);
        
        return await TransactionManager.executeInTransaction(async (session) => {
            let user = await User.findOne({ userId: sanitizedUserId }).session(session);

            if (!user) {
                const referralCode = await SecurityService.generateSecureToken();
                const encryptedReferralCode = SecurityService.encrypt(referralCode);
                
                user = await User.create([{
                    userId: sanitizedUserId,
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
                    user.farmingCount += 1;

                    // Проверка достижений
                    if (user.farmingCount === 1) {
                        user.achievements.firstFarm = true;
                    }
                    if (user.limeAmount >= 1000000) {
                        user.achievements.millionaire = true;
                    }

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

            const decryptedUser = await DataService.decryptData(user, ['referralCode', 'achievements']);
            res.json(decryptedUser);
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            error: process.env.NODE_ENV === 'production' 
                ? 'Internal server error' 
                : error.message 
        });
    }
});
// Начало фарминга
app.post('/api/users/:userId/start-farming',
    authMiddleware,
    validateRequest(schemas.farming),
    async (req, res) => {
        try {
            const sanitizedUserId = SecurityService.sanitizeInput(req.params.userId);
            
            const result = await TransactionManager.executeInTransaction(async (session) => {
                const user = await User.findOne({ userId: sanitizedUserId }).session(session);
                
                if (!user) {
                    throw new Error('User not found');
                }
                
                if (user.isActive) {
                    throw new Error('Farming already in progress');
                }

                user.isActive = true;
                user.startTime = new Date();
                await user.save({ session });

                await SecurityService.logUserAction(user.userId, 'start_farming', {
                    timestamp: new Date(),
                    previousLimeAmount: user.limeAmount
                });

                return user;
            });

            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    }
);

// Ежедневная награда
app.post('/api/users/:userId/daily-reward',
    authMiddleware,
    async (req, res) => {
        try {
            const sanitizedUserId = SecurityService.sanitizeInput(req.params.userId);
            
            const result = await TransactionManager.executeInTransaction(async (session) => {
                const user = await User.findOne({ userId: sanitizedUserId }).session(session);
                
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

                await SecurityService.logUserAction(user.userId, 'daily_reward_claimed', {
                    timestamp: now,
                    streak: user.dailyRewardStreak,
                    reward: limeReward
                });

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
            res.status(400).json({ error: error.message });
        }
    }
);
// Обновление данных пользователя
app.put('/api/users/:userId',
    authMiddleware,
    validateRequest(schemas.user),
    async (req, res) => {
        try {
            const sanitizedUserId = SecurityService.sanitizeInput(req.params.userId);
            
            const result = await TransactionManager.executeInTransaction(async (session) => {
                const user = await User.findOne({ userId: sanitizedUserId }).session(session);
                
                if (!user) {
                    throw new Error('User not found');
                }

                if (req.body.achievements) {
                    const encryptedAchievements = SecurityService.encrypt(
                        JSON.stringify(req.body.achievements)
                    );
                    user.encryptedData.achievements = encryptedAchievements;
                }

                const allowedFields = ['limeAmount', 'level', 'xp', 'slimeNinjaAttempts'];
                const updates = {};

                allowedFields.forEach(field => {
                    if (req.body[field] !== undefined) {
                        updates[field] = SecurityService.sanitizeInput(req.body[field]);
                    }
                });

                // Проверка валидности обновлений
                if (updates.limeAmount !== undefined && updates.limeAmount < 0) {
                    throw new Error('Invalid lime amount');
                }
                if (updates.level !== undefined && updates.level < 1) {
                    throw new Error('Invalid level value');
                }
                if (updates.xp !== undefined && updates.xp < 0) {
                    throw new Error('Invalid XP value');
                }
                if (updates.slimeNinjaAttempts !== undefined && 
                    (updates.slimeNinjaAttempts < 0 || updates.slimeNinjaAttempts > 100)) {
                    throw new Error('Invalid attempts value');
                }

                Object.assign(user, updates);
                user.lastUpdate = new Date();

                await user.save({ session });

                await SecurityService.logUserAction(user.userId, 'update_data', {
                    fields: Object.keys(updates),
                    timestamp: new Date()
                });

                return await DataService.decryptData(user, ['referralCode', 'achievements']);
            });

            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    }
);

// Обновление попыток
app.post('/api/users/:userId/update-attempts',
    authMiddleware,
    validateRequest(schemas.user),
    async (req, res) => {
        try {
            const sanitizedUserId = SecurityService.sanitizeInput(req.params.userId);
            const sanitizedAttempts = parseInt(SecurityService.sanitizeInput(req.body.attempts));

            if (isNaN(sanitizedAttempts) || sanitizedAttempts < 0 || sanitizedAttempts > 100) {
                throw new Error('Invalid attempts value');
            }

            const result = await TransactionManager.executeInTransaction(async (session) => {
                const user = await User.findOne({ userId: sanitizedUserId }).session(session);
                
                if (!user) {
                    throw new Error('User not found');
                }

                const updatedUser = await User.findOneAndUpdate(
                    { userId: sanitizedUserId },
                    { 
                        $set: { 
                            slimeNinjaAttempts: sanitizedAttempts,
                            lastUpdate: new Date()
                        } 
                    },
                    {
                        new: true,
                        session,
                        runValidators: true
                    }
                );

                await SecurityService.logUserAction(sanitizedUserId, 'update_attempts', {
                    oldValue: user.slimeNinjaAttempts,
                    newValue: sanitizedAttempts,
                    timestamp: new Date()
                });

                return updatedUser;
            });

            res.json({ attempts: result.slimeNinjaAttempts });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    }
);
// Получение информации о рефералах
app.get('/api/users/:userId/referrals',
    authMiddleware,
    async (req, res) => {
        try {
            const sanitizedUserId = SecurityService.sanitizeInput(req.params.userId);

            const user = await User.findOne({ userId: sanitizedUserId });
            
            if (!user) {
                throw new Error('User not found');
            }

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
            res.status(400).json({ error: error.message });
        }
    }
);

// Использование реферального кода
app.post('/api/users/referral',
    authMiddleware,
    validateRequest(schemas.referral),
    async (req, res) => {
        try {
            const sanitizedReferralCode = SecurityService.sanitizeInput(req.body.referralCode);
            const sanitizedUserId = SecurityService.sanitizeInput(req.body.userId);

            await TransactionManager.executeInTransaction(async (session) => {
                // Поиск реферера по зашифрованному коду
                const referrer = await User.findOne({
                    'encryptedData.referralCode.encryptedData': 
                        SecurityService.encrypt(sanitizedReferralCode).encryptedData
                }).session(session);

                if (!referrer) {
                    throw new Error('Invalid referral code');
                }

                const user = await User.findOne({ userId: sanitizedUserId }).session(session);
                
                if (!user) {
                    throw new Error('User not found');
                }

                if (user.referrer) {
                    throw new Error('User already has a referrer');
                }

                if (user.userId === referrer.userId) {
                    throw new Error('Cannot use own referral code');
                }

                // Добавление реферала
                referrer.referrals.push({
                    userId: sanitizedUserId,
                    joinDate: new Date(),
                    earnings: 0
                });

                user.referrer = referrer.userId;

                await Promise.all([
                    referrer.save({ session }),
                    user.save({ session })
                ]);

                await SecurityService.logUserAction(sanitizedUserId, 'referral_used', {
                    referrerId: referrer.userId,
                    timestamp: new Date()
                });
            });

            res.json({ success: true });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    }
);

// Обработчик ошибок
app.use((err, req, res, next) => {
    console.error('Error:', err);
    
    const safeError = {
        message: process.env.NODE_ENV === 'production' 
            ? 'Internal Server Error' 
            : err.message,
        status: err.status || 500,
        code: err.code || 'INTERNAL_ERROR'
    };

    SecurityService.logError({
        error: {
            message: err.message,
            stack: err.stack,
            code: err.code
        },
        request: {
            method: req.method,
            path: req.path,
            headers: {
                ...req.headers,
                authorization: undefined // Не логируем чувствительные данные
            },
            body: req.body
        },
        timestamp: new Date()
    });

    res.status(safeError.status).json(safeError);
});
// Graceful Shutdown
const gracefulShutdown = async (signal) => {
    console.log(`${signal} received`);
    
    // Установка таймаута для принудительного завершения
    const shutdownTimeout = setTimeout(() => {
        console.error('Forced shutdown due to timeout');
        process.exit(1);
    }, 10000);

    try {
        // Закрытие всех активных транзакций
        await TransactionManager.closeAllTransactions();
        
        // Закрытие соединения с MongoDB
        await mongoose.connection.close(false);
        
        // Закрытие HTTP-сервера
        server.close(() => {
            clearTimeout(shutdownTimeout);
            console.log('Process terminated gracefully');
            process.exit(0);
        });
    } catch (error) {
        console.error('Error during shutdown:', error);
        clearTimeout(shutdownTimeout);
        process.exit(1);
    }
};

// Обработчики сигналов завершения
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Обработка необработанных исключений и отклонений промисов
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Запуск сервера
const PORT = process.env.PORT || 8000;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`MongoDB Status: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
    console.log(`Security Measures: Enabled`);
});

// Настройка таймаута сервера
server.timeout = 30000; // 30 секунд

// Экспорт для тестирования
module.exports = app;
