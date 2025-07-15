/** biome-ignore-all lint/suspicious/noExplicitAny: false */
export default class DragFilesReader {
    filedrag_u: File[] = [];
    dir_inflight = 0;
    filedrag_paths = Object.create(null);
    debug = false;

    _resolve?: any;
    _reject?: any;

    read(e: DragEvent): Promise<File[]> {
        return new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
            // @ts-ignore
            const items = e.dataTransfer.items;
            for (let i = 0; i < items.length; i++) {
                const item = items[i].webkitGetAsEntry();
                if (item) {
                    this.traverseFileTree(
                        item,
                        '',
                        // @ts-ignore
                        item.isFile && items[i].getAsFile(),
                    );
                }
            }
        });
    }

    traverseFileTree(
        item1: FileSystemEntry,
        path1: string,
        symlink?: File | false,
    ) {
        const path = path1 || '';

        if (item1.isFile) {
            const item = item1 as FileSystemFileEntry;
            this.dir_inflight++;
            this.getFile(item)
                .then((file) => this.pushFile(file, path))
                .catch((error) => {
                    if (this.debug) {
                        const fn = symlink ? 'debug' : 'warn';

                        console[fn](
                            'Failed to get File from FileEntry for "%s", %s',
                            item.name,
                            Object(error).name,
                            error,
                            item,
                        );
                    }
                    this.pushFile(symlink as File, path);
                });
        } else if (item1.isDirectory) {
            const item = item1 as FileSystemDirectoryEntry;
            const newPath = `${path + item.name}/`;
            this.filedrag_paths[newPath] = 0;
            this.dir_inflight++;
            const dirReader = item.createReader();
            const dirReaderIterator = () => {
                dirReader.readEntries(
                    (entries) => {
                        if (entries.length) {
                            let i = entries.length;
                            while (i--) {
                                this.traverseFileTree(entries[i], newPath);
                            }
                            this.filedrag_paths[newPath] += entries.length;

                            dirReaderIterator();
                        } else {
                            this.pushUpload();
                        }
                    },
                    (error) => {
                        console.warn(
                            'Unable to traverse folder "%s", %s',
                            item.name,
                            Object(error).name,
                            error,
                            item,
                        );

                        this.pushUpload();
                    },
                );
            };
            dirReaderIterator();
        }
    }

    getFile(entry: FileSystemFileEntry) {
        return new Promise<File>((resolve, reject) => {
            entry.file(resolve, reject);
        });
    }

    pushFile(file: File, path: string) {
        if (this.debug) {
            console.warn('Adding file %s', file.name, file);
        }
        if (file) {
            if (path) {
                // 新增 _relativePath 属性
                // @ts-ignore
                file._relativePath = path + file.name;
            }
            this.filedrag_u.push(file);
        }
        this.pushUpload();
    }

    pushUpload() {
        if (!--this.dir_inflight) {
            // var emptyFolders = Object.keys(this.filedrag_paths)
            //     .filter((p) => this.filedrag_paths[p] < 1);

            if (this._resolve) {
                this._resolve(this.filedrag_u);
            }
        }
    }
}
