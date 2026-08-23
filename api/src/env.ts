import { randomInt } from "node:crypto";

const isProd = process.env.NODE_ENV === "production";

const DEV_JWT = "dev-only-not-for-production";
const jwtSecret = process.env.JWT_SECRET ?? DEV_JWT;

/**
 * Development conveniences that must never reach a public deployment.
 *
 * The OTP flow stands in for SMS, which is Phase 4. In development the code is
 * fixed and returned in the response so the flow is testable. In production
 * that would mean anyone who knows a worker's phone number can sign in as them,
 * so the code is random, never returned, and only written to the server log
 * until real SMS delivery exists.
 */
const devOtpConfigured = process.env.DEV_OTP;

if (isProd) {
  const fatal: string[] = [];
  if (jwtSecret === DEV_JWT) fatal.push("JWT_SECRET is still the development default");
  if (jwtSecret.length < 32) fatal.push("JWT_SECRET must be at least 32 characters");
  if (devOtpConfigured) fatal.push("DEV_OTP must not be set in production");
  if (fatal.length) {
    console.error("\nRefusing to start in production:\n" + fatal.map((f) => `  · ${f}`).join("\n") + "\n");
    process.exit(1);
  }
}

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret,
  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  /** Fixed and disclosed in development; random and undisclosed otherwise. */
  newOtp: () => (devOtpConfigured && !isProd ? devOtpConfigured : String(randomInt(100000, 999999))),
  /** Whether the sign-in response may echo the code back to the caller. */
  discloseOtp: Boolean(devOtpConfigured) && !isProd,
};
