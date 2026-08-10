// ============================================================
// PRODUCTION CHAIN
// Builds the full recursive tree from a requested output down to
// raw resources. Every node that has more than one possible recipe
// carries its alternatives; the caller can override the recipe used
// at that exact node (identified by its path) without affecting any
// other occurrence of the same item elsewhere in the tree.
// ============================================================

// Looks up the category/subcategory tag for any item name that appears
// as a recipe output. Anything with no recipe (Petrol, Coke, Heavy Oil...)
// is a terminal raw resource, tagged 'resource' even though it has no
// JSON entry of its own yet.
function tagOf(itemName) {
  const recipe = RECIPE_BY_OUTPUT[itemName];
  if (!recipe) return { category: 'resource', subcategory: '' };
  return { category: recipe.category || 'material', subcategory: recipe.subcategory || '' };
}

// overrideKey: recipe chosen specifically at this node's path, if any.
// rootDefaultKey: only set on the root call, so the top-level ticket keeps
// using the recipe it was added with unless overridden.
function resolveNodeRecipe(itemName, path, overrides, rootDefaultKey) {
  const overrideKey = overrides[path];
  if (overrideKey && MATERIAL_RECIPES[overrideKey]) return MATERIAL_RECIPES[overrideKey];
  if (rootDefaultKey && MATERIAL_RECIPES[rootDefaultKey]) return MATERIAL_RECIPES[rootDefaultKey];
  return RECIPE_BY_OUTPUT[itemName] || null;
}

// Water/Oil/Diesel/Petrol/Heavy Oil/Enriched Oil all follow this "Name (L)"
// naming convention in the data — used to treat every liquid as one shared
// logistics category instead of its own Well/Pump/Refinery step.
function isLiquidName(itemName) {
  return /\(L\)$/.test(itemName);
}

// The base gatherable resources — pooled the same way liquids are (see
// isLiquidName): no per-resource Harvester/Mine step, just a total.
const RAW_RESOURCE_NAMES = new Set(['Rare Metal', 'Components', 'Salvage', 'Coal', 'Sulfur']);
function isRawResourceName(itemName) {
  return RAW_RESOURCE_NAMES.has(itemName);
}

// Which pooled "base resource" step (if any) an item belongs to — the
// three step-1/2/3 categories that always coalesce into one combined row
// instead of expanding into their own recipe steps. Order here doubles as
// the display order (see renderCombinedChain).
function poolKindOf(itemName) {
  if (isLiquidName(itemName)) return 'liquid';
  if (isRawResourceName(itemName)) return 'resource';
  if (itemName === 'Facility Power') return 'power';
  return null;
}

function buildNode(itemName, quantityNeeded, path, overrides, rootDefaultKey, chain) {
  // Guard against circular recipes (A needs B, B needs A) so a bad data
  // edit produces a clear error instead of an infinite recursion / stack overflow.
  if (chain.has(itemName)) {
    throw new Error(`Circular recipe detected: ${[...chain, itemName].join(' -> ')}`);
  }

  const { category, subcategory } = tagOf(itemName);

  // Liquids/raw resources/power are a terminal need wherever they're
  // consumed AS AN INGREDIENT (nested, path has a ">"), never expanded
  // into their own Well/Harvester/Power-Plant step — every occurrence
  // across the whole tree pools into one shared step instead (see
  // aggregateRawResources). But one of these picked directly from search
  // as its own ticket (root, no ">" in path) still needs a real resolved
  // recipe here — otherwise the root node comes back with recipeKey: null
  // and the ticket renderer has nothing to look up.
  const isRoot = !path.includes('>');
  const poolKind = poolKindOf(itemName);
  if (!isRoot && poolKind) {
    return {
      id: path, itemName, quantity: quantityNeeded, isRaw: true, isLiquid: poolKind === 'liquid', poolKind,
      isMultiRecipe: false, alternatives: null, recipeKey: null,
      recipeInputs: null, recipeOutputs: null, facility: null,
      batches: null, craftSeconds: 0, totalSeconds: 0, depth: 0,
      category, subcategory, children: []
    };
  }

  const parentKey = PARENT_ITEM_BY_OUTPUT[itemName];
  const alternatives = parentKey
    ? ITEM_MULTIPLE_RECIPES[parentKey].recipes.map(r => ({ recipeKey: r.recipe_key, label: r.recipe_name || r.recipe_key }))
    : null;

  const recipe = resolveNodeRecipe(itemName, path, overrides, rootDefaultKey);

  if (!recipe) {
    return {
      id: path, itemName, quantity: quantityNeeded, isRaw: true, isLiquid: false, poolKind: null,
      isMultiRecipe: false, alternatives: null, recipeKey: null,
      recipeInputs: null, recipeOutputs: null, facility: null,
      batches: null, craftSeconds: 0, totalSeconds: 0, depth: 0,
      category, subcategory, children: []
    };
  }

  const outputQty = recipe.outputs[itemName];
  const batches = Math.ceil(quantityNeeded / outputQty);
  const craftSeconds = (recipe.crafting_time_seconds || 0) * batches;

  const nextChain = new Set(chain);
  nextChain.add(itemName);

  const children = Object.entries(recipe.inputs).map(([inputName, inputQty]) =>
    buildNode(inputName, inputQty * batches, `${path}>${inputName}`, overrides, null, nextChain)
  );

  // Power draw is a steady-state requirement, not a per-batch consumable —
  // running 85 batches through one facility still only needs that facility's
  // stated MW, not 85x it — so this child is built flat (recipe.power_mw),
  // never scaled by batches. It flows through the tree exactly like any
  // other ingredient, including getting its own selectable power-source
  // recipe (see data/resources/power.json).
  if (recipe.power_mw) {
    children.push(buildNode('Facility Power', recipe.power_mw, `${path}>Facility Power`, overrides, null, nextChain));
  }

  const totalSeconds = craftSeconds + children.reduce((sum, c) => sum + c.totalSeconds, 0);
  const nonRawDepths = children.filter(c => !c.isRaw).map(c => c.depth);
  const depth = nonRawDepths.length ? 1 + Math.max(...nonRawDepths) : 1;

  return {
    id: path, itemName, quantity: quantityNeeded, isRaw: false, isLiquid: false, poolKind: null,
    isMultiRecipe: !!parentKey, alternatives, recipeKey: recipe.recipeKey,
    recipeInputs: recipe.inputs, recipeOutputs: recipe.outputs, facility: recipe.facility || null,
    batches, craftSeconds, totalSeconds, depth, category, subcategory, children
  };
}

// Whichever recipe is ACTUALLY active for this entry's root right now —
// its own indexed default, unless the chain panel's recipe picker at the
// root step overrode it (e.g. switched from Garage to MPF). Cheap: reuses
// the same resolution buildNode uses, without building the whole tree.
function resolveRootRecipe(entry) {
  if (entry.kind === 'aircraft') return null;
  const defaultRecipe = MATERIAL_RECIPES[entry.key];
  if (!defaultRecipe) return null;
  const outputName = Object.keys(defaultRecipe.outputs)[0];
  const rootPath = `${entry.kind}:${entry.key}`;
  return resolveNodeRecipe(outputName, rootPath, entry.nodeOverrides || {}, entry.key);
}

// Facilities that hand you the item directly, un-crated, even when that
// same item comes in crates from some other recipe (MPF, Refinery, ...) —
// Garage and Shipyard both work this way.
const UNCRATED_FACILITIES = new Set(['Garage', 'Shipyard']);

// Whether a ticket's target quantity should be treated as individual units
// or as whole crates (each crate = crateSize units) — decided by whichever
// recipe is currently active for the ticket, same crate rules as
// everywhere else: no crate concept if the item was never tracked in
// crates, and never for Garage/Shipyard output even when a crate size
// exists for that item's other recipes.
function ticketCrateSize(entry) {
  if (entry.kind === 'aircraft') {
    const aircraft = AIRCRAFT_COSTS[entry.key];
    return aircraft && !UNCRATED_FACILITIES.has(aircraft.facility) ? CRATE_SIZE_BY_NAME[aircraft.full_name] : undefined;
  }
  const recipe = resolveRootRecipe(entry);
  if (!recipe || UNCRATED_FACILITIES.has(recipe.facility)) return undefined;
  return CRATE_SIZE_BY_NAME[Object.keys(recipe.outputs)[0]];
}

// How many crates the ticket's quantity stepper should move per click. An
// MPF-style recipe (crate_output set, e.g. "MPF (9-Crate)") always produces
// crate_output crates in a single run — there's no such thing as ordering
// 5 crates off an MPF, only whole multiples of its batch size — so the
// stepper snaps to that instead of the usual 1-crate-at-a-time step.
function ticketCrateStep(entry) {
  if (entry.kind === 'aircraft') return 1;
  const recipe = resolveRootRecipe(entry);
  return (recipe && recipe.crate_output > 0) ? recipe.crate_output : 1;
}

// The actual unit count the production chain (and the ticket's own cost
// math) should target: the raw stepper quantity normally, or that many
// crates' worth of units when the ticket's crate-mode toggle is on.
function resolveTicketQuantity(entry) {
  const crateSize = ticketCrateSize(entry);
  const effectiveQuantity = entry.crateMode && crateSize ? entry.quantity * crateSize : entry.quantity;
  return { crateSize, effectiveQuantity };
}

// Builds the full production tree for one ticket (aircraft or material
// entry). entry.nodeOverrides maps a node's path -> the recipe key chosen
// specifically for that occurrence in the chain.
function buildProductionChain(entry) {
  const overrides = entry.nodeOverrides || {};
  const rootPath = `${entry.kind}:${entry.key}`;
  const { effectiveQuantity } = resolveTicketQuantity(entry);

  if (entry.kind === 'aircraft') {
    const aircraft = AIRCRAFT_COSTS[entry.key];
    // per-unit (one aircraft) inputs — this node's "batches" is effectiveQuantity,
    // so each batch consumes exactly these amounts, same shape as a recipe.
    const perUnitInputs = {};
    for (const [m, a] of Object.entries(aircraft.assembly_materials)) perUnitInputs[m] = (perUnitInputs[m] || 0) + a;
    for (const [p, a] of Object.entries(aircraft.aircraft_parts)) perUnitInputs[p] = (perUnitInputs[p] || 0) + a;

    const children = Object.entries(perUnitInputs).map(([name, perUnitQty]) =>
      buildNode(name, perUnitQty * effectiveQuantity, `${rootPath}>${name}`, overrides, null, new Set())
    );
    // Flat, not scaled by effectiveQuantity — same steady-state-draw reasoning
    // as buildNode's own power_mw handling above.
    if (aircraft.power_mw) {
      children.push(buildNode('Facility Power', aircraft.power_mw, `${rootPath}>Facility Power`, overrides, null, new Set()));
    }
    const craftSeconds = (aircraft.crafting_time_seconds || 0) * effectiveQuantity;
    const totalSeconds = craftSeconds + children.reduce((sum, c) => sum + c.totalSeconds, 0);
    const nonRawDepths = children.filter(c => !c.isRaw).map(c => c.depth);
    const depth = nonRawDepths.length ? 1 + Math.max(...nonRawDepths) : 1;

    return {
      id: rootPath, itemName: aircraft.full_name, quantity: effectiveQuantity, isRaw: false,
      isMultiRecipe: false, alternatives: null, recipeKey: null,
      recipeInputs: perUnitInputs, recipeOutputs: { [aircraft.full_name]: 1 }, facility: null,
      batches: effectiveQuantity, craftSeconds, totalSeconds, depth,
      category: aircraft.category || 'vehicle', subcategory: aircraft.subcategory || '', children
    };
  }

  const recipe = MATERIAL_RECIPES[entry.key];
  const outputName = Object.keys(recipe.outputs)[0];
  return buildNode(outputName, effectiveQuantity, rootPath, overrides, entry.key, new Set());
}

// Flattens one or more production-chain trees into one row per distinct
// recipe actually in use (skips raw resources — they only ever show up as
// an input on whichever step consumes them). The same recipe often needs to
// run at several different points — even across different selected outputs
// (e.g. Salvage feeding both a Metal Beam order and a Construction Materials
// order) — those occurrences are combined into a single row with their run
// counts summed, rather than repeating the same step over and over.
// Occurrences that were given a *different* recipe via a node override stay
// as their own separate row, since they're no longer the same step.
// Ordered to read top-to-bottom the way you'd actually work it: steps
// closest to raw resources first (lowest depth), building up toward the
// direct inputs for the requested ticket(s) — which always sort last,
// regardless of their own depth, so "the last step is the direct input"
// holds even when several tickets of different complexity are combined.
function buildChainSteps(trees) {
  const flat = [];
  for (const tree of trees) {
    (function walk(node) {
      if (node.isRaw) return;
      flat.push(node);
      node.children.forEach(walk);
    })(tree);
  }

  // A step is "direct" if any of its occurrences sits right at a tree's
  // root (its path is just "kind:key", with no ">" — see buildProductionChain/
  // buildNode) — i.e. it's the requested item's own recipe, not something
  // crafted purely to feed another recipe further up the chain. If the same
  // recipe also shows up deeper in another branch, the merged row still
  // counts as direct: it's needed right now either way.
  const groups = new Map();
  for (const step of flat) {
    const isDirect = !step.id.includes('>');
    // Aircraft roots have no recipeKey (they're assembled, not crafted from
    // a MATERIAL_RECIPES entry) — fall back to the node's own path so two
    // different aircraft added to the same chain don't collide into one
    // merged (and wrong) row just because they share a null key.
    const groupKey = step.recipeKey || step.id;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.paths.push(step.id);
      existing.quantity += step.quantity;
      existing.batches += step.batches;
      existing.craftSeconds += step.craftSeconds;
      existing.isDirect = existing.isDirect || isDirect;
    } else {
      groups.set(groupKey, {
        paths: [step.id],
        itemName: step.itemName,
        recipeKey: step.recipeKey,
        isMultiRecipe: step.isMultiRecipe,
        alternatives: step.alternatives,
        recipeInputs: step.recipeInputs,
        recipeOutputs: step.recipeOutputs,
        facility: step.facility,
        quantity: step.quantity,
        batches: step.batches,
        craftSeconds: step.craftSeconds,
        depth: step.depth,
        isDirect,
        children: step.children
      });
    }
  }

  return [...groups.values()].sort((a, b) =>
    Number(a.isDirect) - Number(b.isDirect) || a.depth - b.depth || a.itemName.localeCompare(b.itemName)
  );
}

// Every CRAFTED/intermediate item consumed as an input somewhere in the
// combined chain — Basic Materials, Refined Materials, Steel, ... — i.e.
// something that's both produced (has its own craft step above) AND
// consumed (feeds another step), for the sidebar's running tally. Raw/
// liquid/power inputs are skipped here since expandGatherChain's totals
// already cover those in the RAW & LIQUID INPUTS section right above it —
// this is everything else that would otherwise never get a combined total
// anywhere, only scattered mentions buried in each step's own NEEDS line.
function tallyConsumedMaterials(craftSteps) {
  const totals = {};
  for (const step of craftSteps) {
    for (const [inputName, perBatchQty] of Object.entries(step.recipeInputs || {})) {
      if (poolKindOf(inputName)) continue;
      totals[inputName] = (totals[inputName] || 0) + perBatchQty * step.batches;
    }
  }
  return Object.entries(totals)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
}

// Sums every pooled leaf across all trees into one total per item, split
// into the three base-resource buckets (see poolKindOf) — the chain panel
// shows each bucket as one combined row ("gather this much total") instead
// of making the user add up scattered mentions of the same item buried
// inside each step's input list, or expanding into a Well/Harvester/Power
// Plant step of its own.
// Power is handled differently from liquids/resources: it's a flat,
// steady-state draw per FACILITY RECIPE (see buildNode's power_mw
// handling), not a per-unit material cost, so needing the same recipe
// twice in the tree (e.g. two different tickets both needing Refined
// Materials) must not double its power draw the way it correctly doubles a
// material cost — it's still just the one facility running more batches
// (buildChainSteps already merges those occurrences into a single row).
// Deduped by recipeKey (or the node's own path for aircraft, whose root
// power draw has no recipeKey but is still its own distinct facility) so
// each distinct power-drawing recipe is counted exactly once no matter how
// many places in the tree need its output.
function aggregateRawResources(trees) {
  const liquidTotals = {};
  const resourceTotals = {};
  const powerByKey = {};
  for (const tree of trees) {
    (function walk(node) {
      if (node.isRaw) {
        if (node.poolKind === 'power') return; // counted via its drawing recipe below, not summed here
        const bucket = node.poolKind === 'liquid' ? liquidTotals : resourceTotals;
        bucket[node.itemName] = (bucket[node.itemName] || 0) + node.quantity;
        return;
      }
      const powerChild = node.children.find(c => c.itemName === 'Facility Power');
      if (powerChild) powerByKey[node.recipeKey || node.id] = powerChild.quantity;
      node.children.forEach(walk);
    })(tree);
  }
  const toSortedList = obj => Object.entries(obj)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  const powerTotal = Object.values(powerByKey).reduce((sum, qty) => sum + qty, 0);
  return {
    liquids: toSortedList(liquidTotals),
    resources: toSortedList(resourceTotals),
    power: powerTotal > 0 ? [{ name: 'Facility Power', qty: powerTotal }] : []
  };
}

// A pooled item (liquid/raw resource/power) has no recipe step of its own
// in the chain — but the user can still ask to SEE one: given the item's
// pooled total and an optionally chosen recipe, this works out what that
// recipe's facility/batches/inputs would look like, purely for display.
// It's independent of the tree/pooling math above — picking a different
// recipe here never changes the pooled totals, since the whole point of
// pooling is not to cascade a Well/Harvester/Power-Plant chain any deeper.
function poolItemRecipePreview(name, totalQty, chosenRecipeKey) {
  const parentKey = PARENT_ITEM_BY_OUTPUT[name];
  const alternatives = parentKey
    ? ITEM_MULTIPLE_RECIPES[parentKey].recipes.map(r => ({ recipeKey: r.recipe_key, label: r.recipe_name || r.recipe_key }))
    : null;
  const recipe = (chosenRecipeKey && MATERIAL_RECIPES[chosenRecipeKey]) || RECIPE_BY_OUTPUT[name];
  // No recipe at all (Rare Metal — gathered by hand, no facility involved)
  // — still worth its own row: NEEDS nothing, YIELDS the total, same as an
  // Oil Well's empty-inputs recipe reads. Every caller already treats an
  // empty inputs list as "nothing to expand/show further," so this isn't a
  // special case for them, just a stand-in for the missing recipe object.
  if (!recipe) {
    return {
      recipeKey: null, facility: null, batches: 1, craftSeconds: 0,
      inputs: [], outputs: [{ name, qty: totalQty }],
      isMultiRecipe: false, alternatives: null
    };
  }

  const outputQty = recipe.outputs[name];
  const batches = Math.ceil(totalQty / outputQty);
  const craftSeconds = (recipe.crafting_time_seconds || 0) * batches;
  const inputs = Object.entries(recipe.inputs).map(([inputName, qty]) => ({
    name: inputName, qty: qty * batches, facility: facilityOfOutput(inputName)
  }));
  // Every output the recipe actually produces, not just `name` — some
  // harvester/mine recipes yield a byproduct alongside the main resource
  // (e.g. the Sulfur excavator also drops Coal), which a gather-step display
  // should show honestly rather than hiding.
  const outputs = Object.entries(recipe.outputs).map(([outName, qty]) => ({ name: outName, qty: qty * batches }));

  return {
    recipeKey: recipe.recipeKey, facility: recipe.facility || null, batches, craftSeconds,
    inputs, outputs, isMultiRecipe: !!parentKey, alternatives
  };
}

// Fully expands the pooled liquid/raw/power totals down through whichever
// recipe is currently chosen at each tier (poolRecipeChoice) — not just one
// level — all the way to true terminal resources (Oil Well, Water Pump,
// Rare Metal: no recipe, or a recipe with no inputs of its own). Petrol
// needs Oil, but nothing in the real production tree ever "needs" Oil
// directly (Petrol is pooled/terminal there — see poolKindOf), so without
// this, Oil Well never shows up anywhere, even though it's genuinely one of
// the facilities you have to run. Needing the same item from multiple
// places (e.g. Petrol both directly and to fuel the Salvage harvester)
// correctly sums into one combined total instead of being computed twice
// independently. Converges over a handful of rounds since the recipe graph
// is acyclic (same assumption buildNode's own cycle guard relies on) and,
// in practice, never more than a few tiers deep — each round recomputes
// every currently-known item's contribution off the PREVIOUS round's
// totals, starting fresh from the real base totals every time, until
// nothing changes.
function expandGatherChain(liquids, resources, power, recipeChoice) {
  const baseTotals = {};
  for (const it of [...liquids, ...resources, ...power]) {
    baseTotals[it.name] = (baseTotals[it.name] || 0) + it.qty;
  }

  let totals = { ...baseTotals };
  let names = Object.keys(baseTotals);
  for (let round = 0; round < 8; round++) {
    const next = { ...baseTotals };
    const nextNames = new Set(names);
    for (const name of names) {
      const preview = poolItemRecipePreview(name, totals[name] || 0, recipeChoice[name]);
      if (!preview) continue;
      for (const inp of preview.inputs) {
        next[inp.name] = (next[inp.name] || 0) + inp.qty;
        nextNames.add(inp.name);
      }
    }
    const namesArr = [...nextNames];
    const stable = namesArr.length === names.length
      && namesArr.every(n => Math.abs((next[n] || 0) - (totals[n] || 0)) < 1e-6);
    totals = next;
    names = namesArr;
    if (stable) break;
  }

  // How many tiers of further inputs a name's own chosen recipe has — 0
  // for a true terminal. Purely for ordering the gather steps "most
  // primitive first" (Oil Well before the Petrol that consumes it), the
  // same way buildChainSteps already orders the real craft steps.
  const depthCache = {};
  function depthOf(name, chain) {
    if (name in depthCache) return depthCache[name];
    if (chain.has(name)) return 0; // guard only — real recipe data has no cycles
    const preview = poolItemRecipePreview(name, 1, recipeChoice[name]);
    if (!preview || preview.inputs.length === 0) { depthCache[name] = 0; return 0; }
    const nextChain = new Set(chain);
    nextChain.add(name);
    const d = 1 + Math.max(0, ...preview.inputs.map(inp => depthOf(inp.name, nextChain)));
    depthCache[name] = d;
    return d;
  }

  const items = names
    .map(name => ({ name, qty: totals[name], depth: depthOf(name, new Set()) }))
    .sort((a, b) => a.depth - b.depth || b.qty - a.qty || a.name.localeCompare(b.name));

  const buckets = { liquid: [], resource: [], power: [] };
  for (const { name, qty } of items) buckets[poolKindOf(name) || 'resource'].push({ name, qty });
  const sortByQty = list => [...list].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

  return {
    items,
    liquids: sortByQty(buckets.liquid),
    resources: sortByQty(buckets.resource),
    power: sortByQty(buckets.power)
  };
}

// Every alternative recipe for a multi-recipe item, each fully previewed
// (facility/batches/time/inputs/outputs scaled to totalQty) — lets a
// recipe picker show what a recipe actually entails before it's chosen,
// not just its bare label. Returns null for an item with only one recipe
// (nothing to choose between). Purely for display, same as
// poolItemRecipePreview above — computing a preview never mutates
// anything or affects the real chain totals.
function recipeAlternativePreviews(itemName, totalQty) {
  const parentKey = PARENT_ITEM_BY_OUTPUT[itemName];
  if (!parentKey) return null;
  return ITEM_MULTIPLE_RECIPES[parentKey].recipes.map(r => {
    const outputQty = r.outputs[itemName];
    const batches = Math.ceil(totalQty / outputQty);
    const craftSeconds = (r.crafting_time_seconds || 0) * batches;
    const inputs = Object.entries(r.inputs).map(([inputName, qty]) => ({
      name: inputName, qty: qty * batches, facility: facilityOfOutput(inputName)
    }));
    const outputs = Object.entries(r.outputs).map(([outName, qty]) => ({ name: outName, qty: qty * batches }));
    return {
      recipeKey: r.recipe_key, label: r.recipe_name || r.recipe_key,
      facility: r.facility || null, batches, craftSeconds, inputs, outputs
    };
  });
}

// ============================================================
// FORMATTING HELPERS
// ============================================================

function fmtNum(n) { return Math.round(n).toLocaleString('en-US'); }

// Wiki-scraped icons live in icons/images/*.png, named by sanitizing the
// item's title: any run of characters that isn't a letter, digit, or
// hyphen collapses to a single underscore, with leading/trailing
// underscores stripped (".44 Mag" -> "44_Mag", "68A-4 Ronan Fathomer" ->
// "68A-4_Ronan_Fathomer"). Coverage isn't total, so every <img> removes
// itself on a 404 instead of showing a broken-image glyph.
// Liquids carry a " (L)" suffix as OUR OWN data convention (isLiquidName)
// that has nothing to do with the wiki's naming — the wiki's own icon is
// just "Oil.png"/"Diesel.png"/etc., so that suffix is stripped before
// normalizing, same as every other item.
function iconFileName(name) {
  const clean = name.replace(/\s*\(L\)$/, '');
  return clean.replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '');
}
function iconTag(name, cssClass) {
  return `<img src="icons/images/${iconFileName(name)}.png" class="${cssClass}" alt="" onerror="this.remove()">`;
}

// The facility that actually produces a given item by its default recipe —
// used to decide crate display for an INPUT ingredient shown on a ticket,
// since what matters is where THAT item was made (a Garage-built Battering
// Ram stays un-crated even when it's listed as an input elsewhere), not
// the facility of whatever recipe is consuming it.
function facilityOfOutput(name) {
  const recipe = RECIPE_BY_OUTPUT[name];
  return recipe ? recipe.facility : undefined;
}

// Crates first wherever a crate size is known for this item ("5c"), with
// the exact unit count still shown right alongside in smaller text — falls
// back to a plain unit count for anything with no known crate size (most
// raw resources and base materials were never tracked in crates here).
// Garage/Shipyard-crafted output is the exception that overrides a known
// crate size: those facilities hand you the item directly, un-crated, even
// when the same item comes in crates from an MPF or Refinery run — so a
// Garage/Shipyard step always shows the plain count, never "Nc".
function fmtQty(name, qty, facility) {
  const crateSize = !UNCRATED_FACILITIES.has(facility) && CRATE_SIZE_BY_NAME[name];
  if (crateSize) {
    const crates = Math.ceil(qty / crateSize);
    return `<span class="qty-crates">${fmtNum(crates)}c</span><span class="qty-units">${fmtNum(qty)}</span>`;
  }
  // No known crate size — just the plain unit count, at full size/color,
  // not shrunk down the way the secondary number is when crates ARE shown.
  return fmtNum(qty);
}

function fmtTime(totalSeconds) {
  // Summing crafting_time_seconds * batches across a whole chain picks up
  // floating-point fuzz (17.399999999999977 instead of 17.4) — round to the
  // nearest whole second up front so it can't leak into the seconds digit.
  const rounded = Math.round(totalSeconds);
  if (rounded === 0) return "Instant";
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  const parts = [];
  if (hours > 0) parts.push(`${fmtNum(hours)}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(" ");
}

function itemLine(qty, name, facility) {
  return `<div class="item-line"><span class="qty-chip">${fmtQty(name, qty, facility)}</span><span class="item-name">${name}</span></div>`;
}
