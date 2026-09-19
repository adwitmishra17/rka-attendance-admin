# Staff identity & login — current state and target model

_Last updated 2026-09-19. Owner: platform. Covers how a staff member (teacher /
office / admin) is authenticated and resolved across the RKA apps (Teacher PWA,
Tracker admin, SMS office, HRMS), and the model we are moving toward._

## TL;DR

One person should equal **one stable identity**. Email and phone are **login
methods** that map to it, each **unique**. Every app/server/rule should resolve
the same way. Today identity is keyed by the *credential itself*, inconsistently,
and that has produced real cross-account bugs.

## How it works today

**Authentication** (proving who you are) — two methods, both via Firebase
(project `rka-academic-tracker`):
- **Google email** sign-in.
- **Phone OTP** — the app calls the HRMS Supabase edge fns `request-otp` /
  `verify-otp` (project `yegxwxutdalmdubrozrm`, both `--no-verify-jwt`);
  `verify-otp` verifies the code and mints a Firebase **custom token**.

**Identity resolution** (mapping the authenticated user → role + data) — keyed by
the *credential*, and it differs per app:

| Surface | Resolves a person by |
| --- | --- |
| `verify-otp` (`resolveIdentity`) | phone → admin doc (by phone) **before** employee (by email); email-less admin → `fixedUid = admins docId` (a `phone_…` id) |
| Tracker admin (`admin/src/App.jsx`) | `admins/{email}` else `admins/{uid}` |
| SMS office (`auth-sync`) | Firestore `admins/{email}` or `admins where phone==` → JWT `app_metadata` |
| Teacher PWA (`client/src/App.jsx`) | `teachers` by email / personalEmail, and (2026-09) by the `otp_phone` claim |
| Teacher PWA server (`middleware/auth.js`, routes) | `req.user.email`; `userBranches/{email}` / `admins/{email|uid}` |
| Firestore rules | `userBranches/{email}` exists (`isRealTeacher`) |

There is **no single canonical per-person key**. The same person can exist as: an
HRMS `employees` row (`id`), a Firestore `teachers` doc (native id), an `admins`
doc (email- **or** `phone_…`-keyed), and one or more Firebase auth users (a Google
uid and/or a custom-token uid). Nothing links them by one id.

### What this has caused
- **Empty-email collision** (fixed 2026-09-19): an OTP custom token carries no
  email, so the teacher app's `teachers where email == ''` matched every
  email-less teacher stub and dropped OTP users into a random teacher's profile.
- **Shared / duplicate phones & emails**: e.g. a duplicate employee (RKA-1025 vs
  RKA-2049, same email); a phone on two records → collisions.
- **Split identity**: a person who is teacher + office + phone-login admin (Sharad
  Tiwari) resolves to a different identity depending on which credential they use.

### Phone-only admins are intentional
`admins` docs keyed by `phone_…` (email-less, `uid == docId`) are a **working**
pattern for **admin-only** staff — SMS / Tracker / HRMS resolve them by
`admins/{uid}`. It only breaks in the Teacher PWA, which keys on email, and only
for staff who are **both** a phone-login admin **and** a teacher (currently Sharad
Tiwari, Vivek Singh). The 2026-09 `otp_phone`-claim fix covers that case without
changing their admin identity.

## Target model

1. **Canonical id = HRMS `employees.id`.** Everyone is an employee first;
   teacher / admin / office are **roles** on that record.
2. **Email & phone are unique attributes** of the employee — a number/email
   belongs to at most one employee. Enforced by a DB uniqueness guard **and** a
   check in the HRMS "Admin Users" / employee editor at save time.
3. **Roles hang off the id** — `moduleRoles` (tracker/sms/hrms) + teacher-ness
   (in Teachers dept / has teaching assignments). One record, many hats.
4. **Login stamps a stable `emp_id` claim** — both the OTP path (`verify-otp`)
   and the Google path (`auth-sync` equivalent) set it. Generalizes the current
   `otp_phone` claim into a real identity claim, set only by trusted server code.
5. **One shared resolver** `resolvePerson({ email | phone | uid | emp_id })` →
   the canonical employee + roles, used by every client, server, and edge fn,
   replacing the ad-hoc email/uid/`phone_`-docid lookups. Firestore mirrors
   (`teachers` / `admins` / `userBranches`) carry `emp_id`; `firestore.rules`
   gate on its existence.

## Migration (incremental, low-risk)

1. **Done (2026-09-19):** stop matching empty email + resolve OTP by the
   `otp_phone` claim (teacher client + server). Unblocks the teacher+phone-admin
   cases with no model change.
2. **Enforce uniqueness** — reject a phone/email already on another record in the
   HRMS Admin Users editor, and run a one-time dedupe (kills the collision class).
3. **Add the `emp_id` claim** at both login paths + the shared `resolvePerson()`;
   pilot in the Teacher PWA.
4. **Re-key mirrors + rules to `emp_id`**, switch the remaining apps, retire the
   `phone_…` admin-docid hack (phone stays a login method, never a key).

## Why it's robust
A phone change or carrier reassignment becomes a simple attribute update — no
identity churn, no collision — because the phone was never the key.
