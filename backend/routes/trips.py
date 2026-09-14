"""
UMRAH WALLET — Trips API

A Trip is the wallet context. This is a single-user personal app, so in
practice there is usually exactly one trip, but the API stays generic.
"""

from datetime import date

from flask import Blueprint, jsonify, request

from .. import db
from ..models import Trip

trips_bp = Blueprint('trips', __name__)


def _parse_date(value, field):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValueError(f'{field} must be an ISO date string (YYYY-MM-DD)')


@trips_bp.route('/', methods=['GET'])
def list_trips():
    trips = Trip.query.order_by(Trip.created_at.asc()).all()
    return jsonify([t.to_dict() for t in trips])


@trips_bp.route('/', methods=['POST'])
def create_trip():
    data = request.get_json(silent=True) or {}

    try:
        start_date = _parse_date(data.get('startDate'), 'startDate')
        end_date = _parse_date(data.get('endDate'), 'endDate')
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    if end_date < start_date:
        return jsonify({'error': 'endDate must be on or after startDate'}), 400

    daily_allowance = data.get('dailyAllowanceSar')
    if daily_allowance is not None:
        try:
            daily_allowance = float(daily_allowance)
            if daily_allowance < 0:
                raise ValueError()
        except (TypeError, ValueError):
            return jsonify({'error': 'dailyAllowanceSar must be a non-negative number'}), 400

    trip = Trip(
        name=data.get('name') or 'Umrah 2026',
        start_date=start_date,
        end_date=end_date,
        daily_allowance_sar=daily_allowance,
        home_currency=data.get('homeCurrency', 'PKR'),
        travel_currency=data.get('travelCurrency', 'SAR'),
    )
    db.session.add(trip)
    db.session.commit()
    return jsonify(trip.to_dict()), 201


@trips_bp.route('/<int:trip_id>', methods=['GET'])
def get_trip(trip_id):
    trip = db.session.get(Trip, trip_id)
    if not trip:
        return jsonify({'error': 'Trip not found'}), 404
    return jsonify(trip.to_dict())


@trips_bp.route('/<int:trip_id>', methods=['PATCH'])
def update_trip(trip_id):
    trip = db.session.get(Trip, trip_id)
    if not trip:
        return jsonify({'error': 'Trip not found'}), 404

    data = request.get_json(silent=True) or {}

    if 'name' in data:
        trip.name = data['name']

    if 'startDate' in data:
        try:
            trip.start_date = _parse_date(data['startDate'], 'startDate')
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

    if 'endDate' in data:
        try:
            trip.end_date = _parse_date(data['endDate'], 'endDate')
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

    if trip.end_date < trip.start_date:
        db.session.rollback()
        return jsonify({'error': 'endDate must be on or after startDate'}), 400

    if 'dailyAllowanceSar' in data:
        val = data['dailyAllowanceSar']
        if val is None:
            trip.daily_allowance_sar = None
        else:
            try:
                val = float(val)
                if val < 0:
                    raise ValueError()
                trip.daily_allowance_sar = val
            except (TypeError, ValueError):
                db.session.rollback()
                return jsonify({'error': 'dailyAllowanceSar must be a non-negative number'}), 400

    if 'homeCurrency' in data:
        trip.home_currency = data['homeCurrency']
    if 'travelCurrency' in data:
        trip.travel_currency = data['travelCurrency']

    db.session.commit()
    return jsonify(trip.to_dict())


@trips_bp.route('/<int:trip_id>', methods=['DELETE'])
def delete_trip(trip_id):
    trip = db.session.get(Trip, trip_id)
    if not trip:
        return jsonify({'error': 'Trip not found'}), 404
    db.session.delete(trip)
    db.session.commit()
    return '', 204
