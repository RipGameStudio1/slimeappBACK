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
    totalReferralEarnings: { type: Number, default: 0 }
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

app.get('/', (req, res) => {
    res.send('Backend is running');
});

// Эндпоинт для обновления существующих пользователей
app.post('/api/update-users-schema', async (req, res) => {
    try {
        // Получаем всех пользователей
        const users = await User.find({});
        const updates = [];

        for (const user of users) {
            const updateFields = {};
            
            // Проверяем и добавляем отсутствующие поля
            if (!user.referralCode) {
                updateFields.referralCode = await generateReferralCode();
            }
            if (!user.referrals) {
                updateFields.referrals = [];
            }
            if (user.totalReferralEarnings === undefined) {
                updateFields.totalReferralEarnings = 0;
            }
            if (!user.achievements) {
                updateFields.achievements = {
                    firstFarm: false,
                    speedDemon: false,
                    millionaire: false
                };
            }
            if (user.level === undefined) {
                updateFields.level = 1;
            }
            if (user.xp === undefined) {
                updateFields.xp = 0;
            }
            if (user.farmingCount === undefined) {
                updateFields.farmingCount = 0;
            }

            // Если есть что обновлять
            if (Object.keys(updateFields).length > 0) {
                updates.push({
                    updateOne: {
                        filter: { _id: user._id },
                        update: { $set: updateFields }
                    }
                });
            }
        }

        // Если есть обновления, выполняем их
        if (updates.length > 0) {
            await User.bulkWrite(updates);
            res.json({ 
                success: true, 
                message: `Updated ${updates.length} users`,
                updatedUsers: updates.length
            });
        } else {
            res.json({ 
                success: true, 
                message: 'No updates needed',
                updatedUsers: 0
            });
        }

    } catch (error) {
        console.error('Error updating users:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
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
                lastUpdate: new Date(),
                startTime: null,
                referralCode
            });
        }
        
        res.json(user);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/users/:userId', async (req, res) => {
    try {
        const updateData = {
            ...req.body,
            lastUpdate: new Date()
        };
        
        const updatedUser = await User.findOneAndUpdate(
            { userId: req.params.userId },
            updateData,
            { new: true }
        );
        
        res.json(updatedUser);
    } catch (error) {
        console.error('Error:', error);
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

// Статистика для админ-панели
app.get('/api/admin/stats', async (req, res) => {
    try {
        const userId = req.query.userId;
        if (!isAdmin(userId)) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const totalUsers = await User.countDocuments();
        const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const activeUsers = await User.countDocuments({ lastUpdate: { $gte: last24h } });
        const totalLime = await User.aggregate([
            { $group: { _id: null, total: { $sum: "$limeAmount" } } }
        ]);

        res.json({
            totalUsers,
            activeUsers,
            totalLime: totalLime[0]?.total || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получение логов активности
app.get('/api/admin/activity', async (req, res) => {
    try {
        const userId = req.query.userId;
        if (!isAdmin(userId)) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const activities = await ActivityLog.find()
            .sort({ timestamp: -1 })
            .limit(50);

        res.json(activities);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Поиск пользователя
app.get('/api/admin/user/:searchUserId', async (req, res) => {
    try {
        const adminId = req.query.adminId;
        if (!isAdmin(adminId)) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const user = await User.findOne({ userId: req.params.searchUserId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Обновление пользователя
app.put('/api/admin/user/:userId', async (req, res) => {
    try {
        const adminId = req.query.adminId;
        if (!isAdmin(adminId)) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const { limeAmount, level } = req.body;
        const user = await User.findOneAndUpdate(
            { userId: req.params.userId },
            { $set: { limeAmount, level } },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Сброс зависших фармингов
app.post('/api/admin/reset-farming', async (req, res) => {
    try {
        const adminId = req.query.adminId;
        if (!isAdmin(adminId)) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const result = await User.updateMany(
            { isActive: true },
            { $set: { isActive: false, startTime: null } }
        );

        res.json({
            success: true,
            resetCount: result.modifiedCount
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Очистка неактивных пользователей
app.post('/api/admin/clear-inactive', async (req, res) => {
    try {
        const adminId = req.query.adminId;
        if (!isAdmin(adminId)) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const result = await User.deleteMany({
            lastUpdate: { $lt: thirtyDaysAgo },
            limeAmount: { $lt: 1000 } // Не удаляем пользователей с большим балансом
        });

        res.json({
            success: true,
            deletedCount: result.deletedCount
        });
    } catch (error) {
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
