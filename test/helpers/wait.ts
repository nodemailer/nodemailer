/**
 * Resolves once the stream emitted 'close', right away when it already did
 */
export function closed(stream: NodeJS.EventEmitter & { closed?: boolean }): Promise<void> {
    return stream.closed ? Promise.resolve() : new Promise(resolve => stream.once('close', () => resolve()));
}

/**
 * Resolves once the condition holds, checking it every 10ms for at most a second
 */
export async function waitFor(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !condition(); i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}
