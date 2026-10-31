# Social OAuth setup (Google & Facebook)

How the web app completes Supabase social login, and the external configuration it needs.
Implemented 2026-10-31 for the public login (`/[locale]/login`) and the admin login
(`/wanderer/login`). Mobile, Telegram and Apple are not part of this flow.

## Flow

```
Browser                    Next server (apps/web)              Backend                 Supabase
  │ click Google              │                                  │                       │
  │── startSocialLogin ──────►│ GET /auth/social/google/url      │                       │
  │                           │   ?redirectTo=<origin>/…/callback│── signInWithOAuth ───►│
  │◄── { url } ───────────────│                                  │◄── authorize URL ─────│
  │── window.open(about:blank) → popup.location = url ─────────────────────────────────►│
  │◄── 302 to provider ──────────────────────────────────────────────────────────────────│
  │◄── 302 <redirectTo>#access_token=…&type=bearer ──────────────────────────────────────│
  │ /auth/callback/<provider> in the popup (client component)                             │
  │   strip fragment, read access_token                                                   │
  │── completeSocialLogin ───►│ POST /auth/social/callback       │                       │
  │                           │   {provider, accessToken, mode?} │── getUser(token) ────►│
  │                           │                                  │◄── user ──────────────│
  │                           │◄── backend JWTs + user ──────────│                       │
  │◄── Set-Cookie (httpOnly) ─│                                  │                       │
  │── opener navigates to /me or /dashboard; popup closes                                 │
```

**Popup behaviour.** Clicking Google/Facebook opens a popup at `about:blank` synchronously
(so popup blockers allow it) and assigns the Supabase authorize URL once the server action
answers. While the popup is open every action button (Login, Telegram, Apple, Google,
Facebook) is disabled and the clicked social one shows a spinner, but the form fields stay
editable; closing the popup re-enables the buttons so the visitor can try again. When the
popup completes, the callback navigates its opener (same origin) and closes itself — the
cookies set in the popup are shared with the opener. If the browser blocks the popup, the
flow falls back to the full-page redirect.

Routes:

| Surface     | Callback route                               |
| ----------- | -------------------------------------------- |
| Public user | `/{en\|km}/auth/callback/{google\|facebook}` |
| Admin       | `/wanderer/auth/callback/{google\|facebook}` |

The user callback sits outside the `(user)` route group (no marketplace chrome); the admin
callback sits under `/wanderer/*` so the admin-subdomain proxy already allows it.

### Account linking (settings)

The settings hub reads `GET /users/me?includeAuthProviders=1` and renders Facebook / Google /
Telegram as `Add` or `Linked`. Clicking **Add** on Google/Facebook starts a link flow:

1. `startSocialLink` requires a signed-in session, stores an httpOnly
   `social_link_pending = <provider>:<nonce>` cookie (10 minutes), and redirects to
   `/{locale}/auth/link/{provider}/{nonce}`.
2. The callback compares the path nonce with the cookie (a wrong nonce does **not** delete it,
   so an attacker cannot cancel a live flow) and POSTs the provider token to
   `POST /auth/social/link` with the user's JWT. The backend links the provider identity and
   never mints tokens; a provider already attached elsewhere answers
   `409 PROVIDER_ACCOUNT_ALREADY_LINKED`.
3. The opener reloads `/settings`, which re-reads the provider list.

Linked rows open a confirmation dialog calling `DELETE /auth/social/:provider`; the backend
refuses to remove the account's last way in (`409 LAST_LOGIN_METHOD`). Telegram is
display/remove only until its Login Widget ships.

## Required external configuration

### Supabase dashboard → Authentication → Providers

- Google and Facebook enabled, with their client ID/secret.
- In Google Cloud Console / the Facebook developer console, the authorized redirect URI is
  the **Supabase** callback: `https://<project-ref>.supabase.co/auth/v1/callback` — not the
  app callback.

### Supabase dashboard → Authentication → URL Configuration

- **Site URL**: the canonical web origin.
- **Redirect URLs**: add the callback paths explicitly (Supabase matches the whole URL; `**`
  crosses `/`, `*` does not):

```
http://localhost:3001/en/auth/callback/google
http://localhost:3001/en/auth/callback/facebook
http://localhost:3001/km/auth/callback/google
http://localhost:3001/km/auth/callback/facebook
http://localhost:3001/wanderer/auth/callback/google
http://localhost:3001/wanderer/auth/callback/facebook
http://admin.localhost:3001/wanderer/auth/callback/google
http://admin.localhost:3001/wanderer/auth/callback/facebook
http://localhost:3001/en/auth/link/google/*
http://localhost:3001/en/auth/link/facebook/*
http://localhost:3001/km/auth/link/google/*
http://localhost:3001/km/auth/link/facebook/*
https://<production-web>/en/auth/callback/google
https://<production-web>/en/auth/callback/facebook
https://<production-web>/km/auth/callback/google
https://<production-web>/km/auth/callback/facebook
https://<production-web>/en/auth/link/google/*
https://<production-web>/en/auth/link/facebook/*
https://<production-web>/km/auth/link/google/*
https://<production-web>/km/auth/link/facebook/*
https://<admin-host>/wanderer/auth/callback/google
https://<admin-host>/wanderer/auth/callback/facebook
```

The link callbacks carry a UUID nonce as their last path segment (`*` matches it); the login
callbacks have no dynamic segment, so they stay exact entries.

A `redirect_to` that is not listed makes Supabase fall back to the Site URL (or reject the
authorize request), so the flow cannot complete.

### Backend environment (`apps/backend/.env*`)

```
FRONTEND_ORIGINS=https://<production-web>,https://<admin-host>,http://localhost:3001,http://admin.localhost:3001
```

`GET /auth/social/:provider/url` only accepts a `redirectTo` whose origin is in this list.
When the list is empty, development may only loop back to localhost and **production fails
closed** (`400 INVALID_REDIRECT_URI`) — the variable is required in production.

### Web environment

- `API_URL` — the backend base (existing).
- `NEXT_PUBLIC_ADMIN_URL` — the origin that serves `/wanderer/*`. When set, the admin
  callback URL is built on that origin so the host-only admin cookies land where the
  dashboard reads them. In development it is usually unset and the request origin is used.

### Staff accounts

Admin social login never creates an account: it signs in an **existing** staff user whose
`users.email` matches the Google/Facebook account (and links the provider id on success).
Every other outcome returns the same 401. The seeded admin has no email, so set one via the
dashboard/Team edit before using the admin Google/Facebook buttons.

## Security properties

- **Provider binding**: `user_auth_providers.providerAccountId` stores the Supabase user id
  and is matched before email, so a provider email change does not create a second account.
- **Verified email only**: a social login is rejected unless Supabase reports
  `email_confirmed_at`; this closes the unverified-email takeover path from the 2026-10-24
  audit (M1).
- **CSRF binding**: `startSocialLogin` sets an httpOnly `social_oauth_pending` cookie for
  the surface (`user` / `admin`, 10 minutes). The callback refuses to exchange a token
  without it, so a crafted callback URL cannot sign a victim into the attacker's account.
- **Fragment handling**: the Supabase access token arrives in the URL fragment (implicit
  flow). The callback strips it on mount and again after hydration (Next's router otherwise
  restores it); the token is exchanged once and never stored.
- **Admin mode**: `mode: 'admin'` never inserts a user, refuses non-staff roles, and the web
  action re-checks the role before writing admin cookies.

## Verification

- `GET /api/v1/auth/social/google/url?redirectTo=http://localhost:3001/en/auth/callback/google`
  → `200` with a Supabase authorize URL containing `redirect_to`; a foreign origin → `400`.
- Click Google/Facebook on `/en/login` and `/wanderer/login`; a popup opens at `about:blank`,
  every action button (Login, Telegram, Apple, Google, Facebook) disables but the fields stay
  editable, the popup reaches the provider, and closing the popup re-enables the buttons.
- The callback with a junk token shows "Sign-in failed" and clears the pending cookie; its
  **Back to login** button closes the popup and re-enables the opener (in a normal tab it
  navigates back to the login page). A callback opened without a pending cookie shows
  "This sign-in did not start in this browser."
- `GET /api/v1/users/me?includeAuthProviders=1` returns the caller's
  `authProviders` array; without the flag the key is absent.
- `POST /api/v1/auth/social/link` with a junk provider token → `401 INVALID_PROVIDER_TOKEN`;
  without a user JWT → `401`. `DELETE /api/v1/auth/social/github` → `400
UNSUPPORTED_PROVIDER`; deleting an unlinked provider → `200 { unlinked: false }`.
- On `/en/settings` the three rows show `Add` + a chevron; clicking Google opens the popup at
  `about:blank`, all three rows disable, and closing the popup re-enables them. A link
  callback with a foreign nonce shows "This connection did not start in this browser." and
  strips the fragment.
- A full round trip (including a linked row and its remove dialog) needs real provider
  credentials and the Supabase allow-list above.
