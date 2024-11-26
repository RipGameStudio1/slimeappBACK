const SecurityService = require('./security');
const TransactionManager = require('./transactions');

class DataService {
    static async encryptAndSave(model, data, sensitiveFields) {
        const encryptedData = {};
        const regularData = {};

        Object.entries(data).forEach(([key, value]) => {
            if (sensitiveFields.includes(key)) {
                encryptedData[key] = SecurityService.encrypt(JSON.stringify(value));
            } else {
                regularData[key] = value;
            }
        });

        return await TransactionManager.executeInTransaction(async (session) => {
            const document = new model({
                ...regularData,
                encryptedData
            });
            return await document.save({ session });
        });
    }

    static async decryptData(document, sensitiveFields) {
        const decryptedData = { ...document.toObject() };

        sensitiveFields.forEach(field => {
            if (document.encryptedData && document.encryptedData[field]) {
                decryptedData[field] = JSON.parse(
                    SecurityService.decrypt(document.encryptedData[field])
                );
            }
        });

        return decryptedData;
    }
}

module.exports = DataService;
