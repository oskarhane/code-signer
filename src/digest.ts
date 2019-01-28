// @ts-ignore
import folderHash from './folder-hash';

const hashAlg = 'sha512';

export const digestDirectory = async (path: string, excludeFiles: string[]): Promise<string> => {
    // @ts-ignore
    const result = await folderHash.hashElement(path, {
        algo: hashAlg,
        files: {exclude: [...excludeFiles]},
        folders: {ignoreRootName: true}
    });
    return Promise.resolve(result.hash);
};
