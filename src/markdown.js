import * as mdast from 'mdast-util-from-markdown';
import * as gfmMdast from 'mdast-util-gfm';
import * as frontmatterMdast from 'mdast-util-frontmatter';
import * as gfmSyntax from 'micromark-extension-gfm';
import * as frontmatterSyntax from 'micromark-extension-frontmatter';
import { createMarkdownParser } from './markdown-units.js';

export { markdownResult, markdownText } from './markdown-units.js';
export const { parseMarkdown, markdownGrammar } = createMarkdownParser(mdast, gfmMdast, frontmatterMdast, gfmSyntax, frontmatterSyntax);
