import { analyzeSource, initAnalysisEngine } from "../../../src/analyze/engine/engine";
import { LANGUAGE_PACKS, packForFile } from "../../../src/analyze/languages";
import { occurrenceReceiver } from "../../../src/analyze/occurrence-receiver";

const SOURCE = [
  "class ContactsController < ApplicationController", // 1
  "  def create(params, phone: nil)", //                2
  "    email = params[:email]", //                      3
  "    @contact = Contact.new(email: email, phone_number: phone)", // 4
  "    @contact.email = email.downcase", //             5
  "    Mailer.notify(email).deliver_later", //          6
  "    self.email ||= user.email", //                   7
  "  end", //                                           8
  "end", //                                             9
].join("\n");

describe("Ruby language pack", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  const analyze = () => analyzeSource(packForFile("ruby", "app/controllers/contacts_controller.rb")!, SOURCE)!;

  it("is chosen for Ruby files", () => {
    expect(packForFile("ruby", "a.rb")?.id).toBe("ruby");
  });

  it("finds methods with their class and parameters, including keyword parameters", () => {
    const file = analyze();
    expect(file.functionDefinitions().map((fn) => [fn.name, fn.owner, fn.parameters.map((p) => p.name)])).toEqual([
      ["create", "ContactsController", ["params", "phone"]],
    ]);
  });

  it("resolves a local's uses to its assignment", () => {
    const file = analyze();
    expect(file.declarationOf("email", 6, 18)).toEqual({ line: 3, kind: "local" });
  });

  it("records call arguments with the method, the receiver and hash-pair keywords", () => {
    const file = analyze();
    expect(file.callSitesOnLine(4).map((site) => [site.callee, site.position, site.keyword])).toEqual([
      ["new", 0, "email"],
      ["new", 1, "phone_number"],
    ]);
    expect(file.callSitesOnLine(6).map((site) => [site.callee, site.position, site.receiver?.text])).toEqual([["notify", 0, "Mailer"]]);
  });

  it("reads symbol keys like string keys", () => {
    const file = analyze();
    expect(file.keyDeclarations().map((key) => [key.name, key.line])).toEqual([
      ["email", 4],
      ["phone_number", 4],
    ]);
  });

  it("types receivers the Rails way: model self and attributes, ivars, ActiveRecord constants; not services or loggers", () => {
    const source = [
      "class User < ApplicationRecord", //                                 1
      "  validates :email, presence: true", //                           2
      "  def norm", //                                                   3
      "    self.email = email.try(:downcase)", //                        4
      "  end", //                                                        5
      "end", //                                                          6
      "class SyncService", //                                            7
      "  def run(phone_number)", //                                      8
      "    @user = User.find_by(id: 1)", //                              9
      "    @user.email", //                                              10
      "    Channel::Email.find(2).email", //                             11
      "    Rails.logger.warn(phone_number)", //                          12
      "    IdentifierSyncService.new.perform(phone_number: phone_number)", // 13
      "    self.email", //                                               14
      "  end", //                                                        15
      "end", //                                                          16
    ].join("\n");
    const file = analyzeSource(packForFile("ruby", "app/models/user.rb")!, source)!;
    const concept = (token: string) => /email|phone/i.test(token);
    const classAt = (line: number) => occurrenceReceiver(file, line, concept, source.split("\n")[line - 1]).className;
    expect([2, 4, 10, 11, 12, 13, 14].map(classAt)).toEqual(["User", "User", "User", "ChannelEmail", undefined, undefined, undefined]);
  });
});
