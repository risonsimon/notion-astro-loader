import { Client, isFullPage, iteratePaginatedAPI } from '@notionhq/client';
import { dim } from 'kleur/colors';
import * as path from 'node:path';
import { propertiesSchemaForDatabase } from './database-properties.js';
import { VIRTUAL_CONTENT_ROOT } from './image.js';
import { buildProcessor, NotionPageRenderer } from './render.js';
import { notionPageSchema } from './schemas/page.js';
import * as transformedPropertySchema from './schemas/transformed-properties.js';
const DEFAULT_IMAGE_SAVE_PATH = 'assets/images/notion';
/**
 * Notion loader for the Astro Content Layer API.
 *
 * It allows you to load pages from a Notion database then render them as pages in a collection.
 *
 * @param options Takes in same options as `notionClient.databases.query` and `Client` constructor.
 *
 * @example
 * // src/content/config.ts
 * import { defineCollection } from "astro:content";
 * import { notionLoader } from "notion-astro-loader";
 *
 * const database = defineCollection({
 *   loader: notionLoader({
 *     auth: import.meta.env.NOTION_TOKEN,
 *     database_id: import.meta.env.NOTION_DATABASE_ID,
 *     filter: {
 *       property: "Hidden",
 *       checkbox: { equals: false },
 *     }
 *   }),
 * });
 */
export function notionLoader({ database_id, filter_properties, sorts, filter, archived, collectionName, imageSavePath = DEFAULT_IMAGE_SAVE_PATH, rehypePlugins = [], experimentalCacheImageInData = false, experimentalRootSourceAlias = 'src', ...clientOptions }) {
    const notionClient = new Client(clientOptions);
    const resolvedRehypePlugins = Promise.all(rehypePlugins.map(async (config) => {
        let plugin;
        let options;
        if (Array.isArray(config)) {
            [plugin, options] = config;
        }
        else {
            plugin = config;
        }
        if (typeof plugin === 'string') {
            plugin = (await import(/* @vite-ignore */ plugin)).default;
        }
        return [plugin, options];
    }));
    const processor = buildProcessor(resolvedRehypePlugins);
    return {
        name: collectionName ? `notion-loader/${collectionName}` : 'notion-loader',
        schema: async () => notionPageSchema({
            properties: await propertiesSchemaForDatabase(notionClient, database_id),
        }),
        async load(ctx) {
            const { store, logger: log_db, parseData } = ctx;
            const existingPageIds = new Set(store.keys());
            const renderPromises = [];
            log_db.info(`Loading database ${dim(`found ${existingPageIds.size} pages in store`)}`);
            const pages = iteratePaginatedAPI(notionClient.databases.query, {
                database_id,
                filter_properties,
                sorts,
                filter,
                archived,
            });
            let pageCount = 0;
            for await (const page of pages) {
                if (!isFullPage(page)) {
                    continue;
                }
                pageCount++;
                const log_pg = log_db.fork(`${log_db.label}/${page.id.slice(0, 6)}`);
                // Create metadata for logging
                const titleProp = Object.entries(page.properties).find(([_, property]) => property.type === 'title');
                const pageTitle = transformedPropertySchema.title.safeParse(titleProp ? titleProp[1] : {});
                const pageMetadata = [
                    `${pageTitle.success ? '"' + pageTitle.data + '"' : 'Untitled'}`,
                    `(last edited ${page.last_edited_time.slice(0, 10)})`,
                ].join(' ');
                const isCached = existingPageIds.delete(page.id);
                const existingPage = store.get(page.id);
                // If the page has been updated, re-render it
                if (existingPage?.digest !== page.last_edited_time) {
                    const realSavePath = path.resolve(process.cwd(), 'public', 'images', 'notion');
                    const renderer = new NotionPageRenderer(notionClient, page, realSavePath, log_pg);
                    const data = await parseData(await renderer.getPageData(experimentalCacheImageInData, experimentalRootSourceAlias));
                    const renderPromise = renderer.render(processor).then((rendered) => {
                        store.set({
                            id: page.id,
                            digest: page.last_edited_time,
                            data,
                            rendered,
                            filePath: `${VIRTUAL_CONTENT_ROOT}/${page.id}.md`, // 不重要，有就行
                            assetImports: rendered?.metadata.imagePaths,
                        });
                    });
                    renderPromises.push(renderPromise);
                    log_pg.info(`${isCached ? 'Updated' : 'Created'} page ${dim(pageMetadata)}`);
                }
                else {
                    log_pg.debug(`Skipped page ${dim(pageMetadata)}`);
                }
            }
            // Remove any pages that have been deleted
            for (const deletedPageId of existingPageIds) {
                const log_pg = log_db.fork(`${log_db.label}/${deletedPageId.slice(0, 6)}`);
                store.delete(deletedPageId);
                log_pg.info(`Deleted page`);
            }
            log_db.info(`Loaded database ${dim(`fetched ${pageCount} pages from API`)}`);
            if (renderPromises.length === 0) {
                return;
            }
            // Wait for rendering to complete
            log_db.info(`Rendering ${renderPromises.length} updated pages`);
            await Promise.all(renderPromises);
            log_db.info(`Rendered ${renderPromises.length} pages`);
        },
    };
}
