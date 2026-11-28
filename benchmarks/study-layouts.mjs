// Historical experiments measure individual layouts and some use independent
// soft character and hard token budgets. Keep that protocol in the harness.
import {chunk} from '../src/index.js';
import {splitPassages} from '../src/passages.js';

function measurePassages(split,text,embed,options) {
    if (options===undefined && embed && typeof embed==='object' && !Array.isArray(embed)) {
        options=embed;
        embed=undefined;
    }
    if (options?.chunkingStrategy==='semantic-blocks') options={...options,chunkingStrategy:'semantic'};
    return split(text,embed,options);
}

export const studyPassages = measurePassages.bind(null,splitPassages);

// Comparisons can target an earlier checkout with the former public API.
export async function loadStudyPassages(entry) {
    const api=await import(entry);
    if (api.chunkText) return api.chunkText;
    const engine=await import(new URL('passages.js',entry));
    return measurePassages.bind(null,engine.splitPassages);
}

export async function studyLayout(text,options={}) {
    const {includeHierarchy, ...settings}=options;
    const strategy=settings.strategy==='semantic-blocks'?'semantic':settings.strategy;
    const doc=await chunk(text,{...settings,strategy});
    if (strategy==='semantic') doc.chunks=doc.chunks.filter(c=>c.layout==='semantic');
    // Frozen snapshot comparisons include the original metadata and reader.
    delete doc.strategy;
    for (const c of doc.chunks) {
        delete c.layout;
        if (!includeHierarchy) {delete c.nodeIds;delete c.parentId;}
    }
    return includeHierarchy?doc:doc.chunks;
}
