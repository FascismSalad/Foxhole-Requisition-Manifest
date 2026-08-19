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

    // "Send to Planner" (see tryImportFromCalculator in planner.js) must
    // group every step by its BASE facility onto ONE node — a chain
    // needing both Construction Materials (Materials Factory [Metal
    // Press]) and Assembly Materials I (Materials Factory [Forge]) used to
    // land on two separate identically-named "Materials Factory" cards
    // with no visible way to tell them apart (a real bug report: the
    // Forge's own Assembly Materials requirement looked unregistered
    // because it was sitting on a second, easy-to-miss card). T8 Gemini's
    // real recipe data exercises exactly that overlap.
    const t8Key = RECIPE_BY_OUTPUT['T8 Gemini'] && RECIPE_BY_OUTPUT['T8 Gemini'].recipeKey;
    if (t8Key) {
      const tree = buildProductionChain({ kind: 'material', key: t8Key, quantity: 1, nodeOverrides: {} }, {});
      const exportPayload = buildPlannerExport([tree], {});
      localStorage.setItem(PLANNER_IMPORT_KEY, JSON.stringify(exportPayload));
      removeNodes(plannerState.nodes.map(n => n.id));
      const imported = tryImportFromCalculator();

      const mfNodes = plannerState.nodes.filter(n => n.facility === 'Materials Factory');
      const mfNode = mfNodes[0];
      const mergedCorrectly = imported && mfNodes.length === 1 && mfNode
        && mfNode.recipeKeys.includes('cmat_metal_press') && mfNode.recipeKeys.includes('am1');
      if (mergedCorrectly) pass('import-merges-same-facility-recipes-onto-one-node');
      else fail('import-merges-same-facility-recipes-onto-one-node', `materialsFactoryNodes=${mfNodes.length} recipeKeys=${mfNode && JSON.stringify(mfNode.recipeKeys)}`);

      const amWire = plannerState.connections.find(c => c.fromItem === 'Assembly Materials I');
      const wiredFromMergedNode = mfNode && amWire && amWire.fromNode === mfNode.id;
      if (wiredFromMergedNode) pass('import-wires-assembly-materials-from-merged-node');
      else fail('import-wires-assembly-materials-from-merged-node', `wire=${JSON.stringify(amWire)}`);

      removeNodes(plannerState.nodes.map(n => n.id));
    } else {
      fail('import-merges-same-facility-recipes-onto-one-node', 'T8 Gemini not found in data');
    }

    // Recipe picker cards (see toPreview/renderRecipeOptionCard) must show
    // the exact facility/module a recipe needs — a recipe like Assembly
    // Materials I has no sibling recipe sharing its output, so
    // computeRecipeLabel's own collision-avoidance logic never folds the
    // module into the label itself, and the card used to show nothing
    // else identifying it as a Forge recipe at all (another symptom of the
    // same bug report above).
    if (RECIPES_BY_FACILITY['Materials Factory']) {
      addNode('Materials Factory', 200, 200);
      const pickerNode = plannerState.nodes[plannerState.nodes.length - 1];
      openRecipePicker(pickerNode.id);
      renderPickerList('assembly materials i');
      const showsModuleFacility = pickerListEl.innerHTML.includes('Materials Factory [Forge]');
      if (showsModuleFacility) pass('recipe-picker-shows-module-facility');
      else fail('recipe-picker-shows-module-facility', 'picker HTML missing "Materials Factory [Forge]"');
      closeRecipePicker();
      removeNodes([pickerNode.id]);
    } else {
      fail('recipe-picker-shows-module-facility', 'Materials Factory not found in RECIPES_BY_FACILITY');
    }

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

    // Power draw is a flat per-recipe MW figure that only scales with
    // node.count (physical building copies) — a recipe's own queue count
    // (parallel production lines within one copy) must never move it (see
    // itemRatePerMin in planner.js).
    const powerConsumerRecipe = Object.values(RECIPE_INDEX_BY_KEY).find(r => r.power_mw > 0);
    if (powerConsumerRecipe) {
      addNode(baseFacilityName(powerConsumerRecipe.facility), 200, 400);
      const node = plannerState.nodes[plannerState.nodes.length - 1];
      node.recipeKeys = [powerConsumerRecipe.key];
      const rateAt1Copy = itemRatePerMin(node, 'Facility Power', 'in');
      setRecipeQueueCount(node, powerConsumerRecipe.key, maxQueuesForRecipe(powerConsumerRecipe));
      const rateAfterQueueBump = itemRatePerMin(node, 'Facility Power', 'in');
      setNodeCount(node, 2);
      const rateAt2Copies = itemRatePerMin(node, 'Facility Power', 'in');
      if (rateAt1Copy === rateAfterQueueBump && Math.abs(rateAt2Copies - rateAt1Copy * 2) < 1e-9) pass('power-scales-with-building-copies-not-queues');
      else fail('power-scales-with-building-copies-not-queues', `1copy=${rateAt1Copy} afterQueueBump=${rateAfterQueueBump} 2copies=${rateAt2Copies}`);
      removeNodes([node.id]);
    } else {
      fail('power-scales-with-building-copies-not-queues', 'no power-consuming recipe found in data');
    }

    // A power-GENERATING recipe (Power Station, ...) has nothing to
    // parallelize — its own queue count locks to 1 (see clampQueueCount in
    // calc.js) — but node.count (building copies) stays freely steppable
    // regardless, since building a second Power Station is normal.
    const powerProducerRecipe = Object.values(RECIPE_INDEX_BY_KEY).find(r => r.outputs && 'Facility Power' in r.outputs);
    if (powerProducerRecipe) {
      addNode(baseFacilityName(powerProducerRecipe.facility), 200, 600);
      const node = plannerState.nodes[plannerState.nodes.length - 1];
      node.recipeKeys = [powerProducerRecipe.key];
      setRecipeQueueCount(node, powerProducerRecipe.key, 5);
      setNodeCount(node, 3);
      const lockedQueue = nodeQueueCount(node, powerProducerRecipe.key);
      if (lockedQueue === 1 && node.count === 3) pass('power-producer-queue-locked-building-count-free');
      else fail('power-producer-queue-locked-building-count-free', `queueCount=${lockedQueue} node.count=${node.count}`);
      removeNodes([node.id]);
    } else {
      fail('power-producer-queue-locked-building-count-free', 'no power-producing recipe found in data');
    }

    // Two different recipes active on the SAME node/building can each run
    // their own independent queue count (e.g. 2 of one, 3 of another — see
    // setRecipeQueueCount/nodeQueueCount) — and once their combined total
    // passes 5 (more than one physical building fits), buildNodeHtml should
    // show a warning, but not before (see totalNodeQueues).
    let multiRecipeCase = null;
    for (const [base, list] of Object.entries(RECIPES_BY_FACILITY)) {
      const nonPower = list.filter(r => maxQueuesForRecipe(r) > 1);
      if (nonPower.length >= 2) { multiRecipeCase = { base, r1: nonPower[0], r2: nonPower[1] }; break; }
    }
    if (multiRecipeCase) {
      const { base, r1, r2 } = multiRecipeCase;
      addNode(base, 200, 1000);
      const node = plannerState.nodes[plannerState.nodes.length - 1];
      node.recipeKeys = [r1.key];
      node.recipeQueues = {};
      toggleNodeRecipe(node, r2.key);
      setRecipeQueueCount(node, r1.key, 2);
      setRecipeQueueCount(node, r2.key, 3);
      const q1 = nodeQueueCount(node, r1.key), q2 = nodeQueueCount(node, r2.key);
      if (q1 === 2 && q2 === 3) pass('per-recipe-queues-independent');
      else fail('per-recipe-queues-independent', `q1=${q1} q2=${q2}`);

      const totalAt5 = totalNodeQueues(node);
      const warnedAt5 = buildNodeHtml(node).includes('fac-node-queue-warning');
      if (totalAt5 === 5 && !warnedAt5) pass('no-queue-warning-at-5-total');
      else fail('no-queue-warning-at-5-total', `total=${totalAt5} warned=${warnedAt5}`);

      setRecipeQueueCount(node, r2.key, 4);
      const totalAt6 = totalNodeQueues(node);
      const warnedAt6 = buildNodeHtml(node).includes('fac-node-queue-warning');
      if (totalAt6 === 6 && warnedAt6) pass('queue-warning-over-5-total');
      else fail('queue-warning-over-5-total', `total=${totalAt6} warned=${warnedAt6}`);

      removeNodes([node.id]);
    } else {
      fail('per-recipe-queues-independent', 'no facility with 2+ non-power recipes found in data');
    }

    // Searching by a RECIPE's own name (not the base building's) should
    // still surface that building in the sidebar catalog, and placing it
    // from that search should activate the exact recipe searched for (see
    // matchedRecipeKey/FACILITY_CATALOG.searchText in planner.js) — e.g.
    // searching "blast furnace" surfaces Metalworks Factory with Blast
    // Furnace already active. Picks whatever real data provides a
    // distinctly-named recipe for, rather than hardcoding a specific item.
    let recipeSearchCase = null;
    for (const [base, list] of Object.entries(RECIPES_BY_FACILITY)) {
      const candidate = list.find(r => r.recipe_name && r.recipe_name.trim().length > 3 && r.recipe_name.toLowerCase() !== base.toLowerCase());
      if (candidate) { recipeSearchCase = { base, recipe: candidate }; break; }
    }
    if (recipeSearchCase) {
      const query = recipeSearchCase.recipe.recipe_name.toLowerCase();
      const matchedKey = matchedRecipeKey(recipeSearchCase.base, query);
      renderFacilitySidebar(query);
      const surfaced = facilityListEl.innerHTML.includes(`data-facility="${recipeSearchCase.base}"`);
      if (matchedKey === recipeSearchCase.recipe.key && surfaced) pass('search-by-recipe-surfaces-and-activates');
      else fail('search-by-recipe-surfaces-and-activates', `query="${query}" matchedKey=${matchedKey} expectedKey=${recipeSearchCase.recipe.key} surfaced=${surfaced}`);
      renderFacilitySidebar('');

      addNode(recipeSearchCase.base, 200, 800, matchedKey);
      const node = plannerState.nodes[plannerState.nodes.length - 1];
      if (node && node.recipeKeys[0] === recipeSearchCase.recipe.key) pass('add-node-activates-searched-recipe');
      else fail('add-node-activates-searched-recipe', `expected ${recipeSearchCase.recipe.key}, got ${node && node.recipeKeys[0]}`);
      removeNodes([node.id]);
    } else {
      fail('search-by-recipe-surfaces-and-activates', 'no distinctly-named recipe found in data');
    }
  } catch (e) {
    console.log(`AUTOTEST:ERROR ${e.message}`);
  }
  console.log('AUTOTEST:DONE');
})();
