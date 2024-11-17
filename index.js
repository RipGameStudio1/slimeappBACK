const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
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

// Генерация уникального реферального кода
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

app.post('/api/users/:userId/update-attempts', async (req, res) => {
    try {
        const { attempts } = req.body;
        
        // Строгая проверка значения
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
        res.status(500).json({ error: error.message });
    }
});

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
        let user = await User.findOne({ userId: req.params.userId });
        
        if (!user) {
            const referralCode = await generateReferralCode();
            user = await User.create({ 
                userId: req.params.userId,
                limeAmount: 0,
                referralCode
            });
        }

        // Если есть активный фарминг
        if (user.isActive && user.startTime) {
            const now = Date.now();
            const startTime = new Date(user.startTime).getTime();
            const elapsedTime = now - startTime;
            const farmingDuration = 30 * 1000; // 30 секунд
            const baseAmount = user.limeAmount; // Базовый баланс на момент начала фарминга
            const totalReward = 70; // Общая награда за фарминг

            if (elapsedTime >= farmingDuration) {
                // Завершаем фарминг
                user.limeAmount = baseAmount + totalReward;
                user.xp += totalReward * 0.1;
                user.isActive = false;
                user.startTime = null;
                await user.save();
            } else {
                // Вычисляем текущий прогресс
                const progress = (elapsedTime / farmingDuration) * 100;
                const currentEarned = (totalReward * elapsedTime) / farmingDuration;
                const currentXpEarned = currentEarned * 0.1;

                // Отправляем текущий прогресс
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
        await user.save();

        res.json(user);
    } catch (error) {
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
        
        // Если это первая награда пользователя
        if (!lastReward) {
            user.dailyRewardStreak = 1;
        } else {
            const lastRewardDate = new Date(lastReward.setHours(0, 0, 0, 0));
            const todayDate = new Date(now.setHours(0, 0, 0, 0));
            const daysDiff = Math.floor((todayDate - lastRewardDate) / (24 * 60 * 60 * 1000));
            if (daysDiff === 1) {
                user.dailyRewardStreak += 1;
            } else if (daysDiff === 0) {
                return res.status(400).json({ error: 'Already claimed today' });
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

        await user.save();

        res.json({
            streak: user.dailyRewardStreak,
            rewardDay: rewardDay,
            limeReward,
            attemptsReward,
            totalLime: user.limeAmount,
            totalAttempts: user.slimeNinjaAttempts
        });
    } catch (error) {
        console.error('Error in daily reward:', error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/users/:userId', async (req, res) => {
    try {
        console.log('Updating user data:', req.body); // Для отладки

        const updateData = {
            ...req.body,
            lastUpdate: new Date()
        };

        // Если передаются достижения, убедимся что они сохраняются правильно
        if (updateData.achievements) {
            console.log('Updating achievements:', updateData.achievements); // Для отладки
        }

        const updatedUser = await User.findOneAndUpdate(
            { userId: req.params.userId },
            { $set: updateData },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        console.log('Updated user achievements:', updatedUser.achievements); // Для отладки
        res.json(updatedUser);
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/users/:userId/attempts', async (req, res) => {
    try {
        const { attempts } = req.body;
        const user = await User.findOneAndUpdate(
            { userId: req.params.userId },
            { $set: { slimeNinjaAttempts: attempts } },
            { new: true }
        );
        res.json({ attempts: user.slimeNinjaAttempts });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/users/:userId/complete-farming', async (req, res) => {
    try {
        const { limeAmount, farmingCount } = req.body;
        const user = await User.findOne({ userId: req.params.userId });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Вычисляем заработок для реферера (10%)
        if (user.referrer) {
            const referrer = await User.findOne({ userId: user.referrer });
            if (referrer) {
                const referralEarnings = (limeAmount - user.limeAmount) * 0.1;
                const referralIndex = referrer.referrals.findIndex(r => r.userId === user.userId);
                
                if (referralIndex !== -1) {
                    referrer.referrals[referralIndex].earnings += referralEarnings;
                }
                referrer.totalReferralEarnings += referralEarnings;
                await referrer.save();
            }
        }
        
        const updatedUser = await User.findOneAndUpdate(
            { userId: req.params.userId },
            {
                $set: {
                    limeAmount,
                    farmingCount,
                    isActive: false,
                    startTime: null,
                    lastUpdate: new Date()
                }
            },
            { new: true }
        );

        res.json(updatedUser);
    } catch (error) {
        console.error('Error completing farming:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users/:userId/referrals', async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Добавим логирование
        console.log('Referral data:', {
            referralCode: user.referralCode,
            referralCount: user.referrals.length,
            totalEarnings: user.totalReferralEarnings,
            referrals: user.referrals
        });
        
        res.json({
            referralCode: user.referralCode,
            referralCount: user.referrals.length,
            totalEarnings: user.totalReferralEarnings,
            referrals: user.referrals
        });
    } catch (error) {
        console.error('Error in referrals endpoint:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/users/referral', async (req, res) => {
    try {
        const { referralCode, userId } = req.body;
        
        const referrer = await User.findOne({ referralCode });
        if (!referrer) {
            return res.status(404).json({ error: 'Invalid referral code' });
        }
        
        const user = await User.findOne({ userId });
        if (user.referrer) {
            return res.status(400).json({ error: 'User already has a referrer' });
        }
        
        // Добавляем реферала
        referrer.referrals.push({
            userId: userId,
            joinDate: new Date(),
            earnings: 0
        });
        await referrer.save();
        
        // Обновляем информацию о пользователе
        user.referrer = referrer.userId;
        await user.save();
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});

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
