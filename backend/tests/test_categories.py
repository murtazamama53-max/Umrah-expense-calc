"""Tests for /api/categories endpoints."""


class TestCreateCategory:
    def test_creates_top_level_category(self, client, trip):
        resp = client.post('/api/categories/', json={'tripId': trip['id'], 'name': 'Transport', 'icon': '🚕'})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data['name'] == 'Transport'
        assert data['parentId'] is None
        assert data['isDefault'] is False

    def test_creates_subcategory(self, client, trip, category):
        resp = client.post('/api/categories/', json={
            'tripId': trip['id'], 'name': 'Breakfast', 'parentId': category['id'],
        })
        assert resp.status_code == 201
        assert resp.get_json()['parentId'] == category['id']

    def test_rejects_empty_name(self, client, trip):
        resp = client.post('/api/categories/', json={'tripId': trip['id'], 'name': '  '})
        assert resp.status_code == 400

    def test_rejects_parent_from_other_trip(self, client, trip, category):
        other_trip = client.post('/api/trips/', json={
            'startDate': '2026-01-01', 'endDate': '2026-01-10',
        }).get_json()
        resp = client.post('/api/categories/', json={
            'tripId': other_trip['id'], 'name': 'X', 'parentId': category['id'],
        })
        assert resp.status_code == 400


class TestListCategories:
    def test_nested_includes_subcategories(self, client, trip, category):
        client.post('/api/categories/', json={'tripId': trip['id'], 'name': 'Breakfast', 'parentId': category['id']})
        resp = client.get(f"/api/categories/?tripId={trip['id']}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data) == 1
        assert len(data[0]['subcategories']) == 1

    def test_flat_returns_all_rows(self, client, trip, category):
        client.post('/api/categories/', json={'tripId': trip['id'], 'name': 'Breakfast', 'parentId': category['id']})
        resp = client.get(f"/api/categories/?tripId={trip['id']}&flat=true")
        assert len(resp.get_json()) == 2


class TestUpdateAndDeleteCategory:
    def test_renames_category(self, client, category):
        resp = client.patch(f"/api/categories/{category['id']}", json={'name': 'Meals'})
        assert resp.status_code == 200
        assert resp.get_json()['name'] == 'Meals'

    def test_deletes_unused_category(self, client, category):
        resp = client.delete(f"/api/categories/{category['id']}")
        assert resp.status_code == 204

    def test_blocks_delete_with_subcategories(self, client, trip, category):
        client.post('/api/categories/', json={'tripId': trip['id'], 'name': 'Breakfast', 'parentId': category['id']})
        resp = client.delete(f"/api/categories/{category['id']}")
        assert resp.status_code == 409

    def test_blocks_delete_with_transactions(self, client, trip, category):
        client.post('/api/transactions/', json={
            'tripId': trip['id'], 'type': 'EXPENSE', 'amountSar': '10',
            'categoryId': category['id'], 'date': '2026-09-26',
        })
        resp = client.delete(f"/api/categories/{category['id']}")
        assert resp.status_code == 409
