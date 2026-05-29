# QHash — Cloud Mining Platform

QHash is a futuristic cloud-mining fintech platform built for Ethiopian users. It allows users to purchase mining plans, track daily earnings, deposit/withdraw funds, and manage referrals — all via a phone-number-first authentication flow.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | TanStack Start (SSR) |
| Frontend | React 19, TanStack Router v1 |
| Build | Vite 7 |
| Styling | Tailwind CSS 4 |
| Backend / Auth / DB | Supabase |
| State | Zustand |
| Notifications | Sonner |
| Deployment | Netlify |

## Running Locally

**1. Install dependencies**
```bash
npm install
```

**2. Configure environment**
```bash
cp .env.example .env.local
# Edit .env.local with your Supabase project URL and anon key
```

**3. Start dev server**
```bash
npm run dev
# App runs at http://localhost:3000 (Netlify CLI proxy on :8888)
```

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |

## Authentication

Users register and log in with their Ethiopian phone number (`09XXXXXXXX` or `+2519XXXXXXXX`). Internally, the phone is converted to an email address (`2519XXXXXXXX@auth.qhash.app`) for Supabase email/password auth. This is transparent to the user.

## Pages

| Route | Description |
|---|---|
| `/` | Marketing landing page |
| `/login` | Phone-number login |
| `/register` | New account with optional referral code |
| `/dashboard` | Earnings overview |
| `/plans` | Available mining plans |
| `/deposit` | Fund account |
| `/withdraw` | Request withdrawal |
| `/transactions` | Full transaction history |
| `/referrals` | Referral code & commission tracking |
| `/support` | Help ticket submission |
| `/admin` | Admin-only management panel |
