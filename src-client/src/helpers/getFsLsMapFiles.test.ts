import { expect, rs, test } from "@rstest/core";

import getFsLsMapFiles from "./getFsLsMapFiles";

rs.mock("@/api", () => ({
    getFsLs: async () => [
        {
            name: "example.txt",
            type: "f",
            size: 12,
            atime: 1_754_563_200,
            mtime: 1_754_566_861,
            permissions: "644",
        },
    ],
}));

test("maps local filesystem timestamps from seconds to milliseconds", async () => {
    const [file] = await getFsLsMapFiles("/tmp");

    expect(file.uri).toBe("/tmp/example.txt");
    expect(file.isDir).toBe(false);
    expect(file.atime).toBe(1_754_563_200_000);
    expect(file.mtime).toBe(1_754_566_861_000);
});
