import { matchPiiSignalsInFile } from "../../../src/pii-signals/match-pii-signals";

const ids = (filePath: string, line: string): string[] =>
  matchPiiSignalsInFile({ filePath, content: line }).map((hit) => hit.id);

describe("import statements", () => {
  it("name modules and bindings, not addresses", () => {
    expect(ids("core/api.js", "const mail = require('../mail');")).toEqual([]);
    expect(ids("core/api.js", "const signinEmail = require('./emails/signin');")).toEqual([]);
    expect(ids("core/api.js", "const { isEmail } = require('@tryghost/validator');")).toEqual([]);
    expect(ids("core/provider.js", "const debug = require('@tryghost/debug')('email-service:mailgun');")).toEqual([]);
    expect(ids("src/completion.ts", "import renderImportEmail, { type ImportEmailSummary } from './email-template';")).toEqual([]);
    expect(ids("app/mailer.py", "from email.mime.text import MIMEText")).toEqual([]);
    expect(ids("app/mailer.rb", "require 'mail'")).toEqual([]);
  });

  it("leave other code on the line alone", () => {
    expect(ids("core/api.js", "const email = req.body.email;")).toEqual(["email"]);
    expect(ids("core/api.js", "const email = require('../config').get('email');")).toEqual(["email"]);
  });
});
