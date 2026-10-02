import fs from "fs";
import os from "os";
import path from "path";
import { loadSentimentConfig, resolveWithConfig, sentimentConfigPath } from "../../../src/sentiment/config";

describe("sentiment config", () => {
  it("resolves the XDG config path", () => {
    expect(sentimentConfigPath("/home/ryan")).toBe("/home/ryan/.config/dataparade/sentiment.meter.yaml");
    process.env.XDG_CONFIG_HOME = "/xdg";
    expect(sentimentConfigPath()).toBe("/xdg/dataparade/sentiment.meter.yaml");
    delete process.env.XDG_CONFIG_HOME;
  });

  it("a missing config file means pure defaults", () => {
    expect(loadSentimentConfig("/nonexistent-home")).toEqual({});
  });

  it("parses each config key", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-config-"));
    const configPath = path.join(dir, "dataparade", "sentiment.meter.yaml");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      [
        "timezone: Asia/Tokyo",
        'dayStart: "04:00"',
        "sources:",
        "  - claude-code",
        "roots:",
        "  claude-code:",
        "    - /second-mac/.claude/projects",
        "words: /custom/words.yaml",
      ].join("\n"),
    );
    process.env.XDG_CONFIG_HOME = dir;
    const config = loadSentimentConfig();
    delete process.env.XDG_CONFIG_HOME;
    expect(config.timezone).toBe("Asia/Tokyo");
    expect(config.dayStart).toBe("04:00");
    expect(config.sources).toEqual(["claude-code"]);
    expect(config.roots!["claude-code"]).toEqual(["/second-mac/.claude/projects"]);
    expect(config.words).toBe("/custom/words.yaml");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("precedence: flags over config over defaults", () => {
    const resolved = resolveWithConfig(
      { timezone: "UTC" },
      { timezone: "Asia/Tokyo", dayStart: "04:00" },
      {},
    );
    expect(resolved.timezone).toBe("UTC");
    expect(resolved.dayStart).toBe("04:00");
    const defaulted = resolveWithConfig({}, {}, { timezone: "UTC" });
    expect(defaulted.timezone).toBe("UTC");
  });
});
