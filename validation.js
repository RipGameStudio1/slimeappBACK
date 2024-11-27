const Joi = require('joi');

const schemas = {
    farming: Joi.object({
        userId: Joi.string().required().trim().min(1).max(100)
            .pattern(/^[a-zA-Z0-9_-]+$/),
        limeAmount: Joi.number().min(0).max(1000000).precision(2),
        farmingCount: Joi.number().min(0).max(1000000).integer()
    }).required(),
    
    user: Joi.object({
        userId: Joi.string().required().trim().min(1).max(100)
            .pattern(/^[a-zA-Z0-9_-]+$/),
        attempts: Joi.number().integer().min(0).max(100),
        limeAmount: Joi.number().min(0).precision(2),
        level: Joi.number().integer().min(1).max(100),
        xp: Joi.number().min(0),
        achievements: Joi.object().pattern(
            Joi.string(),
            Joi.boolean()
        )
    }).required(),

    referral: Joi.object({
        referralCode: Joi.string().length(8)
            .pattern(/^[A-Z0-9]+$/),
        userId: Joi.string().required().trim()
            .pattern(/^[a-zA-Z0-9_-]+$/)
    }).required()
};

const validateRequest = (schema) => {
    return (req, res, next) => {
        // Очистка входных данных
        const sanitizedBody = Object.entries(req.body).reduce((acc, [key, value]) => {
            acc[key] = typeof value === 'string' ? value.trim() : value;
            return acc;
        }, {});

        const { error, value } = schema.validate(sanitizedBody, {
            abortEarly: false,
            stripUnknown: true,
            errors: {
                wrap: {
                    label: ''
                }
            }
        });

        if (error) {
            return res.status(400).json({
                error: 'Validation error',
                details: error.details.map(err => ({
                    field: err.path.join('.'),
                    message: err.message
                }))
            });
        }

        req.validatedData = value;
        next();
    };
};

module.exports = {
    schemas,
    validateRequest
};
