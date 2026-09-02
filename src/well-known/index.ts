import { services } from './services.js';

/**
 * Connection settings of a well-known e-mail service
 */
export interface WellKnownServiceDefinition {
    /** Human readable description of the service */
    description?: string;
    /** Domains of e-mail addresses hosted by the service */
    domains?: string[];
    /** Alternative names the service can be looked up by */
    aliases?: string[];
    /** SMTP hostname */
    host?: string;
    /** SMTP port (a numeric string in a few entries) */
    port?: number | string;
    /** true for implicit TLS (usually port 465) */
    secure?: boolean;
    /** Preferred authentication method */
    authMethod?: string;
    /** Set to true to require STARTTLS on a plaintext connection */
    requireTLS?: boolean;
    /** Set to true to skip STARTTLS */
    ignoreTLS?: boolean;
}

/**
 * SMTP settings of a well-known service, without the lookup keys
 */
export type WellKnownService = Omit<WellKnownServiceDefinition, 'domains' | 'aliases'>;

const normalized: Record<string, WellKnownService> = {};

Object.keys(services).forEach(key => {
    const service = services[key];
    const normalizedService = normalizeService(service);

    normalized[normalizeKey(key)] = normalizedService;

    ([] as string[]).concat(service.aliases || []).forEach(alias => {
        normalized[normalizeKey(alias)] = normalizedService;
    });

    ([] as string[]).concat(service.domains || []).forEach(domain => {
        normalized[normalizeKey(domain)] = normalizedService;
    });
});

function normalizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9.-]/g, '').toLowerCase();
}

function normalizeService(service: WellKnownServiceDefinition): WellKnownService {
    const response: Record<string, unknown> = {};

    Object.keys(service).forEach(key => {
        if (!['domains', 'aliases'].includes(key)) {
            response[key] = (service as Record<string, unknown>)[key];
        }
    });

    return response as WellKnownService;
}

/**
 * Resolves SMTP config for given key. Key can be a name (like 'Gmail'), alias (like 'Google Mail') or
 * an email address (like 'test@googlemail.com').
 *
 * @param key Service name, alias or an email address
 * @returns SMTP config or false if not found
 */
export default function wellKnown(key: string): WellKnownService | false {
    key = normalizeKey(key.split('@').pop() as string);
    return normalized[key] || false;
}
