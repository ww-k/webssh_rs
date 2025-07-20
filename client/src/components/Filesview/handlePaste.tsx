import { postSftpRename } from "@/api";
import { parseSftpUri } from "@/helpers/file_uri";

import renderBatchTaskProgressModal from "../BatchTaskProgressModal/render";

import type { IFile } from "@/types";
import type { IFileListCopyEvent } from "../Filelist/types";

export default async function handlePaste(
    copyData: IFileListCopyEvent,
    pasteTarget: string,
) {
    // TODO: copy from localhost, paste to target, upload files
    // TODO: copy from target, paste to localhost, download files
    // TODO: copy from target a, paste to target b, cross target transfer
    const copyUri = parseSftpUri(copyData.fileUri);
    const pasteUri = parseSftpUri(pasteTarget);
    if (!copyUri || !pasteUri) throw new Error("copyUri or pasteUri is null");
    if (copyUri.targetId !== pasteUri.targetId)
        throw new Error("targetId is not equal");

    switch (true) {
        case copyData.type === "copy" && copyUri.path === pasteUri.path:
            //TODO: same directory, copy a new file name
            return;
        case copyData.type === "copy" && copyUri.path !== pasteUri.path:
            //TODO: copy to another directory
            return;
        case copyData.type === "cut" && copyUri.path !== pasteUri.path: {
            if (copyData.files.length === 1) {
                await postSftpRename(
                    copyData.files[0].uri,
                    `${pasteUri.path}/${copyData.files[0].name}`,
                );
            } else {
                await renderBatchTaskProgressModal<IFile>({
                    data: copyData.files,
                    action: (file) =>
                        postSftpRename(
                            file.uri,
                            `${pasteUri.path}/${file.name}`,
                        ),
                    failsRender: () => {
                        return "批量操作失败";
                    },
                });
            }
            return;
        }
        case copyData.type === "cut" && copyUri.path === pasteUri.path:
            // ignore
            return;
        default:
            throw new Error(`unsupported operation ${copyData.type}`);
    }
}
