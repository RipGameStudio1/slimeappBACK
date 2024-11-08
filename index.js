const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// User Schema
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

// Routes
app.get('/', (req, res) => {
    res.send('Backend is running');
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK',
        timestamp: new Date(),
        port: PORT,
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Get user data
app.get('/api/users/:userId', async (req, res) => {
    try {
        let user = await User.findOne({ userId: req.params.userId });
        
        if (!user) {
            user = await User.create({ 
                userId: req.params.userId,
                lastUpdate: new Date()
            });
        } else {
            // Проверяем и обновляем офлайн-прогресс
            if (user.isActive) {
                const now = new Date();
                const offlineTime = now - user.lastUpdate;
                const farmingDuration = 5 * 60 * 60 * 1000; // 5 hours
                
                if (offlineTime > 0) {
                    const rewardAmount = 70;
                    const multiplier = 1 + (user.level - 1) * 0.1;
                    const maxOfflineTime = Math.min(offlineTime, farmingDuration);
                    const earned = (rewardAmount / farmingDuration) * maxOfflineTime * multiplier;
                    
                    user.limeAmount += earned;
                    
                    // Если прошло больше времени чем длительность фарминга
                    if (offlineTime >= farmingDuration) {
                        user.isActive = false;
                        user.startTime = null;
                    }
                    
                    user.lastUpdate = now;
                    await user.save();
                }
            }
        }
        
        res.json(user);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update user data
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

// Calculate offline progress
app.post('/api/users/:userId/offline-progress', async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId });
        if (!user || !user.isActive) return res.json({ earned: 0 });

        const now = new Date();
        const offlineTime = now - user.lastUpdate;
        const farmingDuration = 5 * 60 * 60 * 1000;
        
        if (offlineTime > 0) {
            const rewardAmount = 70;
            const multiplier = 1 + (user.level - 1) * 0.1;
            const maxOfflineTime = Math.min(offlineTime, farmingDuration);
            const earned = (rewardAmount / farmingDuration) * maxOfflineTime * multiplier;
            
            user.limeAmount += earned;
            user.lastUpdate = now;
            
            if (offlineTime >= farmingDuration) {
                user.isActive = false;
                user.startTime = null;
            }
            
            await user.save();
            res.json({ earned });
        } else {
            res.json({ earned: 0 });
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});

// Graceful shutdown
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
