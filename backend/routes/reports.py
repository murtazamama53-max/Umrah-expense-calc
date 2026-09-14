"""
UMRAH WALLET — Reports API

A single balance-summary endpoint over server-side data, built on the same
calculator primitives the rest of the backend uses. Full dashboard
aggregations (category/location breakdowns, daily allowance, projections)
live client-side in dashboardService.js against IndexedDB — this endpoint
is only for a sync/reporting consumer that needs a trip's current SAR
position from the server, not a duplicate of the client dashboard.
"""

from flask import Blueprint, jsonify, request

from .. import db
from ..models import ExchangeTransaction, Transaction, Trip
from ..services.calculator import calc_balance_summary

reports_bp = Blueprint('reports', __name__)


@reports_bp.route('/summary', methods=['GET'])
def summary():
    trip_id = request.args.get('tripId', type=int)
    if not trip_id:
        return jsonify({'error': 'tripId query parameter is required'}), 400

    trip = db.session.get(Trip, trip_id)
    if not trip:
        return jsonify({'error': 'Trip not found'}), 404

    exchanges = ExchangeTransaction.query.filter_by(trip_id=trip_id).all()
    transactions = Transaction.query.filter_by(trip_id=trip_id).all()

    ex_dicts = [{'pkr_given': e.pkr_given, 'sar_received': e.sar_received} for e in exchanges]
    tx_dicts = [{'type': t.type, 'amount_sar': t.amount_sar} for t in transactions]

    balance = calc_balance_summary(ex_dicts, tx_dicts)

    return jsonify({
        'tripId':           trip_id,
        'balanceSar':       balance['balance_sar'],
        'pkrValue':         balance['pkr_value'],
        'weightedRate':     balance['weighted_rate'],
        'exchangeCount':    len(exchanges),
        'transactionCount': len(transactions),
    })
