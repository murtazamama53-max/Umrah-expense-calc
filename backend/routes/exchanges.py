"""
UMRAH WALLET — Exchanges API

An ExchangeTransaction records a single PKR→SAR acquisition.
acquisition_rate is always recomputed server-side from pkr_given/sar_received
(never trusted from the client) so it can never drift from the source amounts.

NOTE: Editing or deleting an exchange does NOT touch any existing Transaction
records — those keep their own immutable pkr_equivalent / acquisition_rate_used
snapshot from when they were created. This is what "historical immutability"
means in this app: expense snapshots don't move when exchange data changes.
"""

from datetime import date
from decimal import Decimal, InvalidOperation

from flask import Blueprint, jsonify, request

from .. import db
from ..models import ExchangeTransaction, Trip
from ..services.calculator import (
    calc_acquisition_rate,
    calc_total_pkr_invested,
    calc_total_sar_acquired,
    calc_weighted_avg_rate,
)

exchanges_bp = Blueprint('exchanges', __name__)


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


@exchanges_bp.route('/', methods=['GET'])
def list_exchanges():
    trip_id = request.args.get('tripId', type=int)
    if not trip_id:
        return jsonify({'error': 'tripId query parameter is required'}), 400

    exchanges = (
        ExchangeTransaction.query.filter_by(trip_id=trip_id)
        .order_by(ExchangeTransaction.date.asc(), ExchangeTransaction.id.asc())
        .all()
    )
    return jsonify([e.to_dict() for e in exchanges])


@exchanges_bp.route('/summary', methods=['GET'])
def exchange_summary():
    trip_id = request.args.get('tripId', type=int)
    if not trip_id:
        return jsonify({'error': 'tripId query parameter is required'}), 400

    exchanges = ExchangeTransaction.query.filter_by(trip_id=trip_id).all()
    ex_dicts = [{'pkr_given': e.pkr_given, 'sar_received': e.sar_received} for e in exchanges]

    if not ex_dicts:
        return jsonify({
            'totalSarAcquired': '0.00',
            'totalPkrInvested': '0.00',
            'weightedAvgRate':  '0.000000',
            'exchangeCount':    0,
        })

    return jsonify({
        'totalSarAcquired': str(calc_total_sar_acquired(ex_dicts)),
        'totalPkrInvested': str(calc_total_pkr_invested(ex_dicts)),
        'weightedAvgRate':  str(calc_weighted_avg_rate(ex_dicts)),
        'exchangeCount':    len(ex_dicts),
    })


@exchanges_bp.route('/', methods=['POST'])
def create_exchange():
    data = request.get_json(silent=True) or {}

    trip_id = data.get('tripId')
    if not trip_id or not db.session.get(Trip, trip_id):
        return jsonify({'error': 'A valid tripId is required'}), 400

    try:
        pkr_given = _parse_positive_decimal(data.get('pkrGiven'), 'pkrGiven')
        sar_received = _parse_positive_decimal(data.get('sarReceived'), 'sarReceived')
        ex_date = _parse_date(data.get('date'), 'date')
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    exchange = ExchangeTransaction(
        trip_id=trip_id,
        pkr_given=pkr_given,
        sar_received=sar_received,
        date=ex_date,
        location=data.get('location'),
        note=data.get('note'),
    )
    db.session.add(exchange)
    db.session.commit()
    return jsonify(exchange.to_dict()), 201


@exchanges_bp.route('/<int:exchange_id>', methods=['GET'])
def get_exchange(exchange_id):
    exchange = db.session.get(ExchangeTransaction, exchange_id)
    if not exchange:
        return jsonify({'error': 'Exchange not found'}), 404
    return jsonify(exchange.to_dict())


@exchanges_bp.route('/<int:exchange_id>', methods=['PATCH'])
def update_exchange(exchange_id):
    exchange = db.session.get(ExchangeTransaction, exchange_id)
    if not exchange:
        return jsonify({'error': 'Exchange not found'}), 404

    data = request.get_json(silent=True) or {}
    rate_inputs_changed = False

    if 'pkrGiven' in data:
        try:
            exchange.pkr_given = _parse_positive_decimal(data['pkrGiven'], 'pkrGiven')
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        rate_inputs_changed = True

    if 'sarReceived' in data:
        try:
            exchange.sar_received = _parse_positive_decimal(data['sarReceived'], 'sarReceived')
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        rate_inputs_changed = True

    if rate_inputs_changed:
        # Recompute so acquisition_rate can never drift from pkr_given/sar_received.
        # Uses calc_acquisition_rate() — the same quantized (6dp, ROUND_HALF_UP)
        # logic as the rest of the backend.
        exchange.acquisition_rate = calc_acquisition_rate(exchange.pkr_given, exchange.sar_received)

    if 'date' in data:
        try:
            exchange.date = _parse_date(data['date'], 'date')
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

    if 'location' in data:
        exchange.location = data['location']
    if 'note' in data:
        exchange.note = data['note']

    db.session.commit()
    return jsonify(exchange.to_dict())


@exchanges_bp.route('/<int:exchange_id>', methods=['DELETE'])
def delete_exchange(exchange_id):
    exchange = db.session.get(ExchangeTransaction, exchange_id)
    if not exchange:
        return jsonify({'error': 'Exchange not found'}), 404
    db.session.delete(exchange)
    db.session.commit()
    return '', 204
