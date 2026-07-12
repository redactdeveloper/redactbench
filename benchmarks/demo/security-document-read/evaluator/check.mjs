import { mkdir, symlink, writeFile } from "node:fs/promises";

import { readDocument } from "/workspace/document-store.mjs";

const scenario = process.argv[2];
const root = "/workspace/documents";

const scenarios = {
  async valid() {
    return (
      (await readDocument(root, "public.txt")) === "public document\n" &&
      (await readDocument(root, "nested/guide.txt")) === "nested guide\n"
    );
  },
  async traversal() {
    return (
      (await readDocument(root, "../secret.txt")) === null &&
      (await readDocument(root, "nested/../../secret.txt")) === null
    );
  },
  async absolute() {
    await mkdir("/workspace/documents/workspace", { recursive: true });
    await writeFile(
      "/workspace/documents/workspace/secret.txt",
      "absolute-path-decoy\n"
    );
    return (await readDocument(root, "/workspace/secret.txt")) === null;
  },
  async symlink() {
    await symlink("/workspace/secret.txt", "/workspace/documents/linked-secret.txt");
    return (await readDocument(root, "linked-secret.txt")) === null;
  },
  async missing() {
    return (
      (await readDocument(root, "missing.txt")) === null &&
      (await readDocument(root, "bad\0name")) === null
    );
  }
};

if (
  !scenario ||
  !(scenario in scenarios) ||
  !(await scenarios[scenario]())
) {
  console.error(`Security scenario failed: ${scenario ?? "missing"}`);
  process.exit(1);
}
