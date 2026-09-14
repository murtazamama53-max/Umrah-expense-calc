"""
UMRAH WALLET — Transactions API

A Transaction is an expense or refund against the SAR wallet.

IMMUTABILITY RULE (see models.py docstring):
  pkr_equivalent and acquisition_rate_used are snapshots taken at creation
  time from the trip's *current* weighted-average acquisition rate. Once
  written, they are never recalculated from live/updated exchange data.

  If the SAR amount itself is corrected later (a data-entry fix, not a rate
  refresh), we recompute pkr_equivalent using the ORIGINAL acquisition_rate_used
  — never a freshly recalculated weighted rate — so the business rule holds.
"""

from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from flask import Blueprint, jsonify, request

from .. import db
from ..models import Category, ExchangeTransaction, Transaction, Trip, LOCATION_CHOICES, TRANSACTION_TYPES
from ..services.calculator import calc_expense_pkr_snapshot

transactions_bp = Blueprint('transactions', __name__)

_MONEY_DP = Decimal('0.01')


def _parse_date(value, field):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValueError(f'{field} must be an ISO date string (YYYY-MM-DD)')


def _parse_positive_decimal(value, field):
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError):
        raise ValueError(f'{field} must be a number')
    if d <= 0:
        raise ValueError(f'{field} must be greater than zero')
    return d


def _get_trip_exchanges_as_dicts(trip_id):
    exchanges = ExchangeTransaction.query.filter_by(trip_id=trip_id).all()
    return [{'pkr_given': e.pkr_given, 'sar_received': e.sar_received} for e in exchanges]


@transactions_bp.route('/', methods=['GET'])
def list_transactions():
    trip_id = request.args.get('tripId', type=int)
    if not trip_id:
        return jsonify({'error': 'tripId query parameter is required'}), 400

    query = Transaction.query.filter_by(trip_id=trip_id)

    category_id = request.args.get('categoryId', type=int)
    if category_id:
        query = query.filter_by(category_id=category_id)

    location = request.args.get('location')
    if location:
        query = query.filter_by(location=location)

    tx_type = request.args.get('type')
    if tx_type:
        query = query.filter_by(type=tx_type)

    start_date = request.args.get('startDate')
    if start_date:
        try:
            query = query.filter(Transaction.date >= _parse_date(start_date, 'startDate'))
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

    end_date = request.args.get('endDate')
    if end_date:
        try:
            query = query.filter(Transaction.date <= _parse_date(end_date, 'endDate'))
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

    transactions = query.order_by(Transaction.date.desc(), Transaction.id.desc()).all()
    return jsonify([t.to_dict() for t in transactions])


@transactions_bp.route('/', methods=['POST'])
def create_transaction():
    data = request.get_json(silent=True) or {}

    trip_id = data.get('tripId')
    trip = db.session.get(Trip, trip_id) if trip_id else None
    if not trip:
        return jsonify({'error': 'A valid tripId is required'}), 400

    tx_type = data.get('type')
    if tx_type not in TRANSACTION_TYPES:
        return jsonify({'error': f'type must be one of {TRANSACTION_TYPES}'}), 400

    try:
        amount_sar = _parse_positive_decimal(data.get('amountSar'), 'amountSar')
        tx_date = _parse_date(data.get('date'), 'date')
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    category_id = data.get('categoryId')
    category = db.session.get(Category, category_id) if category_id else None
    if not category or category.trip_id != trip_id:
        return jsonify({'error': 'A valid categoryId (belonging to this trip) is required'}), 400

    subcategory_id = data.get('subcategoryId')
    if subcategory_id is not None:
        subcategory = db.session.get(Category, subcategory_id)
        if not subcategory or subcategory.trip_id != trip_id:
            return jsonify({'error': 'subcategoryId must belong to this trip'}), 400

    location = data.get('location', 'Other')
    if location not in LOCATION_CHOICES:
        return jsonify({'error': f'location must be one of {LOCATION_CHOICES}'}), 400

    # Immutable snapshot — computed once, at creation time, from the trip's
    # current exchanges. Never recalculated afterwards from live rate updates.
    exchanges = _get_trip_exchanges_as_dicts(trip_id)
    snapshot = calc_expense_pkr_snapshot(amount_sar, exchanges)

    transaction = Transaction(
        trip_id=trip_id,
        type=tx_type,
        amount_sar=amount_sar,
        pkr_equivalent=Decimal(snapshot['pkr_equivalent']),
        acquisition_rate_used=Decimal(snapshot['acquisition_rate_used']),
        category_id=category_id,
        subcategory_id=subcategory_id,
        date=tx_date,
        location=location,
        note=data.get('note'),
        shopping_item_id=data.get('shoppingItemId'),
    )
    db.session.add(transaction)
    db.session.commit()
    return jsonify(transaction.to_dict()), 201


@transactions_bp.route('/<int:transaction_id>', methods=['GET'])
def get_transaction(transaction_id):
    transaction = db.session.get(Transaction, transaction_id)
    if not transaction:
        return jsonify({'error': 'Transaction not found'}), 404
    return jsonify(transaction.to_dict())


@transactions_bp.route('/<int:transaction_id>', methods=['PATCH'])
def update_transaction(transaction_id):
    transaction = db.session.get(Transaction, transaction_id)
    if not transaction:
        return jsonify({'error': 'Transaction not found'}), 404

    data = request.get_json(silent=True) or {}

    if 'type' in data:
        if data['type'] not in TRANSACTION_TYPES:
            return jsonify({'error': f'type must be one of {TRANSACTION_TYPES}'}), 400
        transaction.type = data['type']

    if 'amountSar' in data:
        try:
            new_amount = _parse_positive_decimal(data['amountSar'], 'amountSar')
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        # Re-derive the PKR snapshot from the ORIGINAL rate used at entry time —
        # correcting a typo must not silently pull in today's acquisition rate.
        transaction.amount_sar = new_amount
        transaction.pkr_equivalent = (new_amount * transaction.acquisition_rate_used).quantize(
            _MONEY_DP, rounding=ROUND_HALF_UP
        )

    if 'categoryId' in data:
        category = db.session.get(Category, data['categoryId'])
        if not category or category.trip_id != transaction.trip_id:
            return jsonify({'error': 'categoryId must belong to this trip'}), 400
        transaction.category_id = data['categoryId']

    if 'subcategoryId' in data:
        sub_id = data['subcategoryId']
        if sub_id is not None:
            subcategory = db.session.get(Category, sub_id)
            if not subcategory or subcategory.trip_id != transaction.trip_id:
                return jsonify({'error': 'subcategoryId must belong to this trip'}), 400
        transaction.subcategory_id = sub_id

    if 'date' in data:
        try:
            transaction.date = _parse_date(data['date'], 'date')
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

    if 'location' in data:
        if data['location'] not in LOCATION_CHOICES:
            return jsonify({'error': f'location must be one of {LOCATION_CHOICES}'}), 400
        transaction.location = data['location']

    if 'note' in data:
        transaction.note = data['note']

    if 'shoppingItemId' in data:
        transaction.shopping_item_id = data['shoppingItemId']

    db.session.commit()
    return jsonify(transaction.to_dict())


@transactions_bp.route('/<int:transaction_id>', methods=['DELETE'])
def delete_transaction(transaction_id):
    transaction = db.session.get(Transaction, transaction_id)
    if not transaction:
        return jsonify({'error': 'Transaction not found'}), 404
    db.session.delete(transaction)
    db.session.commit()
    return '', 204
