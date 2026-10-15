import readFileAsText from "./readFileAsText";

export type CertContentResult = 0 | 1 | 2;

const PEM_PATTERN =
    /^-----BEGIN ([A-Z0-9 ]+PRIVATE KEY)-----\n([\s\S]*?)\n-----END \1-----\s*$/;
const OPENSSH_MAGIC = "openssh-key-v1\0";

function normalizeKeyText(value: string): string {
    return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
}

function decodeBase64(value: string): Uint8Array | undefined {
    const normalized = value.replace(/\s/g, "");
    if (
        !normalized ||
        normalized.length % 4 === 1 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
    ) {
        return undefined;
    }
    try {
        const decoded = atob(normalized);
        return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    } catch {
        return undefined;
    }
}

function parseOpenSshKey(value: string): CertContentResult {
    const bytes = decodeBase64(value);
    if (!bytes) return 0;
    const magic = new TextDecoder().decode(bytes.slice(0, OPENSSH_MAGIC.length));
    if (magic !== OPENSSH_MAGIC) return 0;

    let offset = OPENSSH_MAGIC.length;
    const readString = (): string | undefined => {
        if (offset + 4 > bytes.length) return undefined;
        const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
        offset += 4;
        if (offset + length > bytes.length) return undefined;
        const result = new TextDecoder().decode(bytes.slice(offset, offset + length));
        offset += length;
        return result;
    };

    const cipherName = readString();
    const kdfName = readString();
    const kdfOptions = readString();
    if (
        cipherName === undefined ||
        kdfName === undefined ||
        kdfOptions === undefined ||
        offset + 4 > bytes.length
    ) {
        return 0;
    }
    const keyCount = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    if (keyCount === 0) return 0;
    return cipherName === "none" && kdfName === "none" ? 1 : 2;
}

function parsePemKey(value: string): CertContentResult {
    const match = value.match(PEM_PATTERN);
    if (!match) return 0;
    const label = match[1];
    const body = match[2];
    if (
        ![
            "RSA PRIVATE KEY",
            "DSA PRIVATE KEY",
            "EC PRIVATE KEY",
            "PRIVATE KEY",
            "ENCRYPTED PRIVATE KEY",
            "OPENSSH PRIVATE KEY",
        ].includes(label)
    ) {
        return 0;
    }
    if (label === "OPENSSH PRIVATE KEY") return parseOpenSshKey(body);
    if (label === "ENCRYPTED PRIVATE KEY") return decodeBase64(body) ? 2 : 0;

    const lines = body.split("\n");
    const separator = lines.findIndex((line) => line.trim() === "");
    const headerLines = separator === -1 ? [] : lines.slice(0, separator);
    const payloadLines = separator === -1 ? lines : lines.slice(separator + 1);
    if (headerLines.some((line) => !/^(Proc-Type|DEK-Info):\s*.+$/.test(line.trim()))) return 0;
    if (!decodeBase64(payloadLines.join(""))) return 0;
    const encrypted = headerLines.some((line) =>
        /^(Proc-Type:\s*4,\s*ENCRYPTED|DEK-Info:)/i.test(line.trim()),
    );
    return encrypted ? 2 : 1;
}

function parsePuttyKey(value: string): CertContentResult {
    if (!/^PuTTY-User-Key-File-\d+:\s*.+$/m.test(value)) return 0;
    const encryption = value.match(/^Encryption:\s*(.+)$/m)?.[1].trim();
    if (!encryption) return 0;
    return encryption.toLowerCase() === "none" ? 1 : 2;
}

/** Returns 0 for invalid, 1 for unencrypted, and 2 for encrypted keys. */
export function validateCertContent(fileContent: string): CertContentResult {
    if (typeof fileContent !== "string") return 0;
    const normalized = normalizeKeyText(fileContent);
    if (!normalized) return 0;
    return normalized.includes("PuTTY-User-Key-File-")
        ? parsePuttyKey(normalized)
        : parsePemKey(normalized);
}

export async function validateCertFile(file: File): Promise<CertContentResult> {
    try {
        return validateCertContent(await readFileAsText(file));
    } catch (_err) {
        return 0;
    }
}
