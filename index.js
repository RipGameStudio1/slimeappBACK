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
    }
});

const User = mongoose.model('User', UserSchema);

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
            user = await User.create({ 
                userId: req.params.userId,
                lastUpdate: new Date(),
                startTime: null
            });
        } else if (user.isActive) {
            const now = new Date();
            const offlineTime = now - new Date(user.startTime);
            const farmingDuration = 5 * 60 * 60 * 1000;
            
            if (offlineTime > 0) {
                const rewardAmount = 70;
                const multiplier = 1 + (user.level - 1) * 0.1;
                const maxOfflineTime = Math.min(offlineTime, farmingDuration);
                const earned = (rewardAmount / farmingDuration) * maxOfflineTime * multiplier;
                
                user.limeAmount += earned;
                
                if (offlineTime >= farmingDuration) {
                    user.isActive = false;
                    user.startTime = null;
                }
                
                user.lastUpdate = now;
                await user.save();
            }
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
        
        const user = await User.findOneAndUpdate(
            { userId: req.params.userId },
            updateData,
            { new: true, upsert: true }
        );
        
        res.json(user);
    } catch (error) {
        console.error('Error:', error);
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
