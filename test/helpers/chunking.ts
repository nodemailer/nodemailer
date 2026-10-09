import type { Transform } from 'node:stream';

/**
 * A small seeded random number generator (Park-Miller). Randomized tests use it so that a failing
 * case can be replayed from the seed printed in the assertion message
 */
export function seededRandom(seed: number): (max: number) => number {
    let state = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
    return (max: number): number => {
        state = (state * 48271) % 2147483647;
        return Math.floor(((state - 1) / 2147483646) * max);
    };
}

/**
 * Writes `input` into the transform in chunks of the given sizes, a macrotask apart so every
 * chunk is processed on its own, and resolves with everything the transform emitted
 */
export function transformInChunks(transform: Transform, input: Buffer, chunkSize: () => number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const output: Buffer[] = [];
        transform.on('data', chunk => output.push(Buffer.from(chunk)));
        transform.on('error', reject);
        transform.on('end', () => resolve(Buffer.concat(output)));

        let pos = 0;
        const next = () => {
            if (pos >= input.length) {
                transform.end();
                return;
            }
            const size = Math.max(1, chunkSize());
            transform.write(input.subarray(pos, pos + size));
            pos += size;
            setImmediate(next);
        };
        next();
    });
}
