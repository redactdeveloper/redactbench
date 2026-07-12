import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";

const utf8 = new TextDecoder("utf-8", { fatal: true });

function parseLine(buffer, maxLineBytes) {
  const line = buffer.at(-1) === 13 ? buffer.subarray(0, -1) : buffer;
  if (line.byteLength > maxLineBytes) throw new RangeError("maxLineBytes exceeded");
  const text = utf8.decode(line);
  return text.trim() === "" ? [] : [JSON.parse(text)];
}

export class JsonlDecoder {
  #finished = false;
  #maxLineBytes;
  #pending = Buffer.alloc(0);

  constructor({ maxLineBytes = 65_536 } = {}) {
    this.#maxLineBytes = maxLineBytes;
  }

  push(chunk) {
    if (this.#finished) throw new Error("decoder is finished");
    this.#pending = Buffer.concat([this.#pending, Buffer.from(chunk)]);
    const values = [];
    let newline;
    while ((newline = this.#pending.indexOf(10)) !== -1) {
      values.push(...parseLine(this.#pending.subarray(0, newline), this.#maxLineBytes));
      this.#pending = this.#pending.subarray(newline + 1);
    }
    if (this.#pending.byteLength > this.#maxLineBytes + 1) {
      throw new RangeError("maxLineBytes exceeded");
    }
    return values;
  }

  finish() {
    if (this.#finished) throw new Error("decoder is finished");
    this.#finished = true;
    const values = parseLine(this.#pending, this.#maxLineBytes);
    this.#pending = Buffer.alloc(0);
    return values;
  }
}
