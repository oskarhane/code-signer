import * as crypto from 'crypto'
import * as debug  from 'debug'
import * as minimatch from 'minimatch'
import * as path from 'path';
const asyncPool = require("tiny-async-pool");

const defaultOptions = {
    algo: 'sha1',       // see crypto.getHashes() for options
    encoding: 'base64', // 'base64', 'hex' or 'binary'
    files: {
        exclude: [],
        include: [],
        matchBasename: true,
        matchPath: false,
        ignoreRootName: false
    },
    folders: {
        exclude: [],
        include: [],
        matchBasename: true,
        matchPath: false,
        ignoreRootName: false
    }
};

// Use the environment variable DEBUG to log output, e.g. `set DEBUG=fhash:*`
const log = {
    match: debug('fhash:match'),
    params: (params: any) => {
        debug('fhash:parameters')(params);
        return params;
    }
};

function prep(fs: any, Promise: any) {
    function hashElement(name: string, dir: any, options: any, callback: any) {
        callback = arguments[arguments.length - 1];

        return parseParameters(arguments)
            .then(({ basename, dir, options }) => {
                // this is only used for the root level
                options.skipMatching = true;
                return hashElementPromise(basename, dir, options, true);
            })
            .then(result => {
                if (typeof callback === 'function') {
                    return callback(undefined, result);
                } else {
                    return result;
                }
            })
            .catch(reason => {
                if (typeof callback === 'function') {
                    return callback(reason);
                } else {
                    throw reason;
                }
            });
    }

    function hashElementPromise(basename: any, dirname: any, options: any, isRootElement = false) {
        return stat(path.join(dirname, basename)).then((stats: any) => {
            if (stats.isDirectory()) {
                return hashFolderPromise(basename, dirname, options, isRootElement);
            } else if (stats.isFile()) {
                return hashFilePromise(basename, dirname, options, isRootElement);
            } else {
                return {
                    name: basename,
                    hash: 'unknown element type'
                };
            }
        });
    }

    function stat(filepath: any) {
        return new Promise((resolve: any, reject: any) => {
            fs.stat(filepath, (err: any, stats: any) => {
                if (err) {
                    return reject(err);
                } else {
                    return resolve(stats);
                }
            });
        });
    }

    function hashFolderPromise(name: any, dir: any, options: any, isRootElement = false) {
        const folderPath = path.join(dir, name);

        if (options.skipMatching) {
            // this is currently only used for the root folder
            log.match(`skipped '${folderPath}'`);
            delete options.skipMatching;
        } else if (ignore(name, folderPath, options.folders)) {
            return undefined;
        }

        return readdir(folderPath).then((files: any) => {
            const children = files.map((child: any) => {
                return () => hashElementPromise(child, folderPath, options);
            });
            const timeout = (fn: any) => fn();
            return asyncPool(1000, children, timeout).then((results:any) => {
                // @ts-ignore
                const hash = new HashedFolder(name, results.filter(notUndefined), options, isRootElement);
                return hash;

            })
        });
    }

    function readdir(folderPath: any) {
        return new Promise((resolve: any, reject: any) => {
            fs.readdir(folderPath, (err: any, files: any) => {
                if (err) {
                    console.error(err);
                    return reject(err);
                } else {
                    return resolve(files);
                }
            });
        });
    }

    function hashFilePromise(name: any, dir: any, options: any, isRootElement = false) {
        const filePath = path.join(dir, name);

        if (options.skipMatching) {
            // this is currently only used for the root folder
            log.match(`skipped '${filePath}'`);
            delete options.skipMatching;
        } else if (ignore(name, filePath, options.files)) {
            return undefined;
        }

        return new Promise((resolve: any, reject: any) => {
            try {
                const hash = crypto.createHash(options.algo);
                if (isRootElement && options.files.ignoreRootName) {
                    log.match(`omitted name of ${filePath} from hash`)
                } else {
                    hash.write(name);
                }

                const f = fs.createReadStream(filePath);
                f.pipe(hash, { end: false });

                f.on('end', () => {
                    // @ts-ignore
                    const hashedFile = new HashedFile(name, hash, options.encoding);
                    return resolve(hashedFile);
                });
            } catch (ex) {
                return reject(ex);
            }
        });
    }

    function ignore(name: any, path: any, rules: any) {
        if (rules.exclude) {
            if (rules.matchBasename && rules.exclude.test(name)) {
                log.match(`exclude basename '${path}'`);
                return true;
            } else if (rules.matchPath && rules.exclude.test(path)) {
                log.match(`exclude path '${path}'`);
                return true;
            }
        } else if (rules.include) {
            if (rules.matchBasename && rules.include.test(name)) {
                log.match(`include basename '${path}'`);
                return false;
            } else if (rules.matchPath && rules.include.test(path)) {
                log.match(`include path '${path}'`);
                return false;
            } else {
                return true;
            }
        }

        log.match(`unmatched '${path}'`);
        return false;
    }

    const HashedFolder = function HashedFolder(name: any, children: any, options: any, isRootElement = false) {
        // @ts-ignore
        this.name = name;
        // @ts-ignore
        this.children = children;

        const hash = crypto.createHash(options.algo);
        if (isRootElement && options.folders.ignoreRootName) {
            log.match(`omitted name of folder ${name} from hash`)
        } else {
            hash.write(name);
        }
        children.forEach((child: any) => {
            if (child.hash) {
                hash.write(child.hash);
            }
        });
        // @ts-ignore
        this.hash = hash.digest(options.encoding);
    };

    HashedFolder.prototype.toString = function (padding = '') {
        const first = `${padding}{ name: '${this.name}', hash: '${this.hash},'\n`;
        padding += '  ';

        return `${first}${padding}children: ${this.childrenToString(padding)}}`;
    };

    HashedFolder.prototype.childrenToString = function (padding = '') {
        if (this.children.length === 0) {
            return '[]';
        } else {
            const nextPadding = padding + '  ';
            const children = this.children
                .map((child: any) => child.toString(nextPadding))
                .join('\n');
            return `[\n${children}\n${padding}]`;
        }
    };

    const HashedFile = function HashedFile(name: any, hash: any, encoding: any) {
        // @ts-ignore
        this.name = name;
        // @ts-ignore
        this.hash = hash.digest(encoding);
    };

    HashedFile.prototype.toString = function (padding = '') {
        return padding + '{ name: \'' + this.name + '\', hash: \'' + this.hash + '\' }';
    };

    return hashElement;
}

function parseParameters(args: any) {
    let basename = args[0],
        dir = args[1],
        options_ = args[2];

    if (!isString(basename)) {
        return Promise.reject(new TypeError('First argument must be a string'));
    }

    if (!isString(dir)) {
        dir = path.dirname(basename);
        basename = path.basename(basename);
        options_ = args[1];
    }

    // parse options (fallback default options)
    if (!isObject(options_)) options_ = {};
    const options = {
        algo: options_.algo || defaultOptions.algo,
        encoding: options_.encoding || defaultOptions.encoding,
        files: Object.assign({}, defaultOptions.files, options_.files),
        folders: Object.assign({}, defaultOptions.folders, options_.folders),
        // @ts-ignore
        match: Object.assign({}, defaultOptions.match, options_.match)
    };

    // transform match globs to Regex
    options.files.exclude = reduceGlobPatterns(options.files.exclude);
    options.files.include = reduceGlobPatterns(options.files.include);
    options.folders.exclude = reduceGlobPatterns(options.folders.exclude);
    options.folders.include = reduceGlobPatterns(options.folders.include);

    return Promise.resolve(log.params({ basename, dir, options }));
}

function isString(str: any) {
    return typeof str === 'string' || str instanceof String;
}

function isObject(obj: any) {
    return obj !== null && typeof obj === 'object';
}

function notUndefined(obj: any) {
    return typeof obj !== 'undefined';
}

function reduceGlobPatterns(globs: any) {
    if (!globs || !Array.isArray(globs) || globs.length === 0) {
        return undefined;
    } else {
        // combine globs into one single RegEx
        return new RegExp(globs.reduce((acc, exclude) => {
            return acc + '|' + minimatch.makeRe(exclude).source;
        }, '').substr(1));
    }
}

export default {
    hashElement: prep(require("graceful-fs"), Promise),
    // exposed for testing
    prep: prep,
    parseParameters: parseParameters
};
