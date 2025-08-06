// #region Processor
import * as fse from 'fs-extra';
import notionRehype from 'notion-rehype-k';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import {} from 'vfile';
import { toc as rehypeToc } from '@jsdevtools/rehype-toc';
import { isFullBlock, iteratePaginatedAPI } from '@notionhq/client';
import { dim } from 'kleur/colors';
import { fileToUrl } from './format.js';
import { saveImageFromAWS, transformImagePathForCover } from './image.js';
import { rehypeImages } from './rehype/rehype-images.js';
const baseProcessor = unified()
    .use(notionRehype, {}) // Parse Notion blocks to rehype AST
    .use(rehypeSlug)
    .use(
// @ts-ignore
rehypeKatex) // Then you can use any rehype plugins to enrich the AST
    .use(rehypeStringify); // Turn AST to HTML string
export function buildProcessor(rehypePlugins) {
    let headings = [];
    const processorWithToc = baseProcessor().use(rehypeToc, {
        customizeTOC(toc) {
            headings = extractTocHeadings(toc);
            return false;
        },
    });
    const processorPromise = rehypePlugins.then((plugins) => {
        let processor = processorWithToc;
        for (const [plugin, options] of plugins) {
            processor = processor.use(plugin, options);
        }
        return processor;
    });
    return async function process(blocks, imagePaths) {
        const processor = await processorPromise.then((p) => p().use(rehypeImages(), { imagePaths }));
        const vFile = (await processor.process({ data: blocks }));
        return { vFile, headings };
    };
}
// #endregion
async function awaitAll(iterable) {
    const result = [];
    for await (const item of iterable) {
        result.push(item);
    }
    return result;
}
/**
 * Return a generator that yields all blocks in a Notion page, recursively.
 * @param blockId ID of block to get children for.
 * @param fetchImage Function that fetches an image and returns a local path.
 */
async function* listBlocks(client, blockId, fetchImage) {
    for await (const block of iteratePaginatedAPI(client.blocks.children.list, {
        block_id: blockId,
    })) {
        if (!isFullBlock(block)) {
            continue;
        }
        if (block.has_children) {
            const children = await awaitAll(listBlocks(client, block.id, fetchImage));
            // @ts-ignore -- TODO: Make TypeScript happy here
            block[block.type].children = children;
        }
        // Specialized handling for image blocks
        if (block.type === 'image') {
            // Fetch remote image and store it locally
            const url = await fetchImage(block.image);
            // notion-rehype-k incorrectly expects "file" to be a string instead of an object
            yield {
                ...block,
                image: {
                    type: block.image.type,
                    [block.image.type]: url,
                    caption: block.image.caption,
                },
            };
        }
        else {
            yield block;
        }
    }
}
function extractTocHeadings(toc) {
    if (toc.tagName !== 'nav') {
        throw new Error(`Expected nav, got ${toc.tagName}`);
    }
    function listElementToTree(ol, depth) {
        return ol.children.flatMap((li) => {
            const [_link, subList] = li.children;
            const link = _link;
            const currentHeading = {
                depth,
                text: link.children[0].value,
                slug: link.properties.href.slice(1),
            };
            let headings = [currentHeading];
            if (subList) {
                headings = headings.concat(listElementToTree(subList, depth + 1));
            }
            return headings;
        });
    }
    return listElementToTree(toc.children[0], 0);
}
export class NotionPageRenderer {
    client;
    page;
    imageSavePath;
    #imagePaths = [];
    #imageAnalytics = {
        download: 0,
        cached: 0,
    };
    #logger;
    /**
     * @param client Notion API client.
     * @param page Notion page object including page ID and properties. Does not include blocks.
     * @param parentLogger Logger to use for logging messages.
     */
    constructor(client, page, imageSavePath, logger) {
        this.client = client;
        this.page = page;
        this.imageSavePath = imageSavePath;
        this.#logger = logger.fork(`${logger.label}/render`);
    }
    /**
     * Return page properties for Astro to use.
     */
    async getPageData(transformCoverImage = false, rootAlias = 'src') {
        const { page } = this;
        let cover = page.cover;
        // transform cover image file
        if (cover && transformCoverImage && cover.type === 'file') {
            const transformedUrl = `${rootAlias}/${transformImagePathForCover(await this.#fetchImage(cover))}`;
            cover = {
                ...cover,
                file: {
                    ...cover.file,
                    url: transformedUrl,
                },
            };
        }
        return {
            id: page.id,
            data: {
                icon: page.icon,
                cover,
                archived: page.archived,
                in_trash: page.in_trash,
                url: page.url,
                public_url: page.public_url,
                properties: page.properties,
            },
        };
    }
    /**
     * Return rendered HTML for the page.
     * @param process Processor function to transform Notion blocks into HTML.
     * This is created once for all pages then shared.
     */
    async render(process) {
        this.#logger.debug('Rendering page');
        try {
            const blocks = await awaitAll(listBlocks(this.client, this.page.id, this.#fetchImage));
            if (this.#imageAnalytics.download > 0 || this.#imageAnalytics.cached > 0) {
                this.#logger.info([
                    `Found ${this.#imageAnalytics.download} images to download`,
                    this.#imageAnalytics.cached > 0 && dim(`${this.#imageAnalytics.cached} already cached`),
                ].join(' '));
            }
            const { vFile, headings } = await process(blocks, this.#imagePaths);
            this.#logger.debug('Rendered page');
            return {
                html: vFile.toString(),
                metadata: {
                    headings,
                    imagePaths: this.#imagePaths,
                },
            };
        }
        catch (error) {
            this.#logger.error(`Failed to render: ${getErrorMessage(error)}`);
            return undefined;
        }
    }
    /**
     * Helper function to convert remote Notion images into local images in Astro.
     * Additionally saves the path in `this.#imagePaths`.
     * @param imageFileObject Notion file object representing an image.
     * @returns Local path to the image, or undefined if the image could not be fetched.
     */
    #fetchImage = async (imageFileObject) => {
        try {
            // only file type will be processed
            if (imageFileObject.type === 'external') {
                return imageFileObject.external.url;
            }
            fse.ensureDirSync(this.imageSavePath);
            // 文件需要下载到本地的指定目录中
            const imageUrl = await saveImageFromAWS(imageFileObject.file.url, this.imageSavePath, {
                log: (message) => {
                    this.#logger.debug(message);
                },
                tag: (type) => {
                    this.#imageAnalytics[type]++;
                },
            });
            this.#imagePaths.push(imageUrl);
            return imageUrl;
        }
        catch (error) {
            this.#logger.error(`Failed to fetch image: ${getErrorMessage(error)}`);
            // Fall back to using the remote URL directly.
            return fileToUrl(imageFileObject);
        }
    };
}
function getErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    else if (typeof error === 'string') {
        return error;
    }
    else {
        return 'Unknown error';
    }
}
