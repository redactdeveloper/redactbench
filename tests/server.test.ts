import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { serveReport } from "../src/server.js";

describe("report server", () => {
  it("serves only the report directory with strict security headers", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-server-"));
    const report = join(root, "report");
    await mkdir(report);
    await writeFile(join(report, "index.html"), "<!doctype html><title>Report</title>");
    await writeFile(join(root, "secret.txt"), "must not be served");
    await symlink(join(root, "secret.txt"), join(report, "leak.txt"));
    const served = await serveReport(report, 0);

    try {
      const response = await fetch(served.url);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Report");
      expect(response.headers.get("content-security-policy")).toContain(
        "default-src 'self'"
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");

      const traversal = await fetch(`${served.url}/..%2Fsecret.txt`);
      expect(traversal.status).toBe(404);
      expect(await traversal.text()).not.toContain("must not be served");

      const symlinkEscape = await fetch(`${served.url}/leak.txt`);
      expect(symlinkEscape.status).toBe(404);
      expect(await symlinkEscape.text()).not.toContain("must not be served");

      const method = await fetch(served.url, { method: "POST" });
      expect(method.status).toBe(405);
    } finally {
      await new Promise<void>((resolveClose, reject) => {
        served.server.close((error) => {
          if (error) reject(error);
          else resolveClose();
        });
      });
    }
  });
});
