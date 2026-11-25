import { readFile } from 'node:fs/promises';
import { asset } from './corpora.mjs';

const docs = 'casai/6d93d977ec5dbe8e16630d35f5f1b1ca9999b22f/docs/matrix/articles/';
const files = [
    [docs + 'change-implementation-keep-workflow.md', '61fb136101fa2589d40d6666bf3fe84eb5f5b2d90a172fcf0f23f8de1f22e7fe'],
    [docs + 'draft-review-revise.md', '41b8d96879a44168fe83c978e7d061aff77fbba3b2eac4580bdabd2ac564f0e6'],
    [docs + 'retrieval-to-grounded-answers.md', '8ffa95bc1be6d20eb72e4f9c6188ce5dd3166d632b45ce33d02e4844fd90f7cb'],
    ['casai-examples/4b4e083d2962e5c517239b05ac5be7aeefc1acf6/package-lock.json', '88eb68bbe9fdffa4ae562a790aab64f79a9e46a2df5d2383802aad5461da7e79']
];
const inputs = await Promise.all(files.map(async ([path, checksum]) => readFile(await asset({
    name: 'json-fields-' + path.split('/').at(-1), url: 'https://raw.githubusercontent.com/geleto/' + path, checksum
}), 'utf8')));
const packages = JSON.parse(inputs.pop()).packages;
export const records = inputs.map(body => ({ title: body.split('\n')[0].slice(2).trim(), body }));
export const queries = [
    [0, 'Which fields must a support ticket supply?', 'a subject and a message'],
    [0, 'What makes the classifier replaceable when creating a workflow?', 'a new workflow with a different `classify`'],
    [0, 'What parses structured responses for the model-based classifier?', "`Output.object` parses the model's structured output"],
    [0, 'What must ticket routing components agree on when streaming?', 'finish and report errors in a compatible way'],
    [1, 'What does the draft reviewer give the revision generator?', 'a score and a list of suggestions'],
    [1, 'How can I accept a satisfactory initial draft immediately?', 'minRevisions: 0'],
    [1, 'Which bound wins if a revision minimum exceeds the maximum?', 'The maximum always wins'],
    [1, 'Why is it safe to reuse the revision workflow between requests?', 'Each call has its own input, draft and revision count'],
    [2, 'Which retrieval step can start while a query vector is being computed?', 'the keyword search can run'],
    [2, 'What happens when both retrieval methods return no documents?', 'without calling the reranker or the answer model'],
    [2, 'How should I choose an embedding model for building and querying the index?', 'the same embedding model you use for questions'],
    [2, 'How many combined passages are sent for reranking?', 'at most twenty candidates']
];
export const proseCount = queries.length;
const digests = new Set();
for (const path of Object.keys(packages).sort()) {
    const { integrity } = packages[path];
    if (!integrity?.startsWith('sha512-') || digests.has(integrity)) continue;
    const name = path.replace(/^node_modules\//, '');
    queries.push([records.length, integrity, name, integrity]);
    records.push({ package: name, integrity });
    digests.add(integrity);
    if (digests.size === 32) break;
}
