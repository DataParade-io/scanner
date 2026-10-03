import { matchPiiSignalsInFile } from "../../../src/pii-signals/match-pii-signals";

const ids = (line: string): string[] => matchPiiSignalsInFile({ filePath: "app/mailboxes/a.rb", content: line }).map((hit) => hit.id);

describe("bare mail as an email signal", () => {
  it("is an address as a variable or an address member", () => {
    expect(ids("def process(mail, channel)")).toEqual(["email"]);
    expect(ids("@mail.to")).toEqual(["email"]);
    expect(ids("reply = mail.reply_to")).toEqual(["email"]);
  });

  it("is not an address as a constant, a call, or another member", () => {
    expect(ids("rescue Mail::Field::ParseError")).toEqual([]);
    expect(ids("html = mail.subject")).toEqual([]);
    expect(ids("mail(to: recipients)")).toEqual([]);
  });
});

describe("mail inside a longer name", () => {
  it("is a mail message unless an address word goes with it", () => {
    expect(ids("html_mail_body = render(x)")).toEqual([]);
    expect(ids("mail_subject = x")).toEqual([]);
    expect(ids("mail_from = sender")).toEqual(["email"]);
    expect(ids("const from: SendMailOptions['from'] = options.from")).toEqual(["email"]);
  });
});
