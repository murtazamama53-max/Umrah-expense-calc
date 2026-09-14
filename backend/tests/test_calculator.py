"""
UMRAH WALLET — Backend Unit Tests (pytest)

Tests the Python services/calculator.py — the server-side mirror of
the JS business logic.

Run with:  cd backend && pytest tests/ -v
"""

import pytest
from decimal import Decimal
from backend.services.calculator import (
    calc_acquisition_rate,
    calc_weighted_avg_rate,
    calc_total_sar_acquired,
    calc_total_pkr_invested,
    calc_total_sar_spent,
    calc_sar_balance,
    calc_balance_summary,
    sar_to_pkr,
    pkr_to_sar,
    calc_expense_pkr_snapshot,
)


# ── calc_acquisition_rate ──────────────────────────────────────────────────

class TestCalcAcquisitionRate:
    def test_product_brief_example(self):
        """PKR 50,000 / 667.56 SAR ≈ 74.90 PKR/SAR"""
        rate = calc_acquisition_rate('50000', '667.56')
        assert round(float(rate), 2) == 74.90

    def test_returns_decimal(self):
        assert isinstance(calc_acquisition_rate(100, 2), Decimal)

    def test_six_decimal_places(self):
        rate = calc_acquisition_rate('100', '3')
        assert str(rate) == '33.333333'

    def test_raises_on_zero_pkr(self):
        with pytest.raises(ValueError, match='pkr_given'):
            calc_acquisition_rate(0, 100)

    def test_raises_on_zero_sar(self):
        with pytest.raises(ValueError, match='sar_received'):
            calc_acquisition_rate(50000, 0)

    def test_raises_on_negative_pkr(self):
        with pytest.raises(ValueError):
            calc_acquisition_rate(-100, 50)

    def test_raises_on_invalid_string(self):
        with pytest.raises(ValueError):
            calc_acquisition_rate('abc', 100)


# ── calc_weighted_avg_rate ─────────────────────────────────────────────────

class TestCalcWeightedAvgRate:
    def test_single_exchange(self):
        exchanges = [{'pkr_given': '50000', 'sar_received': '667.56'}]
        rate = calc_weighted_avg_rate(exchanges)
        assert round(float(rate), 2) == 74.90

    def test_two_exchanges(self):
        exchanges = [
            {'pkr_given': '50000', 'sar_received': '667.56'},
            {'pkr_given': '30000', 'sar_received': '397.35'},
        ]
        rate = calc_weighted_avg_rate(exchanges)
        assert round(float(rate), 2) == pytest.approx(75.12, abs=0.05)

    def test_three_exchanges_seed_data(self):
        exchanges = [
            {'pkr_given': '50000', 'sar_received': '667.56'},
            {'pkr_given': '30000', 'sar_received': '397.35'},
            {'pkr_given': '20000', 'sar_received': '263.85'},
        ]
        rate = calc_weighted_avg_rate(exchanges)
        # 100000 / 1328.76 ≈ 75.26
        assert round(float(rate), 2) == pytest.approx(75.26, abs=0.05)

    def test_weighted_not_simple_average(self):
        exchanges = [
            {'pkr_given': '100000', 'sar_received': '1000'},  # rate 100
            {'pkr_given': '100',    'sar_received': '100'},   # rate 1
        ]
        weighted = calc_weighted_avg_rate(exchanges)
        simple_avg = Decimal('50.5')  # (100+1)/2
        assert weighted != simple_avg
        assert round(float(weighted), 0) == pytest.approx(91, abs=1)

    def test_raises_on_empty(self):
        with pytest.raises(ValueError, match='no exchanges'):
            calc_weighted_avg_rate([])

    def test_raises_on_none(self):
        with pytest.raises((ValueError, TypeError)):
            calc_weighted_avg_rate(None)


# ── calc_total_sar_spent ───────────────────────────────────────────────────

class TestCalcTotalSarSpent:
    def test_sums_expenses(self):
        txs = [
            {'type': 'EXPENSE', 'amount_sar': '35.00'},
            {'type': 'EXPENSE', 'amount_sar': '15.00'},
            {'type': 'EXPENSE', 'amount_sar': '32.50'},
        ]
        assert calc_total_sar_spent(txs) == Decimal('82.50')

    def test_subtracts_refunds(self):
        txs = [
            {'type': 'EXPENSE', 'amount_sar': '100.00'},
            {'type': 'REFUND',  'amount_sar': '25.00'},
        ]
        assert calc_total_sar_spent(txs) == Decimal('75.00')

    def test_empty(self):
        assert calc_total_sar_spent([]) == Decimal('0.00')


# ── calc_sar_balance ───────────────────────────────────────────────────────

class TestCalcSarBalance:
    def test_correct_balance(self):
        exchanges = [
            {'pkr_given': '50000', 'sar_received': '667.56'},
            {'pkr_given': '30000', 'sar_received': '397.35'},
        ]
        transactions = [
            {'type': 'EXPENSE', 'amount_sar': '35.00'},
            {'type': 'EXPENSE', 'amount_sar': '15.00'},
            {'type': 'EXPENSE', 'amount_sar': '120.00'},
        ]
        balance = calc_sar_balance(exchanges, transactions)
        assert balance == Decimal('894.91')

    def test_zero_transactions(self):
        exchanges = [{'pkr_given': '50000', 'sar_received': '500'}]
        assert calc_sar_balance(exchanges, []) == Decimal('500.00')


# ── sar_to_pkr / pkr_to_sar ───────────────────────────────────────────────

class TestConversions:
    def test_sar_to_pkr_brief_example(self):
        """50 SAR × 74.86 = PKR 3743.00"""
        result = sar_to_pkr('50', '74.86')
        assert result == Decimal('3743.00')

    def test_pkr_to_sar_round_trip(self):
        """PKR 3745 ÷ 74.90 ≈ 50 SAR"""
        result = pkr_to_sar('3745', '74.90')
        assert round(float(result), 0) == pytest.approx(50, abs=1)

    def test_sar_to_pkr_negative_raises(self):
        with pytest.raises(ValueError, match='negative'):
            sar_to_pkr('-1', 75)

    def test_zero_rate_raises(self):
        with pytest.raises(ValueError, match='rate'):
            sar_to_pkr(100, 0)


# ── calc_expense_pkr_snapshot ──────────────────────────────────────────────

class TestExpensePkrSnapshot:
    def test_product_brief(self):
        """50 SAR at 74.90 rate → ~PKR 3,745"""
        exchanges = [{'pkr_given': '50000', 'sar_received': '667.56'}]
        snap = calc_expense_pkr_snapshot('50', exchanges)
        pkr = float(snap['pkr_equivalent'])
        assert 3740 < pkr < 3750

    def test_no_exchanges_returns_zero(self):
        snap = calc_expense_pkr_snapshot('50', [])
        assert snap['pkr_equivalent'] == '0.00'

    def test_zero_amount_raises(self):
        exchanges = [{'pkr_given': '50000', 'sar_received': '667'}]
        with pytest.raises(ValueError):
            calc_expense_pkr_snapshot('0', exchanges)

    def test_immutability_concept(self):
        """Two different exchange sets produce different snapshots"""
        ex1 = [{'pkr_given': '74900', 'sar_received': '1000'}]  # 74.90
        ex2 = [{'pkr_given': '80000', 'sar_received': '1000'}]  # 80.00
        s1 = calc_expense_pkr_snapshot('100', ex1)
        s2 = calc_expense_pkr_snapshot('100', ex2)
        assert s1['pkr_equivalent'] != s2['pkr_equivalent']
        assert s1['pkr_equivalent'] == '7490.00'
        assert s2['pkr_equivalent'] == '8000.00'
