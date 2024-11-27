const crypto = require('crypto');
const jwt = require('jsonwebtoken');

class SecurityService {
    static #encryptionKey = process.env.ENCRYPTION_KEY;
    static #algorithm = 'aes-256-gcm';
    static #ivLength = 16;
    static #saltLength = 32;

    static encrypt(text) {
        const iv = crypto.randomBytes(this.#ivLength);
        const salt = crypto.randomBytes(this.#saltLength);
        const key = crypto.pbkdf2Sync(this.#encryptionKey, salt, 100000, 32, 'sha512');
        
        const cipher = crypto.createCipheriv(this.#algorithm, key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();

        return {
            iv: iv.toString('hex'),
            salt: salt.toString('hex'),
            encryptedData: encrypted,
            authTag: authTag.toString('hex')
        };
    }

    static decrypt(encrypted) {
        const key = crypto.pbkdf2Sync(
            this.#encryptionKey,
            Buffer.from(encrypted.salt, 'hex'),
            100000,
            32,
            'sha512'
        );

        const decipher = crypto.createDecipheriv(
            this.#algorithm, 
            key,
            Buffer.from(encrypted.iv, 'hex')
        );
        
        decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
        let decrypted = decipher.update(encrypted.encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    static hashPassword(password) {
        const salt = crypto.randomBytes(this.#saltLength);
        return {
            hash: crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex'),
            salt: salt.toString('hex')
        };
    }

    static verifyPassword(password, hash, salt) {
        const verifyHash = crypto.pbkdf2Sync(
            password,
            Buffer.from(salt, 'hex'),
            100000,
            64,
            'sha512'
        ).toString('hex');
        return hash === verifyHash;
    }

    static sanitizeInput(input) {
        if (typeof input === 'string') {
            return input.replace(/[<>]/g, '');
        }
        return input;
    }

    static generateSecureToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    static validateInput(data, schema) {
        const sanitizedData = Object.entries(data).reduce((acc, [key, value]) => {
            acc[key] = this.sanitizeInput(value);
            return acc;
        }, {});
        return schema.validate(sanitizedData);
    }
}

module.exports = SecurityService;
