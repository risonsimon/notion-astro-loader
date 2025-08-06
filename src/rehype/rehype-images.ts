import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';

interface Config {
  imagePaths?: string[];
}

export function rehypeImages() {
  return ({ imagePaths }: Config) =>
    function (tree: any, file: VFile) {
      const imageOccurrenceMap = new Map();

      visit(tree, (node) => {
        if (node.type !== 'element') return;
        if (node.tagName !== 'img') return;

        if (node.properties?.src) {
          node.properties.src = decodeURI(node.properties.src);
          if (file.data.astro) {
            file.data.astro.imagePaths = imagePaths;
          }

          if (imagePaths?.includes(node.properties.src)) {
            const { ...props } = node.properties;

            // Initialize or increment occurrence count for this image
            const index = imageOccurrenceMap.get(node.properties.src) || 0;
            imageOccurrenceMap.set(node.properties.src, index + 1);

            // Convert the relative path from the loader to a public URL
            // The image path comes in as something like "folder/file.png" from the public directory
            // We convert this to "/images/notion/folder/file.png" for the public URL
            const srcPath = `/images/notion/${props.src}`;

            // Use a regular img tag instead of Astro Image component for public assets
            node.properties.src = srcPath;
            if (props.alt) {
              node.properties.alt = props.alt;
            }
            // Remove other properties but keep src and alt
            Object.keys(props).forEach((prop) => {
              if (prop !== 'alt') {
                delete node.properties[prop];
              }
            });
          }
        }
      });
    };
}
