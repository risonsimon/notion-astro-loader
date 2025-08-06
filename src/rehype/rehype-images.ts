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

            // Convert the relative path to use Astro's Image component
            // The image path comes in as something like "../../assets/images/notion/folder/file.png"
            // We convert this to "~/assets/images/notion/folder/file.png" for Astro asset processing
            const pathParts = props.src.split('/');
            const notionIndex = pathParts.indexOf('notion');
            const relativePath = pathParts.slice(notionIndex + 1).join('/');
            const srcPath = `~/assets/images/notion/${relativePath}`;

            // Use Astro's Image component for optimization
            node.properties['__ASTRO_IMAGE__'] = JSON.stringify({ 
              ...props, 
              src: srcPath,
              index 
            });

            // Remove original properties so Astro Image component takes over
            Object.keys(props).forEach((prop) => {
              delete node.properties[prop];
            });
          }
        }
      });
    };
}
