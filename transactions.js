const mongoose = require('mongoose');

class TransactionManager {
    static async executeInTransaction(callback) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const result = await callback(session);
            await session.commitTransaction();
            return result;
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    static async atomicOperation(model, filter, update, options = {}) {
        return await model.findOneAndUpdate(
            filter,
            update,
            {
                new: true,
                runValidators: true,
                atomic: true,
                ...options
            }
        );
    }
}

module.exports = TransactionManager;
