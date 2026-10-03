import { matchPiiSignalsInFile } from "../../../src/pii-signals/match-pii-signals";

const isPhone = (line: string, filePath = "app/a.ts"): boolean =>
  matchPiiSignalsInFile({ filePath, content: line }).some((hit) => hit.id === "phone_number");

describe("phone words inside longer names", () => {
  it("counts names that hold a phone value", () => {
    expect(["customerPhone = x", "phone_source_id", "twilio_phone_number", "ATTENDEE_PHONE_NUMBER_FIELD,", "phone_info"].map((l) => isPhone(l))).toEqual([
      true, true, true, true, true,
    ]);
  });

  it("does not count names that end in something else, or type names", () => {
    expect(
      ["def existing_phone_number_contact", "phone_number_format", "allow_mobile_webview", "MFAEnrollPhoneParams,", "MobileOtpType"].map((l) => isPhone(l)),
    ).toEqual([false, false, false, false, false]);
  });
});

describe("phone checks and country or schema names", () => {
  it("are not phone values", () => {
    expect(["const isMobile = x", "isValidPhoneNumber(p)", "ensureValidPhoneNumber(p)", "defaultPhoneCountry", "phoneSchema"].map((l) => isPhone(l))).toEqual([
      false, false, false, false, false,
    ]);
    expect(isPhone("attendeePhoneNumber = y")).toBe(true);
  });
});
