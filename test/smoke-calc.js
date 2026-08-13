// Smoke test for the Calculator page (index.html). Loaded only when the
// page is opened with ?autotest=1 — see the hook at the bottom of app.js.
// Not shipped to real visitors in any meaningful sense (dead unless that
// query param is present), but kept out of app.js itself so the actual
// test steps can change without touching production code.
//
// Run via test.ps1, which greps this page's console output for the
// AUTOTEST: lines this file prints and turns them into a pass/fail report.

(async function () {
  function pass(label) { console.log(`AUTOTEST:PASS ${label}`); }
  function fail(label, detail) { console.log(`AUTOTEST:FAIL ${label} - ${detail}`); }

  // Polls instead of a fixed delay — loadData() (loader.js) is async, and
  // how long it takes depends on disk/network speed, not a guessable
  // constant. Bails out (via the fail() below) rather than hanging forever
  // if data never shows up.
  async function waitFor(conditionFn, timeoutMs = 5000, intervalMs = 100) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (conditionFn()) return true;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
  }

  try {
    // RECIPE_BY_OUTPUT is only populated once, by buildIndices() at the very
    // end of loadData() (see loader.js) — unlike MATERIAL_RECIPES, which
    // fills in incrementally as each data/*.json file loads, so checking it
    // is the only reliable "every file is done" signal, not just "the first
    // file is done."
    const ready = await waitFor(() => typeof RECIPE_BY_OUTPUT !== 'undefined' && Object.keys(RECIPE_BY_OUTPUT).length > 0);
    if (!ready) { fail('data-ready', 'RECIPE_BY_OUTPUT never populated'); console.log('AUTOTEST:DONE'); return; }
    pass('data-ready');

    addEntry('material', 'steel_eoil', 10);
    const tickets = document.querySelectorAll('.ticket');
    if (tickets.length === 1) pass('add-entry-creates-ticket');
    else fail('add-entry-creates-ticket', `expected 1 ticket, got ${tickets.length}`);

    const head = document.querySelector('.ticket-head');
    if (head) head.click();
    else fail('ticket-head-present', 'no .ticket-head found to expand');

    const stepper = document.querySelector('.step-queue-stepper');
    if (stepper) pass('queue-stepper-renders');
    else fail('queue-stepper-renders', 'no .step-queue-stepper found after expanding ticket');

    const resultsHtml = document.getElementById('results').innerHTML;
    if (resultsHtml.length > 100) pass('results-panel-populated');
    else fail('results-panel-populated', `#results innerHTML only ${resultsHtml.length} chars`);
  } catch (e) {
    console.log(`AUTOTEST:ERROR ${e.message}`);
  }
  console.log('AUTOTEST:DONE');
})();
