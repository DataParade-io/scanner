import fs from "fs";
import path from "path";
import {
  createTransformerBackend,
  DEFAULT_TRANSFORMER_MODEL,
  defaultTransformerCacheDir,
} from "../../../src/sentiment/transformer-backend";

/**
 * The transformer backend is optional (KDATAP-2ca1f0): these tests run only
 * when the model is already cached locally, so the suite never downloads and
 * never touches the network. Inference itself cannot run under jest (the
 * onnxruntime-node backend fails `instanceof Float32Array` checks across
 * jest's vm realm), so tensor-executing assertions live in
 * scripts/sentiment-backend-eval.ts, which runs under plain ts-node.
 */
const modelDir = path.join(defaultTransformerCacheDir(), "Xenova", "distilbert-base-uncased-finetuned-sst-2-english");
const modelCached = fs.existsSync(modelDir);

(modelCached ? describe : describe.skip)("transformer sentiment backend (model cached locally)", () => {
  it("exposes the documented model id and backend name", async () => {
    const backend = await createTransformerBackend();
    expect(DEFAULT_TRANSFORMER_MODEL).toBe("Xenova/distilbert-base-uncased-finetuned-sst-2-english");
    expect(backend.name).toBe("transformer");
  });

  it("routes fully excluded messages to null without running the model", async () => {
    const backend = await createTransformerBackend();
    expect(await backend.scoreMessage("```\nrm -rf /\n```")).toBeNull();
  });

  it("scores empty text as neutral zero without running the model", async () => {
    const backend = await createTransformerBackend();
    const empty = await backend.scoreMessage("");
    expect(empty!.compound).toBe(0);
    expect(empty!.label).toBe("neu");
  });
});