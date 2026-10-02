import { createReadStream } from "fs";
import { createInterface } from "readline";

/**
 * Stream a JSONL file line by line without loading the whole file into
 * memory (transcript files can exceed 100 MB).
 */
export async function* streamJsonlLines(
  file: string,
  fromLine = 0,
): AsyncGenerator<{ line: number; text: string }> {
  const stream = createReadStream(file, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let index = 0;
  for await (const text of reader) {
    if (index >= fromLine) yield { line: index, text };
    index += 1;
  }
  reader.close();
  stream.destroy();
}
