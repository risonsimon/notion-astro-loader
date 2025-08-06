import type { RehypePlugins } from 'astro';
import type { Loader } from 'astro/loaders';
import type { ClientOptions, QueryDatabaseParameters } from './types.js';
export interface NotionLoaderOptions extends Pick<ClientOptions, 'auth' | 'timeoutMs' | 'baseUrl' | 'notionVersion' | 'fetch' | 'agent'>, Pick<QueryDatabaseParameters, 'database_id' | 'filter_properties' | 'sorts' | 'filter' | 'archived'> {
    /**
     * Pass rehype plugins to customize how the Notion output HTML is processed.
     * You can import and apply the plugin function (recommended), or pass the plugin name as a string.
     */
    rehypePlugins?: RehypePlugins;
    /**
     * The name of the collection, only used for logging and debugging purposes.
     * Useful for multiple loaders to differentiate their logs.
     */
    collectionName?: string;
    /**
     * The path to save the images.
     * Defaults to 'public'.
     */
    publicPath?: string;
    /**
     * MUST STORED IN `src` TO BE PROCESSED PROPERLY
     * The path to save the images relative to `src`.
     * Defaults to 'assets/images/notion'.
     */
    imageSavePath?: string;
    /**
     * Whether to cache images in the data.
     * Defaults to `false`.
     */
    experimentalCacheImageInData?: boolean;
    /**
     * The root alias for the images.
     * Defaults to `src`.
     */
    experimentalRootSourceAlias?: string;
}
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
export declare function notionLoader({ database_id, filter_properties, sorts, filter, archived, collectionName, imageSavePath, rehypePlugins, experimentalCacheImageInData, experimentalRootSourceAlias, ...clientOptions }: NotionLoaderOptions): Loader;
//# sourceMappingURL=loader.d.ts.map