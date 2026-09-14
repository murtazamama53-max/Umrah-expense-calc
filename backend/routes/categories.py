"""
UMRAH WALLET — Categories API

Categories are self-referencing: parent_id = None is a top-level category,
parent_id = <id> is a subcategory of that category (see models.py).
"""

from flask import Blueprint, jsonify, request

from .. import db
from ..models import Category, Transaction, Trip

categories_bp = Blueprint('categories', __name__)


@categories_bp.route('/', methods=['GET'])
def list_categories():
    trip_id = request.args.get('tripId', type=int)
    if not trip_id:
        return jsonify({'error': 'tripId query parameter is required'}), 400

    flat = request.args.get('flat', 'false').lower() == 'true'

    if flat:
        categories = (
            Category.query.filter_by(trip_id=trip_id)
            .order_by(Category.sort_order.asc())
            .all()
        )
        return jsonify([c.to_dict() for c in categories])

    top_level = (
        Category.query.filter_by(trip_id=trip_id, parent_id=None)
        .order_by(Category.sort_order.asc())
        .all()
    )
    return jsonify([c.to_dict(include_subcategories=True) for c in top_level])


@categories_bp.route('/', methods=['POST'])
def create_category():
    data = request.get_json(silent=True) or {}

    trip_id = data.get('tripId')
    if not trip_id or not db.session.get(Trip, trip_id):
        return jsonify({'error': 'A valid tripId is required'}), 400

    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    parent_id = data.get('parentId')
    if parent_id is not None:
        parent = db.session.get(Category, parent_id)
        if not parent or parent.trip_id != trip_id:
            return jsonify({'error': 'parentId must belong to this trip'}), 400

    category = Category(
        trip_id=trip_id,
        name=name,
        icon=data.get('icon', '📦'),
        parent_id=parent_id,
        is_default=False,
        sort_order=data.get('sortOrder', 0),
    )
    db.session.add(category)
    db.session.commit()
    return jsonify(category.to_dict()), 201


@categories_bp.route('/<int:category_id>', methods=['PATCH'])
def update_category(category_id):
    category = db.session.get(Category, category_id)
    if not category:
        return jsonify({'error': 'Category not found'}), 404

    data = request.get_json(silent=True) or {}

    if 'name' in data:
        name = (data['name'] or '').strip()
        if not name:
            return jsonify({'error': 'name cannot be empty'}), 400
        category.name = name

    if 'icon' in data:
        category.icon = data['icon']

    if 'sortOrder' in data:
        category.sort_order = data['sortOrder']

    if 'parentId' in data:
        parent_id = data['parentId']
        if parent_id == category_id:
            return jsonify({'error': 'a category cannot be its own parent'}), 400
        if parent_id is not None:
            parent = db.session.get(Category, parent_id)
            if not parent or parent.trip_id != category.trip_id:
                return jsonify({'error': 'parentId must belong to this trip'}), 400
        category.parent_id = parent_id

    db.session.commit()
    return jsonify(category.to_dict())


@categories_bp.route('/<int:category_id>', methods=['DELETE'])
def delete_category(category_id):
    category = db.session.get(Category, category_id)
    if not category:
        return jsonify({'error': 'Category not found'}), 404

    in_use = Transaction.query.filter(
        (Transaction.category_id == category_id) | (Transaction.subcategory_id == category_id)
    ).first()
    if in_use:
        return jsonify({'error': 'Cannot delete a category that has transactions. Reassign them first.'}), 409

    if category.subcategories.count() > 0:
        return jsonify({'error': 'Cannot delete a category that has subcategories. Delete those first.'}), 409

    db.session.delete(category)
    db.session.commit()
    return '', 204
