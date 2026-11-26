import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWriteStream, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createGzip, gunzipSync } from 'node:zlib';
import { cache, sha256 } from './corpora.mjs';

const compact = ['array', 'last', 'text'], titleFirst = ['array', 'text'];
const poolCounts = { hotpot: 7404, confirmation: 4084, wikisql: 1806, finqa: 299 };
const protocol = JSON.parse(readFileSync(new URL('./json-record-protocol.json', import.meta.url)));
const pretty = data => JSON.stringify(data, null, 2) + '\n';
const sum = values => values.reduce((a, b) => a + b, 0);

function checkProtocol(settings) {
    for (const [key, expected] of Object.entries(protocol)) {
        assert.equal(settings?.[key], expected, `JSON record study requires ${key}=${expected}.`);
    }
}

function loadRun(directory) {
    const batchFiles = dir => readdirSync(dir).filter(name => name.endsWith('.json.gz')).sort();
    if (Object.hasOwn(poolCounts, directory)) {
        const scores = join(cache, 'json-records', 'scores');
        const matches = readdirSync(scores, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name.startsWith(directory + '-'))
            .map(d => join(scores, d.name))
            .filter(dir => batchFiles(dir).length === Math.ceil(poolCounts[directory] / 32));
        assert.equal(matches.length, 1, `Found ${matches.length} complete runs for ${directory}. Supply the full score directory.`);
        [directory] = matches;
    }
    const entries = [], poolBatches = [], provider = {};
    let settings, peakMiB = 0;
    for (const [i, file] of batchFiles(directory).entries()) {
        assert.equal(file, String(i).padStart(4, '0') + '.json.gz', `Missing or misnumbered batch in ${directory}.`);
        const batch = JSON.parse(gunzipSync(readFileSync(join(directory, file))));
        if (i === 0) {
            settings = batch.settings;
            checkProtocol(settings);
        } else {
            assert.deepEqual(batch.settings, settings, `Score settings differ between batches in ${directory}.`);
        }
        poolBatches.push(batch.input);
        entries.push(...batch.results);
        for (const [key, count] of Object.entries(batch.stats)) {
            if (key !== 'replayMs') provider[key] = (provider[key] ?? 0) + count;
        }
        peakMiB = Math.max(peakMiB, batch.peakMiB);
    }
    assert.ok(settings && Object.hasOwn(poolCounts, settings.corpus), `Missing scores or unknown corpus in ${directory}.`);
    assert.equal(entries.length, poolCounts[settings.corpus], `Incomplete ${settings.corpus} score run.`);
    return { entries, meta: { settings, poolBatches, provider, peakMiB, scoreDirectory: basename(directory) } };
}

// Invert P(X >= k) for a binomial variable. Start the tail at k and advance by the ratio of successive terms.
function binomialLower(k, n, alpha) {
    if (k === 0) return 0;
    if (k === n) return alpha ** (1 / n);
    const s = Math.min(k, n - k);
    let logChoose = 0;
    for (let i = 1; i <= s; i++) logChoose += Math.log1p((n - s) / i);
    let lo = 0, hi = k / n;
    for (let step = 0; step < 52; step++) {
        const p = (lo + hi) / 2;
        let term = Math.exp(logChoose + k * Math.log(p) + (n - k) * Math.log1p(-p));
        let tail = term;
        for (let j = k; j < n; j++) {
            term *= (n - j) * p / ((j + 1) * (1 - p));
            tail += term;
            if (term <= tail * 1e-15 || tail > alpha) break;
        }
        if (tail > alpha) hi = p;
        else lo = p;
    }
    return (lo + hi) / 2;
}

export function paired(changes, width = 1, alpha = 0.05) {
    const n = changes.length, tail = alpha / (4 * width);
    assert.ok(n, 'A paired interval requires at least one question.');
    const counts = Array(2 * width + 1).fill(0);
    for (const change of changes) counts[change + width]++;
    let lo = 0, hi = 0;
    for (let k = 1; k <= width; k++) {
        const pos = sum(counts.slice(width + k)), neg = sum(counts.slice(0, width - k + 1));
        lo += binomialLower(pos, n, tail) - (1 - binomialLower(n - neg, n, tail));
        hi += (1 - binomialLower(n - pos, n, tail)) - binomialLower(neg, n, tail);
    }
    return { n, delta: 100 * sum(changes) / (width * n), lo: 100 * lo / width, hi: 100 * hi / width, counts };
}

function subset(entries, group) {
    return entries.filter(e => Math.max(...titleFirst.map(v => e.report[v].group)) === group);
}

function layout(view, name) {
    return view.measured.find(m => m.names.includes(name));
}

function difference(entries, name, control, views, bit, alpha) {
    const hit = (view, candidate) => Number(Boolean(layout(view, candidate).answers[0][0] & bit));
    return paired(entries.map(e => sum(views.map(v => hit(e.report[v], name) - hit(e.report[v], control)))), views.length, alpha);
}

function totals(entries) {
    const result = {};
    for (const { report } of entries) {
        for (const [view, { measured, questions }] of Object.entries(report)) {
            const rows = result[view] ??= {};
            for (const { names, cost, answers } of measured) for (const name of names) {
                const row = rows[name] ??= { cost: [0, 0, 0, 0, 0], n: 0, ordinary: 0, attributable: 0,
                    indexedOrdinary: 0, indexedAttributable: 0, deliveredTokens: 0, queryTokens: 0 };
                cost.forEach((value, i) => { row.cost[i] += value; });
                assert.equal(answers.length, questions.length);
                for (const [i, [got, ceiling, delivered]] of answers.entries()) {
                    assert.ok((got & ~ceiling) === 0 && delivered <= protocol.budget);
                    if (name !== 'plain' && name !== 'record' && !cost[4]) assert.ok(ceiling & 1);
                    row.n++;
                    row.ordinary += got & 1;
                    row.attributable += Number(Boolean(got & 2));
                    row.indexedOrdinary += ceiling & 1;
                    row.indexedAttributable += Number(Boolean(ceiling & 2));
                    row.deliveredTokens += delivered;
                    row.queryTokens += questions[i][1];
                }
            }
        }
    }
    return result;
}

function compare(entries, total, name, control, release) {
    const outcomes = (pools, views) => [1, 2].map(bit => difference(pools, name, control, views, bit));
    const affected = subset(entries, 2), sub = outcomes(affected, titleFirst);
    const full = {}, affectedViews = {}, costDelta = {}, costPercent = {}, titleOnly = {};
    const metric = release ? 'lo' : 'delta';
    const passesFloor = outcome => outcome[metric] >= -1;
    const subgroupFloor = sub.every(passesFloor), quality = sub[1][metric] > 1;
    // Development applied the subgroup floor to every nominee. Confirmation requires it for a savings win.
    let guards = release || subgroupFloor;
    for (const view of compact) {
        full[view] = outcomes(entries, [view]);
        if (titleFirst.includes(view)) affectedViews[view] = outcomes(affected, [view]);
        guards &&= full[view].every(passesFloor);
        const base = total[view][control].cost;
        costDelta[view] = total[view][name].cost.slice(0, 3).map((value, i) => value - base[i]);
        costPercent[view] = costDelta[view].map((delta, i) => {
            assert.ok(base[i] > 0, `Missing baseline cost for ${control} in ${view}.`);
            return 100 * delta / base[i];
        });
        if (name.endsWith('-omit') && control === name.replace('-omit', '-repeat')) {
            const key = name.split('-')[0], changes = [];
            for (const e of entries) {
                const titles = layout(e.report[view], name).titles;
                if (Object.hasOwn(titles, key)) changes.push(titles[key] - layout(e.report[view], control).titles[key]);
            }
            if (changes.length) {
                titleOnly[view] = paired(changes);
                guards &&= passesFloor(titleOnly[view]);
            }
        }
    }
    const indexCosts = Object.values(costDelta).flatMap(cost => cost.slice(0, 2));
    const savings = indexCosts.every(d => d <= 0) && indexCosts.some(d => d < 0);
    return { name, control, full, affected: sub, affectedViews, titleOnly, distractors: outcomes(subset(entries, 1), titleFirst),
        costDelta, costPercent, guards, qualifies: guards && (quality || (savings && subgroupFloor)), quality, savings,
        ...(release && { savingsSubgroupFloor: subgroupFloor }) };
}

export function nominate(entries, meta) {
    checkProtocol(meta.settings);
    const total = totals(entries), candidates = ['children'], comparisons = [];
    for (const name of ['packed', 'packed-repeat', 'packed-omit']) {
        const parent = candidates.at(-1), check = compare(entries, total, name, parent, false);
        comparisons.push(check);
        if (!check.qualifies || (parent !== 'children' && !compare(entries, total, name, 'children', false).guards)) break;
        candidates.push(name);
    }
    const ordinary = ref => sum(titleFirst.map(v => total[v][ref].ordinary));
    const reference = ordinary('plain') > ordinary('record') ? 'plain' : 'record';
    return { candidates, reference, development: meta, comparisons };
}

function* pairedRows(datasets, metadata) {
    for (const [corpus, pools] of Object.entries(datasets)) {
        const fingerprint = createHash('sha256');
        function includeHash(hex) {
            assert.match(hex, /^[\da-f]{64}$/i);
            fingerprint.update(hex, 'hex');
        }
        for (const { id, vectors, report } of pools) {
            includeHash(vectors);
            const views = {};
            for (const [view, { hash, measured, group }] of Object.entries(report)) {
                includeHash(hash);
                for (const m of measured) includeHash(m.layout);
                views[view] = [group, measured.map(m => [m.names, m.answers, m.cost, m.titles])];
            }
            yield JSON.stringify([corpus, id, Object.values(report)[0].questions, views]) + '\n';
        }
        metadata[corpus].orderedVectorSourceLayoutSHA256 = fingerprint.digest('hex');
    }
}

async function report(freeze, paths, output) {
    const frozen = JSON.parse(await readFile(freeze));
    checkProtocol(frozen.development.settings);
    const datasets = {}, metadata = {}, summary = {};
    for (const path of paths) {
        const { entries, meta } = loadRun(path), { corpus } = meta.settings;
        assert.ok(!Object.hasOwn(datasets, corpus), `Duplicate score run for ${corpus}.`);
        datasets[corpus] = entries;
        metadata[corpus] = meta;
        summary[corpus] = totals(entries);
    }
    assert.deepEqual(Object.keys(datasets).sort(), Object.keys(poolCounts).sort());
    assert.deepEqual(metadata.hotpot.poolBatches, frozen.development.poolBatches);
    assert.equal(metadata.hotpot.scoreDirectory, frozen.development.scoreDirectory);
    const entries = datasets.confirmation, total = summary.confirmation;
    const { candidates, reference } = frozen;
    assert.deepEqual(metadata.confirmation.settings.names, [...candidates, reference]);
    const checksum = pools => sha256(pools.map(e => e.id + '\n').join(''));
    assert.equal(checksum(entries), 'da6ec852df9cefb8ca1cddb7fca53416c2185c87295f9435c16af5bd02246fee');
    assert.equal(checksum(subset(entries, 2)), 'fe9dbb0bfa88c751b2a1315ca1e60505de055c66e1661e59285703e6d964bae2');
    assert.equal(subset(entries, 1).length, 1614);
    const comparisons = [], references = {};
    let selected = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
        const name = candidates[i], control = candidates[i - 1], check = compare(entries, total, name, control, true);
        const direct = control === 'children' ? check : compare(entries, total, name, 'children', true);
        check.baselineGuards = direct.guards && (check.quality || direct.savingsSubgroupFloor);
        check.parentQualified = selected === control;
        comparisons.push(check);
        if (check.parentQualified && check.qualifies && check.baselineGuards) selected = name;
    }
    for (const name of candidates) references[name] = difference(entries, reference, name, titleFirst, 1, 0.05 / candidates.length);
    const tmp = await mkdtemp(join(dirname(output), '.json-report-'));
    try {
        const pairedFile = join(tmp, 'paired.gz'), reportFile = join(tmp, 'report.json');
        await pipeline(pairedRows(datasets, metadata), createGzip({ level: 9 }), createWriteStream(pairedFile));
        const result = { qualifiedLayout: selected, reference, candidates, comparisons, references,
            costColumns: ['stored rows', 'row tokens', 'distinct input tokens per call', 'pooled inputs', 'over-limit fragments'],
            answerColumns: ['ranked bits (ordinary=1, attributable or labelled=2)', 'unbudgeted indexing bits', 'delivered tokens'],
            metadata, totals: summary, pairedFileSHA256: sha256(await readFile(pairedFile)) };
        await writeFile(reportFile, pretty(result));
        await rename(pairedFile, output + '-paired.jsonl.gz');
        await rename(reportFile, output + '.json');
    } finally {
        await rm(tmp, { recursive: true, force: true });
    }
    console.log('Highest qualifying layout', selected, 'generic comparison', references[selected]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'nominate' && args.length === 2) {
        const { entries, meta } = loadRun(args[0]), frozen = nominate(entries, meta);
        await writeFile(args[1], pretty(frozen));
        console.log('Frozen candidates', frozen.candidates, 'reference', frozen.reference);
    } else if (command === 'report' && args.length === 6) {
        await report(args[0], args.slice(1, -1), args.at(-1));
    } else {
        throw new Error('Use nominate DEVELOPMENT OUTPUT, or report FROZEN HOTPOT WIKISQL FINQA CONFIRMATION OUTPUT_PREFIX.');
    }
}
