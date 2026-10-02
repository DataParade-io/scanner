import fs from "fs";
import path from "path";
import {
  createTransformerBackend,
  DEFAULT_TRANSFORMER_MODEL,
  defaultTransformerCacheDir,
  TRANSFORMER_MODELS,
} from "../../../src/sentiment/transformer-backend";

/**
 * The transformer backend is optional (KDATAP-2ca1f0): these tests run only
 * when the model is already cached locally, so the suite never downloads and
 * never touches the network. Inference itself cannot run under jest (the
 * onnxruntime-node backend fails `instanceof Float32Array` checks across
 * jest's vm realm), so tensor-executing assertions live in
 * scripts/sentiment-backend-eval.ts, which runs under plain ts-node.
 */
const modelDir = path.join(defaultTransformerCacheDir(), "SamLowe", "roberta-base-go_emotions-onnx");
const modelCached = fs.existsSync(modelDir);

(modelCached ? describe : describe.skip)("transformer sentiment backend (model cached locally)", () => {
  it("exposes the documented winner model and backend name", async () => {
    const backend = await createTransformerBackend();
    expect(DEFAULT_TRANSFORMER_MODEL).toBe("SamLowe/roberta-base-go_emotions-onnx");
    expect(backend.name).toBe("transformer");
  });

  it("routes fully excluded messages to null without running the model", async () => {
    const backend = await createTransformerBackend();
    expect(await backend.scoreMessage("```\nrm -rf /\n```")).toBeNull();
  });

  it("registers the comparison candidates with distinct model ids", () => {
    expect(TRANSFORMER_MODELS.transformer.repo).toBe("SamLowe/roberta-base-go_emotions-onnx");
    expect(TRANSFORMER_MODELS["transformer-cardiff"].repo).toBe("Xenova/twitter-roberta-base-sentiment-latest");
    expect(TRANSFORMER_MODELS["transformer-xlmr"].repo).toBe("onnx-community/twitter-xlm-roberta-base-sentiment-ONNX");
    expect(TRANSFORMER_MODELS["transformer-sst2"].head).toBe("binary");
    expect(TRANSFORMER_MODELS["transformer-cardiff"].labels).toEqual(["negative", "neutral", "positive"]);
  });

  it("defaults every transformer spec to coding filter off (KDATAP-d278a8 study)", () => {
    // The study showed the filter is redundant on gold sets and hides genuine
    // frustration for GoEmotions ("this crash is killing me" -> neu), so the
    // transformer family defaults to raw text; only VADER filters by default.
    for (const [name, spec] of Object.entries(TRANSFORMER_MODELS)) {
      expect({ model: name, defaultCodingFilter: spec.defaultCodingFilter }).toEqual({
        model: name,
        defaultCodingFilter: false,
      });
    }
  });

  it("scores empty text as neutral zero without running the model", async () => {
    const backend = await createTransformerBackend();
    const empty = await backend.scoreMessage("");
    expect(empty!.compound).toBe(0);
    expect(empty!.label).toBe("neu");
  });
});