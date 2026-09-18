import 'fake-indexeddb/auto';

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App.jsx';
import { db } from '../src/db/dexie.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;

async function clearDatabase() {
  await db.open();
  await Promise.all([
    db.trips.clear(),
    db.exchanges.clear(),
    db.transactions.clear(),
    db.categories.clear(),
    db.shoppingItems.clear(),
    db.rateSnapshots.clear(),
    db.syncQueue.clear(),
  ]);
}

async function waitFor(assertion, timeoutMs = 2000) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
  }

  throw lastError;
}

async function renderApp(hash = '#/') {
  window.location.hash = hash;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root.render(<App />);
  });

  return container;
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(async () => {
  await clearDatabase();
  document.body.innerHTML = '';
  root = null;
  container = null;
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root.unmount();
    });
  }
  document.body.innerHTML = '';
});

describe('App Phase 2 UI', () => {
  it('renders the empty dashboard without creating financial transactions', async () => {
    await renderApp('#/');

    await waitFor(() => {
      expect(container.textContent).toContain('Your wallet is ready');
      expect(container.textContent).toContain('0.00 SAR');
    });

    expect(await db.exchanges.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
  });

  it('saves an exchange through the Exchange screen', async () => {
    await renderApp('#/exchanges');

    await waitFor(() => {
      expect(container.textContent).toContain('Add exchange');
    });

    await act(async () => {
      setInputValue(container.querySelector('input[name="pkrGiven"]'), '74900');
      setInputValue(container.querySelector('input[name="sarReceived"]'), '1000');
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await waitFor(() => {
      expect(container.textContent).toContain('Exchange saved');
    });

    const exchanges = await db.exchanges.toArray();
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].acquisitionRate).toBe('74.900000');
  });
});
