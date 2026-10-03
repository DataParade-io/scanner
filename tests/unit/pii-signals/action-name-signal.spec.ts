import { matchPiiSignalsInFile } from "../../../src/pii-signals/match-pii-signals";

const hits = (line: string): string[] => matchPiiSignalsInFile({ filePath: "lib/a.ts", content: line }).map((hit) => hit.id);

describe("flag and action names around a concept", () => {
  it("does not count flags and actions as values", () => {
    for (const line of ["hideOrganizerEmail: true", "noEmail = true", "normalizeEmail(x)", "canSendCalVideoTranscriptionEmails: true"]) {
      expect(hits(line)).not.toContain("email");
    }
  });

  it("still counts values, getters, checks and mail calls", () => {
    for (const line of ["secondaryEmail = y", "getDefaultEmail()", "validations: { isEmail: true }", "await this.mailer.sendMail({ from })"]) {
      expect(hits(line)).toContain("email");
    }
  });
});

describe("translation keys", () => {
  it("ignores keys passed to translation calls and keeps other dotted keys", () => {
    expect(hits("I18n.t('conversations.reply.email.header')")).not.toContain("email");
    expect(hits("config('mail.from.address')")).toContain("email");
  });
});
