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
    pendingRewards: { type: Number, default: 0 },
    referrer: { type: String, default: null },
    referrals: [{ type: String }],
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
                limeAmount: 0,
                lastUpdate: new Date(),
                startTime: null
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

        // Если есть реферер, начисляем ему бонус
        if (user.referrer) {
            const referrer = await User.findOne({ userId: user.referrer });
            if (referrer) {
                const bonus = (limeAmount - user.limeAmount) * 0.1; // 10% от заработка
                referrer.pendingRewards += bonus;
                await referrer.save();
            }
        }

        user.limeAmount = limeAmount;
        user.farmingCount = farmingCount;
        user.isActive = false;
        user.startTime = null;
        user.lastUpdate = new Date();
        await user.save();

        res.json(user);
    } catch (error) {
        console.error('Error completing farming:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users/:userId/referrals', async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId });
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        const referrals = await User.find({ 
            userId: { $in: user.referrals }
        }, 'userId limeAmount');
        
        res.json(referrals);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/users/:userId/referral', async (req, res) => {
    try {
        const { referralCode } = req.body;
        const referrerId = referralCode.replace('ref', '');
        
        if (referrerId === req.params.userId) {
            return res.status(400).json({ error: 'Cannot refer yourself' });
        }
        
        const user = await User.findOne({ userId: req.params.userId });
        if (user.referrer) {
            return res.status(400).json({ error: 'Already has referrer' });
        }
        
        const referrer = await User.findOne({ userId: referrerId });
        if (!referrer) {
            return res.status(404).json({ error: 'Referrer not found' });
        }
        
        user.referrer = referrerId;
        referrer.referrals.push(req.params.userId);
        
        await user.save();
        await referrer.save();
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/users/:userId/collect-rewards', async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const collectedAmount = user.pendingRewards;
        user.limeAmount += collectedAmount;
        user.pendingRewards = 0;
        await user.save();

        res.json({ 
            success: true, 
            collectedAmount,
            newBalance: user.limeAmount 
        });
    } catch (error) {
        console.error('Error collecting rewards:', error);
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
