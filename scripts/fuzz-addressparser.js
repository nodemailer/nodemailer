// Differential fuzz and scaling sweep for src/addressparser.
//
// Run through tsx, which loads the TypeScript sources directly:
//
//   node --import tsx scripts/fuzz-addressparser.js diff [--ref HEAD~1] [--count 200000] [--seed 12345] [--expect <regex>] [--samples 20] [--oracle]
//   node --import tsx scripts/fuzz-addressparser.js scale [--ref <git-ref>] [--size 50000]
//
// diff: parses generated inputs with the current src/ and with src/ at a git ref, and reports
// every input whose addressparser output or MimeNode envelope recipients changed. The old
// tree is extracted with `git archive` into a temp directory, so the working tree is never
// touched. --expect labels changed inputs that match the regex as the intended class, so
// anything outside it stands out. --oracle runs Python's email._header_value_parser over the
// changed inputs and reports how often each side agrees with it. Informational, exits 0.
//
// scale: times parse(prefix + unit.repeat(n)) at n and 4n for a list of known trap shapes
// and flags a growth ratio above 9 (linear is ~4, quadratic ~16). A flagged shape is
// measured again before it is reported, since a single slow reading can be a machine stall.
// Sweeps the current src/ unless --ref is given. Exits 1 when a shape is flagged.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
    const args = { mode: argv[0], ref: null, count: 200000, seed: 12345, expect: null, samples: 20, oracle: false, size: 50000 };
    for (let i = 1; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, '');
        if (key === 'oracle') {
            args.oracle = true;
        } else if (key in args && i + 1 < argv.length) {
            const value = argv[++i];
            args[key] = typeof args[key] === 'number' ? Number(value) : value;
        } else {
            throw new Error('Unknown or incomplete option: ' + argv[i]);
        }
    }
    return args;
}

function git(args, options) {
    const result = spawnSync('git', args, Object.assign({ cwd: root, maxBuffer: 256 * 1024 * 1024 }, options));
    if (result.status !== 0) {
        throw new Error('git ' + args.join(' ') + ' failed: ' + String(result.stderr).trim());
    }
    return result.stdout;
}

const GENERATED = ['src/package-info.ts', 'src/well-known/services.ts'];

function ensureGenerated() {
    if (GENERATED.some(file => !fs.existsSync(path.join(root, file)))) {
        spawnSync(process.execPath, [path.join(root, 'scripts/build.js'), '--generate-only'], { cwd: root, stdio: 'inherit' });
    }
}

// Extracts src/ at a git ref into a temp directory. The generated files are gitignored, so
// they are copied over from the current tree (generated first when missing).
function extractRef(ref) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-addressparser-'));
    git(['cat-file', '-e', ref + ':src/addressparser/index.ts']);
    const tar = git(['archive', '--format=tar', ref, 'src']);
    const untar = spawnSync('tar', ['-x', '-C', dir], { input: tar });
    if (untar.status !== 0) {
        throw new Error('tar failed: ' + String(untar.stderr).trim());
    }
    for (const file of GENERATED) {
        if (!fs.existsSync(path.join(dir, file)) && fs.existsSync(path.join(root, file))) {
            fs.copyFileSync(path.join(root, file), path.join(dir, file));
        }
    }
    return dir;
}

async function loadSide(ref) {
    ensureGenerated();
    const base = ref ? extractRef(ref) : root;
    const load = async file => (await import(pathToFileURL(path.join(base, file)).href)).default;
    return {
        label: ref || 'working tree',
        dir: base,
        addressparser: await load('src/addressparser/index.ts'),
        MimeNode: await load('src/mime-node/index.ts')
    };
}

// JSON.stringify with everything outside printable ASCII escaped, so Unicode spaces are visible
function show(value) {
    return JSON.stringify(value).replace(/[^\x20-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

const UNITS = [
    // ASCII specials and whitespace
    '(',
    ')',
    '<',
    '>',
    '@',
    ',',
    ';',
    ':',
    '"',
    '[',
    ']',
    '\\',
    '.',
    ' ',
    '\t',
    '\r',
    '\n',
    '\r\n',
    // Unicode spaces
    '\u00a0',
    '\u3000',
    '\ufeff',
    // plain and non-ASCII text
    'a',
    'b',
    'ex.com',
    '\u00e9',
    '\u0436',
    '\u4e2d',
    // attack shapes
    'a@b',
    '(x)',
    '<a@b>',
    'v@victim.example',
    'G:',
    ' .',
    '. ',
    ' (x)\u00a0.',
    '.\u00a0'
];

function makeRandom(seed) {
    let state = Math.abs(Math.trunc(seed)) % 2147483647 || 1;
    // Park-Miller minimal standard generator, deterministic for a given seed
    return n => {
        state = (state * 48271) % 2147483647 || 1;
        return state % n;
    };
}

function generate(random) {
    let s = '';
    const length = 1 + random(12);
    for (let i = 0; i < length; i++) {
        s += UNITS[random(UNITS.length)];
    }
    return s;
}

function envelopeOf(side, input) {
    try {
        return new side.MimeNode('text/plain').setHeader('to', input).getEnvelope().to;
    } catch (err) {
        return ['ERROR ' + err.message];
    }
}

function domains(list) {
    return Array.from(new Set(list.map(addr => (addr.includes('@') ? addr.slice(addr.lastIndexOf('@') + 1).toLowerCase() : '')))).sort();
}

function flatAddresses(parsed) {
    const out = [];
    const walk = list => {
        for (const entry of list) {
            if (entry.group) {
                walk(entry.group);
            } else if (entry.address) {
                out.push(entry.address);
            }
        }
    };
    walk(parsed);
    return out;
}

const ORACLE = `
import json, sys
from email import _header_value_parser as hvp
for line in sys.stdin:
    s = json.loads(line)
    try:
        al = hvp.get_address_list(s)[0]
        out = [m.addr_spec for a in al.addresses for m in a.all_mailboxes]
    except Exception as e:
        out = None
    print(json.dumps(out))
`;

function runOracle(inputs) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-oracle-'));
    const script = path.join(dir, 'oracle.py');
    fs.writeFileSync(script, ORACLE);
    const result = spawnSync('python3', ['-I', script], {
        input: inputs.map(s => JSON.stringify(s)).join('\n') + '\n',
        maxBuffer: 256 * 1024 * 1024
    });
    fs.rmSync(dir, { recursive: true, force: true });
    if (result.error || result.status !== 0) {
        return null;
    }
    return String(result.stdout)
        .trim()
        .split('\n')
        .map(line => JSON.parse(line));
}

// Python keeps a quoted local part quoted, addressparser unquotes it, so compare unquoted
function normalizeAddr(addr) {
    return String(addr)
        .replace(/^"((?:[^"\\]|\\.)*)"@/, (m, local) => local.replace(/\\(.)/g, '$1') + '@')
        .toLowerCase();
}

function agrees(oracle, addresses) {
    return oracle !== null && JSON.stringify(oracle.map(normalizeAddr)) === JSON.stringify(addresses.map(normalizeAddr));
}

function reportOracle(changes) {
    const results = runOracle(changes.map(change => change.input));
    if (!results) {
        console.log('\noracle: python3 not available or failed, skipped');
        return;
    }
    let oldAgree = 0;
    let newAgree = 0;
    const regressions = [];
    changes.forEach((change, i) => {
        const o = agrees(results[i], change.oldAddresses);
        const n = agrees(results[i], change.newAddresses);
        oldAgree += o ? 1 : 0;
        newAgree += n ? 1 : 0;
        if (o && !n) {
            regressions.push({ input: change.input, python: results[i], old: change.oldAddresses, new: change.newAddresses });
        }
    });
    console.log('\noracle (python3 email._header_value_parser) over ' + changes.length + ' changed inputs:');
    console.log('  agrees with old: ' + oldAgree + ', with new: ' + newAgree + ', agreed before but not after: ' + regressions.length);
    for (const r of regressions.slice(0, 10)) {
        console.log('  ' + show(r.input) + '\n    python ' + show(r.python) + '\n    old    ' + show(r.old) + '\n    new    ' + show(r.new));
    }
    console.log('  note: Python treats Unicode spaces differently from mailauth, a disagreement there needs judgment');
}

function compareInput(oldSide, newSide, input) {
    const oldParsed = oldSide.addressparser(input);
    const newParsed = newSide.addressparser(input);
    const oldJson = JSON.stringify(oldParsed);
    const newJson = JSON.stringify(newParsed);
    const oldEnvelope = envelopeOf(oldSide, input);
    const newEnvelope = envelopeOf(newSide, input);
    const envelopeChanged = JSON.stringify(oldEnvelope) !== JSON.stringify(newEnvelope);
    if (oldJson === newJson && !envelopeChanged) {
        return null;
    }
    return {
        input,
        oldJson,
        newJson,
        oldEnvelope,
        newEnvelope,
        envelopeChanged,
        domainMoved: JSON.stringify(domains(oldEnvelope)) !== JSON.stringify(domains(newEnvelope)),
        oldAddresses: flatAddresses(oldParsed),
        newAddresses: flatAddresses(newParsed)
    };
}

async function diffMode(args) {
    const ref = args.ref || 'HEAD~1';
    const oldSide = await loadSide(ref);
    const newSide = await loadSide(null);
    const expect = args.expect ? new RegExp(args.expect, 'u') : null;
    const random = makeRandom(args.seed);
    const seen = new Set();
    const changes = [];
    const counts = { parseOnly: 0, envelope: 0, domainMoved: 0, expected: 0, unexpected: 0 };

    for (let i = 0; i < args.count; i++) {
        const input = generate(random);
        if (seen.has(input)) {
            continue;
        }
        seen.add(input);
        const change = compareInput(oldSide, newSide, input);
        if (!change) {
            continue;
        }
        change.expected = expect ? expect.test(input) : null;
        changes.push(change);
        counts[change.envelopeChanged ? 'envelope' : 'parseOnly']++;
        counts.domainMoved += change.domainMoved ? 1 : 0;
        if (expect) {
            counts[change.expected ? 'expected' : 'unexpected']++;
        }
    }

    console.log('diff: ' + oldSide.label + ' -> ' + newSide.label + ', seed ' + args.seed + ', ' + seen.size + ' unique inputs of ' + args.count);
    console.log('changed: ' + changes.length + ' (parse only: ' + counts.parseOnly + ', envelope recipients changed: ' + counts.envelope + ')');
    console.log('envelope domain moved: ' + counts.domainMoved);
    if (expect) {
        console.log('matching --expect: ' + counts.expected + ', NOT matching: ' + counts.unexpected);
    }

    // Unexpected changes and domain moves first, they are the ones worth reading
    const ranked = changes.slice().sort((a, b) => Number(b.expected === false) - Number(a.expected === false) || Number(b.domainMoved) - Number(a.domainMoved));
    for (const change of ranked.slice(0, args.samples)) {
        const tags = [change.domainMoved ? 'DOMAIN-MOVED' : change.envelopeChanged ? 'envelope' : 'parse-only'];
        if (change.expected !== null) {
            tags.push(change.expected ? 'expected' : 'UNEXPECTED');
        }
        console.log('\n[' + tags.join(', ') + '] ' + show(change.input));
        console.log('   old ' + show(JSON.parse(change.oldJson)) + '\n   new ' + show(JSON.parse(change.newJson)));
        if (change.envelopeChanged) {
            console.log('   envelope old ' + show(change.oldEnvelope) + ' new ' + show(change.newEnvelope));
        }
    }
    if (changes.length > args.samples) {
        console.log('\n(' + (changes.length - args.samples) + ' more not shown, raise --samples to see them)');
    }

    if (args.oracle && changes.length) {
        reportOracle(changes);
    }
    if (oldSide.dir !== root) {
        fs.rmSync(oldSide.dir, { recursive: true, force: true });
    }
}

const SCALE_PREFIXES = ['', 'a@b', '<a@b', '"', '('];

const SCALE_UNITS = [
    // single tokens and short shapes
    'a',
    'b@',
    '@b',
    '(c)',
    '<a@b>',
    '"q"',
    'a,',
    'g:',
    ';',
    '[x]',
    '\\',
    '.',
    // many whitespace-separated runs (forward probe trap)
    ' a',
    ' [x]',
    ' (c)',
    ' b@',
    ' @b',
    ' a@b',
    ' "q"',
    ' <a',
    '\u00a0a',
    // comment and dot shapes around a domain (CFWS around dots)
    ' .c',
    '(x).c',
    '. c',
    'a@b . ',
    ' . ',
    '(x) . (y) c',
    '(x).',
    '.(x)',
    'a@b.c (x) .d, '
];

function timeParse(parse, prefix, unit, n) {
    const input = prefix + unit.repeat(n);
    const start = performance.now();
    parse(input);
    return performance.now() - start;
}

function measure(parse, prefix, unit, size) {
    const n = Math.max(1, Math.ceil(size / unit.length));
    timeParse(parse, prefix, unit, Math.min(n, 1000));
    const small = timeParse(parse, prefix, unit, n);
    // A small run this slow is already a finding, do not wait for the 4x one
    if (small > 5000) {
        return { small, large: Infinity, ratio: Infinity };
    }
    const large = timeParse(parse, prefix, unit, 4 * n);
    // Below ~2ms timer noise dominates the ratio, so treat it as linear
    return { small, large, ratio: large < 2 ? 1 : large / Math.max(small, 0.1) };
}

async function scaleMode(args) {
    const side = await loadSide(args.ref);
    const flagged = [];
    console.log('scale: ' + side.label + ', ' + args.size + ' chars at n, flag ratio > 9');
    for (const prefix of SCALE_PREFIXES) {
        for (const unit of SCALE_UNITS) {
            let result = measure(side.addressparser, prefix, unit, args.size);
            let note = '';
            if (result.ratio > 9) {
                result = measure(side.addressparser, prefix, unit, args.size);
                note = result.ratio > 9 ? ' FLAGGED (re-measured)' : ' (did not reproduce on re-measure)';
                if (result.ratio > 9) {
                    flagged.push({ prefix, unit, result });
                }
            }
            if (note || process.env.VERBOSE) {
                console.log(
                    show(prefix).padEnd(8) +
                        show(unit).padEnd(20) +
                        result.small.toFixed(1).padStart(9) +
                        'ms' +
                        result.large.toFixed(1).padStart(9) +
                        'ms  ratio ' +
                        result.ratio.toFixed(1) +
                        note
                );
            }
        }
    }
    console.log(SCALE_PREFIXES.length * SCALE_UNITS.length + ' shapes measured, ' + flagged.length + ' flagged');
    if (side.dir !== root) {
        fs.rmSync(side.dir, { recursive: true, force: true });
    }
    return flagged.length ? 1 : 0;
}

const args = parseArgs(process.argv.slice(2));
if (args.mode === 'diff') {
    await diffMode(args);
} else if (args.mode === 'scale') {
    process.exitCode = await scaleMode(args);
} else {
    console.error('Usage: node --import tsx scripts/fuzz-addressparser.js <diff|scale> [options], see the header of this file');
    process.exitCode = 2;
}
