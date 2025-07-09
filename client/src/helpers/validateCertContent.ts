import readFileAsText from "./readFileAsText";

/**
 * 校验证书文件内容
 * @return {0|1|2} 证书不合法返回0, 证书合法且不需要密码返回1, 证书合法且需要密码返回2
 */
export function validateCertContent(fileContent: string): 0 | 1 | 2 {
    const sshKeyReg =
        /^-----BEGIN (?:RSA|DSA) PRIVATE KEY-----\r?\n((?:.*\r?\n)+)-----END (?:RSA|DSA) PRIVATE KEY-----\r?\n?$/;
    const openSshKeyReg =
        /^-----BEGIN OPENSSH PRIVATE KEY-----\r?\n((?:.*\r?\n)+)-----END OPENSSH PRIVATE KEY-----\r?\n?$/;
    let result = fileContent.match(sshKeyReg);
    if (result) {
        if (result[1].indexOf("ENCRYPTED") !== -1) {
            return 2;
        }
        return 1;
    }
    result = fileContent.match(openSshKeyReg);
    if (result?.[1]) {
        const item = atob(result[1].split('\n')[0]);
        if (item.indexOf('bcrypt') !== -1) {
            return 2;
        }
        return 1;
    }
    // putty key
    // if (/^PuTTY-User-Key-File/.test(fileContent)) {
    //     if (fileContent.indexOf('Encryption: none') === -1) {
    //         return 2;
    //     }
    //     return 1;
    // }
    return 0;
}

export async function validateCertFile(file: File): Promise<0 | 1 | 2> {
    try {
        const fileContent = await readFileAsText(file);
        return validateCertContent(fileContent);
    } catch (_err) {
        return 0;
    }
}
