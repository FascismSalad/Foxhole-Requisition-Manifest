// ============================================================
// FACTORY/MPF CALCULATOR
// A flat "shopping list" calculator, replicating foxholelogi.com:
// pick weapons/vehicles/equipment across category tabs, click to
// add them to a running order (in whole crates), and read off the
// total raw-material cost. Deliberately NOT wired into calc.js's
// recursive production-chain engine — every item's cost is read
// directly off its own existing recipe in MATERIAL_RECIPES, one
// level deep, the same way the source site works. Colonial-only,
// matching the rest of this site (see loader.js's Warden skip).
// ============================================================

// Which of foxholelogi's 8 category tabs each item belongs to. Built once
// from foxholelogi's own itemCategory field (see the project's dev notes) —
// this repo's own subcategory fields don't line up with their tab grouping
// (e.g. their "small_arms" tab includes grenades, which live in this repo's
// own "Grenades" subcategory), so this mapping lives here rather than as a
// new field sprinkled across 10+ existing, already-working data files.
// Keyed by the item's exact full_name/output name (the same identity
// RECIPE_BY_OUTPUT/CRATE_SIZE_BY_NAME already use throughout this codebase).
const LOADOUT_TAB_BY_NAME = {
  ".44 Mag": "small_arms",
  "03MM Caster": "vehicles",
  "12.7mm": "small_arms",
  "120-68 Koronides Field Gun": "vehicles",
  "120mm": "heavy_ammunition",
  "14.5mm": "heavy_arms",
  "150mm": "heavy_ammunition",
  "20mm": "heavy_ammunition",
  "250mm \"Fury\" Shell": "heavy_ammunition",
  "250mm \"Purity\" Shell": "heavy_ammunition",
  "30-250 Tisiphone Field Cannon": "vehicles",
  "30mm": "heavy_arms",
  "40mm": "heavy_ammunition",
  "50-500 \"Thunderbolt\" Cannon": "shipables",
  "68mm": "heavy_ammunition",
  "7.62mm": "small_arms",
  "7.92mm": "small_arms",
  "85K-b Falchion": "vehicles",
  "86K-a Bardiche": "vehicles",
  "8mm": "small_arms",
  "90T-v Nemesis": "vehicles",
  "950-70b Anti-Aircraft Shell": "heavy_ammunition",
  "9mm": "small_arms",
  "AA-2 Battering Ram": "vehicles",
  "AB-8 Acheron": "vehicles",
  "Absol Anti-Aircraft Rounds": "heavy_ammunition",
  "Anti-Tank Sticky Bomb": "heavy_arms",
  "AP/RPG": "heavy_arms",
  "ARC/RPG": "heavy_arms",
  "Argenti r.II Rifle": "small_arms",
  "Bane 45": "heavy_arms",
  "Bellweather by VAC": "vehicles",
  "BMS - Aquatipper": "vehicles",
  "BMS - Class 2 Mobile Auto-Crane": "vehicles",
  "BMS - Ironship": "vehicles",
  "BMS - Packmule Flatbed": "vehicles",
  "BMS - Universal Assembly Rig": "vehicles",
  "Bomastone Grenade": "small_arms",
  "Buckshot": "small_arms",
  "Catara mo.II": "small_arms",
  "Catena rt.IV Auto-Rifle": "small_arms",
  "Cometa T2-9": "small_arms",
  "Concrete Mixer": "shipables",
  "Construction Equipment": "shipables",
  "Cremari Mortar": "heavy_arms",
  "DAE 1b-2 \"Serra\"": "shipables",
  "DAE 1o-3 \"Polybolos\"": "shipables",
  "DAE 5b \"Zeal\"": "shipables",
  "Das Krokodil by VAC": "vehicles",
  "Daucus isg.III": "heavy_arms",
  "Dusk ce.III": "small_arms",
  "E681-B Hullbreaker Mine": "heavy_ammunition",
  "Fabri Rucksack": "uniforms",
  "Flare Mortar Shell": "heavy_arms",
  "Fuscina pi.I": "small_arms",
  "G40 Sagittarii": "vehicles",
  "Green Ash Grenade": "small_arms",
  "Grenadier's Baldric": "uniforms",
  "H-5 Hatchet": "vehicles",
  "HA-1 Sagaris": "vehicles",
  "HC-2 Scorpion": "vehicles",
  "Heavy Topcoat": "uniforms",
  "HH-a Javelin": "vehicles",
  "Ignifist 30": "heavy_arms",
  "K-81e Sombre": "vehicles",
  "KLG901-2 Lunaire F": "heavy_arms",
  "KRF1-750 Dragonfly": "small_arms",
  "KRN886-127 Gast Machine Gun": "small_arms",
  "KRR2-790 Omen": "small_arms",
  "Lamentum mm.IV": "heavy_arms",
  "Legionary's Oilcoat": "uniforms",
  "Lionclaw mc.VIII": "small_arms",
  "Liquid Container": "shipables",
  "Maintenance Supplies": "supplies",
  "Mammon 91-b": "heavy_arms",
  "Material Pallet": "shipables",
  "Medic Fatigues": "uniforms",
  "Molten Wind v.II Flame Torch": "heavy_arms",
  "Mortar Shell": "heavy_arms",
  "Mounted Fissura gd.I": "heavy_arms",
  "Naval Buoy": "heavy_ammunition",
  "Officialis' Attire": "uniforms",
  "PT-815 Smoke Grenade": "small_arms",
  "Quillback Torpedo": "heavy_ammunition",
  "R-1 Hauler": "vehicles",
  "R-12 - Salus Ambulance": "vehicles",
  "R-15 - Chariot": "vehicles",
  "R-5 Atlas Hauler": "vehicles",
  "Recon Camo": "uniforms",
  "Remex Garb": "uniforms",
  "Resource Container": "shipables",
  "Rooster - Junkwagon": "vehicles",
  "Rooster - Lamploader": "vehicles",
  "Rooster - Tumblebox": "vehicles",
  "RPG": "heavy_arms",
  "RR-3 Stolon Tanker": "vehicles",
  "Shatter Missile": "heavy_ammunition",
  "Shipping Container": "shipables",
  "Shrapnel Mortar Shell": "heavy_arms",
  "Strider": "vehicles",
  "T12 Actaeon Tankette": "vehicles",
  "T3 Xiphos": "vehicles",
  "Tankman's Coveralls": "uniforms",
  "The Pitch Gun mc.V": "small_arms",
  "Tremola Grenade GPb-1": "heavy_arms",
  "Type B - Lucian": "vehicles",
  "Type C - Charon": "vehicles",
  "Typhon ra.XII": "heavy_arms",
  "UV-05a Argonaut": "vehicles",
  "Velian Flak Vest": "uniforms",
  "Venom c.II 35": "heavy_arms",
  "Volta r.I Repeater": "small_arms",
};

// Utilities and Medical were dropped entirely (not just hidden) — every
// single item in both categories is Factory-only, zero have an MPF recipe
// (confirmed: 0/23 and 0/5), so they'd always render as an empty tab the
// moment MPF is selected. Rather than leave a dead-end tab in the UI, the
// items themselves were removed from the map above too — no orphaned data
// hanging off a tab nothing points at.
const LOADOUT_TAB_ORDER = ['small_arms', 'heavy_arms', 'heavy_ammunition', 'supplies', 'uniforms', 'vehicles', 'shipables'];
const LOADOUT_TAB_LABELS = {
  small_arms: 'SMALL ARMS',
  heavy_arms: 'HEAVY ARMS',
  heavy_ammunition: 'HEAVY AMMUNITION',
  supplies: 'SUPPLIES',
  uniforms: 'UNIFORMS',
  vehicles: 'VEHICLES',
  shipables: 'SHIPPABLES'
};

// The four resources this page's totals lead with (everything else this
// order happens to cost — Explosive Powder, Construction Materials, etc. —
// still shows, just sorted after these by name).
const LOADOUT_PRIMARY_RESOURCES = ['Basic Materials', 'Refined Materials', 'Explosive Materials', 'Heavy Explosive Materials'];

const LOADOUT_STORAGE_KEY = 'foxholeLoadout.v1';

// A single real in-game production order can only hold this many crates at
// once — 4 at a Factory, 9 at an MPF (matching the "MPF (9-Crate)" batch
// naming already used throughout this repo's own recipe data). This page
// never blocks ordering more than that — a real player just needs multiple
// queue slots/order runs to fulfill it — it only warns, non-blockingly, on
// the order row (see renderOrderList). Shift-clicking a grid tile adds a
// full queue's worth at once instead of the usual +1 (see the itemGrid
// click handler in initLoadoutUI).
const LOADOUT_QUEUE_LIMIT = { factory: 4, mpf: 9 };

// name -> [recipe, ...] for every item this page knows about, built once at
// boot from MATERIAL_RECIPES (already populated by loader.js). Only the
// PRIMARY output of each recipe counts (same rule buildIndices in loader.js
// uses for RECIPE_BY_OUTPUT) so a recipe's incidental byproduct never gets
// mistaken for a real way to craft that byproduct.
let LOADOUT_ITEMS_BY_NAME = {};
let LOADOUT_ITEMS = [];

const loadoutState = {
  craftLocation: 'factory', // 'factory' | 'mpf'
  activeTab: 'small_arms',
  searchQuery: '',
  order: {} // item full_name -> quantity, in whole crates
};

let tabBarEl, itemGridEl, searchInputEl, totalsPanelEl, crateTotalsPanelEl, orderListEl;

function buildLoadoutItems() {
  const byName = {};
  for (const recipe of Object.values(MATERIAL_RECIPES)) {
    const primary = Object.keys(recipe.outputs)[0];
    if (!primary) continue;
    if (!byName[primary]) byName[primary] = [];
    byName[primary].push(recipe);
  }

  LOADOUT_ITEMS_BY_NAME = {};
  LOADOUT_ITEMS = [];
  for (const [name, tab] of Object.entries(LOADOUT_TAB_BY_NAME)) {
    const recipes = byName[name];
    if (!recipes || !recipes.length) continue; // shouldn't happen — every name here was verified against real data
    const item = { name, tab, recipes };
    LOADOUT_ITEMS_BY_NAME[name] = item;
    LOADOUT_ITEMS.push(item);
  }
}

// Which of an item's recipes applies to the current Factory/MPF toggle.
// 'mpf' needs an exact "Mass Production Factory" facility match. 'factory'
// means anywhere else (Garage, Ammunition Factory, ...) since this site's
// toggle is a binary "MPF or not" — preferring the recipe literally named
// "Factory" when more than one non-MPF option exists. Returns null when the
// item simply isn't craftable at the selected location (e.g. vehicles are
// MPF-only) — callers treat that as "unavailable right now", not an error.
function pickRecipeForLocation(recipes, craftLocation) {
  if (craftLocation === 'mpf') {
    return recipes.find(r => r.facility === 'Mass Production Factory') || null;
  }
  const nonMpf = recipes.filter(r => r.facility !== 'Mass Production Factory');
  if (!nonMpf.length) return null;
  return nonMpf.find(r => r.facility === 'Factory') || nonMpf[0];
}

function sortResourceNames(names) {
  return names.sort((a, b) => {
    const ia = LOADOUT_PRIMARY_RESOURCES.indexOf(a);
    const ib = LOADOUT_PRIMARY_RESOURCES.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    return a.localeCompare(b);
  });
}

// Sums the whole order's raw-material cost and per-category crate counts in
// one pass. Order quantities are always in whole CRATES (matching how
// foxholelogi itself displays "Produces a crate of Nx") — an MPF recipe
// that batches multiple crates at once (crate_output > 1) is prorated back
// down to a per-crate cost first, same crate_output/unit_output convention
// used throughout calc.js/render.js elsewhere in this codebase.
function computeLoadoutTotals() {
  const costTotals = {};
  const crateTotalsByTab = {};
  for (const [name, qty] of Object.entries(loadoutState.order)) {
    if (!qty) continue;
    const item = LOADOUT_ITEMS_BY_NAME[name];
    if (!item) continue;
    crateTotalsByTab[item.tab] = (crateTotalsByTab[item.tab] || 0) + qty;
    const recipe = pickRecipeForLocation(item.recipes, loadoutState.craftLocation);
    if (!recipe) continue; // queued, but not craftable at the current toggle — see renderOrderList
    const cratesPerBatch = recipe.crate_output || 1;
    for (const [resName, resQty] of Object.entries(recipe.inputs)) {
      costTotals[resName] = (costTotals[resName] || 0) + (resQty / cratesPerBatch) * qty;
    }
  }
  return { costTotals, crateTotalsByTab };
}

function addToOrder(name, amount = 1) {
  loadoutState.order[name] = (loadoutState.order[name] || 0) + amount;
  renderAll();
}

function setOrderQty(name, qty) {
  if (qty <= 0) {
    delete loadoutState.order[name];
  } else {
    loadoutState.order[name] = qty;
  }
  renderAll();
}

function removeFromOrder(name) {
  delete loadoutState.order[name];
  renderAll();
}

function renderTabBar() {
  const usedTabs = LOADOUT_TAB_ORDER.filter(tab => LOADOUT_ITEMS.some(item => item.tab === tab));
  tabBarEl.innerHTML = usedTabs.map(tab =>
    `<button type="button" class="loadout-tab${tab === loadoutState.activeTab ? ' active' : ''}" data-tab="${tab}">${LOADOUT_TAB_LABELS[tab]}</button>`
  ).join('');
}

function renderItemGrid() {
  const q = loadoutState.searchQuery.trim().toLowerCase();
  const items = LOADOUT_ITEMS
    .filter(item => item.tab === loadoutState.activeTab)
    .filter(item => !q || item.name.toLowerCase().includes(q))
    .filter(item => pickRecipeForLocation(item.recipes, loadoutState.craftLocation))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!items.length) {
    itemGridEl.innerHTML = '<div class="loadout-empty-hint">— NO ITEMS MATCH —</div>';
    return;
  }

  itemGridEl.innerHTML = items.map(item => {
    const qty = loadoutState.order[item.name] || 0;
    // Always rendered (even at qty 0, just invisible via .is-empty) so the
    // icon/name never shift position the moment a tile's count first
    // appears — the row always has the same height either way.
    const qtyTag = `<span class="loadout-item-qty${qty > 0 ? '' : ' is-empty'}">×${qty || 1}</span>`;
    return `<div class="loadout-item-tile${qty > 0 ? ' has-qty' : ''}" data-item-name="${item.name}" title="${item.name} — shift-click to add a full queue (${LOADOUT_QUEUE_LIMIT[loadoutState.craftLocation]})">
      ${iconTag(item.name, 'loadout-item-icon')}
      <span class="loadout-item-name">${item.name}</span>
      ${qtyTag}
    </div>`;
  }).join('');
}

function renderTotalsPanel(costTotals) {
  const names = sortResourceNames(Object.keys(costTotals));
  totalsPanelEl.innerHTML = names.map(name => `
    <div class="loadout-resource-chip">
      <span class="loadout-resource-name">${name}</span>
      <span class="loadout-resource-value">${fmtNum(costTotals[name])}</span>
    </div>
  `).join('');
}

function renderCrateTotalsPanel(crateTotalsByTab) {
  const tabs = LOADOUT_TAB_ORDER.filter(tab => crateTotalsByTab[tab] > 0);
  crateTotalsPanelEl.innerHTML = tabs.map(tab => `
    <div class="loadout-resource-chip">
      <span class="loadout-resource-name">${LOADOUT_TAB_LABELS[tab]}</span>
      <span class="loadout-resource-value">${fmtNum(crateTotalsByTab[tab])}</span>
    </div>
  `).join('');
}

// Grouped by tab, same as foxholelogi's own "Manage Crate Orders" layout.
// An item that's queued but not craftable at the currently-selected
// Factory/MPF toggle stays visible (so switching the toggle back and forth
// never silently drops part of the order) but is flagged and excluded from
// the cost totals above — see computeLoadoutTotals.
function renderOrderList() {
  const names = Object.keys(loadoutState.order).filter(n => loadoutState.order[n] > 0);
  if (!names.length) {
    orderListEl.innerHTML = '<div class="loadout-empty-hint" id="orderEmptyHint">— CLICK AN ITEM TO ADD IT TO THE ORDER —</div>';
    return;
  }

  const byTab = {};
  for (const name of names) {
    const item = LOADOUT_ITEMS_BY_NAME[name];
    if (!item) continue;
    (byTab[item.tab] = byTab[item.tab] || []).push(name);
  }

  const queueLimit = LOADOUT_QUEUE_LIMIT[loadoutState.craftLocation];
  const locationLabel = loadoutState.craftLocation === 'mpf' ? 'MPF' : 'Factory';

  let html = '';
  for (const tab of LOADOUT_TAB_ORDER) {
    const tabNames = byTab[tab];
    if (!tabNames || !tabNames.length) continue;
    tabNames.sort((a, b) => a.localeCompare(b));
    html += `<div class="loadout-order-category">${LOADOUT_TAB_LABELS[tab]}</div>`;
    for (const name of tabNames) {
      const item = LOADOUT_ITEMS_BY_NAME[name];
      const qty = loadoutState.order[name];
      const available = !!pickRecipeForLocation(item.recipes, loadoutState.craftLocation);
      // Informational only — never blocks ordering more. A single real
      // production order queue only holds so many crates (see
      // LOADOUT_QUEUE_LIMIT); past that, the player just needs multiple
      // queue runs to actually fulfill it in-game.
      const overLimit = available && qty > queueLimit;
      const warning = overLimit
        ? `<span class="loadout-order-warning" title="A single ${locationLabel} order queue only holds ${queueLimit} crates — you'll need ${Math.ceil(qty / queueLimit)} separate orders to fulfill this.">⚠ ${Math.ceil(qty / queueLimit)}× orders</span>`
        : '';
      html += `<div class="loadout-order-row${available ? '' : ' loadout-order-row-unavailable'}" data-item-name="${name}">
        ${iconTag(name, 'loadout-order-icon')}
        <span class="loadout-order-name" title="${available ? name : name + ' — not craftable at this location'}">${name}</span>
        ${warning}
        <div class="step-queue-stepper">
          <button type="button" class="step-queue-btn loadout-qty-dec">−</button>
          <input type="number" min="1" class="qty-val step-queue-val-input loadout-qty-input" value="${qty}">
          <button type="button" class="step-queue-btn loadout-qty-inc">+</button>
        </div>
        <button type="button" class="loadout-order-remove" title="Remove">×</button>
      </div>`;
    }
  }
  orderListEl.innerHTML = html;
}

function saveLoadoutState() {
  try {
    localStorage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify({ order: loadoutState.order, craftLocation: loadoutState.craftLocation }));
  } catch (e) { /* localStorage unavailable (private browsing, quota) — order just won't persist */ }
}

function loadLoadoutState() {
  let raw;
  try { raw = localStorage.getItem(LOADOUT_STORAGE_KEY); } catch (e) { return; }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed.order && typeof parsed.order === 'object') loadoutState.order = parsed.order;
      if (parsed.craftLocation === 'factory' || parsed.craftLocation === 'mpf') loadoutState.craftLocation = parsed.craftLocation;
    }
  } catch (e) { /* corrupt saved state — ignore, start fresh */ }
}

function renderAll() {
  renderTabBar();
  renderItemGrid();
  const { costTotals, crateTotalsByTab } = computeLoadoutTotals();
  renderTotalsPanel(costTotals);
  renderCrateTotalsPanel(crateTotalsByTab);
  renderOrderList();
  saveLoadoutState();
}

function initLoadoutUI() {
  tabBarEl = document.getElementById('tabBar');
  itemGridEl = document.getElementById('itemGrid');
  searchInputEl = document.getElementById('itemSearch');
  totalsPanelEl = document.getElementById('totalsPanel');
  crateTotalsPanelEl = document.getElementById('crateTotalsPanel');
  orderListEl = document.getElementById('orderList');

  document.getElementById('craftLocationFactory').checked = loadoutState.craftLocation === 'factory';
  document.getElementById('craftLocationMpf').checked = loadoutState.craftLocation === 'mpf';
  document.querySelectorAll('input[name="craftLocation"]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked) { loadoutState.craftLocation = input.value; renderAll(); }
    });
  });

  searchInputEl.addEventListener('input', () => {
    loadoutState.searchQuery = searchInputEl.value;
    renderItemGrid();
  });

  tabBarEl.addEventListener('click', e => {
    const btn = e.target.closest('.loadout-tab');
    if (!btn) return;
    loadoutState.activeTab = btn.dataset.tab;
    renderTabBar();
    renderItemGrid();
  });

  itemGridEl.addEventListener('click', e => {
    const tile = e.target.closest('.loadout-item-tile');
    if (!tile) return;
    const amount = e.shiftKey ? LOADOUT_QUEUE_LIMIT[loadoutState.craftLocation] : 1;
    addToOrder(tile.dataset.itemName, amount);
  });

  document.getElementById('clearOrderBtn').addEventListener('click', () => {
    loadoutState.order = {};
    renderAll();
  });

  orderListEl.addEventListener('click', e => {
    const row = e.target.closest('.loadout-order-row');
    if (!row) return;
    const name = row.dataset.itemName;
    if (e.target.closest('.loadout-order-remove')) {
      removeFromOrder(name);
    } else if (e.target.closest('.loadout-qty-dec')) {
      const next = (loadoutState.order[name] || 1) - 1;
      setOrderQty(name, next);
    } else if (e.target.closest('.loadout-qty-inc')) {
      setOrderQty(name, (loadoutState.order[name] || 0) + 1);
    }
  });

  orderListEl.addEventListener('change', e => {
    const input = e.target.closest('.loadout-qty-input');
    if (!input) return;
    const row = e.target.closest('.loadout-order-row');
    const next = Math.max(1, Math.round(Number(input.value)) || 1);
    setOrderQty(row.dataset.itemName, next);
  });
}

// Entry point — same retry-a-couple-times reasoning as bootWithRetry in
// app.js / bootPlanner in planner.js for a transient first-load network hiccup.
async function bootLoadout(retriesLeft = 2) {
  try {
    await loadData();
  } catch (err) {
    if (retriesLeft > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return bootLoadout(retriesLeft - 1);
    }
    console.error('Failed to load data:', err);
    document.getElementById('itemGrid').innerHTML =
      `<div class="loadout-empty-hint">— FAILED TO LOAD DATA —<br>${err.message}<br><br>if you opened this file directly (file://), your browser is blocking local JSON fetches.<br>run a local server instead — see README.md</div>`;
    return;
  }

  buildLoadoutItems();
  loadLoadoutState();
  initLoadoutUI();
  renderAll();
}

bootLoadout();

// Dev-only smoke-test hook — inert for every real visitor since nothing
// ever links to this page with ?autotest=1. See test.ps1/test/smoke-loadout.js.
if (new URLSearchParams(location.search).has('autotest')) {
  const s = document.createElement('script');
  s.src = 'test/smoke-loadout.js';
  document.head.appendChild(s);
}
