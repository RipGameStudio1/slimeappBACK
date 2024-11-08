const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Схема пользователя
const UserSchema = new mongoose.Schema({
    userId: String,
    limeAmount: { type: Number, default: 0 },
    farmingCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: false },
    startTime: { type: Date, default: null },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    achievements: {
        firstFarm: { type: Boolean, default: false },
        speedDemon: { type: Boolean, default: false },
        millionaire: { type: Boolean, default: false }
    }
});

const User = mongoose.model('User', UserSchema);

// Базовый маршрут для проверки
app.get('/', (req, res) => {
    res.send('Backend is running');
});

// Получить данные пользователя
app.get('/api/users/:userId', async (req, res) => {
    try {
        let user = await User.findOne({ userId: req.params.userId });
        if (!user) {
            user = await User.create({ userId: req.params.userId });
        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Обновить данные пользователя
app.put('/api/users/:userId', async (req, res) => {
    try {
        const user = await User.findOneAndUpdate(
            { userId: req.params.userId },
            req.body,
            { new: true, upsert: true }
        );
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Начать фарминг
app.post('/api/users/:userId/start-farming', async (req, res) => {
    try {
        const user = await User.findOneAndUpdate(
            { userId: req.params.userId },
            { 
                isActive: true, 
                startTime: new Date(),
                $inc: { farmingCount: 1 }
            },
            { new: true }
        );
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Завершить фарминг
app.post('/api/users/:userId/end-farming', async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const earnedAmount = req.body.earnedAmount || 0;
        const earnedXp = req.body.earnedXp || 0;

        user.limeAmount += earnedAmount;
        user.xp += earnedXp;
        user.isActive = false;
        user.startTime = null;

        // Проверка достижений
        if (user.farmingCount === 1) {
            user.achievements.firstFarm = true;
        }
        if (user.limeAmount >= 1000000) {
            user.achievements.millionaire = true;
        }

        await user.save();
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Проверка состояния сервера
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
