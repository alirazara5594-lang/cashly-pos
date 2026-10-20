# Demo video recorder

Records the "Watch demo" videos on the sign-in page from the real app. Output goes to
`out/`; finished videos are copied to `pos-frontend/public/demo-videos/` (the list each kind of
business sees is in `pos-frontend/src/utils/demoVideos.ts`).

It never touches the real database: it records against a separate demo backend on its own
database, `cashly_demo`.

## Run

1. Build the backend in Release, then start the demo backend from `Pos.Api`:

   ```
   dotnet build -c Release
   dotnet bin\Release\net10.0\Pos.Api.dll --environment Development --urls http://localhost:5290 --ConnectionStrings:DefaultConnection "Host=localhost;Port=5432;Database=cashly_demo;Username=postgres;Password=12345678"
   ```

2. Keep the frontend dev server running on http://localhost:5173.
3. From this folder:

   ```
   node run.mjs restaurant.mjs --record          # restaurant-1..4
   $env:KIND="retail";  node run.mjs shop.mjs --record
   $env:KIND="grocery"; node run.mjs shop.mjs --record
   ```

   Without `--record` a script only runs (a quick check). `DEMO_TEST=<n>` registers a test
   business instead of the real demo name. Each run registers its business, so a re-run needs
   a name and mobile number not used before in `cashly_demo` (`DEMO_NAME`, `DEMO_SLUG`,
   `DEMO_MOBILE` for the restaurant).

## Files

- `rec.mjs` — drives headless Edge: pointer, captions, title cards; records and encodes MP4.
- `run.mjs` — runs one script; `common.mjs` — sign-in, registration, catalog and stock steps.
- `restaurant.mjs`, `shop.mjs` (retail and grocery) — the videos.
- `frames.mjs` — frames from a finished video, to check it; `peek.mjs` — screenshot a running run.
- `explore-pharmacy.mjs` — first look at the pharmacy screens (the pharmacy videos are next).
