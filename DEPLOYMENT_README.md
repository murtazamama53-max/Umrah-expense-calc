# Deploying Umrah Wallet to Vercel

This document covers only what changed for deployment and what you need to
configure in Vercel. No React components, no financial/business logic, no
database models, and no tests were changed. All 69 backend tests and 54
frontend tests pass, and the production build succeeds, with these files
in place.

---

## 1. Files added (nothing else was touched)

| File | Why it exists |
|---|---|
| `backend/server.py` | **New.** Vercel's Python runtime requires a plain module-level `app = Flask(...)` instance in a recognized file. Your backend uses a factory (`create_app()`), so this 3-line file just calls it: `app = create_app('production')`. It is not imported by `flask run`, your tests, or anything else — those all still use `create_app()` directly, exactly as before. |
| `pyproject.toml` (repo root) | **New.** Tells Vercel where that `app` instance lives: `backend.server:app`. This is Vercel's documented mechanism for a Flask app that isn't in one of its auto-detected filenames (`app.py`/`index.py`/`server.py`/`main.py`/`wsgi.py`/`asgi.py` at the root or in `src/`/`app/`). It is not a Python packaging file and nothing else reads it. |
| `requirements.txt` (repo root) | **New.** A production-only dependency list for Vercel: the same pinned versions as `backend/requirements.txt`, minus `pytest`/`pytest-flask` (dev-only — Vercel's own guidance is to keep deployed bundles to runtime packages) and `requests` (not used anywhere in the backend), plus `psycopg2-binary` added — this is required to connect to a Postgres `DATABASE_URL`; the old sqlite-only setup never needed it. `backend/requirements.txt` is unchanged and still what you use locally. |
| `.vercelignore` (repo root) | **New.** Keeps `venv/`, `__pycache__/`, `.pytest_cache/`, `backend/tests/`, `instance/` (your local dev sqlite file), and `coverage/` out of what gets deployed. Doesn't affect local development at all. |

No existing file's content changed — `backend/__init__.py`, `models.py`, every route file, every test, and every React/JS file are byte-for-byte what they were before this turn.

---

## 2. Why two files were unavoidable

Vercel's Python support looks for a specific filename with a bare `app`
variable. Your backend deliberately uses the factory pattern
(`create_app()`) so the same code can build a `'development'`, `'testing'`,
or `'production'` app — that's good architecture, but it's exactly the
shape Vercel's zero-config detection doesn't recognize on its own. The two
new files are a thin adapter, not a redesign: `backend/server.py` calls
your existing factory unchanged, and `pyproject.toml` just points Vercel at
it.

---

## 3. Vercel dashboard configuration

Deploy this repo as **two separate Vercel projects** (same repo, connected
twice) rather than combining them into one — this matches how the project
is already split, needs no extra rewrite/routing config, and is what
Vercel's own guidance recommends for a repo shaped like this one.

### Project 1 — Frontend
- **Root Directory:** `.` (leave default)
- **Framework Preset:** Vite (should auto-detect from `package.json` + `vite.config.js`; confirm it in Project Settings since the new root-level `pyproject.toml`/`requirements.txt` could theoretically nudge auto-detection — if so, just select "Vite" explicitly)
- **Build Command:** leave default (`vite build`, from your existing `package.json`)
- **Output Directory:** leave default (`dist`)
- No environment variables required for this project today — nothing in `src/` currently calls the Flask backend.

### Project 2 — Backend
- **Root Directory:** `.` (leave default — do **not** set it to `backend`, which would relocate what Python treats as the package root and risk breaking the existing relative imports in `models.py`/`routes/`)
- **Framework Preset:** Other / Python (should auto-detect from `requirements.txt` + `pyproject.toml`)
- **Build Command / Output Directory:** leave default — Python Functions don't use these the way static frontends do
- Environment variables: **required**, see below

---

## 4. Required environment variables (backend project only)

Set these in the backend Vercel project → Settings → Environment Variables:

| Variable | Required? | Value |
|---|---|---|
| `FLASK_ENV` | **Required** | `production` |
| `DATABASE_URL` | **Required** | Your hosted Postgres connection string (see §5) |
| `SECRET_KEY` | Recommended | Any random string — without it, the app falls back to the checked-in dev default |
| `ALLOWED_ORIGINS` | Recommended once you have a frontend URL | Your frontend's Vercel URL, e.g. `https://your-frontend.vercel.app` (defaults to `*` if unset) |

**Both `FLASK_ENV` and `DATABASE_URL` are required together** — this is existing behavior in `backend/__init__.py`, unchanged. Setting only one does nothing useful:
- `DATABASE_URL` alone: ignored, because config only checks it when `env == 'production'`.
- `FLASK_ENV=production` alone: the app switches to production config but finds no `DATABASE_URL`, silently falls back to the old sqlite path, and **every** database read or write will fail outright — Vercel Functions have a read-only filesystem outside `/tmp`, and `/tmp` isn't persistent. This isn't a data-loss risk, it's a hard crash on first request.

---

## 5. Database requirements

SQLite cannot work on Vercel at all — this is a Vercel platform constraint, not something in your code to fix. You need a hosted Postgres database:

- **Vercel Postgres** (powered by Neon) — easiest, sets `DATABASE_URL` for you automatically when linked to the project
- Or any external Postgres: Neon, Supabase, Railway, etc. — copy their connection string into `DATABASE_URL` yourself

If your provider's connection string requires SSL (most hosted Postgres do), append `?sslmode=require` to the URL, e.g.:
```
postgresql://user:pass@host:5432/dbname?sslmode=require
```

---

## 6. Migration steps (run once, from your own machine — not from Vercel)

Vercel has no built-in "run migrations on deploy" step for Python, so do this manually, once, before or right after the first deploy:

1. Create the Postgres database with your chosen provider and copy its connection string.
2. On your Windows machine, in the project folder, with your existing virtual environment active:
   ```
   set DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require
   set FLASK_ENV=production
   flask --app backend:create_app db upgrade
   ```
   (On macOS/Linux, use `export` instead of `set`.) This applies the existing migration in `migrations/versions/` — the schema itself is unchanged, so this creates the same tables you already have locally, just in Postgres.
3. Verify it worked by connecting to the database with any Postgres client and confirming the tables exist (`trips`, `exchange_transactions`, `transactions`, `categories`, `shopping_items`).
4. If you ever change `models.py` in the future, run `flask --app backend:create_app db migrate -m "..."` then `db upgrade` the same way, against the same `DATABASE_URL`.

---

## 7. How to test the deployment

Once both projects are deployed:

1. **Frontend:** open the frontend project's Vercel URL. You should see the current app (still the default Vite/React starter screen — no UI has been built against the wallet yet, so this is expected, not a deployment problem).
2. **Backend health check:**
   ```
   curl https://your-backend-project.vercel.app/api/health
   ```
   Expect: `{"status":"ok","service":"umrah-wallet-backend"}`
3. **Backend database check:**
   ```
   curl -X POST https://your-backend-project.vercel.app/api/trips/ \
     -H "Content-Type: application/json" \
     -d '{"startDate":"2026-09-25","endDate":"2026-11-15"}'
   ```
   Expect a `201` with a JSON trip object back. If this instead returns a 500, the most likely cause is `DATABASE_URL`/`FLASK_ENV` not set correctly, or migrations not yet run (§6).
4. **Confirm it persists:**
   ```
   curl https://your-backend-project.vercel.app/api/trips/
   ```
   The trip you just created should be in the list — confirming it landed in Postgres, not a throwaway sqlite file.

If any of these fail, re-check §4 (both env vars set, correctly spelled) before anything else — that's the failure mode this setup is most likely to hit.
