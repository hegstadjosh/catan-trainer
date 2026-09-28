# Contributing

Please start with a focused issue or proposal that explains the player-visible behavior and the assumptions behind any new probability claim. Keep changes small enough to review. Include a meaningful test when a rules or numerical invariant changes, and say whether a result is exact, sampled, or illustrative.

For the standalone guide, use Python 3 and Node.js, edit `src/`, then run `npm run build` and `npm test`. The hosted app also uses `web/lib/`, `web/game/`, and `web/public/`; install its dependencies with `npm ci --prefix web`, run `node web/build.mjs`, and run the relevant local `web/test/*.test.mjs` files. `index.html`, `flashcards.html`, `web/lib/generated-pages.mjs`, and several `web/public` browser bundles are generated, so change their source files first. Do not run live-account acceptance tests against someone else's Supabase project.

Do not include secrets, personal account identifiers, private game logs, reference screenshots, copied rulebook text, or artwork unless you have the right to publish them. Preserve third-party notices and identify the source and license of any new dependency or asset. By contributing, you should be able to license your original contribution under the project's MIT license; if that is uncertain, raise the provenance question before submitting code. See [Licensing and publication scope](LICENSING.md).
