import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readDocument(root, name) {
  try {
    return await readFile(join(root, name), "utf8");
  } catch {
    return null;
  }
}
