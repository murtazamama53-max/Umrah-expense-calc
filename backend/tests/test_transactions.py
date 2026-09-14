"""
Tests for /api/transactions endpoints.

The most important behaviour here is the historical-immutability rule:
once a transaction's pkr_equivalent / acquisition_rate_used are recorded,
neither new exchanges nor edited exchanges may silently change them.
"""


class TestCreateTransaction:
    def test_snapshots_pkr_equivalent_from_current_rate(self, client, trip, category):
        client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '74900', 'sarReceived': '1000', 'date': '2026-09-25',
        })
        resp = client.post('/api/transactions/', json={
            'tripId': trip['id'], 'type': 'EXPENSE', 'amountSar': '50',
            'categoryId': category['id'], 'date': '2026-09-26', 'location': 'Makkah',
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data['acquisitionRateUsed'] == '74.900000'
        assert data['pkrEquivalent'] == '3745.00'

    def test_zero_snapshot_when_no_exchanges_yet(self, client, trip, category):
        resp = client.post('/api/transactions/', json={
            'tripId': trip['id'], 'type': 'EXPENSE', 'amountSar': '50',
            'categoryId': category['id'], 'date': '2026-09-26',
        })
        data = resp.get_json()
        assert data['pkrEquivalent'] == '0.00'
        assert data['acquisitionRateUsed'] == '0.000000'

    def test_rejects_category_from_other_trip(self, client, trip, category):
        other_trip = client.post('/api/trips/', json={'startDate': '2026-01-01', 'endDate': '2026-01-10'}).get_json()
        resp = client.post('/api/transactions/', json={
            'tripId': other_trip['id'], 'type': 'EXPENSE', 'amountSar': '10',
            'categoryId': category['id'], 'date': '2026-01-02',
        })
        assert resp.status_code == 400

    def test_rejects_invalid_location(self, client, trip, category):
        resp = client.post('/api/transactions/', json={
            'tripId': trip['id'], 'type': 'EXPENSE', 'amountSar': '10',
            'categoryId': category['id'], 'date': '2026-09-26', 'location': 'Riyadh',
        })
        assert resp.status_code == 400


class TestHistoricalImmutability:
    def test_new_exchange_does_not_change_past_transaction(self, client, trip, category):
        # First exchange at 74.90
        client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '74900', 'sarReceived': '1000', 'date': '2026-09-25',
        })
        tx = client.post('/api/transactions/', json={
            'tripId': trip['id'], 'type': 'EXPENSE', 'amountSar': '50',
            'categoryId': category['id'], 'date': '2026-09-26',
        }).get_json()
        assert tx['pkrEquivalent'] == '3745.00'

        # A second, very different exchange is added later...
        client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '100000', 'sarReceived': '1000', 'date': '2026-10-15',
        })

        # ...the earlier transaction's snapshot must be untouched.
        refetched = client.get(f"/api/transactions/{tx['id']}").get_json()
        assert refetched['pkrEquivalent'] == '3745.00'
        assert refetched['acquisitionRateUsed'] == '74.900000'

    def test_editing_exchange_does_not_change_past_transaction(self, client, trip, category):
        exchange = client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '74900', 'sarReceived': '1000', 'date': '2026-09-25',
        }).get_json()
        tx = client.post('/api/transactions/', json={
            'tripId': trip['id'], 'type': 'EXPENSE', 'amountSar': '50',
            'categoryId': category['id'], 'date': '2026-09-26',
        }).get_json()

        # Correct a typo in the exchange itself.
        client.patch(f"/api/exchanges/{exchange['id']}", json={'sarReceived': '2000'})

        refetched = client.get(f"/api/transactions/{tx['id']}").get_json()
        assert refetched['pkrEquivalent'] == '3745.00'
        assert refetched['acquisitionRateUsed'] == '74.900000'

    def test_amount_correction_preserves_original_rate(self, client, trip, category):
        client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '74900', 'sarReceived': '1000', 'date': '2026-09-25',
        })
        tx = client.post('/api/transactions/', json={
            'tripId': trip['id'], 'type': 'EXPENSE', 'amountSar': '50',
            'categoryId': category['id'], 'date': '2026-09-26',
        }).get_json()

        # A second exchange changes the weighted average significantly.
        client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '100000', 'sarReceived': '1000', 'date': '2026-10-15',
        })

        # Fixing a typo in the SAR amount must reuse the ORIGINAL rate (74.90),
        # not today's new weighted average.
        resp = client.patch(f"/api/transactions/{tx['id']}", json={'amountSar': '60'})
        data = resp.get_json()
        assert data['acquisitionRateUsed'] == '74.900000'
        assert data['pkrEquivalent'] == '4494.00'  # 60 * 74.90


class TestListAndDeleteTransactions:
    def test_filters_by_category(self, client, trip, category):
        other_cat = client.post('/api/categories/', json={'tripId': trip['id'], 'name': 'Transport'}).get_json()
        client.post('/api/transactions/', json={'tripId': trip['id'], 'type': 'EXPENSE', 'amountSar': '10', 'categoryId': category['id'], 'date': '2026-09-26'})
        client.post('/api/transactions/', json={'tripId': trip['id'], 'type': 'EXPENSE', 'amountSar': '20', 'categoryId': other_cat['id'], 'date': '2026-09-26'})

        resp = client.get(f"/api/transactions/?tripId={trip['id']}&categoryId={category['id']}")
        data = resp.get_json()
        assert len(data) == 1
        assert data[0]['categoryId'] == category['id']

    def test_delete_transaction(self, client, trip, category):
        tx = client.post('/api/transactions/', json={
            'tripId': trip['id'], 'type': 'EXPENSE', 'amountSar': '10',
            'categoryId': category['id'], 'date': '2026-09-26',
        }).get_json()
        resp = client.delete(f"/api/transactions/{tx['id']}")
        assert resp.status_code == 204
        assert client.get(f"/api/transactions/{tx['id']}").status_code == 404
