import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { TextEncoder } from "node:util";

const encode = (value) => new TextEncoder().encode(value);
const mode = process.argv[2];
const modulePath = process.argv[3] ?? "/workspace/src/jsonl-decoder.mjs";
const { JsonlDecoder } = await import(pathToFileURL(modulePath).href);

if (mode === "boundaries") {
  const bytes = encode('{"id":1}\n{"id":2}\n');
  const decoder = new JsonlDecoder();
  const original = bytes.slice();
  const values = [
    ...decoder.push(bytes.subarray(0, 5)),
    ...decoder.push(bytes.subarray(5, 13)),
    ...decoder.push(bytes.subarray(13)),
    ...decoder.finish()
  ];
  assert.deepEqual(values, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(bytes, original);
} else if (mode === "utf8") {
  const bytes = encode('{"text":"Привет 🧪"}\n');
  const split = bytes.indexOf(0xd0) + 1;
  const decoder = new JsonlDecoder();
  const values = [
    ...decoder.push(bytes.subarray(0, split)),
    ...decoder.push(bytes.subarray(split)),
    ...decoder.finish()
  ];
  assert.deepEqual(values, [{ text: "Привет 🧪" }]);
} else if (mode === "line-contract") {
  const decoder = new JsonlDecoder();
  const values = [
    ...decoder.push(encode('\r\n  \n{"ok":true}\r\n\n')),
    ...decoder.finish()
  ];
  assert.deepEqual(values, [{ ok: true }]);
} else if (mode === "limits") {
  const finalRecord = '{"ok":true}';
  const decoder = new JsonlDecoder({ maxLineBytes: encode(finalRecord).byteLength });
  assert.deepEqual(decoder.push(encode(finalRecord)), []);
  assert.deepEqual(decoder.finish(), [{ ok: true }]);
  assert.throws(() => decoder.push(encode("{}\n")), /finished/u);

  const limited = new JsonlDecoder({ maxLineBytes: 8 });
  assert.throws(() => limited.push(encode('{"long":123}\n')), /maxLineBytes/u);
} else {
  throw new Error(`unknown evaluator mode: ${mode}`);
}
