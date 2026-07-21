// OTP generation + hashing.
// The OTP is never stored in plaintext — only an HMAC-SHA256 hash (keyed by
// OTP_PEPPER) is written to the database.

const OTP_PEPPER = Deno.env.get("OTP_PEPPER") ?? "";

/** Generate a 6-digit numeric OTP (100000–999999, never a leading zero). */
export function generateOtp(): string {
  const r = crypto.getRandomValues(new Uint32Array(1))[0];
  return String((r % 900000) + 100000);
}

/** HMAC-SHA256 hash of an OTP, returned as hex. Deterministic for compare. */
export async function hashOtp(otp: string): Promise<string> {
  if (!OTP_PEPPER) throw new Error("OTP_PEPPER env var is not set");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(OTP_PEPPER),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(otp),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** bulksmsindia accepts the number with or without 91, but NOT with a '+'. */
export function toSmsNumber(phone: string): string {
  return phone.replace(/\D/g, "");
}
