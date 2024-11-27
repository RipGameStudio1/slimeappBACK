const SecurityService = require('./SecurityService');
const TransactionManager = require('./TransactionManager');

class DataService {
    static async encryptAndSave(model, data, sensitiveFields) {
        const encryptedData = {};
        const regularData = {};

        for (const [key, value] of Object.entries(data)) {
            if (sensitiveFields.includes(key)) {
                encryptedData[key] = SecurityService.encrypt(
                    typeof value === 'object' ? JSON.stringify(value) : String(value)
                );
            } else {
                regularData[key] = SecurityService.sanitizeInput(value);
            }
        }

        return await TransactionManager.executeInTransaction(async (session) => {
            const document = new model({
                ...regularData,
                encryptedData,
                lastUpdate: new Date()
            });
            
            await document.validate();
            return await document.save({ session });
        });
    }

    static async decryptData(document, sensitiveFields) {
        if (!document) return null;

        const decryptedData = { ...document.toObject() };
        delete decryptedData.encryptedData;

        for (const field of sensitiveFields) {
            if (document.encryptedData?.[field]) {
                try {
                    const decrypted = SecurityService.decrypt(document.encryptedData[field]);
                    decryptedData[field] = JSON.parse(decrypted);
                } catch (error) {
                    console.error(`Error decrypting field ${field}:`, error);
                    decryptedData[field] = null;
                }
            }
        }

        return decryptedData;
    }

    static async updateSecureData(model, filter, updates, sensitiveFields) {
        return await TransactionManager.atomicOperation(
            model,
            filter,
            this.prepareSecureUpdate(updates, sensitiveFields)
        );
    }

    static prepareSecureUpdate(updates, sensitiveFields) {
        const secureUpdates = {};
        const encryptedUpdates = {};

        for (const [key, value] of Object.entries(updates)) {
            if (sensitiveFields.includes(key)) {
                encryptedUpdates[`encryptedData.${key}`] = SecurityService.encrypt(
                    typeof value === 'object' ? JSON.stringify(value) : String(value)
                );
            } else {
                secureUpdates[key] = SecurityService.sanitizeInput(value);
            }
        }

        return { $set: { ...secureUpdates, ...encryptedUpdates } };
    }
}

module.exports = DataService;
