# Self-hosting

The account-backed app needs your own Supabase project, a Node.js 24 host, and a Google OAuth configuration. The standalone guide needs none of these services; use the two commands under **Standalone** if you only want the planner and flashcards.

## Standalone

From the repository root, install Python 3 and Node.js, then run:

```sh
npm run build
npm test
npm start
```

Open `http://127.0.0.1:8768/` for the guide or `/flashcards.html` for drills. Browser storage holds local inputs and progress. There is no account sync, hosted game, dashboard, replay, or MCP endpoint in this mode. The generated `index.html` and `flashcards.html` can also be opened locally after the build.

## Account-backed app

1. Create a **new Supabase project that you control**. Review the SQL files in `supabase/migrations/` and apply them in filename order to that project using your preferred Supabase migration workflow. These migrations create account, game, history, and decision-practice storage and access policies. Do not point a development copy at another operator's database. The exported repository has generic Supabase CLI configuration, not a linked project.
2. In Supabase Auth, enable the Google provider. Create your own Google OAuth client and configure its authorized origins and the **Supabase provider callback** as described in the [Supabase Google guide](https://supabase.com/docs/guides/auth/social-login/auth-google). Add your app's exact `SITE_URL/auth/callback` to Supabase's redirect allow list. Set Supabase's site URL to your deployment origin. The app's Google login route is `/auth/google`.
3. Copy `web/.env.example` to `web/.env.local` for local development, then fill in the values below. Keep `.env.local` out of Git. Set the same variables in the server-side environment of your hosted Node/Express deployment. Use an HTTPS origin for a public deployment.

| Variable | Meaning |
| --- | --- |
| `SUPABASE_URL` | Your project's Supabase URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Its publishable API key, used with each signed-in user's session. |
| `SUPABASE_SECRET_KEY` | Server-only secret API key for account-owned game storage. Never put it in browser code or public build settings. |
| `SITE_URL` | Exact external origin, with no trailing slash, such as `https://your-domain.example`. It controls OAuth redirects, links, cookie security, and same-origin checks. For local development, retain `http://127.0.0.1:8769`. |
| `GOOGLE_ENABLED` | Set to `true` to make Google sign-in available. |
| `PRIVACY_CONTACT_EMAIL` | Operator-chosen contact shown on `/privacy`; set this before inviting other users. |

4. Build both sets of pages and browser assets from the repository root:

```sh
npm run build
npm test
npm ci --prefix web
node web/build.mjs
npm test --prefix web
```

For a local server, run `npm run dev --prefix web` and open `http://127.0.0.1:8769/`. The dev command reads `web/.env.local`. The server entry point for a hosted deployment is `web/server.mjs`; this repository's `web/vercel.json` declares the Express framework. Ensure the host installs `web/package-lock.json` dependencies and runs the build from the repository root before serving the generated pages and browser assets. When using another host, serve `web/public/` at the app's asset routes as configured by `web/server.mjs`. Confirm your host's static-file handling and output inclusion; a passing local build alone does not establish that its deployed asset routes work.

The hosted sign-in currently accepts any Google account that completes Supabase authentication; there is no email allowlist. Check the access policies and rate limits against your own project before sharing the URL. Check sign-in, save/reload, account separation, game seat boundaries, and `/privacy` on the deployed origin. No project credentials or player data are included in the repository.

## Agent connections

The account MCP endpoint is `/mcp`. It uses Supabase's [OAuth 2.1 server](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication); enable and configure that feature for your own project before connecting an MCP client. The app exposes a consent page at `/oauth/consent` and protected-resource metadata for client discovery. An approved account connection can read and change that user's dashboards, saved games, and match history, including complete hidden game state. Connect only a client you trust, and use the dashboard to revoke its grant.

Game-seat tokens are separate: `/game-mcp` grants play and view access to one assigned seat. The `/game-info-mcp` sidekick token is read-only and shows public information plus the human seat's hand and saved game events. Issue, rotate, and revoke those tokens from the game controls. Do not share any bearer token, secret key, or real player log in an issue or screenshot.

A seat MCP connection alone does not wake a coding agent after its run ends. The game provides `catan-seat.py`, a persistent listener for seat-ready events; run it on the agent's host using the private token and the Codex or Claude Code command shown in the connection dialog. Keep that process running across chat turns and verify its CLI can make an unattended move on a disposable seat before relying on it. A host prompt or approval can still prevent unattended play. The listener stops on completion or token revocation and retries temporary connection failures without replaying an uncertain move.

## License and publication scope

Self-hosting the MIT-licensed project code does not itself grant rights to CATAN branding or other game intellectual property. Read [Licensing and publication scope](../LICENSING.md) and preserve [Third-party notices](../THIRD_PARTY_NOTICES.md) if you distribute a modified copy.
