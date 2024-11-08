require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Схема пользователя
const UserSchema = new mongoose.Schema({
    userId: String,
    limeAmount: Number,
    farmingCount: Number,
    isActive: Boolean,
    startTime: Date
});

const User = mongoose.model('User', UserSchema);

// Маршруты
app.get('/', (req, res) => {
    res.send('Lime App Backend is running');
});

app.post('/api/users', async (req, res) => {
    try {
        const user = new User(req.body);
        await user.save();
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users/:userId', async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
