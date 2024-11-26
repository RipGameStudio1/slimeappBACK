const crypto = require('crypto');
const jwt = require('jsonwebtoken');

class SecurityService {
    static #encryptionKey = process.env.ENCRYPTION_KEY;
    static #algorithm = 'aes-256-gcm';

    static encrypt(text) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.#algorithm, Buffer.from(this.#encryptionKey), iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();
        return {
            iv: iv.toString('hex'),
            encryptedData: encrypted,
            authTag: authTag.toString('hex')
        };
    }

    static decrypt(encrypted) {
        const decipher = crypto.createDecipheriv(
            this.#algorithm, 
            Buffer.from(this.#encryptionKey),
            Buffer.from(encrypted.iv, 'hex')
        );
        decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
        let decrypted = decipher.update(encrypted.encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    static hashPassword(password) {
        return crypto.pbkdf2Sync(password, 
            process.env.SALT, 
            10000, 
            64, 
            'sha512'
        ).toString('hex');
    }

    static validateInput(data, schema) {
        return schema.validate(data);
    }
}

module.exports = SecurityService;
