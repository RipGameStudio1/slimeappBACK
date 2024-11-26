const Joi = require('joi');

const schemas = {
    farming: Joi.object({
        userId: Joi.string().required(),
        limeAmount: Joi.number().min(0),
        farmingCount: Joi.number().min(0)
    }),
    
    user: Joi.object({
        userId: Joi.string().required(),
        attempts: Joi.number().min(0).max(100)
    }),

    referral: Joi.object({
        referralCode: Joi.string().length(8),
        userId: Joi.string().required()
    })
};

const validateRequest = (schema) => {
    return (req, res, next) => {
        const { error } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: error.details[0].message
            });
        }
        next();
    };
};

module.exports = {
    schemas,
    validateRequest
};
