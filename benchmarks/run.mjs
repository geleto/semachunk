import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assets, here } from './corpora.mjs';
import { dimension, encodingName, model, modelInputTokens, openEncoder } from './encoder.mjs';
import { qualityPlans } from './chunking.mjs';
import { evaluateQuality, qualityTasks } from './quality.mjs';
import { budgets, evaluateRag, ragPlans, ragTasks, windowName, windowPlan } from './rag.mjs';

async function digest(root, names) {
    const hash = createHash('sha256');
    for (const name of names.sort()) {
        const source = (await readFile(join(root, name), 'utf8')).replace(/\r\n/g, '\n');
        hash.update(name + '\0' + source + '\0');
    }
    return hash.digest('hex');
}

function argumentsFor(args, rag) {
    const result = { implementation: join(here, '..') };
    for (let i = 0; i < args.length; i++) {
        const key = args[i];
        if (key === '--methods') {
            const names = [];
            while (args[i + 1] && !args[i + 1].startsWith('--')) names.push(args[++i]);
            if (!names.length) throw new Error('--methods needs at least one method');
            result.methods = names;
        } else {
            if (!['--implementation', '--output', '--env-file', '--new-tokens', ...(rag ? ['--task'] : [])].includes(key)) {
                throw new Error('Unknown option ' + key);
            }
            const value = args[++i];
            if (!value || value.startsWith('--')) throw new Error('Missing value for ' + key);
            result[key.slice(2)] = value;
        }
    }
    return result;
}

async function main() {
    const [suite, ...args] = process.argv.slice(2);
    if (!['quality', 'rag'].includes(suite)) throw new Error('Select the quality or rag suite');
    const rag = suite === 'rag', options = argumentsFor(args, rag);
    const root = resolve(options.implementation), startedUTC = new Date().toISOString();
    const output = resolve(options.output ?? join(here, 'results', suite + '-' + startedUTC.replace(/[-:.]/g, '') + '.json'));
    if (existsSync(output)) throw new Error('Result already exists: ' + output);
    const { chunkText } = await import(pathToFileURL(join(root, 'src', 'index.js')));
    const tasks = !rag || !options.task || options.task === 'all' ? Object.keys(rag ? ragTasks : qualityTasks) : [options.task];
    if (rag && tasks.some(t => !Object.hasOwn(ragTasks, t))) throw new Error('Unknown RAG task ' + options.task);
    let plans = rag ? ragPlans() : qualityPlans();
    if (options.methods) plans = Object.fromEntries(options.methods.map(name => {
        if (!Object.hasOwn(plans, name)) throw new Error('Unknown ' + suite + ' method ' + name);
        return [name, plans[name]];
    }));
    const { devDependencies: libraries } = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8'));
    const report = { startedUTC, implementationSHA256: await digest(root, ['config.js', ...(await readdir(join(root, 'src')))
        .filter(f => f.endsWith('.js')).map(f => 'src/' + f)]),
        harnessSHA256: await digest(here, ['run.mjs', 'chunking.mjs', 'corpora.mjs', 'encoder.mjs', suite + '.mjs']),
        node: process.version, platform: process.platform + '-' + process.arch, libraries,
        embedding: { provider: 'OpenAI', model, dimensions: dimension, encoding: encodingName, maxInputTokens: modelInputTokens },
        artifactsSHA256: Object.fromEntries(tasks.map(task => [assets[task].name, assets[task].checksum])),
        ...(rag ? { contextBudgets: budgets, rankers: { dense: 'cosine with ' + model, bm25: { k1: 1.2, b: 0.75 } },
            plans: { ...plans, [windowName]: windowPlan }, tasks: {} } : { contextTokens: 256, plans }) };
    const maxNewTokens = options['new-tokens'] === undefined ? Infinity : Number(options['new-tokens']);
    if (maxNewTokens !== Infinity && (!Number.isSafeInteger(maxNewTokens) || maxNewTokens < 0)) throw new Error('Invalid new-token budget.');
    const encoder = openEncoder(options['env-file'], undefined, 1, maxNewTokens);
    try {
        for (const task of tasks) {
            console.log('Running', task);
            if (rag) report.tasks[task] = await evaluateRag(task, chunkText, encoder, plans);
            else report[task] = await evaluateQuality(task, chunkText, encoder, plans);
        }
    } finally { await encoder.close(); }
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log('Saved', output);
}
await main();
