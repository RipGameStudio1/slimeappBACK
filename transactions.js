const mongoose = require('mongoose');

class TransactionManager {
    static async executeInTransaction(callback) {
        const session = await mongoose.startSession();
        session.startTransaction({
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' }
        });

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
        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const result = await model.findOneAndUpdate(
                filter,
                update,
                {
                    new: true,
                    runValidators: true,
                    session,
                    ...options
                }
            );

            await session.commitTransaction();
            return result;
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    static async atomicFindAndModify(model, filter, updateCallback) {
        return this.executeInTransaction(async (session) => {
            const doc = await model.findOne(filter).session(session);
            if (!doc) {
                throw new Error('Document not found');
            }

            const updates = await updateCallback(doc);
            Object.assign(doc, updates);

            await doc.save({ session });
            return doc;
        });
    }

    static async bulkWrite(model, operations) {
        return this.executeInTransaction(async (session) => {
            return await model.bulkWrite(operations, { session });
        });
    }
}

module.exports = TransactionManager;
