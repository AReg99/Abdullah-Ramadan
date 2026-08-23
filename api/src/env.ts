import "node:process";
export const env = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-not-for-production",
  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  /** Dev convenience: every OTP is this code. Never ship with it set. */
  devOtp: process.env.DEV_OTP ?? "1234",
};
