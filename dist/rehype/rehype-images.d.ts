import type { VFile } from 'vfile';
interface Config {
    imagePaths?: string[];
}
export declare function rehypeImages(): ({ imagePaths }: Config) => (tree: any, file: VFile) => void;
export {};
//# sourceMappingURL=rehype-images.d.ts.map