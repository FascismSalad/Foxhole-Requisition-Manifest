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
  nodes: [],        // { id, facility, recipeKey, x, y } — x/y are world-space px
  connections: [],   // { id, fromNode, fromItem, toNode, toItem }
  pan: { x: 60, y: 60 },
  scale: 1,
  selectedNodeId: null,
  selectedWireId: null
};
let nodesById = {};
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

function screenToWorld(clientX, clientY) {
  const rect = viewportEl.getBoundingClientRect();
  return {
    x: (clientX - rect.left - plannerState.pan.x) / plannerState.scale,
    y: (clientY - rect.top - plannerState.pan.y) / plannerState.scale
  };
}

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
  const dx = Math.max(Math.abs(x2 - x1) * 0.5, 60);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function fmtRate(n) {
  if (!isFinite(n)) return '0/min';
  return `${n.toFixed(1)}/min`;
}

function portColorClass(name) {
  const kind = poolKindOf(name);
  if (kind === 'liquid') return 'fac-port-liquid';
  if (kind === 'resource') return 'fac-port-resource';
  if (kind === 'power') return 'fac-port-power';
  return '';
}

function nodeRecipeObj(node) {
  return node && node.recipeKey ? RECIPE_INDEX_BY_KEY[node.recipeKey] || null : null;
}

function isPortConnected(nodeId, item, dir) {
  return dir === 'out'
    ? plannerState.connections.some(c => c.fromNode === nodeId && c.fromItem === item)
    : plannerState.connections.some(c => c.toNode === nodeId && c.toItem === item);
}

function round2(n) { return Math.round(n * 100) / 100; }

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
  const recipe = nodeRecipeObj(node);
  if (!recipe) return 0;
  const queues = node.queues || 1;
  if (item === 'Facility Power') {
    return dir === 'in' ? (recipe.power_mw || 0) * node.count * queues : (recipe.outputs[item] || 0) * node.count * queues;
  }
  const qty = dir === 'in' ? (recipe.inputs[item] || 0) : (recipe.outputs[item] || 0);
  return qty / Math.max(effectiveCraftingTime(recipe, queues), 0.001) * 60 * node.count;
}

function fmtItemRate(item, rate) {
  return item === 'Facility Power' ? `${round2(rate)} MW` : fmtRate(rate);
}

// ============================================================
// RENDERING — nodes
// ============================================================

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

function buildNodeHtml(node) {
  const recipe = nodeRecipeObj(node);
  const inputRows = recipe
    ? Object.keys(recipe.inputs).map(n => ioRowHtml(node, n, fmtItemRate(n, itemRatePerMin(node, n, 'in')), 'in'))
    : [];
  // Power is a normal NEEDS-side port here too — a second, yellow-coded
  // input alongside the recipe's real ingredients (see itemRatePerMin) —
  // rather than a bare text readout with nothing to actually wire a power
  // plant's output into.
  if (recipe && recipe.power_mw) {
    inputRows.push(ioRowHtml(node, 'Facility Power', fmtItemRate('Facility Power', itemRatePerMin(node, 'Facility Power', 'in')), 'in'));
  }
  const inputsHtml = inputRows.length ? inputRows.join('') : `<div class="fac-node-io-empty">—</div>`;

  const outputsHtml = recipe && Object.keys(recipe.outputs).length
    ? Object.keys(recipe.outputs).map(n => ioRowHtml(node, n, fmtItemRate(n, itemRatePerMin(node, n, 'out')), 'out')).join('')
    : `<div class="fac-node-io-empty">—</div>`;

  // The header always names the base building (what you searched for and
  // placed) — the icon and tooltip switch to the ACTIVE recipe's own exact
  // module facility when one's selected ("Oil Refinery [Cracking Unit]"),
  // since that's the more specific/accurate picture of what's actually
  // sitting on the board right now; falls back to the base building's own
  // icon before a recipe's chosen.
  const iconFacility = recipe ? recipe.facility : node.facility;
  // The facility count lives inline in the header now (no separate labeled
  // row, no craft-time row below it — see the card-condensing pass this
  // came from) — same qty-inc/qty-dec/.fac-qty-val hooks the event
  // delegation in initPlannerUI already listens for, just laid out smaller.
  // Queues (separate from facility count — parallel lines WITHIN one
  // building, not how many buildings) share the button row with the recipe
  // picker instead of costing their own row, same reasoning; omitted
  // entirely for a power facility, capped at a single queue.
  const maxQueues = maxQueuesForFacility(node.facility);
  const queueStepperHtml = maxQueues > 1 ? `
    <div class="fac-node-queue-inline" title="Production queues (parallel)">
      <button class="fac-qty-mini-btn" data-action="queue-dec" title="One fewer queue">−</button>
      <input type="number" class="qty-val fac-qty-val fac-qty-mini-val" value="${node.queues}" min="1" max="${maxQueues}" step="1" inputmode="numeric">
      <button class="fac-qty-mini-btn" data-action="queue-inc" title="One more queue">+</button>
    </div>` : '';
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
    <div class="fac-node-recipe-row">
      <button class="fac-node-recipe-btn" data-action="pick-recipe">
        <span class="rbtn-label">${recipe ? recipe.label : 'SELECT RECIPE'}</span>
        <span class="rbtn-chevron" aria-hidden="true"></span>
      </button>
      ${queueStepperHtml}
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

function renderNodesLayer() {
  nodesLayerEl.innerHTML = '';
  for (const node of plannerState.nodes) {
    const el = document.createElement('div');
    el.className = 'fac-node' + (node.id === plannerState.selectedNodeId ? ' selected' : '');
    el.dataset.nodeId = node.id;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.innerHTML = buildNodeHtml(node);
    nodesLayerEl.appendChild(el);
  }
  indexPorts();
}

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

// Per output port (nodeId+item), how much it actually produces vs. how much
// every wire leaving it is asking for combined — an output wired to several
// consumers isn't multiplied by each branch (that was the original bug: a
// single 60/min refinery showing 60/min on all three of its outgoing
// wires, implying 180/min total); each wire instead reports its own
// consumer's real draw, and this tracks whether those draws, summed,
// overrun what the port can actually supply — surfaced as a warning color
// on the port and its wires rather than silently letting the numbers not
// add up.
function computeSupplyDemand() {
  const balance = {};
  for (const node of plannerState.nodes) {
    const recipe = nodeRecipeObj(node);
    if (!recipe) continue;
    for (const item of Object.keys(recipe.outputs)) {
      balance[`${node.id}|out|${item}`] = { supplied: itemRatePerMin(node, item, 'out'), demanded: 0 };
    }
  }
  for (const conn of plannerState.connections) {
    const entry = balance[`${conn.fromNode}|out|${conn.fromItem}`];
    const toNode = nodesById[conn.toNode];
    if (!entry || !toNode) continue;
    entry.demanded += itemRatePerMin(toNode, conn.toItem, 'in');
  }
  return balance;
}

function renderWires() {
  wireLayerEl.innerHTML = '';
  pendingPathEl = null;
  const balance = computeSupplyDemand();
  nodesLayerEl.querySelectorAll('.fac-port.overcap').forEach(el => el.classList.remove('overcap'));

  for (const conn of plannerState.connections) {
    const fromEl = portElIndex[`${conn.fromNode}|out|${conn.fromItem}`];
    const toEl = portElIndex[`${conn.toNode}|in|${conn.toItem}`];
    if (!fromEl || !toEl) continue;
    const p1 = getPortWorldPos(fromEl);
    const p2 = getPortWorldPos(toEl);
    const d = bezierPath(p1.x, p1.y, p2.x, p2.y);

    const bal = balance[`${conn.fromNode}|out|${conn.fromItem}`];
    const overCap = !!bal && bal.demanded > bal.supplied + 1e-6;
    if (overCap) fromEl.classList.add('overcap');

    const hit = document.createElementNS(SVG_NS, 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('class', 'wire-path-hitbox');
    hit.dataset.wireId = conn.id;
    wireLayerEl.appendChild(hit);

    const vis = document.createElementNS(SVG_NS, 'path');
    vis.setAttribute('d', d);
    vis.setAttribute('class', 'wire-path'
      + (overCap ? ' wire-path-overcap' : '')
      + (conn.id === plannerState.selectedWireId ? ' selected' : ''));
    vis.dataset.wireId = conn.id;
    wireLayerEl.appendChild(vis);

    // The rate shown is what the CONSUMER at this wire's far end actually
    // draws, not the producer's full output — see computeSupplyDemand above.
    const toNode = nodesById[conn.toNode];
    const rate = toNode ? itemRatePerMin(toNode, conn.toItem, 'in') : 0;

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', (p1.x + p2.x) / 2);
    label.setAttribute('y', (p1.y + p2.y) / 2 - 8);
    label.setAttribute('class', 'wire-label' + (overCap ? ' wire-label-overcap' : ''));
    label.textContent = `${conn.fromItem} · ${fmtItemRate(conn.fromItem, rate)}`;
    wireLayerEl.appendChild(label);
  }
}

function updatePendingWire(x1, y1, x2, y2) {
  if (!pendingPathEl) {
    pendingPathEl = document.createElementNS(SVG_NS, 'path');
    pendingPathEl.setAttribute('class', 'wire-path-pending');
    wireLayerEl.appendChild(pendingPathEl);
  }
  pendingPathEl.setAttribute('d', bezierPath(x1, y1, x2, y2));
}

function clearPendingWire() {
  if (pendingPathEl) pendingPathEl.remove();
  pendingPathEl = null;
}

// ============================================================
// SELECTION
// ============================================================

function updateSelectionClasses() {
  nodesLayerEl.querySelectorAll('.fac-node').forEach(el => {
    el.classList.toggle('selected', el.dataset.nodeId === plannerState.selectedNodeId);
  });
  wireLayerEl.querySelectorAll('.wire-path').forEach(el => {
    el.classList.toggle('selected', el.dataset.wireId === plannerState.selectedWireId);
  });
}

function selectNode(id) {
  plannerState.selectedNodeId = id;
  plannerState.selectedWireId = null;
  updateSelectionClasses();
}
function selectWire(id) {
  plannerState.selectedWireId = id;
  plannerState.selectedNodeId = null;
  updateSelectionClasses();
}
function deselectAll() {
  if (!plannerState.selectedNodeId && !plannerState.selectedWireId) return;
  plannerState.selectedNodeId = null;
  plannerState.selectedWireId = null;
  updateSelectionClasses();
}

// ============================================================
// NODE / CONNECTION MUTATIONS
// ============================================================

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
  const node = { id: `n${nodeIdCounter++}`, facility, recipeKey: defaultRecipe.key, x, y, count: 1, queues: 1 };
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

// How many of this node's facility's parallel production queues are
// devoted to it — 1-5, clamped to 1 for a power facility (see
// maxQueuesForFacility in calc.js). Unlike count (separate physical
// buildings), this scales rate by shortening the effective craft time
// (see itemRatePerMin) — the same lever the manifest's own per-step queue
// stepper pulls, just expressed per-node here instead of per-recipe-row.
function setNodeQueues(node, queues) {
  node.queues = clampQueueCount(queues, node.facility);
  const nodeEl = nodesLayerEl.querySelector(`.fac-node[data-node-id="${node.id}"]`);
  if (nodeEl) nodeEl.innerHTML = buildNodeHtml(node);
  indexPorts();
  renderWires();
  saveState();
}

function removeNode(id) {
  plannerState.nodes = plannerState.nodes.filter(n => n.id !== id);
  delete nodesById[id];
  if (plannerState.selectedNodeId === id) plannerState.selectedNodeId = null;
  pruneConnections();
  renderNodesLayer();
  renderWires();
  updateEmptyHint();
  saveState();
}

function pruneConnections() {
  plannerState.connections = plannerState.connections.filter(c => {
    const fromNode = nodesById[c.fromNode];
    const toNode = nodesById[c.toNode];
    if (!fromNode || !toNode) return false;
    const fromRecipe = nodeRecipeObj(fromNode);
    const toRecipe = nodeRecipeObj(toNode);
    if (!fromRecipe || !toRecipe) return false;
    // Facility Power lives in recipe.power_mw, not recipe.inputs (see
    // itemRatePerMin) — a plain `in` check would otherwise prune every
    // power wire the next time this runs.
    const toValid = c.toItem === 'Facility Power' ? !!toRecipe.power_mw : c.toItem in toRecipe.inputs;
    return (c.fromItem in fromRecipe.outputs) && toValid;
  });
  if (plannerState.selectedWireId && !plannerState.connections.some(c => c.id === plannerState.selectedWireId)) {
    plannerState.selectedWireId = null;
  }
}

function addConnection(fromNode, fromItem, toNode, toItem) {
  if (fromNode === toNode) return;
  const exists = plannerState.connections.some(c =>
    c.fromNode === fromNode && c.fromItem === fromItem && c.toNode === toNode && c.toItem === toItem);
  if (exists) return;
  plannerState.connections.push({ id: `w${wireIdCounter++}`, fromNode, fromItem, toNode, toItem });
  renderNodesLayer(); // refresh "connected" dot styling on both ends
  renderWires();
  saveState();
}

function removeConnection(id) {
  plannerState.connections = plannerState.connections.filter(c => c.id !== id);
  if (plannerState.selectedWireId === id) plannerState.selectedWireId = null;
  renderNodesLayer();
  renderWires();
  saveState();
}

// ============================================================
// PERSISTENCE
// ============================================================

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
      queues: clampQueueCount(n.queues || 1, n.facility) // ...and predate queues entirely
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
      const node = { id, facility: entry.facility, recipeKey: entry.recipeKey, x: depth * COL_SPACING, y: i * ROW_SPACING, count: 1, queues: 1 };
      plannerState.nodes.push(node);
      nodesById[id] = node;
      nodeIdByRecipeKey[entry.recipeKey] = id;
    });
  });

  for (const edge of payload.edges || []) {
    const fromId = nodeIdByRecipeKey[edge.from], toId = nodeIdByRecipeKey[edge.to];
    if (!fromId || !toId) continue;
    plannerState.connections.push({ id: `w${wireIdCounter++}`, fromNode: fromId, fromItem: edge.item, toNode: toId, toItem: edge.item });
  }

  fitViewToNodes();
  plannerState.selectedNodeId = null;
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

// ============================================================
// NODE DRAG
// ============================================================

function onNodeDragStart(e, nodeEl) {
  e.preventDefault();
  e.stopPropagation();
  const nodeId = nodeEl.dataset.nodeId;
  const node = nodesById[nodeId];
  selectNode(nodeId);
  const startClientX = e.clientX, startClientY = e.clientY;
  const startX = node.x, startY = node.y;
  let moved = false;
  function onMove(ev) {
    const dx = (ev.clientX - startClientX) / plannerState.scale;
    const dy = (ev.clientY - startClientY) / plannerState.scale;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
    node.x = startX + dx;
    node.y = startY + dy;
    nodeEl.style.left = `${node.x}px`;
    nodeEl.style.top = `${node.y}px`;
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
// WIRE DRAG (port -> port)
// ============================================================

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
    updatePendingWire(start.x, start.y, world.x, world.y);
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

function renderPickerList(query) {
  const node = nodesById[pickerContext.nodeId];
  const recipes = RECIPES_BY_FACILITY[node.facility] || [];
  const q = query.toLowerCase().trim();
  const filtered = q ? recipes.filter(r => r.searchText.includes(q)) : recipes;
  if (!filtered.length) {
    pickerListEl.innerHTML = `<div class="picker-empty">NO MATCHING RECIPES</div>`;
    return;
  }
  pickerListEl.innerHTML = filtered.map(r => renderRecipeOptionCard(toPreview(r), r.key === node.recipeKey, '')).join('');
}

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

function openRecipePicker(nodeId) {
  const node = nodesById[nodeId];
  if (!node) return;
  pickerContext = { nodeId };
  pickerTitleEl.textContent = `${node.facility.toUpperCase()} — CHOOSE RECIPE`;
  pickerSearchEl.value = '';
  renderPickerList('');
  positionPickerNear(document.querySelector(`.fac-node[data-node-id="${nodeId}"] .fac-node-recipe-btn`));
  pickerOverlayEl.classList.add('open');
  pickerSearchEl.focus();
}

function closeRecipePicker() {
  pickerOverlayEl.classList.remove('open');
  pickerContext = null;
}

// ============================================================
// UI WIRING
// ============================================================

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
    plannerState.selectedNodeId = null;
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
    if (head) { onNodeDragStart(e, head.closest('.fac-node')); return; }
  });
  nodesLayerEl.addEventListener('click', e => {
    const removeBtn = e.target.closest('[data-action="remove"]');
    if (removeBtn) { removeNode(removeBtn.closest('.fac-node').dataset.nodeId); return; }
    const recipeBtn = e.target.closest('[data-action="pick-recipe"]');
    if (recipeBtn) { openRecipePicker(recipeBtn.closest('.fac-node').dataset.nodeId); return; }
    const qtyBtn = e.target.closest('[data-action="qty-inc"], [data-action="qty-dec"]');
    if (qtyBtn) {
      const node = nodesById[qtyBtn.closest('.fac-node').dataset.nodeId];
      if (!node) return;
      setNodeCount(node, node.count + (qtyBtn.dataset.action === 'qty-inc' ? 1 : -1));
      return;
    }
    const queueBtn = e.target.closest('[data-action="queue-inc"], [data-action="queue-dec"]');
    if (queueBtn) {
      const node = nodesById[queueBtn.closest('.fac-node').dataset.nodeId];
      if (!node) return;
      setNodeQueues(node, node.queues + (queueBtn.dataset.action === 'queue-inc' ? 1 : -1));
      return;
    }
  });
  // Typing a count/queue value directly commits on blur/Enter (a 'change'
  // event), same pattern as the main calculator's ticket qty field — a
  // re-render mid-keystroke would fight the user for control of the input.
  // Both fields share the same .fac-qty-val class (identical look), so
  // which setter applies is decided by which wrapper the input is actually
  // in, not the class.
  nodesLayerEl.addEventListener('change', e => {
    const input = e.target.closest('.fac-qty-val');
    if (!input) return;
    const node = nodesById[input.closest('.fac-node').dataset.nodeId];
    if (!node) return;
    if (input.closest('.fac-node-queue-inline')) {
      setNodeQueues(node, Math.floor(Number(input.value) || 1));
      return;
    }
    setNodeCount(node, Math.floor(Number(input.value) || 1));
  });
  nodesLayerEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest('.fac-qty-val')) e.target.blur();
  });

  // ---- Wires: select ----
  wireLayerEl.addEventListener('click', e => {
    const hit = e.target.closest('[data-wire-id]');
    if (!hit) return;
    selectWire(hit.dataset.wireId);
  });

  // ---- Recipe picker popup ----
  pickerSearchEl.addEventListener('input', () => renderPickerList(pickerSearchEl.value));
  pickerCloseEl.addEventListener('click', closeRecipePicker);
  pickerOverlayEl.addEventListener('click', e => { if (e.target === pickerOverlayEl) closeRecipePicker(); });
  pickerListEl.addEventListener('click', e => {
    const card = e.target.closest('.recipe-option-card');
    if (!card || !pickerContext) return;
    const node = nodesById[pickerContext.nodeId];
    node.recipeKey = card.dataset.recipeKey;
    closeRecipePicker();
    pruneConnections();
    renderNodesLayer();
    renderWires();
    saveState();
  });

  // ---- Keyboard: delete selected node/wire, escape closes the picker ----
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pickerContext) { closeRecipePicker(); return; }
    const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (typing || pickerContext) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (plannerState.selectedWireId) { removeConnection(plannerState.selectedWireId); }
      else if (plannerState.selectedNodeId) { removeNode(plannerState.selectedNodeId); }
    }
  });
}

// ============================================================
// BOOT
// ============================================================

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
