"""Tests for /api/trips endpoints."""


class TestCreateTrip:
    def test_creates_trip_with_defaults(self, client):
        resp = client.post('/api/trips/', json={
            'startDate': '2026-09-25',
            'endDate': '2026-11-15',
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data['name'] == 'Umrah 2026'
        assert data['homeCurrency'] == 'PKR'
        assert data['travelCurrency'] == 'SAR'
        assert data['dailyAllowanceSar'] is None

    def test_rejects_end_before_start(self, client):
        resp = client.post('/api/trips/', json={
            'startDate': '2026-11-15',
            'endDate': '2026-09-25',
        })
        assert resp.status_code == 400

    def test_rejects_missing_dates(self, client):
        resp = client.post('/api/trips/', json={'name': 'No dates'})
        assert resp.status_code == 400

    def test_rejects_negative_allowance(self, client):
        resp = client.post('/api/trips/', json={
            'startDate': '2026-09-25', 'endDate': '2026-11-15', 'dailyAllowanceSar': '-5',
        })
        assert resp.status_code == 400


class TestGetAndListTrips:
    def test_get_existing_trip(self, client, trip):
        resp = client.get(f"/api/trips/{trip['id']}")
        assert resp.status_code == 200
        assert resp.get_json()['id'] == trip['id']

    def test_get_missing_trip_404(self, client):
        resp = client.get('/api/trips/999')
        assert resp.status_code == 404

    def test_list_includes_created_trip(self, client, trip):
        resp = client.get('/api/trips/')
        assert resp.status_code == 200
        ids = [t['id'] for t in resp.get_json()]
        assert trip['id'] in ids


class TestUpdateTrip:
    def test_updates_daily_allowance(self, client, trip):
        resp = client.patch(f"/api/trips/{trip['id']}", json={'dailyAllowanceSar': '150.00'})
        assert resp.status_code == 200
        assert resp.get_json()['dailyAllowanceSar'] == '150.00'

    def test_rejects_end_before_start_on_update(self, client, trip):
        resp = client.patch(f"/api/trips/{trip['id']}", json={'endDate': '2020-01-01'})
        assert resp.status_code == 400


class TestDeleteTrip:
    def test_deletes_trip(self, client, trip):
        resp = client.delete(f"/api/trips/{trip['id']}")
        assert resp.status_code == 204
        assert client.get(f"/api/trips/{trip['id']}").status_code == 404
