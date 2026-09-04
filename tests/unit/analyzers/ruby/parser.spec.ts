import type { FileInfo } from "../../../../src/core/types/file";
import { parseRubySourceFile } from "../../../../src/analyzers/ruby/parser";

function makeRubyFile(content: string, path = "app/models/user.rb"): FileInfo {
  return {
    path,
    name: path.split("/").pop() ?? path,
    content,
    language: "ruby",
    size: content.length,
  };
}

describe("Ruby parser", () => {
  it("extracts ActiveRecord class declarations", () => {
    const content = [
      "class User < ActiveRecord::Base",
      "  has_many :posts",
      "end",
      "",
      "class Post < ApplicationRecord",
      "end",
      "",
    ].join("\n");

    const model = parseRubySourceFile(makeRubyFile(content));

    expect(model.classes.map((c) => c.name)).toEqual(["User", "Post"]);
    expect(model.classes[0].baseType).toBe("ActiveRecord::Base");
    expect(model.classes[1].baseType).toBe("ApplicationRecord");
  });

  it("extracts require statements", () => {
    const content = [
      "require 'redis'",
      "require_relative '../lib/helper'",
      "",
    ].join("\n");

    const model = parseRubySourceFile(makeRubyFile(content, "config/initializers/redis.rb"));
    expect(model.requires.map((r) => r.path)).toEqual(["redis", "../lib/helper"]);
  });

  it("skips spec and vendor paths", () => {
    const content = "class User < ActiveRecord::Base\nend\n";
    const model = parseRubySourceFile(makeRubyFile(content, "spec/models/user_spec.rb"));
    expect(model.classes).toHaveLength(0);
  });

  it("preserves line numbers after comment stripping", () => {
    const content = [
      "# comment",
      "class User < ActiveRecord::Base",
      "end",
      "",
    ].join("\n");

    const model = parseRubySourceFile(makeRubyFile(content));
    expect(model.classes[0].location.startLine).toBe(2);
  });
});
