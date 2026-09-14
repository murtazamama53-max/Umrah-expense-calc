"""Tests for /api/exchanges endpoints."""


class TestCreateExchange:
    def test_server_computes_acquisition_rate(self, client, trip):
        resp = client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '50000', 'sarReceived': '667.56', 'date': '2026-09-25',
        })
        assert resp.status_code == 201
        data = resp.get_json()
        # 50000 / 667.56 = 74.899634...
        assert data['acquisitionRate'] == '74.899634'

    def test_ignores_client_supplied_rate(self, client, trip):
        # A client-supplied acquisitionRate must never be trusted — only
        # pkrGiven/sarReceived determine the rate.
        resp = client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '100', 'sarReceived': '1',
            'acquisitionRate': '999999', 'date': '2026-09-25',
        })
        assert resp.get_json()['acquisitionRate'] == '100.000000'

    def test_rejects_zero_sar_received(self, client, trip):
        resp = client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '100', 'sarReceived': '0', 'date': '2026-09-25',
        })
        assert resp.status_code == 400

    def test_rejects_missing_trip(self, client):
        resp = client.post('/api/exchanges/', json={
            'tripId': 999, 'pkrGiven': '100', 'sarReceived': '1', 'date': '2026-09-25',
        })
        assert resp.status_code == 400


class TestExchangeSummary:
    def test_weighted_average_across_exchanges(self, client, trip):
        client.post('/api/exchanges/', json={'tripId': trip['id'], 'pkrGiven': '50000', 'sarReceived': '667.56', 'date': '2026-09-25'})
        client.post('/api/exchanges/', json={'tripId': trip['id'], 'pkrGiven': '30000', 'sarReceived': '397.35', 'date': '2026-10-01'})

        resp = client.get(f"/api/exchanges/summary?tripId={trip['id']}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['exchangeCount'] == 2
        assert data['totalPkrInvested'] == '80000.00'
        assert data['totalSarAcquired'] == '1064.91'
        # Matches the worked example in the architecture doc (~75.13)
        assert data['weightedAvgRate'] == '75.123719'

    def test_zero_state_when_no_exchanges(self, client, trip):
        resp = client.get(f"/api/exchanges/summary?tripId={trip['id']}")
        assert resp.get_json()['weightedAvgRate'] == '0.000000'


class TestUpdateAndDeleteExchange:
    def test_updating_sar_received_recomputes_rate(self, client, trip):
        created = client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '50000', 'sarReceived': '667.56', 'date': '2026-09-25',
        }).get_json()

        resp = client.patch(f"/api/exchanges/{created['id']}", json={'sarReceived': '700.00'})
        assert resp.status_code == 200
        assert resp.get_json()['acquisitionRate'] == '71.428571'

    def test_delete_exchange(self, client, trip):
        created = client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '50000', 'sarReceived': '667.56', 'date': '2026-09-25',
        }).get_json()
        resp = client.delete(f"/api/exchanges/{created['id']}")
        assert resp.status_code == 204
        assert client.get(f"/api/exchanges/{created['id']}").status_code == 404


class TestAcquisitionRateRoundingBoundary:
    """
    Regression tests for a precision bug where ExchangeTransaction's
    auto-computed acquisition_rate (and the PATCH recompute) used raw,
    unquantized division instead of calc_acquisition_rate()'s explicit
    .quantize(6dp, ROUND_HALF_UP). At exact rounding-boundary inputs this
    could silently round the wrong way (e.g. 1234565/10000000 gave
    '0.123456' via the API instead of the correct '0.123457').

    Each pair below lands exactly on a 7th-decimal-digit-5 boundary, so a
    naive/unquantized computation is the one case most likely to disagree
    with calc_acquisition_rate(). The stored/API acquisitionRate must match
    calc_acquisition_rate() exactly, for both creation and update.
    """

    BOUNDARY_CASES = [
        ('1234565', '10000000'),  # 0.1234565 -> 0.123457 (the case that exposed the bug)
        ('987655',  '10000000'),  # 0.0987655 -> 0.098766
        ('123',     '400000'),    # 0.0003075 -> 0.000308
        ('4999995', '10000000'),  # 0.4999995 -> 0.500000 (rounds up into a carry)
    ]

    def test_create_matches_calc_acquisition_rate_at_boundaries(self, client, trip):
        from backend.services.calculator import calc_acquisition_rate

        for pkr_given, sar_received in self.BOUNDARY_CASES:
            resp = client.post('/api/exchanges/', json={
                'tripId': trip['id'], 'pkrGiven': pkr_given, 'sarReceived': sar_received,
                'date': '2026-09-25',
            })
            assert resp.status_code == 201
            expected = str(calc_acquisition_rate(pkr_given, sar_received))
            assert resp.get_json()['acquisitionRate'] == expected, (
                f'{pkr_given}/{sar_received}: API gave {resp.get_json()["acquisitionRate"]!r}, '
                f'expected {expected!r}'
            )

    def test_update_matches_calc_acquisition_rate_at_boundaries(self, client, trip):
        from backend.services.calculator import calc_acquisition_rate

        created = client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '50000', 'sarReceived': '667.56', 'date': '2026-09-25',
        }).get_json()

        for pkr_given, sar_received in self.BOUNDARY_CASES:
            resp = client.patch(f"/api/exchanges/{created['id']}", json={
                'pkrGiven': pkr_given, 'sarReceived': sar_received,
            })
            assert resp.status_code == 200
            expected = str(calc_acquisition_rate(pkr_given, sar_received))
            assert resp.get_json()['acquisitionRate'] == expected, (
                f'{pkr_given}/{sar_received}: API gave {resp.get_json()["acquisitionRate"]!r}, '
                f'expected {expected!r}'
            )

    def test_original_bug_case_exact_value(self, client, trip):
        # Pinned regression: before the fix, this returned '0.123456'.
        resp = client.post('/api/exchanges/', json={
            'tripId': trip['id'], 'pkrGiven': '1234565', 'sarReceived': '10000000', 'date': '2026-09-25',
        })
        assert resp.get_json()['acquisitionRate'] == '0.123457'
