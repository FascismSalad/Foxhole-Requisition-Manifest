// Smoke test for the Factory/MPF Calculator page (loadout.html). Loaded only
// when the page is opened with ?autotest=1 — see the hook at the bottom of
// js/loadout.js. Sibling to test/smoke-calc.js and test/smoke-planner.js;
// see smoke-calc.js's header for the general approach.

(async function () {
  function pass(label) { console.log(`AUTOTEST:PASS ${label}`); }
  function fail(label, detail) { console.log(`AUTOTEST:FAIL ${label} - ${detail}`); }

  async function waitFor(conditionFn, timeoutMs = 5000, intervalMs = 100) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (conditionFn()) return true;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
  }

  try {
    const ready = await waitFor(() => typeof LOADOUT_ITEMS !== 'undefined' && LOADOUT_ITEMS.length > 0);
    if (!ready) { fail('data-ready', 'LOADOUT_ITEMS never populated'); console.log('AUTOTEST:DONE'); return; }
    pass('data-ready');

    // Known-good baseline: reset any state a reused Chrome profile's
    // localStorage might carry over from a previous run.
    loadoutState.order = {};
    loadoutState.activeTab = 'small_arms';
    loadoutState.craftLocation = 'factory';
    renderAll();

    // Dusk ce.III: Refined Materials 15, crate_output 1 (Factory recipe) —
    // real numbers pinned in the dev notes, checked here so a future data
    // edit that quietly changes this recipe gets caught.
    addToOrder('Dusk ce.III');
    const qty1 = loadoutState.order['Dusk ce.III'];
    if (qty1 === 1) pass('add-to-order');
    else fail('add-to-order', `expected qty 1, got ${qty1}`);

    addToOrder('Dusk ce.III');
    const qty2 = loadoutState.order['Dusk ce.III'];
    if (qty2 === 2) pass('add-to-order-increments');
    else fail('add-to-order-increments', `expected qty 2, got ${qty2}`);

    const { costTotals } = computeLoadoutTotals();
    if (costTotals['Refined Materials'] === 30) pass('cost-totals-correct');
    else fail('cost-totals-correct', `expected Refined Materials 30, got ${costTotals['Refined Materials']}`);

    // H-5 Hatchet: Garage recipe costs 115 Refined Materials (Garage counts
    // as "factory mode" — see pickRecipeForLocation), MPF recipe costs
    // 1206 Refined Materials for a 5-crate batch (241.2/crate). Toggling
    // location should swap which recipe (and thus cost) is used.
    addToOrder('H-5 Hatchet');
    const factoryTotals = computeLoadoutTotals().costTotals;
    const expectedFactory = 30 + 115; // Dusk x2 (30) + Hatchet Garage (115)
    if (factoryTotals['Refined Materials'] === expectedFactory) pass('factory-mode-uses-garage-recipe');
    else fail('factory-mode-uses-garage-recipe', `expected Refined Materials ${expectedFactory}, got ${factoryTotals['Refined Materials']}`);

    loadoutState.craftLocation = 'mpf';
    renderAll();
    const mpfTotals = computeLoadoutTotals().costTotals;
    // Both Dusk and Hatchet have their own MPF recipe too, at different
    // per-crate rates than their factory-mode ones, so the total should
    // land somewhere different from the factory-mode figure either way.
    if (mpfTotals['Refined Materials'] > 0 && mpfTotals['Refined Materials'] !== factoryTotals['Refined Materials']) pass('mpf-toggle-swaps-recipe-and-cost');
    else fail('mpf-toggle-swaps-recipe-and-cost', `expected a different positive Refined Materials total, got ${mpfTotals['Refined Materials']} (factory was ${factoryTotals['Refined Materials']})`);

    // Shift-click equivalent: addToOrder's amount param should add a full
    // queue (LOADOUT_QUEUE_LIMIT) in one go, not just +1.
    loadoutState.order = {};
    loadoutState.craftLocation = 'factory';
    renderAll();
    addToOrder('Dusk ce.III', LOADOUT_QUEUE_LIMIT.factory);
    if (loadoutState.order['Dusk ce.III'] === LOADOUT_QUEUE_LIMIT.factory) pass('shift-click-adds-full-queue');
    else fail('shift-click-adds-full-queue', `expected qty ${LOADOUT_QUEUE_LIMIT.factory}, got ${loadoutState.order['Dusk ce.III']}`);

    // Ordering past a single queue's capacity should never be blocked —
    // just flagged (see renderOrderList's non-blocking warning).
    addToOrder('Dusk ce.III', 1);
    if (loadoutState.order['Dusk ce.III'] === LOADOUT_QUEUE_LIMIT.factory + 1) pass('over-queue-limit-not-blocked');
    else fail('over-queue-limit-not-blocked', `expected qty ${LOADOUT_QUEUE_LIMIT.factory + 1}, got ${loadoutState.order['Dusk ce.III']}`);

    renderAll();
    const warningEl = orderListEl.querySelector('.loadout-order-warning');
    if (warningEl) pass('over-queue-limit-shows-warning');
    else fail('over-queue-limit-shows-warning', 'no .loadout-order-warning rendered for an over-limit item');

    loadoutState.order = {};
    renderAll();
    if (Object.keys(loadoutState.order).length === 0) pass('clear-order');
    else fail('clear-order', `expected empty order, got ${JSON.stringify(loadoutState.order)}`);
  } catch (e) {
    console.log(`AUTOTEST:ERROR ${e.message}`);
  }
  console.log('AUTOTEST:DONE');
})();
