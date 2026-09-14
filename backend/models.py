"""
UMRAH WALLET — SQLAlchemy Models

All monetary amounts stored as Numeric(14, 2) for currency precision.
Acquisition rates stored as Numeric(14, 6) for extra decimal precision.

HISTORICAL IMMUTABILITY RULE:
  Transaction.pkr_equivalent and Transaction.acquisition_rate_used are
  snapshot values recorded at entry time. They are NEVER updated by
  background jobs, rate refreshes, or new exchange records.
"""

from datetime import datetime, timezone
from decimal import Decimal
from . import db
from .services.calculator import calc_acquisition_rate

# ── Enums (stored as strings for portability) ──────────────────────────────

LOCATION_CHOICES    = ('Makkah', 'Madinah', 'Jeddah', 'Other')
TRANSACTION_TYPES   = ('EXPENSE', 'REFUND')


def _now():
    """UTC datetime for created_at fields."""
    return datetime.now(timezone.utc)


# ── Models ─────────────────────────────────────────────────────────────────

class Trip(db.Model):
    """
    A single Umrah trip. Acts as the wallet context.
    All other records belong to a trip.
    """
    __tablename__ = 'trips'

    id                  = db.Column(db.Integer,      primary_key=True)
    name                = db.Column(db.String(120),  nullable=False, default='Umrah 2026')
    start_date          = db.Column(db.Date,          nullable=False)
    end_date            = db.Column(db.Date,          nullable=False)
    daily_allowance_sar = db.Column(db.Numeric(14, 2), nullable=True)   # Optional daily budget
    home_currency       = db.Column(db.String(3),     nullable=False, default='PKR')
    travel_currency     = db.Column(db.String(3),     nullable=False, default='SAR')
    created_at          = db.Column(db.DateTime(timezone=True), nullable=False, default=_now)

    # Relationships
    exchanges     = db.relationship('ExchangeTransaction', back_populates='trip', cascade='all, delete-orphan', lazy='dynamic')
    transactions  = db.relationship('Transaction',         back_populates='trip', cascade='all, delete-orphan', lazy='dynamic')
    categories    = db.relationship('Category',            back_populates='trip', cascade='all, delete-orphan', lazy='dynamic')
    shopping_items= db.relationship('ShoppingItem',        back_populates='trip', cascade='all, delete-orphan', lazy='dynamic')
    rate_snapshots= db.relationship('ExchangeRateSnapshot',back_populates='trip', cascade='all, delete-orphan', lazy='dynamic')

    def to_dict(self):
        return {
            'id':                  self.id,
            'name':                self.name,
            'startDate':           self.start_date.isoformat(),
            'endDate':             self.end_date.isoformat(),
            'dailyAllowanceSar':   str(self.daily_allowance_sar) if self.daily_allowance_sar else None,
            'homeCurrency':        self.home_currency,
            'travelCurrency':      self.travel_currency,
            'createdAt':           self.created_at.isoformat(),
        }


class ExchangeTransaction(db.Model):
    """
    A single PKR→SAR currency exchange event.

    acquisition_rate is computed (pkr_given / sar_received) and stored
    as a convenience; the source of truth is always pkr_given + sar_received.
    """
    __tablename__ = 'exchange_transactions'

    id               = db.Column(db.Integer,       primary_key=True)
    trip_id          = db.Column(db.Integer,       db.ForeignKey('trips.id'), nullable=False, index=True)
    pkr_given        = db.Column(db.Numeric(14, 2), nullable=False)
    sar_received     = db.Column(db.Numeric(14, 2), nullable=False)
    acquisition_rate = db.Column(db.Numeric(14, 6), nullable=False)   # pkr_given / sar_received
    date             = db.Column(db.Date,           nullable=False)
    location         = db.Column(db.String(200),    nullable=True)
    note             = db.Column(db.Text,           nullable=True)
    created_at       = db.Column(db.DateTime(timezone=True), nullable=False, default=_now)

    trip = db.relationship('Trip', back_populates='exchanges')

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Auto-compute acquisition_rate if not provided.
        # Uses the same calc_acquisition_rate() as the rest of the backend
        # (quantized to 6dp, ROUND_HALF_UP) so this can never drift from it.
        if self.acquisition_rate is None and self.pkr_given and self.sar_received:
            if Decimal(str(self.sar_received)) > 0:
                self.acquisition_rate = calc_acquisition_rate(self.pkr_given, self.sar_received)

    def to_dict(self):
        return {
            'id':              self.id,
            'tripId':          self.trip_id,
            'pkrGiven':        str(self.pkr_given),
            'sarReceived':     str(self.sar_received),
            'acquisitionRate': str(self.acquisition_rate),
            'date':            self.date.isoformat(),
            'location':        self.location,
            'note':            self.note,
            'createdAt':       self.created_at.isoformat(),
        }


class Transaction(db.Model):
    """
    An expense or refund against the SAR wallet.

    CRITICAL FIELDS (immutable after creation):
      pkr_equivalent       — SAR amount × weighted rate at entry time (PKR value snapshot)
      acquisition_rate_used — weighted avg rate used at entry time

    These fields MUST NOT be updated by any background job or rate refresh.
    """
    __tablename__ = 'transactions'

    id                    = db.Column(db.Integer,      primary_key=True)
    trip_id               = db.Column(db.Integer,      db.ForeignKey('trips.id'), nullable=False, index=True)
    type                  = db.Column(db.String(10),   nullable=False)                  # EXPENSE | REFUND
    amount_sar            = db.Column(db.Numeric(14, 2), nullable=False)
    pkr_equivalent        = db.Column(db.Numeric(14, 2), nullable=False)                # SNAPSHOT — immutable
    acquisition_rate_used = db.Column(db.Numeric(14, 6), nullable=False)                # SNAPSHOT — immutable
    category_id           = db.Column(db.Integer,      db.ForeignKey('categories.id'), nullable=False)
    subcategory_id        = db.Column(db.Integer,      db.ForeignKey('categories.id'), nullable=True)
    date                  = db.Column(db.Date,          nullable=False)
    location              = db.Column(db.String(20),   nullable=False, default='Other') # Makkah|Madinah|Jeddah|Other
    note                  = db.Column(db.Text,          nullable=True)
    shopping_item_id      = db.Column(db.Integer,      db.ForeignKey('shopping_items.id'), nullable=True)
    created_at            = db.Column(db.DateTime(timezone=True), nullable=False, default=_now)

    # Constraints
    __table_args__ = (
        db.CheckConstraint(f"type IN {TRANSACTION_TYPES}", name='ck_transaction_type'),
        db.CheckConstraint(f"location IN {LOCATION_CHOICES}", name='ck_transaction_location'),
        db.CheckConstraint('amount_sar > 0', name='ck_transaction_amount_positive'),
    )

    trip         = db.relationship('Trip',         back_populates='transactions')
    category     = db.relationship('Category',     foreign_keys=[category_id])
    subcategory  = db.relationship('Category',     foreign_keys=[subcategory_id])
    shopping_item= db.relationship('ShoppingItem', back_populates='transaction')

    def to_dict(self):
        return {
            'id':                  self.id,
            'tripId':              self.trip_id,
            'type':                self.type,
            'amountSar':           str(self.amount_sar),
            'pkrEquivalent':       str(self.pkr_equivalent),
            'acquisitionRateUsed': str(self.acquisition_rate_used),
            'categoryId':          self.category_id,
            'subcategoryId':       self.subcategory_id,
            'date':                self.date.isoformat(),
            'location':            self.location,
            'note':                self.note,
            'shoppingItemId':      self.shopping_item_id,
            'createdAt':           self.created_at.isoformat(),
        }


class Category(db.Model):
    """
    User-manageable expense category.
    Subcategories use self-referencing parent_id.
    parent_id = None → top-level category
    parent_id = <id> → subcategory of that category
    """
    __tablename__ = 'categories'

    id          = db.Column(db.Integer,     primary_key=True)
    trip_id     = db.Column(db.Integer,     db.ForeignKey('trips.id'), nullable=False, index=True)
    name        = db.Column(db.String(80),  nullable=False)
    icon        = db.Column(db.String(10),  nullable=True, default='📦')    # Emoji
    parent_id   = db.Column(db.Integer,     db.ForeignKey('categories.id'), nullable=True, index=True)
    is_default  = db.Column(db.Boolean,     nullable=False, default=False)
    sort_order  = db.Column(db.Integer,     nullable=False, default=0)
    created_at  = db.Column(db.DateTime(timezone=True), nullable=False, default=_now)

    trip          = db.relationship('Trip',     back_populates='categories')
    subcategories = db.relationship('Category', backref=db.backref('parent', remote_side=[id]), lazy='dynamic')

    def to_dict(self, include_subcategories=False):
        d = {
            'id':         self.id,
            'tripId':     self.trip_id,
            'name':       self.name,
            'icon':       self.icon,
            'parentId':   self.parent_id,
            'isDefault':  self.is_default,
            'sortOrder':  self.sort_order,
            'createdAt':  self.created_at.isoformat(),
        }
        if include_subcategories:
            d['subcategories'] = [s.to_dict() for s in self.subcategories.order_by(Category.sort_order)]
        return d


class ShoppingItem(db.Model):
    """
    A planned purchase item. Can be converted to an Expense when purchased.
    """
    __tablename__ = 'shopping_items'

    id             = db.Column(db.Integer,      primary_key=True)
    trip_id        = db.Column(db.Integer,      db.ForeignKey('trips.id'), nullable=False, index=True)
    name           = db.Column(db.String(200),  nullable=False)
    category_id    = db.Column(db.Integer,      db.ForeignKey('categories.id'), nullable=True)
    expected_sar   = db.Column(db.Numeric(14, 2), nullable=True)
    is_purchased   = db.Column(db.Boolean,       nullable=False, default=False)
    actual_sar     = db.Column(db.Numeric(14, 2), nullable=True)   # Set when purchased
    note           = db.Column(db.Text,           nullable=True)
    created_at     = db.Column(db.DateTime(timezone=True), nullable=False, default=_now)

    trip        = db.relationship('Trip',        back_populates='shopping_items')
    category    = db.relationship('Category',    foreign_keys=[category_id])
    transaction = db.relationship('Transaction', back_populates='shopping_item', uselist=False)

    def to_dict(self):
        return {
            'id':            self.id,
            'tripId':        self.trip_id,
            'name':          self.name,
            'categoryId':    self.category_id,
            'expectedSar':   str(self.expected_sar) if self.expected_sar else None,
            'isPurchased':   self.is_purchased,
            'actualSar':     str(self.actual_sar) if self.actual_sar else None,
            'transactionId': self.transaction.id if self.transaction else None,
            'note':          self.note,
            'createdAt':     self.created_at.isoformat(),
        }


class ExchangeRateSnapshot(db.Model):
    """
    A cached live market SAR→PKR rate.
    Reference only — never used to rewrite historical data.
    Maximum one 'is_latest=True' per trip at any time.
    """
    __tablename__ = 'exchange_rate_snapshots'

    id         = db.Column(db.Integer,      primary_key=True)
    trip_id    = db.Column(db.Integer,      db.ForeignKey('trips.id'), nullable=False, index=True)
    sar_to_pkr = db.Column(db.Numeric(14, 6), nullable=False)
    source     = db.Column(db.String(100),   nullable=False)
    fetched_at = db.Column(db.DateTime(timezone=True), nullable=False)
    is_latest  = db.Column(db.Boolean,       nullable=False, default=False, index=True)

    trip = db.relationship('Trip', back_populates='rate_snapshots')

    def to_dict(self):
        return {
            'id':        self.id,
            'tripId':    self.trip_id,
            'sarToPkr':  str(self.sar_to_pkr),
            'source':    self.source,
            'fetchedAt': self.fetched_at.isoformat(),
            'isLatest':  self.is_latest,
        }
