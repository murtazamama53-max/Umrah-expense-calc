"""
UMRAH WALLET — Flask Application Factory

Initializes Flask app with SQLAlchemy, Migrations, and CORS.
This backend is an optional sync layer — the PWA works without it.
"""

from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_cors import CORS
import os

# ── Extensions (initialized without app for factory pattern) ───────────────
db      = SQLAlchemy()
migrate = Migrate()


def create_app(config_name: str | None = None) -> Flask:
    """
    Application factory.

    Args:
        config_name: 'development' | 'testing' | 'production'
                     Defaults to FLASK_ENV env var or 'development'.
    """
    app = Flask(__name__)

    env = config_name or os.getenv('FLASK_ENV', 'development')
    _load_config(app, env)

    # ── Extensions ──────────────────────────────────────────────────────────
    db.init_app(app)
    migrate.init_app(app, db)
    CORS(app, resources={r'/api/*': {'origins': os.getenv('ALLOWED_ORIGINS', '*')}})
    
    with app.app_context():
        from . import models

    # ── Blueprints ───────────────────────────────────────────────────────────
    from .routes.trips        import trips_bp
    from .routes.exchanges    import exchanges_bp
    from .routes.transactions import transactions_bp
    from .routes.categories   import categories_bp
    from .routes.reports      import reports_bp

    app.register_blueprint(trips_bp,        url_prefix='/api/trips')
    app.register_blueprint(exchanges_bp,    url_prefix='/api/exchanges')
    app.register_blueprint(transactions_bp, url_prefix='/api/transactions')
    app.register_blueprint(categories_bp,   url_prefix='/api/categories')
    app.register_blueprint(reports_bp,      url_prefix='/api/reports')

    # ── Health check ─────────────────────────────────────────────────────────
    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'service': 'umrah-wallet-backend'}

    return app


def _load_config(app: Flask, env: str) -> None:
    """Load configuration based on environment."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    db_path  = os.path.join(base_dir, '..', 'instance', 'umrah_wallet.db')

    defaults = {
        'SQLALCHEMY_TRACK_MODIFICATIONS': False,
        'SQLALCHEMY_DATABASE_URI':        f'sqlite:///{db_path}',
        'SECRET_KEY':                     os.getenv('SECRET_KEY', 'dev-secret-change-in-prod'),
        'JSON_SORT_KEYS':                 False,
    }

    if env == 'testing':
        defaults['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        defaults['TESTING'] = True
    elif env == 'production':
        pg_url = os.getenv('DATABASE_URL')
        if pg_url:
            # Heroku/Render give postgres:// — SQLAlchemy requires postgresql://
            defaults['SQLALCHEMY_DATABASE_URI'] = pg_url.replace('postgres://', 'postgresql://', 1)

    app.config.update(defaults)
    # Allow env-specific overrides via .env
    app.config.from_prefixed_env(prefix='UW')
