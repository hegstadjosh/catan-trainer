# Security reporting

Please do not put credentials, private game data, OAuth tokens, database URLs with secrets, or an unpatched vulnerability in a public issue. If this repository enables GitHub private vulnerability reporting, use **Security → Report a vulnerability**. Otherwise, open a public issue with a minimal, non-sensitive description and ask the maintainer for a private reporting channel before sending reproduction details. No public security email address is designated in this source export.

For self-hosted copies, keep `SUPABASE_SECRET_KEY` only in the server environment, protect the Supabase project and Google OAuth configuration, and verify the database migrations and row-level security against separate test accounts before inviting users. `SUPABASE_PUBLISHABLE_KEY` is a client-facing identifier; it is not a substitute for the server secret. Revoke exposed agent or seat tokens promptly in the running app. See [Self-hosting](docs/SELF_HOSTING.md).

The maintainer should avoid publishing production data, screenshots of private matches, `.env.local`, Vercel links/configuration, Supabase temporary files, or agent transcripts with a security report. There is no claim here that a hosted deployment has been independently audited.
