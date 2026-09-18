import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDownUp,
  CalendarDays,
  CheckCircle2,
  Home,
  Loader2,
  Plus,
  ReceiptText,
  RefreshCcw,
} from 'lucide-react';
import './App.css';
import { exportBackupData, importBackupData } from './services/backupService.js';
import { ensureAppData } from './services/appDataService.js';
import { calcAcquisitionRate } from './services/exchangeService.js';
import {
  addExchange,
  addExpense,
  getWalletSummary,
  listExchanges,
  listExpenses,
  updateExpense,
  deleteExpense,
  addCategory,
  deleteCategory,
} from './services/walletService.js';
import {
  calculateSarToPkr,
  formatPkr,
  formatRate,
  formatSar,
  pkrToSar,
} from './services/calculatorService.js';

const LOCATIONS = ['Makkah', 'Madinah', 'Jeddah', 'Other'];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function defaultEntryDate(trip) {
  const today = todayISO();
  if (!trip) return today;
  if (today < trip.startDate) return trip.startDate;
  if (today > trip.endDate) return trip.endDate;
  return today;
}

function sortNewestFirst(records) {
  return [...records].sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date);
    if (dateCompare !== 0) return dateCompare;
    return (b.id || 0) - (a.id || 0);
  });
}

function getErrorMessage(error) {
  if (!error) return 'Something went wrong.';
  if (typeof error === 'string') return error;
  return error.message || 'Something went wrong.';
}

function buildCategoryLookup(categories) {
  return new Map(categories.map((category) => [category.id, category]));
}

function useWalletData(tripId, categories, refreshKey) {
  const [state, setState] = useState({
    status: 'loading',
    data: null,
    error: null,
  });

  useEffect(() => {
    let isActive = true;

    async function load() {
      if (!tripId) return;
      setState((current) => ({ ...current, status: 'loading', error: null }));

      try {
        const [summary, exchanges, expenses] = await Promise.all([
          getWalletSummary(tripId),
          listExchanges(tripId),
          listExpenses(tripId),
        ]);

        if (!isActive) return;
        setState({
          status: 'ready',
          error: null,
          data: {
            summary,
            exchanges: sortNewestFirst(exchanges),
            expenses: sortNewestFirst(expenses),
            categoryLookup: buildCategoryLookup(categories),
          },
        });
      } catch (error) {
        if (!isActive) return;
        setState({ status: 'error', data: null, error });
      }
    }

    load();

    return () => {
      isActive = false;
    };
  }, [tripId, categories, refreshKey]);

  return state;
}

function LoadingScreen({ message = 'Opening your offline wallet...' }) {
  return (
    <div className="screen-state" role="status">
      <Loader2 className="spin" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

function ErrorScreen({ title = 'Wallet could not load', error, onRetry }) {
  return (
    <div className="screen-state screen-state--error" role="alert">
      <AlertCircle aria-hidden="true" />
      <h1>{title}</h1>
      <p>{getErrorMessage(error)}</p>
      {onRetry ? (
        <button className="button button--primary" type="button" onClick={onRetry}>
          <RefreshCcw size={16} aria-hidden="true" />
          Try again
        </button>
      ) : null}
    </div>
  );
}

function StatusMessage({ feedback }) {
  if (!feedback) return null;
  const Icon = feedback.type === 'success' ? CheckCircle2 : AlertCircle;

  return (
    <div className={`feedback feedback--${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
      <Icon size={17} aria-hidden="true" />
      <span>{feedback.text}</span>
    </div>
  );
}

function AppShell({ trip, children, onRefresh }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Umrah Wallet</p>
          <h1>{trip.name}</h1>
          <span className="trip-dates">
            <CalendarDays size={14} aria-hidden="true" />
            {trip.startDate} to {trip.endDate}
          </span>
        </div>
        <button className="icon-button" type="button" onClick={onRefresh} aria-label="Refresh wallet data">
          <RefreshCcw size={19} aria-hidden="true" />
        </button>
      </header>

      <main className="app-main">{children}</main>

      <nav className="bottom-nav" aria-label="Primary">
        <NavLink to="/" end>
          <Home size={19} aria-hidden="true" />
          <span>Overview</span>
        </NavLink>
        <NavLink to="/exchanges">
          <ArrowDownUp size={19} aria-hidden="true" />
          <span>Exchange</span>
        </NavLink>
        <NavLink to="/expenses">
          <ReceiptText size={19} aria-hidden="true" />
          <span>Expense</span>
        </NavLink>
        <NavLink to="/categories">
          <span style={{fontSize: '19px', padding: '0 2px'}}>📦</span>
          <span>Categories</span>
        </NavLink>
        <NavLink to="/settings">
          <span style={{fontSize: '19px', padding: '0 2px'}}>⚙️</span>
          <span>Settings</span>
        </NavLink>
      </nav>
    </div>
  );
}

function MetricCard({ label, value, detail, tone = 'neutral' }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      {detail ? <span>{detail}</span> : null}
    </article>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="empty-state">
      <p>{title}</p>
      <span>{body}</span>
    </div>
  );
}

function RecentExchangeList({ exchanges }) {
  if (exchanges.length === 0) {
    return (
      <EmptyState
        title="No exchanges recorded yet"
        body="Add your first PKR to SAR exchange to establish your personal acquisition rate."
      />
    );
  }

  return (
    <div className="timeline-list">
      {exchanges.slice(0, 5).map((exchange) => (
        <article className="timeline-item" key={exchange.id}>
          <div>
            <strong>{formatSar(exchange.sarReceived)}</strong>
            <span>{exchange.location || exchange.date}</span>
          </div>
          <div>
            <strong>{formatPkr(exchange.pkrGiven)}</strong>
            <span>{formatRate(exchange.acquisitionRate)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function RecentExpenseList({ expenses, categoryLookup }) {
  if (expenses.length === 0) {
    return (
      <EmptyState
        title="No expenses recorded yet"
        body="Actual spending will appear here after you add SAR expenses."
      />
    );
  }

  return (
    <div className="timeline-list">
      {expenses.slice(0, 5).map((expense) => {
        const category = categoryLookup.get(expense.categoryId);
        return (
          <article className="timeline-item" key={expense.id}>
            <div>
              <strong>{formatSar(expense.amountSar)}</strong>
              <span>{expense.note || category?.name || 'Expense'}</span>
            </div>
            <div>
              <strong>{formatPkr(expense.pkrEquivalent)}</strong>
              <span>{category?.name || 'Other'} - {expense.date}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function QuickCalculator({ weightedRate }) {
  const hasMyRate = Number(weightedRate) > 0;
  const [manualRate, setManualRate] = useState('');
  const [sarValue, setSarValue] = useState('');
  const [pkrValue, setPkrValue] = useState('');
  const [lastEdited, setLastEdited] = useState('SAR');
  const activeRate = hasMyRate ? weightedRate : manualRate;
  const canCalculate = Number(activeRate) > 0;

  function calculatePkr(value, rate) {
    try {
      return Number(rate) > 0 && value !== ''
        ? calculateSarToPkr(value, rate).pkrAmount
        : '';
    } catch {
      return '';
    }
  }

  function calculateSar(value, rate) {
    try {
      return Number(rate) > 0 && value !== ''
        ? pkrToSar(value, rate).toFixed(2)
        : '';
    } catch {
      return '';
    }
  }

  function handleSarChange(value) {
    setLastEdited('SAR');
    setSarValue(value);
    setPkrValue(calculatePkr(value, activeRate));
  }

  function handlePkrChange(value) {
    setLastEdited('PKR');
    setPkrValue(value);
    setSarValue(calculateSar(value, activeRate));
  }

  function handleManualRateChange(value) {
    setManualRate(value);
    if (hasMyRate) return;
    if (lastEdited === 'SAR') setPkrValue(calculatePkr(sarValue, value));
    if (lastEdited === 'PKR') setSarValue(calculateSar(pkrValue, value));
  }

  return (
    <section className="panel calculator-panel" aria-labelledby="calculator-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Quick calculator</p>
          <h2 id="calculator-heading">SAR to PKR</h2>
        </div>
        <span className="rate-chip">
          {hasMyRate ? 'My effective rate' : 'Manual fallback'}
        </span>
      </div>

      {!hasMyRate ? (
        <label className="field field--compact">
          <span>Manual PKR/SAR rate</span>
          <input
            inputMode="decimal"
            name="manualRate"
            placeholder="75.00"
            value={manualRate}
            onChange={(event) => handleManualRateChange(event.target.value)}
          />
        </label>
      ) : null}

      <div className="calculator-grid">
        <label className="field">
          <span>SAR</span>
          <input
            inputMode="decimal"
            name="calcSar"
            placeholder="0.00"
            value={sarValue}
            onChange={(event) => handleSarChange(event.target.value)}
          />
        </label>
        <label className="field">
          <span>PKR</span>
          <input
            inputMode="decimal"
            name="calcPkr"
            placeholder="0.00"
            value={pkrValue}
            onChange={(event) => handlePkrChange(event.target.value)}
          />
        </label>
      </div>
      <p className="helper-text">
        {canCalculate ? `Using ${formatRate(activeRate)}` : 'Enter a manual rate until your first exchange is recorded.'}
      </p>
    </section>
  );
}

function OverviewScreen({ trip, categories, refreshKey }) {
  const walletState = useWalletData(trip.id, categories, refreshKey);

  if (walletState.status === 'loading' || !walletState.data) {
    return <LoadingScreen message="Reading wallet totals from IndexedDB..." />;
  }

  if (walletState.status === 'error') {
    return <ErrorScreen title="Dashboard could not load" error={walletState.error} />;
  }

  const { summary, exchanges, expenses, categoryLookup } = walletState.data;
  const hasAnyData = exchanges.length > 0 || expenses.length > 0;

  return (
    <div className="screen-stack">
      <section className="hero-balance panel">
        <p className="eyebrow">Current SAR wallet balance</p>
        <strong>{formatSar(summary.sarBalance)}</strong>
        <span>{summary.exchangeCount > 0 ? `${formatPkr(summary.pkrValue)} at your effective rate` : 'No acquisition rate yet'}</span>
      </section>

      {!hasAnyData ? (
        <EmptyState
          title="Your wallet is ready"
          body="No fake financial transactions were added. Start by recording a real PKR to SAR exchange."
        />
      ) : null}

      <section className="metric-grid" aria-label="Wallet summary">
        <MetricCard label="Total SAR acquired" value={formatSar(summary.totalSarAcquired)} detail={`${summary.exchangeCount} exchanges`} />
        <MetricCard label="Total PKR spent" value={formatPkr(summary.totalPkrInvested)} detail="Acquiring SAR" />
        <MetricCard label="Effective rate" value={formatRate(summary.weightedRate)} detail="Weighted by SAR received" tone="gold" />
        <MetricCard label="Total expenses" value={formatSar(summary.totalSarSpent)} detail={`${summary.transactionCount} records`} />
        <MetricCard label="Remaining SAR" value={formatSar(summary.sarBalance)} detail="Acquired minus spent" tone="gold" />
      </section>

      <QuickCalculator weightedRate={summary.weightedRate} />

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent</p>
            <h2>Exchanges</h2>
          </div>
          <NavLink className="text-link" to="/exchanges">Add</NavLink>
        </div>
        <RecentExchangeList exchanges={exchanges} />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent</p>
            <h2>Expenses</h2>
          </div>
          <NavLink className="text-link" to="/expenses">Add</NavLink>
        </div>
        <RecentExpenseList expenses={expenses} categoryLookup={categoryLookup} />
      </section>
    </div>
  );
}

function ExchangeScreen({ trip, categories, refreshKey, onDataChanged }) {
  const walletState = useWalletData(trip.id, categories, refreshKey);
  const [form, setForm] = useState({
    date: defaultEntryDate(trip),
    pkrGiven: '',
    sarReceived: '',
    location: '',
    note: '',
  });
  const [feedback, setFeedback] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const previewRate = useMemo(() => {
    if (!form.pkrGiven || !form.sarReceived) return null;
    try {
      return calcAcquisitionRate(form.pkrGiven, form.sarReceived).toFixed(6);
    } catch {
      return null;
    }
  }, [form.pkrGiven, form.sarReceived]);

  function updateField(field, value) {
    setFeedback(null);
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    try {
      const created = await addExchange(trip.id, {
        date: form.date,
        pkrGiven: form.pkrGiven,
        sarReceived: form.sarReceived,
        location: form.location.trim() || null,
        note: form.note.trim() || null,
      });

      setForm((current) => ({
        ...current,
        pkrGiven: '',
        sarReceived: '',
        location: '',
        note: '',
      }));
      setFeedback({ type: 'success', text: `Exchange saved at ${formatRate(created.acquisitionRate)}.` });
      onDataChanged();
    } catch (error) {
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setIsSaving(false);
    }
  }

  const exchanges = walletState.data?.exchanges || [];

  return (
    <div className="screen-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PKR to SAR</p>
            <h2>Add exchange</h2>
          </div>
          <ArrowDownUp aria-hidden="true" />
        </div>

        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="field">
            <span>Date</span>
            <input
              name="date"
              type="date"
              required
              value={form.date}
              onChange={(event) => updateField('date', event.target.value)}
            />
          </label>
          <label className="field">
            <span>PKR given</span>
            <input
              name="pkrGiven"
              inputMode="decimal"
              required
              placeholder="50000"
              value={form.pkrGiven}
              onChange={(event) => updateField('pkrGiven', event.target.value)}
            />
          </label>
          <label className="field">
            <span>SAR received</span>
            <input
              name="sarReceived"
              inputMode="decimal"
              required
              placeholder="667.56"
              value={form.sarReceived}
              onChange={(event) => updateField('sarReceived', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Location</span>
            <input
              name="location"
              placeholder="Money changer or city"
              value={form.location}
              onChange={(event) => updateField('location', event.target.value)}
            />
          </label>
          <label className="field field--full">
            <span>Notes</span>
            <textarea
              name="note"
              rows="3"
              placeholder="Optional details"
              value={form.note}
              onChange={(event) => updateField('note', event.target.value)}
            />
          </label>

          <div className="rate-preview field--full">
            <span>Acquisition rate</span>
            <strong>{previewRate ? formatRate(previewRate) : 'Enter PKR and SAR amounts'}</strong>
          </div>

          <StatusMessage feedback={feedback} />

          <button className="button button--primary field--full" type="submit" disabled={isSaving}>
            {isSaving ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
            Save exchange
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">History</p>
            <h2>Exchange records</h2>
          </div>
          <span className="count-pill">{exchanges.length}</span>
        </div>
        {walletState.status === 'loading' ? <LoadingScreen message="Loading exchange history..." /> : <RecentExchangeList exchanges={exchanges} />}
      </section>
    </div>
  );
}


function ExpenseHistory({ expenses, categoryLookup, onDataChanged }) {
  const [filters, setFilters] = useState({
    search: '',
    categoryId: 'all',
    datePreset: 'all',
    dateFrom: '',
    dateTo: '',
    sort: 'newest',
  });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const categories = Array.from(categoryLookup.values());

  const filtered = useMemo(() => {
    let result = expenses.filter(exp => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const noteMatch = (exp.note || '').toLowerCase().includes(q);
        const locMatch = (exp.location || '').toLowerCase().includes(q);
        if (!noteMatch && !locMatch) return false;
      }
      if (filters.categoryId !== 'all' && String(exp.categoryId) !== filters.categoryId) {
        return false;
      }
      if (filters.datePreset !== 'all') {
        const expDate = exp.date;
        const now = new Date();
        const toISO = (d) => {
          const yr = d.getFullYear();
          const mo = String(d.getMonth() + 1).padStart(2, '0');
          const da = String(d.getDate()).padStart(2, '0');
          return `${yr}-${mo}-${da}`;
        };
        const today = toISO(now);
        const yesterdayDate = new Date(now);
        yesterdayDate.setDate(now.getDate() - 1);
        const yesterday = toISO(yesterdayDate);

        if (filters.datePreset === 'today' && expDate !== today) return false;
        if (filters.datePreset === 'yesterday' && expDate !== yesterday) return false;
        if (filters.datePreset === 'week') {
          const firstDay = new Date(now);
          firstDay.setDate(now.getDate() - now.getDay());
          const lastDay = new Date(firstDay);
          lastDay.setDate(firstDay.getDate() + 6);
          if (expDate < toISO(firstDay) || expDate > toISO(lastDay)) return false;
        }
        if (filters.datePreset === 'month') {
          if (expDate.slice(0, 7) !== today.slice(0, 7)) return false;
        }
        if (filters.datePreset === 'custom') {
          if (filters.dateFrom && expDate < filters.dateFrom) return false;
          if (filters.dateTo && expDate > filters.dateTo) return false;
        }
      }
      return true;
    });

    if (filters.sort === 'oldest') {
      result.sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return (a.id || 0) - (b.id || 0);
      });
    } else {
      result.sort((a, b) => {
        const dateCompare = b.date.localeCompare(a.date);
        if (dateCompare !== 0) return dateCompare;
        return (b.id || 0) - (a.id || 0);
      });
    }
    return result;
  }, [expenses, filters]);

  const totalSar = filtered.reduce((sum, exp) => sum + Number(exp.amountSar), 0);
  const totalPkr = filtered.reduce((sum, exp) => sum + Number(exp.pkrEquivalent), 0);

  async function handleDelete(id) {
    if (window.confirm('Are you sure you want to delete this expense?')) {
      try {
        await deleteExpense(id);
        onDataChanged();
      } catch (err) {
        alert(err.message);
      }
    }
  }

  function startEdit(exp) {
    setEditingId(exp.id);
    setEditForm({
      date: exp.date,
      amountSar: exp.amountSar,
      categoryId: exp.categoryId,
      note: exp.note || '',
    });
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    try {
      await updateExpense(editingId, {
        date: editForm.date,
        amountSar: editForm.amountSar,
        categoryId: editForm.categoryId,
        note: editForm.note,
      });
      setEditingId(null);
      onDataChanged();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="expense-history">
      <div className="filters-grid" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
        <input
          type="search"
          placeholder="Search expenses..."
          value={filters.search}
          onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          className="field"
          style={{ width: '100%', padding: '0.5rem', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select
            value={filters.categoryId}
            onChange={e => setFilters(f => ({ ...f, categoryId: e.target.value }))}
            style={{ padding: '0.5rem', flex: 1, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
          >
            <option value="all">All categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={filters.datePreset}
            onChange={e => setFilters(f => ({ ...f, datePreset: e.target.value }))}
            style={{ padding: '0.5rem', flex: 1, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
          >
            <option value="all">All dates</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="custom">Custom Range</option>
          </select>
          <select
            value={filters.sort}
            onChange={e => setFilters(f => ({ ...f, sort: e.target.value }))}
            style={{ padding: '0.5rem', flex: 1, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
        {filters.datePreset === 'custom' && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
              style={{ padding: '0.5rem', flex: 1, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
            />
            <input
              type="date"
              value={filters.dateTo}
              onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
              style={{ padding: '0.5rem', flex: 1, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
            />
          </div>
        )}
      </div>

      <div className="filtered-summary" style={{ padding: '0.75rem', backgroundColor: 'var(--color-surface-dim)', borderRadius: 'var(--radius-md)', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
        <span><strong>{filtered.length}</strong> matching</span>
        <div style={{ textAlign: 'right' }}>
          <div><strong>{formatSar(totalSar)}</strong></div>
          <div style={{ color: 'var(--color-text-dim)' }}>{formatPkr(totalPkr)}</div>
        </div>
      </div>

      <div className="timeline-list">
        {filtered.length === 0 && <div className="empty-state">No matching expenses found.</div>}
        {filtered.map(exp => {
          const category = categoryLookup.get(exp.categoryId);
          if (editingId === exp.id) {
            return (
              <form key={exp.id} onSubmit={handleSaveEdit} className="timeline-item" style={{ flexDirection: 'column', gap: '0.5rem', alignItems: 'stretch' }}>
                <input type="date" value={editForm.date} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} required style={{ padding: '0.5rem', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }} />
                <input type="number" step="0.01" value={editForm.amountSar} onChange={e => setEditForm(f => ({ ...f, amountSar: e.target.value }))} required placeholder="SAR Amount" style={{ padding: '0.5rem', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }} />
                <select value={editForm.categoryId} onChange={e => setEditForm(f => ({ ...f, categoryId: Number(e.target.value) }))} required style={{ padding: '0.5rem', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input type="text" value={editForm.note} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))} placeholder="Description" required style={{ padding: '0.5rem', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }} />
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button type="submit" className="button button--primary" style={{ flex: 1 }}>Save</button>
                  <button type="button" className="button" style={{ flex: 1 }} onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </form>
            );
          }
          return (
            <article className="timeline-item" key={exp.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <div>
                  <strong>{formatSar(exp.amountSar)}</strong>
                  <span style={{ display: 'block', fontSize: '0.9rem' }}>{exp.note || category?.name}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong>{formatPkr(exp.pkrEquivalent)}</strong>
                  <span style={{ display: 'block', fontSize: '0.9rem' }}>{category?.name} - {exp.date}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                <button type="button" onClick={() => startEdit(exp)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '4px', cursor: 'pointer', color: 'var(--color-text)' }}>Edit</button>
                <button type="button" onClick={() => handleDelete(exp.id)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '4px', cursor: 'pointer', color: 'var(--color-danger)' }}>Delete</button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ExpenseScreen({ trip, categories, refreshKey, onDataChanged }) {
  const walletState = useWalletData(trip.id, categories, refreshKey);
  const defaultCategoryId = categories[0]?.id ? String(categories[0].id) : '';
  const [form, setForm] = useState({
    date: defaultEntryDate(trip),
    amountSar: '',
    categoryId: defaultCategoryId,
    location: 'Other',
    description: '',
    notes: '',
  });
  const [feedback, setFeedback] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const summary = walletState.data?.summary;
  const weightedRate = summary?.weightedRate || '0';
  const expenses = walletState.data?.expenses || [];
  const categoryLookup = walletState.data?.categoryLookup || buildCategoryLookup(categories);
  const hasAcquisitionRate = Number(weightedRate) > 0;
  const preview = useMemo(() => {
    if (!form.amountSar || !hasAcquisitionRate) return null;
    try {
      return calculateSarToPkr(form.amountSar, weightedRate);
    } catch {
      return null;
    }
  }, [form.amountSar, hasAcquisitionRate, weightedRate]);

  function updateField(field, value) {
    setFeedback(null);
    setForm((current) => ({ ...current, [field]: value }));
  }

  function buildNote() {
    const description = form.description.trim();
    const notes = form.notes.trim();
    if (description && notes) return `${description} | ${notes}`;
    return description || notes;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    try {
      if (!hasAcquisitionRate) {
        throw new Error('Record at least one exchange before adding an expense, so the historical PKR snapshot is meaningful.');
      }
      if (!form.categoryId) {
        throw new Error('Choose a category.');
      }
      if (!buildNote()) {
        throw new Error('Add a description, product, or merchant.');
      }

      const created = await addExpense(trip.id, {
        amountSar: form.amountSar,
        categoryId: Number(form.categoryId),
        date: form.date,
        location: form.location,
        note: buildNote(),
      });

      setForm((current) => ({
        ...current,
        amountSar: '',
        description: '',
        notes: '',
      }));
      setFeedback({
        type: 'success',
        text: `Expense saved with ${formatPkr(created.pkrEquivalent)} at ${formatRate(created.acquisitionRateUsed)}.`,
      });
      onDataChanged();
    } catch (error) {
      setFeedback({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="screen-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SAR spending</p>
            <h2>Add expense</h2>
          </div>
          <ReceiptText aria-hidden="true" />
        </div>

        {!hasAcquisitionRate ? (
          <div className="feedback feedback--warning" role="status">
            <AlertCircle size={17} aria-hidden="true" />
            <span>Add an exchange first so expenses can keep a real historical PKR equivalent.</span>
          </div>
        ) : null}

        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="field">
            <span>Date</span>
            <input
              name="date"
              type="date"
              required
              value={form.date}
              onChange={(event) => updateField('date', event.target.value)}
            />
          </label>
          <label className="field">
            <span>SAR amount</span>
            <input
              name="amountSar"
              inputMode="decimal"
              required
              placeholder="35.00"
              value={form.amountSar}
              onChange={(event) => updateField('amountSar', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Category</span>
            <select
              name="categoryId"
              required
              value={form.categoryId}
              onChange={(event) => updateField('categoryId', event.target.value)}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Location</span>
            <select
              name="location"
              value={form.location}
              onChange={(event) => updateField('location', event.target.value)}
            >
              {LOCATIONS.map((location) => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>
          </label>
          <label className="field field--full">
            <span>Description / product / merchant</span>
            <input
              name="description"
              required
              placeholder="Dinner near Haram"
              value={form.description}
              onChange={(event) => updateField('description', event.target.value)}
            />
          </label>
          <label className="field field--full">
            <span>Notes</span>
            <textarea
              name="notes"
              rows="3"
              placeholder="Optional details"
              value={form.notes}
              onChange={(event) => updateField('notes', event.target.value)}
            />
          </label>

          <div className="rate-preview field--full">
            <span>Historical PKR snapshot</span>
            <strong>{preview ? `${preview.pkrAmount} PKR` : hasAcquisitionRate ? 'Enter SAR amount' : 'Waiting for first exchange'}</strong>
            {hasAcquisitionRate ? <small>Uses {formatRate(weightedRate)}</small> : null}
          </div>

          <StatusMessage feedback={feedback} />

          <button className="button button--primary field--full" type="submit" disabled={isSaving}>
            {isSaving ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
            Save expense
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">History</p>
            <h2>Expense records</h2>
          </div>
          <span className="count-pill">{expenses.length}</span>
        </div>
        {walletState.status === 'loading' ? (
          <LoadingScreen message="Loading expense history..." />
        ) : (
          <ExpenseHistory expenses={expenses} categoryLookup={categoryLookup} onDataChanged={onDataChanged} />
        )}
      </section>
    </div>
  );
}


function CategoriesScreen({ trip, categories, onDataChanged }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📦');
  const [error, setError] = useState(null);

  async function handleAdd(e) {
    e.preventDefault();
    setError(null);
    try {
      await addCategory(trip.id, name, icon);
      setName('');
      setIcon('📦');
      onDataChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (window.confirm('Delete category?')) {
      try {
        await deleteCategory(id);
        onDataChanged();
      } catch (err) {
        alert(err.message);
      }
    }
  }

  return (
    <div className="screen-stack">
      <section className="panel">
        <div className="section-heading">
          <div><p className="eyebrow">Manage</p><h2>Categories</h2></div>
        </div>
        {error && <div className="feedback feedback--error">{error}</div>}
        <form onSubmit={handleAdd} className="form-grid">
          <label className="field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Gifts" /></label>
          <label className="field"><span>Icon</span><input value={icon} onChange={e => setIcon(e.target.value)} required placeholder="e.g. 🎁" /></label>
          <button className="button button--primary field--full" type="submit">Add Category</button>
        </form>
      </section>

      <section className="panel">
        <div className="timeline-list">
          {categories.map(c => (
            <article className="timeline-item" key={c.id}>
              <div><strong>{c.icon} {c.name}</strong></div>
              <div>
                {!c.isDefault && <button type="button" onClick={() => handleDelete(c.id)} className="button" style={{color: 'var(--color-danger)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', padding: '0.25rem 0.5rem', borderRadius: '4px'}}>Delete</button>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function SettingsScreen({ onDataChanged: _onDataChanged }) {
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const fileInputRef = useRef(null);

  async function handleExport() {
    try {
      const json = await exportBackupData();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `umrah-wallet-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    if (window.confirm('This will replace all your current data. Are you sure?')) {
      try {
        const text = await file.text();
        await importBackupData(text);
        setMsg('Data restored successfully!');
        setError(null);
        window.location.reload();
      } catch (err) {
        setError(err.message);
      }
    }
    e.target.value = '';
  }

  return (
    <div className="screen-stack">
      <section className="panel">
        <div className="section-heading">
          <div><p className="eyebrow">Data</p><h2>Backup & Restore</h2></div>
        </div>
        {error && <div className="feedback feedback--error">{error}</div>}
        {msg && <div className="feedback feedback--success"><CheckCircle2 size={17} /><span>{msg}</span></div>}
        
        <div className="form-grid">
          <button className="button button--primary field--full" onClick={handleExport}>Export Backup (JSON)</button>
          
          <div className="field--full" style={{marginTop: '1rem'}}>
             <p style={{marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--color-text-dim)'}}>Restore from backup</p>
             <input type="file" accept=".json" onChange={handleImport} ref={fileInputRef} style={{display: 'none'}} />
             <button className="button field--full" onClick={() => fileInputRef.current.click()}>Import Backup</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function App() {
  const [bootState, setBootState] = useState({
    status: 'loading',
    trip: null,
    categories: [],
    error: null,
  });
  const [refreshKey, setRefreshKey] = useState(0);

  const loadApp = useCallback(async () => {
    setBootState((current) => ({ ...current, status: 'loading', error: null }));

    try {
      const { trip, categories } = await ensureAppData();
      setBootState({ status: 'ready', trip, categories, error: null });
    } catch (error) {
      setBootState({ status: 'error', trip: null, categories: [], error });
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    ensureAppData()
      .then(({ trip, categories }) => {
        if (!isActive) return;
        setBootState({ status: 'ready', trip, categories, error: null });
      })
      .catch((error) => {
        if (!isActive) return;
        setBootState({ status: 'error', trip: null, categories: [], error });
      });

    return () => {
      isActive = false;
    };
  }, []);

  const handleDataChanged = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  if (bootState.status === 'loading') {
    return <LoadingScreen />;
  }

  if (bootState.status === 'error') {
    return <ErrorScreen error={bootState.error} onRetry={loadApp} />;
  }

  return (
    <HashRouter>
      <AppShell trip={bootState.trip} onRefresh={handleRefresh}>
        <Routes>
          <Route
            path="/"
            element={(
              <OverviewScreen
                trip={bootState.trip}
                categories={bootState.categories}
                refreshKey={refreshKey}
              />
            )}
          />
          <Route
            path="/exchanges"
            element={(
              <ExchangeScreen
                trip={bootState.trip}
                categories={bootState.categories}
                refreshKey={refreshKey}
                onDataChanged={handleDataChanged}
              />
            )}
          />
          <Route
            path="/expenses"
            element={(
              <ExpenseScreen
                trip={bootState.trip}
                categories={bootState.categories}
                refreshKey={refreshKey}
                onDataChanged={handleDataChanged}
              />
            )}
          />
          <Route
            path="/categories"
            element={
              <CategoriesScreen
                trip={bootState.trip}
                categories={bootState.categories}
                onDataChanged={handleDataChanged}
              />
            }
          />
          <Route
            path="/settings"
            element={<SettingsScreen onDataChanged={handleDataChanged} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}

export default App;
