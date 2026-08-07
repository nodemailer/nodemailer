'use strict';

// Safe copying of objects whose keys come from the caller.
//
// This lives in its own leaf module, like ./url.js, so that every layer can reach it.
// lib/shared/index.js requires lib/fetch, so lib/fetch can not require lib/shared back,
// and lib/mime-funcs is a leaf that would otherwise pull in dns/net/os/fs for a string
// comparison. lib/shared/index.js re-exports both functions for the callers that already
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
 * @param {String} key Key to check
 * @returns {Boolean} true if the key must not be copied
 */
module.exports.isProtoKey = key => key === '__proto__';

/**
 * Copies own enumerable keys from a source object to a target object. Every copy that
 * walks the keys of user supplied data goes through here, see isProtoKey.
 *
 * @param {Object} target Object to copy the keys to
 * @param {Object} source Object to copy the keys from
 * @param {Function} [skip] Optional predicate, return true to leave a key out
 * @returns {Object} The target object
 */
module.exports.copyOwnKeys = (target, source, skip) => {
    Object.keys(source || {}).forEach(key => {
        if (module.exports.isProtoKey(key) || (skip && skip(key))) {
            return;
        }
        target[key] = source[key];
    });
    return target;
};
