# RKA Attendance Admin

Admin dashboard for the RKA HR & Attendance system.

Connects to:
- **Firebase** (project: `rka-academic-tracker`) — for Google Sign-In and admin authorisation (reads `admins` collection)
- **Supabase** (project: `rka-attendance`) — for all HR data (employees, attendance, holidays, reporting time)

## Local development

```bash
npm install
npm run dev
```

Then open http://localhost:5173

## Deployment

Auto-deploys to Vercel on every push to `main`.

## Env variables

See `.env.example` for the list. Local development uses `.env.local`. Vercel uses Project Settings → Environment Variables.

## Auth

- Super Admin (hardcoded): `adwit@rkacademyballia.in`
- Other admins: managed in the existing Academic Tracker app at `/admin-users`. This app reads the same `admins` Firestore collection — no duplicate admin management.
