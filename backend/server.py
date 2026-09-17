"""
UMRAH WALLET — Vercel deployment entrypoint

This file exists ONLY because Vercel's Python runtime requires a
module-level `app` variable (a plain Flask instance) to detect and serve
a Flask application. It adds no routes, no logic, and no configuration
of its own — it just calls the existing application factory.

Everything else about the backend — the factory pattern in
backend/__init__.py, all models, all routes, all business logic — is
completely unchanged. Local development, `flask run`, and the test
suite all continue to use create_app() exactly as before; this file is
not imported by any of them.
"""

from backend import create_app

app = create_app('production')
