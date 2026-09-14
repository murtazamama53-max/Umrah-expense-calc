"""
UMRAH WALLET — Backend Calculator Service (Python)

Mirrors exchangeService.js and calculatorService.js logic in Python.
Used by Flask API and pytest tests.

All monetary arithmetic uses Python's built-in decimal.Decimal.
Never use float for money.
"""

from decimal import Decimal, ROUND_HALF_UP, InvalidOperation


# ── Precision contexts ─────────────────────────────────────────────────────

_RATE_DP  = Decimal('0.000001')   # 6 decimal places for rates
_MONEY_DP = Decimal('0.01')       # 2 decimal places for amounts


def _to_decimal(value) -> Decimal:
    """Convert int, float, or str to Decimal safely."""
    try:
        return Decimal(str(value))
    except InvalidOperation:
        raise ValueError(f'Invalid numeric value: {value!r}')


def _assert_positive(value: Decimal, field: str) -> None:
    if value <= 0:
        raise ValueError(f'{field} must be greater than zero. Got: {value}')


# ── Exchange calculations ──────────────────────────────────────────────────

def calc_acquisition_rate(pkr_given, sar_received) -> Decimal:
    """
    Calculate acquisition rate for a single exchange.
    Formula: pkr_given / sar_received
    """
    pkr = _to_decimal(pkr_given)
    sar = _to_decimal(sar_received)
    _assert_positive(pkr, 'pkr_given')
    _assert_positive(sar, 'sar_received')
    return (pkr / sar).quantize(_RATE_DP, rounding=ROUND_HALF_UP)


def calc_weighted_avg_rate(exchanges: list[dict]) -> Decimal:
    """
    Weighted-average acquisition rate across multiple exchanges.
    Formula: sum(pkr_given) / sum(sar_received)

    Each exchange dict must have 'pkr_given' and 'sar_received'.
    """
    if not exchanges:
        raise ValueError('Cannot calculate weighted average rate: no exchanges provided')

    total_pkr = Decimal('0')
    total_sar = Decimal('0')

    for ex in exchanges:
        pkr = _to_decimal(ex['pkr_given'])
        sar = _to_decimal(ex['sar_received'])
        _assert_positive(pkr, 'pkr_given')
        _assert_positive(sar, 'sar_received')
        total_pkr += pkr
        total_sar += sar

    _assert_positive(total_sar, 'total sar_received')
    return (total_pkr / total_sar).quantize(_RATE_DP, rounding=ROUND_HALF_UP)


def calc_total_sar_acquired(exchanges: list[dict]) -> Decimal:
    """Sum all sar_received across exchanges."""
    if not exchanges:
        return Decimal('0.00')
    return sum((_to_decimal(ex['sar_received']) for ex in exchanges), Decimal('0')).quantize(_MONEY_DP)


def calc_total_pkr_invested(exchanges: list[dict]) -> Decimal:
    """Sum all pkr_given across exchanges."""
    if not exchanges:
        return Decimal('0.00')
    return sum((_to_decimal(ex['pkr_given']) for ex in exchanges), Decimal('0')).quantize(_MONEY_DP)


def calc_total_sar_spent(transactions: list[dict]) -> Decimal:
    """
    Net SAR spent: EXPENSE adds, REFUND subtracts.
    """
    if not transactions:
        return Decimal('0.00')

    total = Decimal('0')
    for tx in transactions:
        amount = _to_decimal(tx['amount_sar'])
        if tx['type'] == 'EXPENSE':
            total += amount
        elif tx['type'] == 'REFUND':
            total -= amount

    return total.quantize(_MONEY_DP)


def calc_sar_balance(exchanges: list[dict], transactions: list[dict]) -> Decimal:
    """Current SAR wallet balance."""
    acquired = calc_total_sar_acquired(exchanges)
    spent    = calc_total_sar_spent(transactions)
    return (acquired - spent).quantize(_MONEY_DP)


def calc_balance_summary(exchanges: list[dict], transactions: list[dict]) -> dict:
    """Full balance summary dict (all values as str for JSON safety)."""
    if not exchanges:
        return {
            'balance_sar':   '0.00',
            'pkr_value':     '0.00',
            'weighted_rate': '0.000000',
        }

    balance_sar   = calc_sar_balance(exchanges, transactions)
    weighted_rate = calc_weighted_avg_rate(exchanges)
    pkr_value     = (balance_sar * weighted_rate).quantize(_MONEY_DP)

    return {
        'balance_sar':   str(balance_sar),
        'pkr_value':     str(pkr_value),
        'weighted_rate': str(weighted_rate),
    }


# ── SAR↔PKR conversion ─────────────────────────────────────────────────────

def sar_to_pkr(sar_amount, rate) -> Decimal:
    """Convert SAR to PKR. Both must be positive."""
    sar = _to_decimal(sar_amount)
    r   = _to_decimal(rate)
    if sar < 0:
        raise ValueError('sar_amount cannot be negative')
    _assert_positive(r, 'rate')
    return (sar * r).quantize(_MONEY_DP, rounding=ROUND_HALF_UP)


def pkr_to_sar(pkr_amount, rate) -> Decimal:
    """Convert PKR to SAR."""
    pkr = _to_decimal(pkr_amount)
    r   = _to_decimal(rate)
    if pkr < 0:
        raise ValueError('pkr_amount cannot be negative')
    _assert_positive(r, 'rate')
    return (pkr / r).quantize(_MONEY_DP, rounding=ROUND_HALF_UP)


def calc_expense_pkr_snapshot(amount_sar, exchanges: list[dict]) -> dict:
    """
    Compute the immutable PKR snapshot for a new expense.
    Returns dict with 'pkr_equivalent' and 'acquisition_rate_used'.
    """
    if not exchanges:
        return {'pkr_equivalent': '0.00', 'acquisition_rate_used': '0.000000'}

    sar  = _to_decimal(amount_sar)
    _assert_positive(sar, 'amount_sar')

    rate   = calc_weighted_avg_rate(exchanges)
    pkr_eq = (sar * rate).quantize(_MONEY_DP, rounding=ROUND_HALF_UP)

    return {
        'pkr_equivalent':       str(pkr_eq),
        'acquisition_rate_used': str(rate),
    }
