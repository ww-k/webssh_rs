import { expect, test } from "@rstest/core";

import { joinFileUri } from "./file_uri";

test("[file_uri] joinFileUri joins root sftp uri without duplicated slash", () => {
    expect(joinFileUri("sftp:1:/", "Users")).toBe("sftp:1:/Users");
});

test("[file_uri] joinFileUri joins nested sftp uri", () => {
    expect(joinFileUri("sftp:1:/Users", "kevin")).toBe("sftp:1:/Users/kevin");
});
