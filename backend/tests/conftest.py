"""
Shared pytest fixtures for backend route tests.
"""

import pytest

from backend import create_app, db as _db


@pytest.fixture()
def app():
    app = create_app('testing')
    with app.app_context():
        _db.create_all()
        yield app
        _db.session.remove()
        _db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def trip(client):
    """A default trip, created via the API, for tests that need one."""
    resp = client.post('/api/trips/', json={
        'name': 'Umrah 2026',
        'startDate': '2026-09-25',
        'endDate': '2026-11-15',
        'dailyAllowanceSar': '100.00',
    })
    return resp.get_json()


@pytest.fixture()
def category(client, trip):
    """A default top-level category belonging to `trip`."""
    resp = client.post('/api/categories/', json={
        'tripId': trip['id'],
        'name': 'Food & Drinks',
        'icon': '🍽',
    })
    return resp.get_json()
