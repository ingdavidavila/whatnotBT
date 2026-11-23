# Whatnot best-times dashboard

Uses the Whatnot Seller API (your own shows only) to find the day/hour slots where you perform best.

1. Create a personal access token in your Whatnot developer dashboard with `read:shows` and `read:reports`.
2. `node server.js` (Node 18+), open http://localhost:3000, paste the token, click **Sync**.
   Or: `WHATNOT_TOKEN=wn_pat_tk_... node server.js`.
3. Synced shows are saved in `data/shows.json`; later syncs only fetch new shows.

Try it without a token: `node server.js --demo` (fake data in `data/demo.json`).
Do not commit `data/` if you don't want your sales data in git.
