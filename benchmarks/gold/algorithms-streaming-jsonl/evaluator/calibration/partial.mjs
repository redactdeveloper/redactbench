import { Buffer } from "node:buffer";

export class JsonlDecoder {
  #finished = false;
  #maxLineBytes;
  #pending = "";

  constructor({ maxLineBytes = 65_536 } = {}) {
    this.#maxLineBytes = maxLineBytes;
  }

  #parse(line) {
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (Buffer.byteLength(normalized) > this.#maxLineBytes) throw new RangeError("maxLineBytes exceeded");
    return normalized.trim() === "" ? [] : [JSON.parse(normalized)];
  }

  push(chunk) {
    if (this.#finished) throw new Error("decoder is finished");
    this.#pending += Buffer.from(chunk).toString("utf8");
    const lines = this.#pending.split("\n");
    this.#pending = lines.pop() ?? "";
    if (Buffer.byteLength(this.#pending) > this.#maxLineBytes + 1) {
      throw new RangeError("maxLineBytes exceeded");
    }
    return lines.flatMap((line) => this.#parse(line));
  }

  finish() {
    if (this.#finished) throw new Error("decoder is finished");
    this.#finished = true;
    return this.#parse(this.#pending);
  }
}
