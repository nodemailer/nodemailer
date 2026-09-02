// Safe copying of objects whose keys come from the caller.
//
// This lives in its own leaf module, like ./url.ts, so that every layer can reach it.
// src/shared/index.ts imports src/fetch, so src/fetch can not import src/shared back,
// and src/mime-funcs is a leaf that would otherwise pull in dns/net/os/fs for a string
// comparison. src/shared/index.ts re-exports both functions for the callers that already
// depend on it.

/**
 * Detects a key that can not be copied onto a plain object with `target[key] = value`.
 *
 * "__proto__" is the only one: assigning it runs the inherited setter and replaces the
 * prototype of the target instead of adding a property to it, so a caller can smuggle
 * values past validation that only inspects own keys. JSON.parse produces such a key
 * where an object literal can not. "constructor" and "prototype" have no such setter and
 * become ordinary own properties, so dropping them would only discard legitimate values.
 *
 * @param key Key to check
 * @returns true if the key must not be copied
 */
export const isProtoKey = (key: string): boolean => key === '__proto__';

/**
 * Copies own enumerable keys from a source object to a target object. Every copy that
 * walks the keys of user supplied data goes through here, see isProtoKey.
 *
 * @param target Object to copy the keys to
 * @param source Object to copy the keys from
 * @param [skip] Optional predicate, return true to leave a key out
 * @returns The target object
 */
export const copyOwnKeys = <T extends object>(target: T, source: object | null | undefined, skip?: (key: string) => boolean): T => {
    Object.keys(source || {}).forEach(key => {
        if (isProtoKey(key) || (skip && skip(key))) {
            return;
        }
        (target as Record<string, unknown>)[key] = (source as Record<string, unknown>)[key];
    });
    return target;
};
