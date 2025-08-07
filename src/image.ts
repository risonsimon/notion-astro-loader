import fse from 'fs-extra';
import path from 'node:path';

import { dim } from 'kleur/colors';

export interface SaveOptions {
  ignoreCache?: boolean;
  log?: (message: string) => void;
  tag?: (type: 'download' | 'cached') => void;
}

export const VIRTUAL_CONTENT_ROOT = 'src/content/notion';

/**
 * Downloads and saves an image from an AWS URL to a local directory.
 *
 * @param url The AWS URL of the image to download.
 * @param dir The directory path where the image will be saved.
 * @param options Optional configuration for saving the image.
 * @param options.ignoreCache Whether to ignore cached images and download again. Defaults to false.
 * @param options.log Optional logging function to record the operation.
 * @param options.tag Optional tagging function to mark the operation as 'download' or 'cached'.
 *
 * @returns The relative path of the saved image from the project's virtual content root.
 *
 * @throws {Error} If the provided `url` is invalid.
 *
 * @example
 * For the following AWS URL:
 * https://prod-files-secure.s3.us-west-2.amazonaws.com/ed3b245b-dd96-4e0d-a399-9a99a0cf37c0/d16195b7-f998-4b7c-8d2e-38b9c47be295/image.png?...
 *
 * The function parses the URL into:
 * - Parent ID: ed3b245b-dd96-4e0d-a399-9a99a0cf37c0
 * - Object ID: d16195b7-f998-4b7c-8d2e-38b9c47be295
 * - File Name: image.png
 *
 * And saves it to:
 * ./src/{dir}/ed3b245b-dd96-4e0d-a399-9a99a0cf37c0/d16195b7-f998-4b7c-8d2e-38b9c47be295.png
 */
export async function saveImageFromAWS(url: string, dir: string, options: SaveOptions = {}) {
  const { ignoreCache, log, tag } = options;

  if (!fse.existsSync(dir)) {
    throw new Error(`Directory ${dir} does not exist`);
  }

  // Validate and parse the URL
  const [parentId, objId, fileName] = new URL(url).pathname.split('/').filter(Boolean); // Remove empty strings

  if (!fileName || !parentId || !objId) {
    throw new Error('Invalid URL');
  }

  // Path to parent directory of the image
  // ./src/{dir}/{parentId}
  const saveDirPath = path.resolve(dir, parentId);
  fse.ensureDirSync(saveDirPath);

  const ext = fileName.split('.').at(-1);

  // Path to the image file
  // ./src/{dir}/{parentId}/{objId}.{ext}
  const filePath = path.resolve(saveDirPath, `${objId}.${ext}`);

  if (ignoreCache || !fse.existsSync(filePath)) {
    // If ignoreCache is true or the file doesn't exist, download it
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    await fse.writeFile(filePath, new Uint8Array(buffer));

    log?.(`Saved image \`${fileName}\` ${dim(`created \`${filePath}\``)}`);
    tag?.('download');
  } else {
    log?.(`Skipped caching image \`${fileName}\` ${dim(`cached at \`${filePath}\``)}`);
    tag?.('cached');
  }

  // Return the path relative to public directory for use in URLs
  // This will be something like "edeb0bcc-9c82-4a04-b1cf-d3ce5e635950/79398d7e-30e3-4ee0-b610-392d2922cb07.png"
  return `${parentId}/${objId}.${ext}`;
}

/**
 * Transforms a raw image path into a relative path from the 'src' directory.
 */
export function transformImagePathForCover(rawPath: string): string {
  // get abs path from relative path to VIRTUAL_CONTENT_ROOT
  const absPath = path.resolve(process.cwd(), VIRTUAL_CONTENT_ROOT, rawPath);
  return path.relative(path.resolve(process.cwd(), 'src'), absPath);
}
