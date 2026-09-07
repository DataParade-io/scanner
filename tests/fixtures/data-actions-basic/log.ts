/**
 * Intentional log spans — logger invocations with PII on the same line.
 */

declare const logger: {
  info: (msg: string | Record<string, unknown>) => void;
  error: (msg: string | Record<string, unknown>) => void;
  debug: (msg: string | Record<string, unknown>) => void;
};

export function logSignup(email: string): void {
  // log — email written into application logs
  logger.info({ event: "signup", email });
}

export function logPaymentFailure(ssn: string, reason: string): void {
  // log — SSN co-occurs with logger.error on the same call
  logger.error({ reason, ssn });
}

export function logDebugPhone(phone: string): void {
  // log — phone number in debug telemetry
  logger.debug({ phone });
}
