import { Buffer } from "node:buffer";

export class JsonlDecoder {
  #finished = false;
  #maxLineBytes;

  constructor({ maxLineBytes = 65_536 } = {}) {
    this.#maxLineBytes = maxLineBytes;
  }

  push(chunk) {
    if (this.#finished) throw new Error("decoder is finished");
    const text = Buffer.from(chunk).toString("utf8");
    return text
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== "")
      .map((line) => {
        if (Buffer.byteLength(line) > this.#maxLineBytes) throw new RangeError("maxLineBytes exceeded");
        return JSON.parse(line);
      });
  }

  finish() {
    this.#finished = true;
    return [];
  }
}
