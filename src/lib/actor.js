// Identity to stamp on audit / upload records.
//
// HRMS admins can sign in by PHONE (custom token, no email) — App.jsx
// resolves those email-less sessions via admins/{uid}. Code that stamped
// `user.email` directly treated such admins as "not logged in" and blocked
// reveals / document uploads. Fall back to phoneNumber then uid so every
// authenticated admin has a stable identifier for attribution.
export function actorId(user) {
  return user?.email || user?.phoneNumber || user?.uid || null
}
