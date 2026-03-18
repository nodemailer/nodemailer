'use strict';

const services = require('./services.json');
const normalized = {};

Object.keys(services).forEach(key => {
    const service = services[key];
    const normalizedService = normalizeService(service);

    normalized[normalizeKey(key)] = normalizedService;

    [].concat(service.aliases || []).forEach(alias => {
        normalized[normalizeKey(alias)] = normalizedService;
    });

    [].concat(service.domains || []).forEach(domain => {
        normalized[normalizeKey(domain)] = normalizedService;
    });
});

function normalizeKey(key) {
    return key.replace(/[^a-zA-Z0-9.-]/g, '').toLowerCase();
}

function normalizeService(service) {
    const response = {};

    Object.keys(service).forEach(key => {
        if (!['domains', 'aliases'].includes(key)) {
            response[key] = service[key];
        }
    });

    return response;
}

/**
 * Resolves SMTP config for given key. Key can be a name (like 'Gmail'), alias (like 'Google Mail') or
 * an email address (like 'test@googlemail.com').
 *
 * @param {String} key [description]
 * @returns {Object} SMTP config or false if not found
 */
module.exports = function (key) {
    key = normalizeKey(key.split('@').pop());
    return normalized[key] || false;
};
