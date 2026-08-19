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

    // Power draw is per-BUILDING, not per-queue: flat across node.count
    // 1-5 (one building), then doubles the instant a 6th queue needs a
    // second building (see itemRatePerMin in planner.js).
    const powerConsumerRecipe = Object.values(RECIPE_INDEX_BY_KEY).find(r => r.power_mw > 0);
    if (powerConsumerRecipe) {
      addNode(baseFacilityName(powerConsumerRecipe.facility), 200, 400);
      const node = plannerState.nodes[plannerState.nodes.length - 1];
      node.recipeKeys = [powerConsumerRecipe.key];
      const rateAt1 = itemRatePerMin(node, 'Facility Power', 'in');
      setNodeCount(node, 5);
      const rateAt5 = itemRatePerMin(node, 'Facility Power', 'in');
      setNodeCount(node, 6);
      const rateAt6 = itemRatePerMin(node, 'Facility Power', 'in');
      if (rateAt1 === rateAt5 && Math.abs(rateAt6 - rateAt1 * 2) < 1e-9) pass('power-flat-then-doubles-past-5-queues');
      else fail('power-flat-then-doubles-past-5-queues', `1q=${rateAt1} 5q=${rateAt5} 6q=${rateAt6}`);
      removeNodes([node.id]);
    } else {
      fail('power-flat-then-doubles-past-5-queues', 'no power-consuming recipe found in data');
    }

    // A power-GENERATING recipe (Power Station, ...) has nothing to
    // parallelize — its node.count locks to 1 regardless of what's
    // requested (see maxCountForNode in planner.js).
    const powerProducerRecipe = Object.values(RECIPE_INDEX_BY_KEY).find(r => r.outputs && 'Facility Power' in r.outputs);
    if (powerProducerRecipe) {
      addNode(baseFacilityName(powerProducerRecipe.facility), 200, 600);
      const node = plannerState.nodes[plannerState.nodes.length - 1];
      node.recipeKeys = [powerProducerRecipe.key];
      setNodeCount(node, 5);
      if (node.count === 1) pass('power-producer-count-locked-to-1');
      else fail('power-producer-count-locked-to-1', `expected count 1, got ${node.count}`);
      removeNodes([node.id]);
    } else {
      fail('power-producer-count-locked-to-1', 'no power-producing recipe found in data');
    }
  } catch (e) {
    console.log(`AUTOTEST:ERROR ${e.message}`);
  }
  console.log('AUTOTEST:DONE');
})();
