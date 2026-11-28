import { readStructuredUnits } from './structured-units.js';
export { structuredResult as markdownResult, structuredText as markdownText } from './structured-units.js';

function missingMarkdownParser(error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && /package '(?:mdast-util|micromark-extension)-/.test(error.message)) {
        throw new Error('Markdown input requires the optional Markdown parsers. Run npm install --include=optional.', { cause: error });
    }
    throw error;
}

let parser;

// Guard each optional import so a bundler can also build a plain-text-only install.
export async function loadMarkdownParser() {
    if (parser) return parser;
    const modules = await Promise.all([
        import('mdast-util-from-markdown').catch(missingMarkdownParser),
        import('mdast-util-gfm').catch(missingMarkdownParser),
        import('mdast-util-frontmatter').catch(missingMarkdownParser),
        import('micromark-extension-gfm').catch(missingMarkdownParser),
        import('micromark-extension-frontmatter').catch(missingMarkdownParser)
    ]);
    return parser ??= createMarkdownParser(...modules);
}

export async function parseMarkdownDocument(source) {
    return (await loadMarkdownParser()).document(source);
}

export function createMarkdownParser({ fromMarkdown }, { gfmFromMarkdown }, { frontmatterFromMarkdown }, { gfm }, { frontmatter }) {
    const markdownGrammar = {
        extensions: [gfm(), frontmatter(['yaml'])],
        mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml'])]
    };
    const parse = source => fromMarkdown(source, markdownGrammar);
    function document(source) {
        const root = parse(source);
        // micromark consumes a leading BOM before assigning positions.
        const bom = Number(source.startsWith('\uFEFF'));
        return {source,units:options=>readStructuredUnits(source,options,root,false,bom),
            tree:options=>readStructuredUnits(source,options,root,true,bom)};
    }
    return {
        markdownGrammar, document,
        parseMarkdown: (source, options) => document(source).units(options),
        parseMarkdownTree: (source, options) => document(source).tree(options)
    };
}
