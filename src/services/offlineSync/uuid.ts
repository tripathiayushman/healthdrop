/**
 * UUID v4 generator that works on Hermes/React Native, where
 * crypto.randomUUID is not available. Falls back from
 * crypto.randomUUID → crypto.getRandomValues → Math.random.
 */
export function generateUUID(): string {
    const g = globalThis as { crypto?: Crypto };
    if (typeof g.crypto?.randomUUID === 'function') {
        return g.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (typeof g.crypto?.getRandomValues === 'function') {
        g.crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < 16; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }
    // RFC 4122 version + variant bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
