import { Context, Next } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../config/app";
import { Exception, UnauthorizedException } from "../helper/exception";

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Autentikasi untuk client eksternal (server-to-server) lewat header `X-API-Key`.
 * Key diambil dari CLIENT_API_KEYS (boleh lebih dari satu, dipisah koma, supaya bisa rotasi tanpa downtime).
 */
export const apiKeyMiddleware = async (c: Context, next: Next) => {
    const keys = config.client.apiKeys;
    if (!keys.length) {
        throw new Exception('Client API is not configured', 503);
    }

    const apiKey = c.req.header('X-API-Key');
    if (!apiKey) {
        throw new UnauthorizedException('X-API-Key header missing');
    }

    // Bandingkan hash-nya supaya panjang selalu sama dan perbandingan constant-time
    const given = digest(apiKey);
    const valid = keys.some(key => timingSafeEqual(digest(key), given));
    if (!valid) {
        throw new UnauthorizedException('Invalid API key');
    }

    await next();
};
