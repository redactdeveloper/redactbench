# Chunked JSONL decoder

`JsonlDecoder` receives raw `Uint8Array` chunks from a transport. A chunk has no relationship to a JSONL record boundary. `push(chunk)` returns values completed by that chunk, while `finish()` parses a final record without a trailing newline and closes the decoder.

Empty lines are ignored. `maxLineBytes` counts bytes before the line-feed byte, excluding an optional carriage return. The decoder must preserve UTF-8 sequences split across chunks and reject malformed JSON or invalid UTF-8.
