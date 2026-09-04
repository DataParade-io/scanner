import {
  isBareAddressFieldDeclaration,
  isPlainPasswordFieldDeclaration,
  resolveAliasRuleIdsForToken,
} from "../../../src/pii-signals/pii-signal-aliases";

describe("pii-signal-aliases", () => {
  it("resolves compound email tokens", () => {
    expect(
      resolveAliasRuleIdsForToken(
        "user_email",
        "* @property string $user_email",
        18,
        "class-wp-user.php",
      ),
    ).toEqual(["email"]);
  });

  it("resolves suffix tokens for validation method names", () => {
    expect(
      resolveAliasRuleIdsForToken(
        "validate_social_security_number",
        "def validate_social_security_number(self, value):",
        4,
        "employee.py",
      ),
    ).toEqual(["ssn"]);
  });

  it("gates bare address on property access", () => {
    expect(
      isBareAddressFieldDeclaration(
        "DATABASE_URL = aws_db_instance.main.address",
        "DATABASE_URL = aws_db_instance.main.".length,
      ),
    ).toBe(false);
  });

  it("gates plain password outside password modules", () => {
    expect(isPlainPasswordFieldDeclaration("Plain string", "models/user.go")).toBe(
      false,
    );
    expect(
      isPlainPasswordFieldDeclaration("Plain     string", "core/field_password.go"),
    ).toBe(true);
  });
});
