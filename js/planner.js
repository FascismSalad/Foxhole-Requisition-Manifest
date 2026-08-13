// ============================================================
// FACILITY PLANNER
// The reverse of the main calculator: instead of picking an output and
// working backwards to raw resources, this page starts from buildings —
// place a facility on the board, choose which of its recipes it's running,
// and drag connections between matching input/output ports to build up a
// production flowchart by hand.
//
// Reuses loader.js (data load + MATERIAL_RECIPES/AIRCRAFT_COSTS/FACILITIES)
// and calc.js/render.js (iconTag, fmtNum/fmtTime, effectiveCraftingTime,
// poolKindOf, renderRecipeOptionCard, ...) as-is — this file only adds the
// facility-indexed recipe lookup and the board itself.
// ============================================================

// BASE facility name (see baseFacilityName — bracketed module suffixes
// stripped, so "Oil Refinery [Cracking Unit]" and "Oil Refinery" share one
// entry) -> array of unified recipe entries (see buildFacilityIndex). A
// "recipe entry" here normalizes both a real MATERIAL_RECIPES row and a
// synthesized one for an aircraft (which uses assembly_materials/
// aircraft_parts instead of inputs/outputs) into the same { key, facility,
// inputs, outputs, crafting_time_seconds, power_mw, label, outputName }
// shape — `facility` stays each recipe's own EXACT (unstripped) facility
// string, so a node can still show/icon the specific module a recipe
// actually runs on even though it's filed under the base name.
let RECIPES_BY_FACILITY = {};
const RECIPE_INDEX_BY_KEY = {};
let FACILITY_CATALOG = [];

// A bracketed suffix on a facility name ("Materials Factory [Metal Press]",
// "Oil Refinery [Cracking Unit]") names a MODULE of that same physical
// building, not a separate building — the base name (without the suffix)
// is what actually gets placed on the board and searched for in the
// catalog; every one of its module variants' recipes shows up together on
// that single node's own recipe dropdown instead of forcing a separate
// node per module. A plain parenthesized name ("Stationary Harvester
// (Salvage)") is NOT a module suffix — it's part of the base name itself
// (the resource it harvests) — only a trailing [...] group is stripped.
function baseFacilityName(name) {
  return name.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
}

// What actually distinguishes this recipe from its siblings once every
// module variant of a building is merged into one group (see
// baseFacilityName) — two parts, combined:
//  - moduleTag: which bracketed module this recipe's own (unmerged)
//    facility names, relative to the group's base name — "Oil Refinery
//    [Reformer]" in a group based on "Oil Refinery" -> "[Reformer]"; the
//    group's own plain/unbracketed recipe -> ''.
//  - fuelTag: a recipe's own recipe_name often just repeats its facility
//    name with nothing left once that's stripped, but sometimes carries
//    genuinely new info even on the plain facility itself (fuel choice:
//    "Salvage Mine (Diesel)" vs "(Petrol)", both facility "Salvage Mine").
function recipeVariantSuffix(r, baseName) {
  let moduleTag = '';
  if (r.facility && r.facility !== baseName) {
    moduleTag = r.facility.startsWith(baseName) ? r.facility.slice(baseName.length).trim() : r.facility;
  }
  let fuelTag = '';
  if (r.recipe_name && r.facility) {
    let v = r.recipe_name;
    if (v.startsWith(r.facility)) v = v.slice(r.facility.length).trim();
    if (v && v !== r.facility) fuelTag = v;
  }
  return [moduleTag, fuelTag].filter(Boolean).join(' ');
}

// Picker/node labels lead with WHAT the recipe makes (the useful thing to
// scan a long facility-scoped list by, e.g. every "Factory" recipe) rather
// than how (the facility is already the fixed context of that list) — the
// variant only gets appended when two recipes in the same group would
// otherwise share an identical label (module variants with the same
// primary output, or the mine/power-station fuel variants).
function computeRecipeLabel(r, siblingRecipes, baseName) {
  if (r.full_name) return r.full_name;
  const sameOutput = siblingRecipes.filter(x => x.outputName === r.outputName);
  const variant = recipeVariantSuffix(r, baseName);
  if (sameOutput.length > 1 && variant) return `${r.outputName} · ${variant}`;
  return r.outputName;
}

// Every term a recipe should be findable by in a picker search — not just
// its own label, but every alias/tag it or (for a multi-recipe item like
// Construction Materials) its parent item carries, same breadth the main
// calculator's own search bar indexes (buildSuggestions in app.js): full
// name, key, category/subcategory/class/type, aliases, and its own output
// names. Lets "bomber" surface an aircraft whose real name doesn't contain
// that word at all, purely via its type ("heavy_bomber") or an alias.
function buildSearchText(parts) {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

// Builds RECIPES_BY_FACILITY/RECIPE_INDEX_BY_KEY/FACILITY_CATALOG from
// MATERIAL_RECIPES + AIRCRAFT_COSTS (already loaded by loadData() in
// loader.js by the time this runs) — the planner-specific facility-indexed
// view neither of the calculator's own data structures provide on their
// own. Called once at boot, right after loadData() resolves (see
// bootPlanner below).
function buildFacilityIndex() {
  const raw = [];
  for (const [key, recipe] of Object.entries(MATERIAL_RECIPES)) {
    if (!recipe.facility) continue;
    // A recipe belonging to a multi-recipe item (Steel, Construction
    // Materials, ...) carries its OWN aliases sometimes (e.g. "salvage
    // harvester"), but the item-wide aliases/full_name ("cmat", "cmats",
    // "Construction Materials") live one level up, on the parent — both
    // need to be searchable from this one recipe entry.
    const parent = findMultiRecipeParent(recipe.recipeKey || key);
    raw.push({
      key: recipe.recipeKey || key,
      facility: recipe.facility,
      inputs: recipe.inputs || {},
      outputs: recipe.outputs,
      crafting_time_seconds: recipe.crafting_time_seconds,
      power_mw: recipe.power_mw,
      full_name: recipe.full_name || null,
      recipe_name: recipe.recipe_name || null,
      isAircraft: false,
      searchText: buildSearchText([
        recipe.full_name, recipe.recipe_name, recipe.recipeKey || key,
        recipe.category, recipe.subcategory,
        ...(recipe.aliases || []),
        ...Object.keys(recipe.outputs || {}),
        parent && parent.itemData.full_name, parent && parent.itemKey,
        ...(parent ? parent.itemData.aliases || [] : [])
      ])
    });
  }
  for (const [key, aircraft] of Object.entries(AIRCRAFT_COSTS)) {
    if (!aircraft.facility) continue;
    const inputs = {};
    for (const [m, a] of Object.entries(aircraft.assembly_materials || {})) inputs[m] = (inputs[m] || 0) + a;
    for (const [p, a] of Object.entries(aircraft.aircraft_parts || {})) inputs[p] = (inputs[p] || 0) + a;
    raw.push({
      key: `aircraft:${key}`,
      facility: aircraft.facility,
      inputs,
      outputs: { [aircraft.full_name]: 1 },
      crafting_time_seconds: aircraft.crafting_time_seconds,
      power_mw: aircraft.power_mw,
      full_name: aircraft.full_name,
      recipe_name: null,
      isAircraft: true,
      searchText: buildSearchText([
        aircraft.full_name, key, aircraft.category, aircraft.subcategory, aircraft.class, aircraft.type,
        ...(aircraft.aliases || [])
      ])
    });
  }

  // Grouped by BASE name (see baseFacilityName) — every recipe from every
  // bracketed module of the same physical building lands in one group, so
  // placing "Oil Refinery" once puts its base recipe AND every one of
  // [Cracking Unit]/[Petrochemical Plant]/[Reformer]'s recipes on that
  // single node's own dropdown, rather than needing a separate node per
  // module (each of which, in the old per-exact-facility grouping, usually
  // had just its own one or two recipes, so picking a different recipe on
  // it visibly did nothing).
  RECIPES_BY_FACILITY = {};
  for (const r of raw) {
    r.outputName = Object.keys(r.outputs)[0] || '';
    const base = baseFacilityName(r.facility);
    (RECIPES_BY_FACILITY[base] || (RECIPES_BY_FACILITY[base] = [])).push(r);
  }
  for (const [base, list] of Object.entries(RECIPES_BY_FACILITY)) {
    for (const r of list) {
      r.label = computeRecipeLabel(r, list, base);
      RECIPE_INDEX_BY_KEY[r.key] = r;
    }
    list.sort((a, b) => a.label.localeCompare(b.label));
  }

  // "Beach" isn't a real placeable facility — it's the game letting you
  // assemble one specific small boat directly on open shoreline, no
  // building involved, and it only shows up here because the recipe data
  // still needs SOME facility field for it. Not a building you'd ever
  // place on this board, so it's excluded from the catalog outright.
  delete RECIPES_BY_FACILITY['Beach'];

  // Every key in RECIPES_BY_FACILITY already IS a valid, non-empty base
  // building name by construction — no need to cross-reference FACILITIES
  // separately (that also would have re-fragmented the list back into
  // one-entry-per-module, the exact thing being merged away here).
  // representativeFacility carries one real (unmerged) recipe's own exact
  // facility string alongside the base name — a fallback icon candidate
  // for bases like "Infantry Kit Factory" that have no icon of their own
  // (only its bracketed modules were ever scraped) — see
  // iconTagWithFallback.
  FACILITY_CATALOG = Object.entries(RECIPES_BY_FACILITY)
    .map(([name, list]) => ({ name, count: list.length, representativeFacility: list[0].facility }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Some base building names were never individually scraped an icon (only
// their bracketed module variants were, e.g. "Infantry Kit Factory") — this
// tries a list of candidate names in order, falling back to the next one
// on a 404 instead of just leaving that slot blank (iconTag's plain
// this.remove() behavior) whenever a better-covered alternative name exists.
function handleIconFallback(imgEl) {
  const remaining = (imgEl.dataset.fallbacks || '').split('|').filter(Boolean);
  if (!remaining.length) { imgEl.remove(); return; }
  const next = remaining.shift();
  imgEl.dataset.fallbacks = remaining.join('|');
  imgEl.src = `icons/images/${next}.png`;
}

function iconTagWithFallback(candidateNames, cssClass) {
  const files = [...new Set(candidateNames.filter(Boolean).map(iconFileName))];
  if (!files.length) return '';
  const [first, ...rest] = files;
  return `<img src="icons/images/${first}.png" class="${cssClass}" alt="" data-fallbacks="${rest.join('|')}" onerror="handleIconFallback(this)">`;
}

// ============================================================
// STATE
// ============================================================

const plannerState = {
  nodes: [],        // { id, facility, recipeKeys, x, y, count } — x/y are world-space px
  connections: [],   // { id, fromNode, fromItem, toNode, toItem }
  pan: { x: 60, y: 60 },
  scale: 1,
  selectedNodeIds: new Set(), // shift-drag box select / shift-click can hold more than one
  selectedWireId: null
};
let nodesById = {};
let plannerClipboard = null; // { nodes, connections } snapshot from Ctrl+C — see copySelection
let pasteOffsetStep = 0;
let nodeIdCounter = 1;
let wireIdCounter = 1;
let portElIndex = {};
let pendingPathEl = null;
let pickerContext = null; // { nodeId }

const STORAGE_KEY = 'foxholePlannerLayout.v1';

// ============================================================
// DOM refs (populated in initPlannerUI)
// ============================================================

let viewportEl, worldEl, wireLayerEl, nodesLayerEl, emptyHintEl, zoomReadoutEl;
let facilitySearchEl, facilityListEl;
let pickerOverlayEl, pickerPanelEl, pickerTitleEl, pickerSearchEl, pickerListEl, pickerCloseEl;

// ============================================================
// GEOMETRY HELPERS
// ============================================================

// body.planner-page cancels the site-wide html{zoom:1.12} for this page
// (see the comment on that rule in planner.css) specifically so this math
// doesn't have to account for it — getBoundingClientRect()/clientX/clientY
// and a raw px value we assign (style.left, a transform's translate(), an
// SVG path coordinate) are back to being the same pixel space, board-wide.
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

// Converts a raw mouse position (clientX/Y, screen space) into world-space
// board coordinates — inverts applyTransform's own pan+scale so a click at
// a given screen pixel maps back to the exact same board point regardless
// of how far panned/zoomed the view currently is.
function screenToWorld(clientX, clientY) {
  const rect = viewportEl.getBoundingClientRect();
  return {
    x: (clientX - rect.left - plannerState.pan.x) / plannerState.scale,
    y: (clientY - rect.top - plannerState.pan.y) / plannerState.scale
  };
}

// Whatever board point is currently centered in the viewport — used to
// drop a newly-placed facility (click-to-place in the sidebar) roughly in
// the middle of what's actually visible, rather than at a fixed world
// origin that might be scrolled off-screen.
function viewportCenterWorld() {
  const rect = viewportEl.getBoundingClientRect();
  return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

// Port world-position is read straight off the live DOM (port vs. its own
// node's bounding box, divided by the current zoom) rather than computed
// from hardcoded row heights — robust to any layout change, and correct
// under the current pan/scale without needing to invert the CSS transform.
function getPortWorldPos(portEl) {
  const nodeEl = portEl.closest('.fac-node');
  const node = nodesById[nodeEl.dataset.nodeId];
  const portRect = portEl.getBoundingClientRect();
  const nodeRect = nodeEl.getBoundingClientRect();
  return {
    x: node.x + (portRect.left - nodeRect.left + portRect.width / 2) / plannerState.scale,
    y: node.y + (portRect.top - nodeRect.top + portRect.height / 2) / plannerState.scale
  };
}

function bezierPath(x1, y1, x2, y2) {
  // Signed, not abs — a control point offset that's always "+dx from x1,
  // -dx from x2" assumes the target sits to the right, so when it's
  // actually to the LEFT (a wire feeding back to something upstream, or a
  // node dragged past what it's wired to) both control points bulge away
  // from each other instead of toward each other, looping the curve out
  // and back instead of a clean line. Keeping the sign of (x2-x1) makes
  // both control points always point toward the OTHER end regardless of
  // which side it's actually on.
  const rawDx = x2 - x1;
  const dx = (rawDx < 0 ? -1 : 1) * Math.max(Math.abs(rawDx) * 0.5, 60);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// Power lines read like circuit wiring — straight runs and clean corners,
// never the smooth curve every other wire uses — so a power connection
// stays visually distinct on a busy board at a glance, the same way its
// port already gets its own color. One elbow, bent at the horizontal
// midpoint, is enough to always reach the target regardless of relative
// position (unlike a naive H-then-V path, this doesn't go fully vertical
// when x1 and x2 are nearly equal).
function orthogonalPath(x1, y1, x2, y2) {
  const midX = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
}

// The single-hop (no waypoints) routing rule: power gets the right-angle
// elbow, everything else gets the smooth default curve — see renderWires,
// the only place that decides when a wire actually has just one hop.
function wirePathFor(item, x1, y1, x2, y2) {
  return poolKindOf(item) === 'power' ? orthogonalPath(x1, y1, x2, y2) : bezierPath(x1, y1, x2, y2);
}

// A plain straight line between two points — used for a power wire's own
// hops once it has waypoints (see renderWires): power keeps its
// right-angle-only rule even when manually adjusted, so its hops stay
// straight lines between whatever points are placed rather than curving
// like a normal wire's do (see smoothSegmentPath).
function straightPath(x1, y1, x2, y2) {
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

// One hop of a smooth curve running through an entire point sequence
// (port -> waypoints -> port) — dragging a waypoint bends the wire
// gracefully around it instead of kinking it into a hard corner. Standard
// Catmull-Rom-to-Bezier conversion: this hop's own control points lean on
// its NEIGHBORS on both sides (p0 before, p3 after — duplicated at either
// end of the sequence, the usual open-curve convention), so consecutive
// hops blend into one continuous curve rather than each being shaped in
// isolation — the same trick behind "smooth" path tools in vector
// editors. i is this hop's index into points (points[i] -> points[i+1]).
function smoothSegmentPath(points, i) {
  const p0 = points[i - 1] || points[i];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[i + 2] || p2;
  const cp1x = p1.x + (p2.x - p0.x) / 6;
  const cp1y = p1.y + (p2.y - p0.y) / 6;
  const cp2x = p2.x - (p3.x - p1.x) / 6;
  const cp2y = p2.y - (p3.y - p1.y) / 6;
  return `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
}

// fmtRate/fmtItemRate/round2 are defined in calc.js (shared with the
// calculator's own queue-scaled rate chips — see renderCraftRow in
// render.js) so both pages' rate displays read identically.

// Which category color a port dot gets, matching the calculator's own
// liquid/resource/power color coding (stepColorClass in render.js) — a
// plain crafted item gets no extra class, just the default port styling.
function portColorClass(name) {
  const kind = poolKindOf(name);
  if (kind === 'liquid') return 'fac-port-liquid';
  if (kind === 'resource') return 'fac-port-resource';
  if (kind === 'power') return 'fac-port-power';
  return '';
}

// A card can run more than one of its facility's recipes at once (an
// Aircraft Factory building both Parts and Engines on the same node) — its
// inputs/outputs/rates are the union/sum of every recipe it currently has
// active, exactly as if each were its own separate node.
function nodeRecipeObjs(node) {
  if (!node || !node.recipeKeys) return [];
  return node.recipeKeys.map(k => RECIPE_INDEX_BY_KEY[k]).filter(Boolean);
}

// Whether this exact port (a node + item + direction) already has at
// least one wire touching it — drives the "connected" dot styling
// (buildNodeHtml/ioRowHtml) so a wired port reads differently at a glance
// from an unwired one, before you even look for the wire itself.
function isPortConnected(nodeId, item, dir) {
  return dir === 'out'
    ? plannerState.connections.some(c => c.fromNode === nodeId && c.fromItem === item)
    : plannerState.connections.some(c => c.toNode === nodeId && c.toItem === item);
}

// A node's actual rate for one of its own items, as either its producer
// (dir 'out') or consumer (dir 'in') — MW for Facility Power (a continuous
// draw/supply, not a per-cycle yield — same treatment calc.js gives
// power_mw: flat, never scaled by craft time), items/min for everything
// else. This is the one source of truth for every rate shown on a node's
// NEEDS/YIELDS rows AND on the wires connected to it, so a wire always
// reads as "what the consumer at this end actually draws" (see
// renderWires) rather than restating the producer's full output on every
// branch it happens to feed.
function itemRatePerMin(node, item, dir) {
  const recipes = nodeRecipeObjs(node);
  if (!recipes.length) return 0;
  let total = 0;
  for (const recipe of recipes) {
    if (item === 'Facility Power') {
      total += dir === 'in' ? (recipe.power_mw || 0) : (recipe.outputs[item] || 0);
      continue;
    }
    const qty = dir === 'in' ? (recipe.inputs[item] || 0) : (recipe.outputs[item] || 0);
    if (qty) total += qty / Math.max(effectiveCraftingTime(recipe), 0.001) * 60;
  }
  return total * node.count;
}

// ============================================================
// RENDERING — nodes
// ============================================================

// One NEEDS/YIELDS row on a node card: the draggable port dot, icon, item
// name, and its already-formatted rate text (see itemRatePerMin/
// fmtItemRate) — dir is 'in' or 'out', matching the port's own
// data-dir/portElIndex key so wiring logic can find it again.
function ioRowHtml(node, name, rateText, dir) {
  const colorClass = portColorClass(name);
  const connectedClass = isPortConnected(node.id, name, dir) ? 'connected' : '';
  return `<div class="fac-io-row" data-item="${name}" data-dir="${dir}">
    <span class="fac-port fac-port-${dir} ${colorClass} ${connectedClass}" data-item="${name}" data-dir="${dir}"></span>
    ${iconTag(name, 'fac-io-icon')}
    <div class="fac-io-text">
      <span class="fac-io-name">${name}</span>
      <span class="fac-io-rate">${rateText}</span>
    </div>
  </div>`;
}

// Builds one facility card's full inner HTML — header (icon, title, count
// stepper, remove), the active-recipe chip list, and the combined NEEDS/
// YIELDS port columns. Called both for a brand new node (renderNodesLayer)
// and to refresh a single existing one in place (setNodeCount,
// toggleNodeRecipe, ...) whenever something about it changes without
// needing a full board re-render.
function buildNodeHtml(node) {
  const recipes = nodeRecipeObjs(node);
  // NEEDS/YIELDS are the UNION of every active recipe's own inputs/outputs
  // (see itemRatePerMin, which already sums the rate across all of them) —
  // an item two active recipes both need shows once, at their combined
  // rate, not as two duplicate rows.
  const inputItems = [];
  const outputItems = [];
  let anyPower = false;
  for (const r of recipes) {
    for (const n of Object.keys(r.inputs)) if (!inputItems.includes(n)) inputItems.push(n);
    for (const n of Object.keys(r.outputs)) if (!outputItems.includes(n)) outputItems.push(n);
    if (r.power_mw) anyPower = true;
  }
  const inputRows = inputItems.map(n => ioRowHtml(node, n, fmtItemRate(n, itemRatePerMin(node, n, 'in')), 'in'));
  // Power is a normal NEEDS-side port here too — a second, yellow-coded
  // input alongside the recipes' real ingredients (see itemRatePerMin) —
  // rather than a bare text readout with nothing to actually wire a power
  // plant's output into.
  if (anyPower) {
    inputRows.push(ioRowHtml(node, 'Facility Power', fmtItemRate('Facility Power', itemRatePerMin(node, 'Facility Power', 'in')), 'in'));
  }
  const inputsHtml = inputRows.length ? inputRows.join('') : `<div class="fac-node-io-empty">—</div>`;

  const outputsHtml = outputItems.length
    ? outputItems.map(n => ioRowHtml(node, n, fmtItemRate(n, itemRatePerMin(node, n, 'out')), 'out')).join('')
    : `<div class="fac-node-io-empty">—</div>`;

  // The header always names the base building (what you searched for and
  // placed) — the icon and tooltip switch to the first ACTIVE recipe's own
  // exact module facility when one's selected ("Oil Refinery [Cracking
  // Unit]"), since that's the more specific/accurate picture of what's
  // actually sitting on the board right now; falls back to the base
  // building's own icon before any recipe's chosen.
  const iconFacility = recipes.length ? recipes[0].facility : node.facility;
  // The facility count lives inline in the header now (no separate labeled
  // row, no craft-time row below it — see the card-condensing pass this
  // came from) — same qty-inc/qty-dec/.fac-qty-val hooks the event
  // delegation in initPlannerUI already listens for, just laid out smaller.
  const recipeListHtml = recipes.length
    ? recipes.map(r => `
      <div class="fac-node-recipe-chip" data-recipe-key="${r.key}" title="Click to edit recipes">
        <span class="chip-label">${r.label}</span>
        <button class="chip-remove" data-action="remove-recipe" data-recipe-key="${r.key}" title="Stop running this recipe">×</button>
      </div>`).join('')
    : `<div class="fac-node-recipe-empty">NO RECIPE SELECTED</div>`;
  return `
    <div class="fac-node-head" data-drag-handle>
      ${iconTagWithFallback([iconFacility, node.facility], 'fac-node-icon')}
      <div class="fac-node-title" title="${iconFacility}">${node.facility}</div>
      <div class="fac-node-qty-inline" title="Facilities placed here">
        <button class="fac-qty-mini-btn" data-action="qty-dec" title="One fewer of this facility">−</button>
        <input type="number" class="qty-val fac-qty-val fac-qty-mini-val" value="${node.count}" min="1" step="1" inputmode="numeric">
        <button class="fac-qty-mini-btn" data-action="qty-inc" title="One more of this facility">+</button>
      </div>
      <button class="fac-node-remove" data-action="remove" title="Remove facility">×</button>
    </div>
    <div class="fac-node-recipes">
      ${recipeListHtml}
      <button class="fac-node-recipe-add" data-action="add-recipe" title="Run another of this facility's recipes at the same time">+ RECIPE</button>
    </div>
    <div class="fac-node-io">
      <div class="fac-node-io-col needs">
        <div class="fac-node-io-label">NEEDS</div>
        ${inputsHtml}
      </div>
      <div class="fac-node-io-col yields">
        <div class="fac-node-io-label">YIELDS</div>
        ${outputsHtml}
      </div>
    </div>`;
}

// Rebuilds every node's DOM element from scratch (positioned via
// style.left/top, sized/laid out by buildNodeHtml's own markup) — the
// full-board equivalent of buildNodeHtml's single-node refresh, used
// whenever the SET of nodes itself changed (added/removed/pasted/loaded),
// not just one node's own content. Always followed by indexPorts, since
// every port element it just created needs to be findable again.
function renderNodesLayer() {
  nodesLayerEl.innerHTML = '';
  for (const node of plannerState.nodes) {
    const el = document.createElement('div');
    el.className = 'fac-node' + (plannerState.selectedNodeIds.has(node.id) ? ' selected' : '');
    el.dataset.nodeId = node.id;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.innerHTML = buildNodeHtml(node);
    nodesLayerEl.appendChild(el);
  }
  indexPorts();
}

// Rebuilds portElIndex (nodeId|dir|item -> its actual port element) by
// scanning the live DOM — the lookup renderWires/getPortWorldPos use to
// find a specific port without re-querying the whole board on every wire.
// Must be re-run any time a node's own HTML is rebuilt (its old port
// elements are gone, replaced by new ones with the same keys).
function indexPorts() {
  portElIndex = {};
  nodesLayerEl.querySelectorAll('.fac-port').forEach(portEl => {
    const nodeId = portEl.closest('.fac-node').dataset.nodeId;
    portElIndex[`${nodeId}|${portEl.dataset.dir}|${portEl.dataset.item}`] = portEl;
  });
}

// ============================================================
// RENDERING — wires
// ============================================================

const SVG_NS = 'http://www.w3.org/2000/svg';
const WAYPOINT_HANDLE_SIZE = 9; // a small square "box" you grab to bend a wire — see smoothSegmentPath

// Two jobs in one pass, both about wires sharing a port that only has one
// combined rate to go around:
//  - FAN-OUT (one output feeding several consumers): a single 60/min
//    refinery wired to three consumers doesn't supply 60/min to each of
//    them (the original bug this fixed — the port would've shown 180/min
//    worth of draw against a 60/min supply even when the consumers only
//    actually needed 40 total). Each wire's flow is capped by what's
//    actually left once every other wire off that port is accounted for.
//  - FAN-IN (one input fed by several producers — "merge inputs": two
//    buildings both making Construction Materials wired into the same
//    consumer): the consumer's demand is split across its incoming wires
//    proportional to each source's own rate, capped at what that source
//    actually makes, instead of treating EVERY wire as if it alone had to
//    cover the full downstream demand (which used to flag both sources as
//    short even when the two together covered it exactly). If every
//    source combined still isn't enough, each just passes its full rate
//    through and the port itself — not any one wire — is marked short.
// The result is a per-wire "flow" (what that specific wire is actually
// carrying), plus a supplied/demanded balance for every output port and a
// demand/short balance for every input port, used by renderWires to color
// whichever side of a shortfall is the real bottleneck.
function computeFlow() {
  const byTarget = {};
  for (const conn of plannerState.connections) {
    const perNode = byTarget[conn.toNode] || (byTarget[conn.toNode] = {});
    (perNode[conn.toItem] || (perNode[conn.toItem] = [])).push(conn);
  }

  const wireFlow = {};       // connId -> rate this specific wire actually carries
  const inputBalance = {};   // `${toNode}|${toItem}` -> { demand, totalOffered, short }
  for (const [toNodeId, itemsMap] of Object.entries(byTarget)) {
    const toNode = nodesById[toNodeId];
    if (!toNode) continue;
    for (const [toItem, conns] of Object.entries(itemsMap)) {
      const demand = itemRatePerMin(toNode, toItem, 'in');
      const supplies = conns.map(c => {
        const fromNode = nodesById[c.fromNode];
        return fromNode ? itemRatePerMin(fromNode, c.fromItem, 'out') : 0;
      });
      const totalOffered = supplies.reduce((a, b) => a + b, 0);
      // Combined sources cover (or exceed) the need: split the demand
      // between them, proportional to what each already makes. Combined
      // sources fall short: nobody's throttled, so just pass each one's
      // full rate through — the shortfall belongs to the port, not a wire.
      const scale = totalOffered > demand && totalOffered > 0 ? demand / totalOffered : 1;
      conns.forEach((c, i) => { wireFlow[c.id] = supplies[i] * scale; });
      inputBalance[`${toNodeId}|${toItem}`] = { demand, totalOffered, short: totalOffered < demand - 1e-6 };
    }
  }

  const outputBalance = {}; // `${fromNode}|${fromItem}` -> { supplied, demanded }
  for (const node of plannerState.nodes) {
    for (const r of nodeRecipeObjs(node)) {
      for (const item of Object.keys(r.outputs)) {
        const key = `${node.id}|${item}`;
        if (!outputBalance[key]) outputBalance[key] = { supplied: itemRatePerMin(node, item, 'out'), demanded: 0 };
      }
    }
  }
  for (const conn of plannerState.connections) {
    const entry = outputBalance[`${conn.fromNode}|${conn.fromItem}`];
    if (entry) entry.demanded += wireFlow[conn.id] || 0;
  }

  return { wireFlow, inputBalance, outputBalance };
}

function renderWires() {
  wireLayerEl.innerHTML = '';
  pendingPathEl = null;
  const { wireFlow, inputBalance, outputBalance } = computeFlow();
  nodesLayerEl.querySelectorAll('.fac-port.overcap').forEach(el => el.classList.remove('overcap'));

  for (const conn of plannerState.connections) {
    const fromEl = portElIndex[`${conn.fromNode}|out|${conn.fromItem}`];
    const toEl = portElIndex[`${conn.toNode}|in|${conn.toItem}`];
    if (!fromEl || !toEl) continue;
    const p1 = getPortWorldPos(fromEl);
    const p2 = getPortWorldPos(toEl);
    // A dragged bend point (see onWireHitMouseDown/onWaypointDragStart)
    // splits the wire into a chain of hops through each waypoint in
    // order — smoothly curved for a normal wire, straight for power (see
    // the isPower/hasWaypoints branch below) — rather than one smooth
    // curve straight to the target. Each hop is its own path/hitbox
    // (still tagged with this connection's id, so selection/click-
    // through-drag work on any of them) instead of trying to splice
    // multiple curve commands into one "d" string.
    const waypoints = conn.waypoints || [];
    const points = [p1, ...waypoints, p2];

    // Two independent reasons a wire can be flagged, colored the same way
    // since both mean "the numbers along this wire don't add up": the
    // SOURCE is promising more across all its wires than it actually makes
    // (producerOvercap), or the DESTINATION port isn't getting enough even
    // with every source feeding it combined (inputShort) — see
    // computeFlow. A wire between two otherwise-fine nodes can still show
    // inputShort if a sibling wire into the same input is the shortfall.
    const outBal = outputBalance[`${conn.fromNode}|${conn.fromItem}`];
    const inBal = inputBalance[`${conn.toNode}|${conn.toItem}`];
    const producerOvercap = !!outBal && outBal.demanded > outBal.supplied + 1e-6;
    const inputShort = !!inBal && inBal.short;
    const overCap = producerOvercap || inputShort;
    if (producerOvercap) fromEl.classList.add('overcap');
    if (inputShort) toEl.classList.add('overcap');

    // Once a wire has waypoints, dragging one bends the wire smoothly
    // around it (see smoothSegmentPath) — the whole point of a "curve you
    // can drag" is that it stays a curve, not a polyline with a kink at
    // every point. Power keeps its right-angle-only rule even once
    // adjusted by hand (see wirePathFor/orthogonalPath) — a curved power
    // line would undercut the very thing that request asked for — so it
    // still gets straight hops between whatever points are placed. The
    // untouched single hop (no waypoints at all) keeps using the auto
    // routing for both cases.
    const isPower = poolKindOf(conn.fromItem) === 'power';
    const hasWaypoints = points.length > 2;
    for (let i = 0; i < points.length - 1; i++) {
      const segD = !hasWaypoints
        ? wirePathFor(conn.fromItem, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y)
        : isPower
          ? straightPath(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y)
          : smoothSegmentPath(points, i);

      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', segD);
      hit.setAttribute('class', 'wire-path-hitbox');
      hit.dataset.wireId = conn.id;
      hit.dataset.segmentIndex = i;
      wireLayerEl.appendChild(hit);

      const vis = document.createElementNS(SVG_NS, 'path');
      vis.setAttribute('d', segD);
      vis.setAttribute('class', 'wire-path'
        + (overCap ? ' wire-path-overcap' : '')
        + (conn.id === plannerState.selectedWireId ? ' selected' : ''));
      vis.dataset.wireId = conn.id;
      wireLayerEl.appendChild(vis);
    }

    waypoints.forEach((wp, i) => {
      const handle = document.createElementNS(SVG_NS, 'rect');
      handle.setAttribute('x', wp.x - WAYPOINT_HANDLE_SIZE / 2);
      handle.setAttribute('y', wp.y - WAYPOINT_HANDLE_SIZE / 2);
      handle.setAttribute('width', WAYPOINT_HANDLE_SIZE);
      handle.setAttribute('height', WAYPOINT_HANDLE_SIZE);
      handle.setAttribute('rx', 1.5);
      handle.setAttribute('class', 'wire-waypoint' + (conn.id === plannerState.selectedWireId ? ' selected' : ''));
      handle.dataset.wireId = conn.id;
      handle.dataset.wpIndex = i;
      wireLayerEl.appendChild(handle);
    });

    // The rate shown is what THIS wire actually carries — its fair share
    // of the consumer's demand when other wires feed the same input too,
    // not the producer's full output and not the consumer's full demand
    // restated on every branch feeding it (see computeFlow). The label
    // sits at the midpoint of the middle hop, which is just the original
    // port-to-port midpoint whenever there are no waypoints at all.
    const rate = wireFlow[conn.id] || 0;
    const midIdx = Math.floor((points.length - 2) / 2);
    const a = points[midIdx], b = points[midIdx + 1];

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', (a.x + b.x) / 2);
    label.setAttribute('y', (a.y + b.y) / 2 - 8);
    label.setAttribute('class', 'wire-label' + (overCap ? ' wire-label-overcap' : ''));
    label.textContent = `${conn.fromItem} · ${fmtItemRate(conn.fromItem, rate)}`;
    wireLayerEl.appendChild(label);
  }
}

// The dashed "wire being dragged" preview shown while dragging from an
// output port (see onPortMouseDown) — a single reused path element,
// created lazily on the first call and just re-pointed on every mousemove
// rather than recreated, following the same routing rule (bezier/
// orthogonal) the real wire would use once dropped.
function updatePendingWire(x1, y1, x2, y2, item) {
  if (!pendingPathEl) {
    pendingPathEl = document.createElementNS(SVG_NS, 'path');
    pendingPathEl.setAttribute('class', 'wire-path-pending');
    wireLayerEl.appendChild(pendingPathEl);
  }
  pendingPathEl.setAttribute('d', wirePathFor(item, x1, y1, x2, y2));
}

// Removes the pending-wire preview once a port drag ends, whether it
// landed on a valid target or not.
function clearPendingWire() {
  if (pendingPathEl) pendingPathEl.remove();
  pendingPathEl = null;
}

// ============================================================
// SELECTION
// ============================================================

// Syncs every node/wire element's .selected class to the current
// plannerState.selectedNodeIds/selectedWireId — called by every selection
// function below instead of a full re-render, since selection changes far
// more often than the board's actual content does.
function updateSelectionClasses() {
  nodesLayerEl.querySelectorAll('.fac-node').forEach(el => {
    el.classList.toggle('selected', plannerState.selectedNodeIds.has(el.dataset.nodeId));
  });
  wireLayerEl.querySelectorAll('.wire-path').forEach(el => {
    el.classList.toggle('selected', el.dataset.wireId === plannerState.selectedWireId);
  });
}

// Node and wire selection are mutually exclusive — selecting either kind
// always clears the other — since the sidebar/delete/copy actions below
// only make sense applied to one or the other, never both at once.
function selectNode(id) {
  plannerState.selectedNodeIds = new Set([id]);
  plannerState.selectedWireId = null;
  updateSelectionClasses();
}

// Shift-clicking a node's header adds/removes just that one node from
// whatever's currently selected, instead of replacing the selection the
// way a plain click does — lets a box-select be fine-tuned by hand.
function toggleNodeSelection(id) {
  const next = new Set(plannerState.selectedNodeIds);
  if (next.has(id)) next.delete(id); else next.add(id);
  plannerState.selectedNodeIds = next;
  plannerState.selectedWireId = null;
  updateSelectionClasses();
}

// Replaces the whole selection at once — used by box-select to select
// everything caught in the drag rectangle in one go, unlike
// toggleNodeSelection's one-at-a-time shift-click behavior.
function setSelectedNodes(ids) {
  plannerState.selectedNodeIds = new Set(ids);
  plannerState.selectedWireId = null;
  updateSelectionClasses();
}

function selectWire(id) {
  plannerState.selectedWireId = id;
  plannerState.selectedNodeIds = new Set();
  updateSelectionClasses();
}

function deselectAll() {
  if (!plannerState.selectedNodeIds.size && !plannerState.selectedWireId) return;
  plannerState.selectedNodeIds = new Set();
  plannerState.selectedWireId = null;
  updateSelectionClasses();
}

// ============================================================
// NODE / CONNECTION MUTATIONS
// ============================================================

// Shows/hides the "SELECT A FACILITY..." placeholder overlay depending on
// whether the board has any nodes at all yet.
function updateEmptyHint() {
  emptyHintEl.classList.toggle('hidden', plannerState.nodes.length > 0);
}

function addNode(facility, x, y) {
  const recipes = RECIPES_BY_FACILITY[facility];
  if (!recipes || !recipes.length) return;
  // Prefer the group's own plain/unmodule'd recipe as the default (placing
  // "Oil Refinery" should start on the base Oil Refinery recipe, not
  // whichever module recipe happens to sort first alphabetically) — falls
  // back to the alphabetically-first when there's no plain configuration.
  const defaultRecipe = recipes.find(r => r.facility === facility) || recipes[0];
  const node = { id: `n${nodeIdCounter++}`, facility, recipeKeys: [defaultRecipe.key], x, y, count: 1 };
  plannerState.nodes.push(node);
  nodesById[node.id] = node;
  renderNodesLayer();
  renderWires();
  updateEmptyHint();
  saveState();
}

// How many of this exact facility+recipe are placed here, side by side —
// scales every displayed rate (NEEDS/YIELDS per-minute, power draw, and any
// wire fed from this node's outputs) without needing separate duplicate
// nodes for "I built two of these." Craft time itself is untouched: it's
// still one recipe cycle, just running on `count` physical copies at once.
function setNodeCount(node, count) {
  node.count = Math.max(1, count);
  const nodeEl = nodesLayerEl.querySelector(`.fac-node[data-node-id="${node.id}"]`);
  if (nodeEl) nodeEl.innerHTML = buildNodeHtml(node);
  indexPorts();
  renderWires();
  saveState();
}

function removeNode(id) { removeNodes([id]); }

// Batched so a multi-select Delete does one state mutation and one
// re-render instead of removeNode's full render cycle per node.
function removeNodes(ids) {
  const idSet = new Set(ids);
  plannerState.nodes = plannerState.nodes.filter(n => !idSet.has(n.id));
  for (const id of idSet) delete nodesById[id];
  if (plannerState.selectedNodeIds.size) {
    plannerState.selectedNodeIds = new Set([...plannerState.selectedNodeIds].filter(id => !idSet.has(id)));
  }
  pruneConnections();
  renderNodesLayer();
  renderWires();
  updateEmptyHint();
  saveState();
}

// Drops any connection that's no longer valid — its node was removed, or
// (more often) a recipe change means one end no longer has a matching
// port. Called after anything that can invalidate a wire without directly
// touching plannerState.connections itself: removing a node, toggling a
// recipe on/off, loading a saved board.
function pruneConnections() {
  plannerState.connections = plannerState.connections.filter(c => {
    const fromNode = nodesById[c.fromNode];
    const toNode = nodesById[c.toNode];
    if (!fromNode || !toNode) return false;
    const fromRecipes = nodeRecipeObjs(fromNode);
    const toRecipes = nodeRecipeObjs(toNode);
    if (!fromRecipes.length || !toRecipes.length) return false;
    // Facility Power lives in recipe.power_mw, not recipe.inputs (see
    // itemRatePerMin) — a plain `in` check would otherwise prune every
    // power wire the next time this runs. A port stays valid as long as
    // ANY of the node's active recipes still uses that item.
    const toValid = c.toItem === 'Facility Power'
      ? toRecipes.some(r => !!r.power_mw)
      : toRecipes.some(r => c.toItem in r.inputs);
    return fromRecipes.some(r => c.fromItem in r.outputs) && toValid;
  });
  if (plannerState.selectedWireId && !plannerState.connections.some(c => c.id === plannerState.selectedWireId)) {
    plannerState.selectedWireId = null;
  }
}

// Wires an output port to an input port — a no-op for a self-loop or an
// exact duplicate of an existing wire (same four fields), so repeatedly
// dragging the same connection never stacks up identical wires.
function addConnection(fromNode, fromItem, toNode, toItem) {
  if (fromNode === toNode) return;
  const exists = plannerState.connections.some(c =>
    c.fromNode === fromNode && c.fromItem === fromItem && c.toNode === toNode && c.toItem === toItem);
  if (exists) return;
  plannerState.connections.push({ id: `w${wireIdCounter++}`, fromNode, fromItem, toNode, toItem, waypoints: [] });
  renderNodesLayer(); // refresh "connected" dot styling on both ends
  renderWires();
  saveState();
}

// Deletes one specific wire by id (e.g. the Delete key on a selected
// wire — see the keydown handler in initPlannerUI).
function removeConnection(id) {
  plannerState.connections = plannerState.connections.filter(c => c.id !== id);
  if (plannerState.selectedWireId === id) plannerState.selectedWireId = null;
  renderNodesLayer();
  renderWires();
  saveState();
}

// ============================================================
// COPY / PASTE
// ============================================================

// Snapshots the current selection into plannerClipboard — only wiring
// BETWEEN two copied nodes comes along (a wire to something outside the
// selection has no matching node on the other end once pasted, so it's
// dropped rather than left dangling). Resets the cascade offset so the
// next paste lands right on top of the copied nodes, same as any other
// clipboard.
function copySelection() {
  if (!plannerState.selectedNodeIds.size) return;
  const ids = plannerState.selectedNodeIds;
  plannerClipboard = {
    nodes: plannerState.nodes.filter(n => ids.has(n.id)).map(n => ({ ...n, recipeKeys: [...n.recipeKeys] })),
    connections: plannerState.connections
      .filter(c => ids.has(c.fromNode) && ids.has(c.toNode))
      .map(c => ({
        fromNode: c.fromNode, fromItem: c.fromItem, toNode: c.toNode, toItem: c.toItem,
        waypoints: (c.waypoints || []).map(wp => ({ ...wp }))
      }))
  };
  pasteOffsetStep = 0;
}

// Pastes as new nodes with new ids, preserving the copied group's relative
// layout and internal wiring — offset a little further from the original
// on each successive paste (classic clipboard cascade) so repeated Ctrl+V
// doesn't stack every copy exactly on top of the last.
function pasteClipboard() {
  if (!plannerClipboard || !plannerClipboard.nodes.length) return;
  pasteOffsetStep += 1;
  const offset = pasteOffsetStep * 40;
  const idMap = {};
  const newNodes = plannerClipboard.nodes.map(n => {
    const id = `n${nodeIdCounter++}`;
    idMap[n.id] = id;
    return { ...n, id, recipeKeys: [...n.recipeKeys], x: n.x + offset, y: n.y + offset };
  });
  for (const n of newNodes) { plannerState.nodes.push(n); nodesById[n.id] = n; }
  for (const c of plannerClipboard.connections) {
    const fromId = idMap[c.fromNode], toId = idMap[c.toNode];
    if (!fromId || !toId) continue;
    const waypoints = (c.waypoints || []).map(wp => ({ x: wp.x + offset, y: wp.y + offset }));
    plannerState.connections.push({ id: `w${wireIdCounter++}`, fromNode: fromId, fromItem: c.fromItem, toNode: toId, toItem: c.toItem, waypoints });
  }
  setSelectedNodes(newNodes.map(n => n.id));
  renderNodesLayer();
  renderWires();
  updateEmptyHint();
  saveState();
}

// ============================================================
// PERSISTENCE
// ============================================================

// Persists the whole board (nodes, wires, pan, zoom) to localStorage —
// called after essentially every mutation in this file, so the board is
// never more than one action away from being saved; a fresh page load
// picks it back up via loadState below.
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      nodes: plannerState.nodes,
      connections: plannerState.connections,
      pan: plannerState.pan,
      scale: plannerState.scale
    }));
  } catch (e) { /* storage unavailable/full — layout just won't persist */ }
}

// Restores a previously-saved board from localStorage, if there is one —
// returns false (leaving plannerState untouched) on no saved data, a
// storage error, or invalid JSON, so callers can tell "nothing to
// restore" apart from "restored successfully." A node whose facility no
// longer exists in the current data (removed/renamed since it was saved)
// is silently dropped rather than left broken.
function loadState() {
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return false; }
  if (!raw) return false;
  let data;
  try { data = JSON.parse(raw); } catch (e) { return false; }

  plannerState.nodes = (data.nodes || [])
    .filter(n => RECIPES_BY_FACILITY[n.facility])
    .map(n => ({
      ...n,
      count: Math.max(1, Math.floor(n.count) || 1), // older saved layouts predate the count field
      // Older saved layouts predate multi-recipe cards and carry a single
      // recipeKey instead — migrate it into a one-item recipeKeys array.
      recipeKeys: n.recipeKeys ? n.recipeKeys : (n.recipeKey ? [n.recipeKey] : [])
    }));
  plannerState.connections = data.connections || [];
  plannerState.pan = data.pan && typeof data.pan.x === 'number' ? data.pan : { x: 60, y: 60 };
  plannerState.scale = typeof data.scale === 'number' ? clamp(data.scale, 0.3, 2.5) : 1;

  nodesById = {};
  for (const n of plannerState.nodes) nodesById[n.id] = n;
  pruneConnections();

  nodeIdCounter = plannerState.nodes.reduce((m, n) => Math.max(m, parseInt(String(n.id).slice(1), 10) || 0), 0) + 1;
  wireIdCounter = plannerState.connections.reduce((m, c) => Math.max(m, parseInt(String(c.id).slice(1), 10) || 0), 0) + 1;
  return true;
}

const PLANNER_IMPORT_KEY = 'foxholePlannerImport.v1';

// Picks up a chain handed off from the main calculator's "SEND TO PLANNER"
// button (see buildPlannerExport in calc.js) — a plain { steps: [{recipeKey,
// depth}], edges: [{from,item,to}] } shape with no positions or facility
// grouping of its own, since the calculator has no idea those concepts
// exist. This is entirely the "how to draw that as a board" half: lay
// steps out in columns by depth (gathered raw materials on the left,
// deeper/more-refined steps to the right — the same direction wires
// naturally flow), then reconnect edges by recipe key.
function tryImportFromCalculator() {
  let raw;
  try { raw = localStorage.getItem(PLANNER_IMPORT_KEY); } catch (e) { return false; }
  if (!raw) return false;
  localStorage.removeItem(PLANNER_IMPORT_KEY); // consume once — a later refresh must not reapply it
  let payload;
  try { payload = JSON.parse(raw); } catch (e) { return false; }
  if (!payload || !Array.isArray(payload.steps) || !payload.steps.length) return false;

  if (plannerState.nodes.length && !confirm('Replace the current board with the chain sent from the calculator?')) {
    return false;
  }

  const byDepth = {};
  for (const step of payload.steps) {
    const recipe = RECIPE_INDEX_BY_KEY[step.recipeKey];
    if (!recipe) continue; // stale export from before a data change — skip rather than guess
    const depth = Number(step.depth) || 0;
    (byDepth[depth] || (byDepth[depth] = [])).push({ recipeKey: step.recipeKey, facility: baseFacilityName(recipe.facility) });
  }
  if (!Object.keys(byDepth).length) return false;

  plannerState.nodes = [];
  plannerState.connections = [];
  nodesById = {};
  const nodeIdByRecipeKey = {};
  // The gap between columns (COL_SPACING minus the node's own 236px width)
  // needs to comfortably fit a wire label ("Refined Materials · 54.5/min"
  // can run ~200px wide) — too tight and the label spills into the next
  // column's node instead of sitting in open space.
  const COL_SPACING = 560, ROW_SPACING = 250;

  Object.keys(byDepth).map(Number).sort((a, b) => a - b).forEach(depth => {
    byDepth[depth].forEach((entry, i) => {
      const id = `n${nodeIdCounter++}`;
      const node = { id, facility: entry.facility, recipeKeys: [entry.recipeKey], x: depth * COL_SPACING, y: i * ROW_SPACING, count: 1 };
      plannerState.nodes.push(node);
      nodesById[id] = node;
      nodeIdByRecipeKey[entry.recipeKey] = id;
    });
  });

  for (const edge of payload.edges || []) {
    const fromId = nodeIdByRecipeKey[edge.from], toId = nodeIdByRecipeKey[edge.to];
    if (!fromId || !toId) continue;
    plannerState.connections.push({ id: `w${wireIdCounter++}`, fromNode: fromId, fromItem: edge.item, toNode: toId, toItem: edge.item, waypoints: [] });
  }

  fitViewToNodes();
  plannerState.selectedNodeIds = new Set();
  plannerState.selectedWireId = null;
  saveState();
  return true;
}

// Frames the whole imported chain in the viewport instead of dropping it at
// whatever pan/scale the board happened to be left at — node HEIGHT isn't
// known yet at this point (nothing's been rendered to the DOM to measure),
// so this uses a generous flat estimate rather than the real per-node
// height; a little slack in the fit is far less noticeable than nodes
// spilling out of view entirely.
function fitViewToNodes() {
  if (!plannerState.nodes.length || !viewportEl) return;
  const NODE_W = 236, NODE_H_ESTIMATE = 220;
  const xs = plannerState.nodes.map(n => n.x), ys = plannerState.nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs) + NODE_W;
  const minY = Math.min(...ys), maxY = Math.max(...ys) + NODE_H_ESTIMATE;
  const rect = viewportEl.getBoundingClientRect();
  const margin = 40;
  const scaleX = (rect.width - margin * 2) / (maxX - minX);
  const scaleY = (rect.height - margin * 2) / (maxY - minY);
  // Never zoom IN past 100% just because a small chain leaves room to —
  // only ever shrinks to fit a chain too big for the viewport.
  plannerState.scale = clamp(Math.min(scaleX, scaleY, 1), 0.3, 2.5);
  plannerState.pan.x = margin - minX * plannerState.scale;
  plannerState.pan.y = margin - minY * plannerState.scale;
}

// ============================================================
// PAN / ZOOM
// ============================================================

const GRID_SPACING = 28;

// Pushes the current pan/scale out to the actual DOM — the CSS transform
// on the world layer, the zoom readout text, and the background dot grid
// (kept in sync here rather than via CSS alone, since its size/position
// needs to track the same pan/scale values). Called after anything that
// changes pan or scale: panning, zooming, resetting the view, fitting to
// an imported chain.
function applyTransform() {
  worldEl.style.transform = `translate(${plannerState.pan.x}px, ${plannerState.pan.y}px) scale(${plannerState.scale})`;
  zoomReadoutEl.textContent = `${Math.round(plannerState.scale * 100)}%`;
  // The viewport's own dot-grid background (see .planner-viewport in
  // planner.css) is driven from the same pan/scale as worldEl's transform,
  // so the dots stay in exact visual sync with the nodes.
  const gridSize = GRID_SPACING * plannerState.scale;
  viewportEl.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  viewportEl.style.backgroundPosition = `${plannerState.pan.x}px ${plannerState.pan.y}px`;
}

// Zooms in/out by a multiplier around a fixed screen point (the mouse
// position for a scroll-wheel zoom, or the viewport's own center for the
// +/-/reset buttons) — the anchor point's WORLD coordinate is held fixed
// before and after, which is what makes zooming under the cursor feel
// like it's "zooming into" that exact spot rather than the board just
// resizing around its own center.
function zoomBy(factor, anchorClientX, anchorClientY) {
  const rect = viewportEl.getBoundingClientRect();
  const cx = anchorClientX != null ? anchorClientX - rect.left : rect.width / 2;
  const cy = anchorClientY != null ? anchorClientY - rect.top : rect.height / 2;
  const worldXBefore = (cx - plannerState.pan.x) / plannerState.scale;
  const worldYBefore = (cy - plannerState.pan.y) / plannerState.scale;
  plannerState.scale = clamp(plannerState.scale * factor, 0.3, 2.5);
  plannerState.pan.x = cx - worldXBefore * plannerState.scale;
  plannerState.pan.y = cy - worldYBefore * plannerState.scale;
  applyTransform();
  saveState();
}

// Dragging the empty board background moves the whole world — plain
// delta-from-mousedown tracking, same drag-lifecycle shape as
// onNodeDragStart/startBoxSelect (mousemove/mouseup listeners on document,
// not the element itself, so the drag keeps tracking even if the cursor
// leaves the viewport mid-drag).
function startPan(e) {
  const startClientX = e.clientX, startClientY = e.clientY;
  const startPan = { x: plannerState.pan.x, y: plannerState.pan.y };
  viewportEl.classList.add('panning');
  function onMove(ev) {
    plannerState.pan.x = startPan.x + (ev.clientX - startClientX);
    plannerState.pan.y = startPan.y + (ev.clientY - startClientY);
    applyTransform();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    viewportEl.classList.remove('panning');
    saveState();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// Shift+drag on empty board draws a marquee and selects every node its
// rectangle overlaps — compared purely in screen/client space (each
// node's own getBoundingClientRect() vs. the marquee's), so it doesn't
// need to know a node's world-space footprint or account for pan/zoom
// itself; both rects already live in the same coordinate system the
// mouse events do.
function startBoxSelect(e) {
  e.preventDefault();
  const startClientX = e.clientX, startClientY = e.clientY;
  const boxEl = document.createElement('div');
  boxEl.className = 'planner-select-box';
  viewportEl.appendChild(boxEl);
  const viewportRect = viewportEl.getBoundingClientRect();

  function updateBox(ev) {
    const x1 = Math.min(startClientX, ev.clientX), x2 = Math.max(startClientX, ev.clientX);
    const y1 = Math.min(startClientY, ev.clientY), y2 = Math.max(startClientY, ev.clientY);
    boxEl.style.left = `${x1 - viewportRect.left}px`;
    boxEl.style.top = `${y1 - viewportRect.top}px`;
    boxEl.style.width = `${x2 - x1}px`;
    boxEl.style.height = `${y2 - y1}px`;
    return { left: x1, right: x2, top: y1, bottom: y2 };
  }

  function onMove(ev) { updateBox(ev); }
  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const sel = updateBox(ev);
    boxEl.remove();
    const ids = [];
    nodesLayerEl.querySelectorAll('.fac-node').forEach(nodeEl => {
      const r = nodeEl.getBoundingClientRect();
      if (r.left < sel.right && r.right > sel.left && r.top < sel.bottom && r.bottom > sel.top) {
        ids.push(nodeEl.dataset.nodeId);
      }
    });
    setSelectedNodes(ids);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ============================================================
// NODE DRAG
// ============================================================

// Selection is decided by the caller BEFORE this runs (see the
// nodesLayerEl mousedown handler) — dragging moves whichever node(s) are
// selected at that point: the whole group when the clicked node is part
// of a multi-selection, or just the one node otherwise.
function onNodeDragStart(e, nodeEl) {
  e.preventDefault();
  e.stopPropagation();
  const draggedIds = plannerState.selectedNodeIds.size > 1 && plannerState.selectedNodeIds.has(nodeEl.dataset.nodeId)
    ? [...plannerState.selectedNodeIds]
    : [nodeEl.dataset.nodeId];
  const starts = draggedIds.map(id => ({ id, x: nodesById[id].x, y: nodesById[id].y }));
  const startClientX = e.clientX, startClientY = e.clientY;
  let moved = false;
  function onMove(ev) {
    const dx = (ev.clientX - startClientX) / plannerState.scale;
    const dy = (ev.clientY - startClientY) / plannerState.scale;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
    for (const s of starts) {
      const node = nodesById[s.id];
      node.x = s.x + dx;
      node.y = s.y + dy;
      const el = nodesLayerEl.querySelector(`.fac-node[data-node-id="${s.id}"]`);
      if (el) { el.style.left = `${node.x}px`; el.style.top = `${node.y}px`; }
    }
    renderWires();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (moved) saveState();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ============================================================
// WIRE RESHAPE (bend points along an existing wire)
// ============================================================

// Dragging an existing bend point just moves it. A plain click (no real
// movement) still falls through to selecting the wire, same as clicking
// anywhere else on it.
function onWaypointDragStart(e, handleEl) {
  e.preventDefault();
  e.stopPropagation();
  const wireId = handleEl.dataset.wireId;
  const wpIndex = Number(handleEl.dataset.wpIndex);
  const conn = plannerState.connections.find(c => c.id === wireId);
  if (!conn) return;
  selectWire(wireId);
  const startClientX = e.clientX, startClientY = e.clientY;
  let moved = false;
  function onMove(ev) {
    if (Math.abs(ev.clientX - startClientX) > 1 || Math.abs(ev.clientY - startClientY) > 1) moved = true;
    const world = screenToWorld(ev.clientX, ev.clientY);
    conn.waypoints[wpIndex] = { x: world.x, y: world.y };
    renderWires();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (moved) saveState();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// Grabbing the wire's body itself (not an existing handle) and dragging —
// "let me move the lines connecting pieces around" — pulls a brand new
// bend point out of whichever hop was grabbed, right where the drag
// crosses a small threshold, so a plain click (no real movement) still
// just selects the wire instead of littering it with an accidental
// zero-length bend. The hop's own data-segment-index IS the correct
// insertion index into conn.waypoints: waypoints[0..n-1] sit between
// points[1..n], so a new point pulled out of hop i belongs at
// waypoints-index i regardless of how many bends already exist.
function onWireHitMouseDown(e, hitEl) {
  e.preventDefault();
  e.stopPropagation();
  const wireId = hitEl.dataset.wireId;
  const segmentIndex = Number(hitEl.dataset.segmentIndex);
  const conn = plannerState.connections.find(c => c.id === wireId);
  if (!conn) return;
  const startClientX = e.clientX, startClientY = e.clientY;
  const startWorld = screenToWorld(startClientX, startClientY);
  let created = false, wpIndex = -1;
  function onMove(ev) {
    if (!created) {
      if (Math.abs(ev.clientX - startClientX) < 4 && Math.abs(ev.clientY - startClientY) < 4) return;
      if (!conn.waypoints) conn.waypoints = [];
      wpIndex = segmentIndex;
      // Insert at the point where the wire was actually grabbed, not
      // wherever the cursor happened to be once the drag crossed the
      // threshold — otherwise the new bend visibly jumps a few pixels the
      // instant it appears instead of starting exactly under the cursor.
      conn.waypoints.splice(wpIndex, 0, { x: startWorld.x, y: startWorld.y });
      created = true;
      selectWire(wireId);
      renderWires();
      return;
    }
    const world = screenToWorld(ev.clientX, ev.clientY);
    conn.waypoints[wpIndex] = { x: world.x, y: world.y };
    renderWires();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (created) saveState();
    else selectWire(wireId); // no real movement — a plain click-to-select
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ============================================================
// WIRE DRAG (port -> port)
// ============================================================

// Dragging from an output port shows a live pending-wire preview
// (updatePendingWire) that snaps to highlight any matching (same item)
// input port the cursor is over, and completes the connection on mouseup
// only if it's released over one. A port that's already the wire's own
// source is excluded (addConnection would reject the self-loop anyway,
// but the hover highlight itself shouldn't invite it).
function onPortMouseDown(e, portEl) {
  if (portEl.dataset.dir !== 'out') return; // wires are always dragged from an output
  e.preventDefault();
  e.stopPropagation();
  const fromNodeId = portEl.closest('.fac-node').dataset.nodeId;
  const item = portEl.dataset.item;
  const start = getPortWorldPos(portEl);
  let hoverTarget = null;

  function onMove(ev) {
    const world = screenToWorld(ev.clientX, ev.clientY);
    updatePendingWire(start.x, start.y, world.x, world.y, item);
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const candidate = el && el.closest && el.closest('.fac-port-in');
    if (hoverTarget && hoverTarget !== candidate) hoverTarget.classList.remove('wire-target-hover');
    if (candidate && candidate.dataset.item === item && candidate.closest('.fac-node').dataset.nodeId !== fromNodeId) {
      candidate.classList.add('wire-target-hover');
      hoverTarget = candidate;
    } else {
      hoverTarget = null;
    }
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (hoverTarget) {
      hoverTarget.classList.remove('wire-target-hover');
      const toNodeId = hoverTarget.closest('.fac-node').dataset.nodeId;
      addConnection(fromNodeId, item, toNodeId, item);
    }
    clearPendingWire();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ============================================================
// RECIPE PICKER (floating popup)
// ============================================================

// Reshapes one of this file's own recipe-index entries into the
// { recipeKey, label, facility, batches, craftSeconds, inputs, outputs }
// preview shape renderRecipeOptionCard (render.js) expects — batches is
// always 1 here since the picker is comparing single-run recipes, not a
// scaled-to-order total the way the calculator's own alternatives picker
// does (see recipeAlternativePreviews in calc.js).
function toPreview(r) {
  return {
    recipeKey: r.key,
    label: r.label,
    facility: r.facility,
    batches: 1,
    craftSeconds: effectiveCraftingTime(r),
    inputs: Object.entries(r.inputs).map(([name, qty]) => ({ name, qty, facility: facilityOfOutput(name) })),
    outputs: Object.entries(r.outputs).map(([name, qty]) => ({ name, qty }))
  };
}

// Fills the picker popup's list with every recipe belonging to the
// current node's facility, filtered by the search box's own text (all
// recipes when empty) — re-run on every keystroke and every recipe
// toggle, so the ACTIVE tag (see renderRecipeOptionCard) always reflects
// the node's current recipeKeys even as the user keeps toggling more on.
function renderPickerList(query) {
  const node = nodesById[pickerContext.nodeId];
  const recipes = RECIPES_BY_FACILITY[node.facility] || [];
  const q = query.toLowerCase().trim();
  const filtered = q ? recipes.filter(r => r.searchText.includes(q)) : recipes;
  if (!filtered.length) {
    pickerListEl.innerHTML = `<div class="picker-empty">NO MATCHING RECIPES</div>`;
    return;
  }
  pickerListEl.innerHTML = filtered.map(r => renderRecipeOptionCard(toPreview(r), node.recipeKeys.includes(r.key), '')).join('');
}

// Places the floating picker panel just to the right of whatever anchor
// element opened it (a node's recipe row), flipping to the left side if
// it wouldn't fit on the right, and clamped on all sides so it never
// renders partially off-screen regardless of where on the board the node
// happens to be.
function positionPickerNear(anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const panelW = 360, margin = 10;
  let left = rect.right + 12;
  if (left + panelW > window.innerWidth - margin) left = rect.left - panelW - 12;
  left = clamp(left, margin, Math.max(margin, window.innerWidth - panelW - margin));
  const panelMaxH = window.innerHeight * 0.7;
  let top = clamp(rect.top, margin, Math.max(margin, window.innerHeight - panelMaxH - margin));
  pickerPanelEl.style.left = `${left}px`;
  pickerPanelEl.style.top = `${top}px`;
}

// Opens the floating recipe picker for a specific node — remembers which
// node it's for (pickerContext) so the search box and the list's click
// handler both know where to route their results.
function openRecipePicker(nodeId) {
  const node = nodesById[nodeId];
  if (!node) return;
  pickerContext = { nodeId };
  pickerTitleEl.textContent = `${node.facility.toUpperCase()} — CLICK TO TOGGLE RECIPES`;
  pickerSearchEl.value = '';
  renderPickerList('');
  positionPickerNear(document.querySelector(`.fac-node[data-node-id="${nodeId}"] .fac-node-recipes`));
  pickerOverlayEl.classList.add('open');
  pickerSearchEl.focus();
}

// Turns one of this node's facility's recipes on or off — a card can run
// any number of its facility's recipes at once (see nodeRecipeObjs), so
// this toggles membership in recipeKeys rather than replacing it the way a
// single-recipe picker would.
function toggleNodeRecipe(node, key) {
  const idx = node.recipeKeys.indexOf(key);
  if (idx >= 0) node.recipeKeys.splice(idx, 1);
  else node.recipeKeys.push(key);
  pruneConnections();
  renderNodesLayer();
  renderWires();
  saveState();
}

function closeRecipePicker() {
  pickerOverlayEl.classList.remove('open');
  pickerContext = null;
}

// ============================================================
// UI WIRING
// ============================================================

// Fills the left sidebar's facility catalog, filtered by the search box
// (or the full FACILITY_CATALOG when empty) — each entry is both
// click-to-place and drag-to-place (see the click/dragstart listeners in
// initPlannerUI).
function renderFacilitySidebar(query = '') {
  const q = query.toLowerCase().trim();
  const filtered = q ? FACILITY_CATALOG.filter(f => f.name.toLowerCase().includes(q)) : FACILITY_CATALOG;
  if (!filtered.length) {
    facilityListEl.innerHTML = `<div class="planner-facility-empty">NO MATCHING FACILITIES</div>`;
    return;
  }
  facilityListEl.innerHTML = filtered.map(f => `
    <div class="planner-facility-item" draggable="true" data-facility="${f.name}">
      ${iconTagWithFallback([f.name, f.representativeFacility], 'planner-facility-icon')}
      <span class="planner-facility-name">${f.name}</span>
      <span class="planner-facility-count">${f.count}</span>
    </div>`).join('');
}

// Grabs every DOM reference this file needs and wires up every listener
// on the board — pan/zoom, node placement/drag/wiring, box-select/copy/
// paste, the recipe picker popup, and keyboard shortcuts. Everything below
// this point is event-driven; called once from bootPlanner, after
// buildFacilityIndex has run.
function initPlannerUI() {
  viewportEl = document.getElementById('plannerViewport');
  worldEl = document.getElementById('plannerWorld');
  wireLayerEl = document.getElementById('wireLayer');
  nodesLayerEl = document.getElementById('nodesLayer');
  emptyHintEl = document.getElementById('plannerEmptyHint');
  zoomReadoutEl = document.getElementById('zoomReadout');
  facilitySearchEl = document.getElementById('facilitySearch');
  facilityListEl = document.getElementById('facilityList');
  pickerOverlayEl = document.getElementById('pickerOverlay');
  pickerPanelEl = document.getElementById('pickerPanel');
  pickerTitleEl = document.getElementById('pickerTitle');
  pickerSearchEl = document.getElementById('pickerSearch');
  pickerListEl = document.getElementById('pickerList');
  pickerCloseEl = document.getElementById('pickerClose');

  // ---- Sidebar: search + click/drag to place ----
  facilitySearchEl.addEventListener('input', () => renderFacilitySidebar(facilitySearchEl.value));

  facilityListEl.addEventListener('click', e => {
    const item = e.target.closest('.planner-facility-item');
    if (!item) return;
    const center = viewportCenterWorld();
    addNode(item.dataset.facility, center.x - 130 + (Math.random() * 40 - 20), center.y - 90 + (Math.random() * 40 - 20));
  });
  facilityListEl.addEventListener('dragstart', e => {
    const item = e.target.closest('.planner-facility-item');
    if (!item) return;
    e.dataTransfer.setData('text/plain', item.dataset.facility);
    e.dataTransfer.effectAllowed = 'copy';
  });
  viewportEl.addEventListener('dragover', e => e.preventDefault());
  viewportEl.addEventListener('drop', e => {
    e.preventDefault();
    const facility = e.dataTransfer.getData('text/plain');
    if (!facility || !RECIPES_BY_FACILITY[facility]) return;
    const pos = screenToWorld(e.clientX, e.clientY);
    addNode(facility, pos.x - 130, pos.y - 20);
  });

  // ---- Board: pan / zoom ----
  viewportEl.addEventListener('mousedown', e => {
    if (e.target.closest('.fac-node') || e.target.closest('[data-wire-id]')) return;
    if (e.shiftKey) { startBoxSelect(e); return; }
    deselectAll();
    startPan(e);
  });
  viewportEl.addEventListener('wheel', e => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
  }, { passive: false });

  document.getElementById('zoomInBtn').addEventListener('click', () => zoomBy(1.2));
  document.getElementById('zoomOutBtn').addEventListener('click', () => zoomBy(1 / 1.2));
  document.getElementById('zoomResetBtn').addEventListener('click', () => {
    plannerState.scale = 1;
    plannerState.pan = { x: 60, y: 60 };
    applyTransform();
    saveState();
  });
  document.getElementById('clearBoardBtn').addEventListener('click', () => {
    if (!plannerState.nodes.length && !plannerState.connections.length) return;
    if (!confirm('Clear every facility and connection from the board? This cannot be undone.')) return;
    plannerState.nodes = [];
    plannerState.connections = [];
    nodesById = {};
    plannerState.selectedNodeIds = new Set();
    plannerState.selectedWireId = null;
    renderNodesLayer();
    renderWires();
    updateEmptyHint();
    saveState();
  });

  // ---- Nodes: drag / remove / open recipe picker ----
  nodesLayerEl.addEventListener('mousedown', e => {
    const port = e.target.closest('.fac-port');
    if (port) { onPortMouseDown(e, port); return; }
    // The qty stepper and remove button now live inside the drag handle
    // itself (see buildNodeHtml) — onNodeDragStart's preventDefault() would
    // otherwise block the qty input from ever receiving focus on click.
    if (e.target.closest('.fac-node-qty-inline, .fac-node-remove')) return;
    const head = e.target.closest('.fac-node-head');
    if (!head) return;
    const nodeEl = head.closest('.fac-node');
    const nodeId = nodeEl.dataset.nodeId;
    // Shift+click adds/removes just this one node from the selection and
    // stops there — it doesn't also start a drag, so a box-selected group
    // can be fine-tuned by hand without immediately dragging it.
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      toggleNodeSelection(nodeId);
      return;
    }
    // A plain click on a node that's already part of a multi-selection
    // drags the whole group; clicking anything else collapses the
    // selection down to just that node first, same as before multi-select
    // existed.
    if (!(plannerState.selectedNodeIds.size > 1 && plannerState.selectedNodeIds.has(nodeId))) {
      selectNode(nodeId);
    }
    onNodeDragStart(e, nodeEl);
  });
  nodesLayerEl.addEventListener('click', e => {
    const removeBtn = e.target.closest('[data-action="remove"]');
    if (removeBtn) { removeNode(removeBtn.closest('.fac-node').dataset.nodeId); return; }
    const chipRemoveBtn = e.target.closest('[data-action="remove-recipe"]');
    if (chipRemoveBtn) {
      const node = nodesById[chipRemoveBtn.closest('.fac-node').dataset.nodeId];
      if (!node) return;
      toggleNodeRecipe(node, chipRemoveBtn.dataset.recipeKey);
      return;
    }
    const addRecipeBtn = e.target.closest('[data-action="add-recipe"]');
    if (addRecipeBtn) { openRecipePicker(addRecipeBtn.closest('.fac-node').dataset.nodeId); return; }
    const recipeChip = e.target.closest('.fac-node-recipe-chip');
    if (recipeChip) { openRecipePicker(recipeChip.closest('.fac-node').dataset.nodeId); return; }
    const qtyBtn = e.target.closest('[data-action="qty-inc"], [data-action="qty-dec"]');
    if (qtyBtn) {
      const node = nodesById[qtyBtn.closest('.fac-node').dataset.nodeId];
      if (!node) return;
      setNodeCount(node, node.count + (qtyBtn.dataset.action === 'qty-inc' ? 1 : -1));
      return;
    }
  });
  // Typing a count value directly commits on blur/Enter (a 'change'
  // event), same pattern as the main calculator's ticket qty field — a
  // re-render mid-keystroke would fight the user for control of the input.
  nodesLayerEl.addEventListener('change', e => {
    const input = e.target.closest('.fac-qty-val');
    if (!input) return;
    const node = nodesById[input.closest('.fac-node').dataset.nodeId];
    if (!node) return;
    setNodeCount(node, Math.floor(Number(input.value) || 1));
  });
  nodesLayerEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest('.fac-qty-val')) e.target.blur();
  });

  // ---- Wires: select, drag to bend, drag a bend point, double-click a
  // bend point to remove it ----
  wireLayerEl.addEventListener('mousedown', e => {
    const handle = e.target.closest('.wire-waypoint');
    if (handle) { onWaypointDragStart(e, handle); return; }
    const hit = e.target.closest('.wire-path-hitbox');
    if (hit) { onWireHitMouseDown(e, hit); return; }
  });
  wireLayerEl.addEventListener('dblclick', e => {
    const handle = e.target.closest('.wire-waypoint');
    if (!handle) return;
    const conn = plannerState.connections.find(c => c.id === handle.dataset.wireId);
    if (!conn) return;
    conn.waypoints.splice(Number(handle.dataset.wpIndex), 1);
    renderWires();
    saveState();
  });

  // ---- Recipe picker popup ----
  pickerSearchEl.addEventListener('input', () => renderPickerList(pickerSearchEl.value));
  pickerCloseEl.addEventListener('click', closeRecipePicker);
  pickerOverlayEl.addEventListener('click', e => { if (e.target === pickerOverlayEl) closeRecipePicker(); });
  pickerListEl.addEventListener('click', e => {
    const card = e.target.closest('.recipe-option-card');
    if (!card || !pickerContext) return;
    const node = nodesById[pickerContext.nodeId];
    toggleNodeRecipe(node, card.dataset.recipeKey);
    renderPickerList(pickerSearchEl.value); // stays open — refresh ACTIVE state so more can be toggled
  });

  // ---- Keyboard: delete selected node(s)/wire, copy/paste, escape closes the picker ----
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pickerContext) { closeRecipePicker(); return; }
    const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (typing || pickerContext) return;
    const cmdKey = e.ctrlKey || e.metaKey;
    if (cmdKey && e.key.toLowerCase() === 'c') { copySelection(); return; }
    if (cmdKey && e.key.toLowerCase() === 'v') { pasteClipboard(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (plannerState.selectedWireId) { removeConnection(plannerState.selectedWireId); }
      else if (plannerState.selectedNodeIds.size) { removeNodes([...plannerState.selectedNodeIds]); }
    }
  });
}

// ============================================================
// BOOT
// ============================================================

// Entry point — loads the shared data (retrying a couple of times on a
// transient network hiccup, same reasoning as bootWithRetry in app.js),
// builds the facility index, wires up the UI, then restores a saved board
// or a chain handed off from the calculator (at most one of the two — see
// tryImportFromCalculator's own confirm() prompt when both would apply).
async function bootPlanner(retriesLeft = 2) {
  try {
    await loadData();
  } catch (err) {
    if (retriesLeft > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return bootPlanner(retriesLeft - 1);
    }
    console.error('Failed to load data:', err);
    document.getElementById('facilityList').innerHTML =
      `<div class="planner-facility-empty">FAILED TO LOAD DATA<br>${err.message}<br><br>if you opened this file directly (file://), your browser is blocking local JSON fetches — run a local server instead.</div>`;
    return;
  }

  buildFacilityIndex();
  initPlannerUI();
  const restored = loadState();
  const imported = tryImportFromCalculator();
  applyTransform();
  renderFacilitySidebar();
  renderNodesLayer();
  renderWires();
  updateEmptyHint();
  if (!restored && !imported) saveState();
}

bootPlanner();

// Dev-only smoke-test hook — inert for every real visitor since nothing
// ever links to this page with ?autotest=1. See test.ps1/test/smoke-planner.js.
if (new URLSearchParams(location.search).has('autotest')) {
  const s = document.createElement('script');
  s.src = 'test/smoke-planner.js';
  document.head.appendChild(s);
}
