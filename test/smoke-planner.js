// Smoke test for the Facility Planner page (planner.html). Loaded only
// when the page is opened with ?autotest=1 — see the hook at the bottom
// of planner.js. Sibling to test/smoke-calc.js; see that file's header
// for the general approach (run via test.ps1, AUTOTEST: lines, etc.).

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
    const ready = await waitFor(() => typeof RECIPES_BY_FACILITY !== 'undefined' && Object.keys(RECIPES_BY_FACILITY).length > 0);
    if (!ready) { fail('data-ready', 'RECIPES_BY_FACILITY never populated'); console.log('AUTOTEST:DONE'); return; }
    pass('data-ready');

    // Force a known-empty baseline regardless of whatever a reused Chrome
    // profile's localStorage board happens to have left behind (e.g. from
    // a previous run that crashed mid-test) — every assertion below is an
    // absolute count from here, not a delta.
    removeNodes(plannerState.nodes.map(n => n.id));

    const facility = Object.keys(RECIPES_BY_FACILITY)[0];
    addNode(facility, 200, 200);
    addNode(facility, 500, 200);
    if (plannerState.nodes.length === 2) pass('add-node-x2');
    else fail('add-node-x2', `expected 2 nodes, got ${plannerState.nodes.length}`);

    const [a, b] = plannerState.nodes;

    selectNode(a.id);
    if (plannerState.selectedNodeIds.has(a.id) && plannerState.selectedNodeIds.size === 1) pass('select-node');
    else fail('select-node', `selectedNodeIds=${[...plannerState.selectedNodeIds]}`);

    toggleNodeSelection(b.id);
    if (plannerState.selectedNodeIds.size === 2) pass('toggle-node-selection-adds');
    else fail('toggle-node-selection-adds', `expected 2 selected, got ${plannerState.selectedNodeIds.size}`);

    deselectAll();
    if (plannerState.selectedNodeIds.size === 0 && !plannerState.selectedWireId) pass('deselect-all');
    else fail('deselect-all', `selectedNodeIds.size=${plannerState.selectedNodeIds.size}, selectedWireId=${plannerState.selectedWireId}`);

    removeNodes([a.id, b.id]);
    if (plannerState.nodes.length === 0) pass('remove-nodes');
    else fail('remove-nodes', `expected 0 nodes, got ${plannerState.nodes.length}`);
  } catch (e) {
    console.log(`AUTOTEST:ERROR ${e.message}`);
  }
  console.log('AUTOTEST:DONE');
})();
