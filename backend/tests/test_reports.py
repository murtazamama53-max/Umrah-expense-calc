"""Tests for /api/reports endpoints."""


class TestReportsSummary:
    def test_summary_reflects_balance(self, client, trip, category):
        client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '74900', 'sarReceived': '1000', 'date': '2026-09-25',
        })
        client.post('/api/transactions/', json={
            'tripId': trip['id'], 'type': 'EXPENSE', 'amountSar': '100',
            'categoryId': category['id'], 'date': '2026-09-26',
        })

        resp = client.get(f"/api/reports/summary?tripId={trip['id']}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['balanceSar'] == '900.00'
        assert data['pkrValue'] == '67410.00'
        assert data['exchangeCount'] == 1
        assert data['transactionCount'] == 1

    def test_missing_trip_404(self, client):
        resp = client.get('/api/reports/summary?tripId=999')
        assert resp.status_code == 404

    def test_missing_trip_id_400(self, client):
        resp = client.get('/api/reports/summary')
        assert resp.status_code == 400
