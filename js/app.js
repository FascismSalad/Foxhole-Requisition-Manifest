// ============================================================
// STATE + INTERACTION
// ============================================================

// Each entry: { kind, key, quantity, crateMode, nodeOverrides, collapsed }
// nodeOverrides maps a chain node's path -> the recipe key chosen
// specifically for that occurrence (see buildProductionChain in calc.js).
// crateMode: when true (and the item has a known crate size), quantity is
// read as a target number of CRATES instead of individual units — see
// resolveTicketQuantity() in calc.js.
// poolRecipeChoice: itemName -> recipeKey chosen for a gather step's own
// recipe preview — purely informational (see poolItemRecipePreview in
// calc.js), it never feeds back into the left sidebar's totals themselves.
// craftRecipesOpen: itemName -> whether a regular multi-recipe step's own
// CHOOSE RECIPE picker is currently expanded — a real recipe choice that
// DOES affect the chain (see the .recipe-option-card click handler).
// gatherRecipesOpen: itemName -> whether a gather step's (Water Pump,
// Harvester, Power Station, ...) own CHOOSE RECIPE picker is expanded —
// same shape as craftRecipesOpen, kept separate since gather steps are
// purely informational (see renderGatherRow/poolItemRecipePreview), not a
// real chain override.
// chainVisibility: whether LIQUIDS/RAW RESOURCES/POWER gather rows show
// up in the middle production chain — toggled via the sidebar section
// headers (see renderRawPanel). Purely a display filter on the chain
// panel; the sidebar's own totals always stay visible regardless (see
// renderCombinedChain's use of this vs renderRawPanel's). MATERIALS
// CONSUMED has no toggle, so it's not tracked here.
const state = { entries: [], poolRecipeChoice: {}, craftRecipesOpen: {}, gatherRecipesOpen: {}, chainVisibility: { liquid: true, resource: true, power: true } };

// The left sidebar's own scroll region: bounded to whatever room is
// actually left below its current on-screen position, so it starts
// scrolling in place exactly when it reaches the bottom of the viewport —
// a flat CSS "100vh" figure can't do this correctly on its own, since the
// panel's real top position varies (until it's actually stuck at its
// sticky offset, its top is wherever normal document flow puts it, not the
// 20px sticky offset yet). Re-run after every render too, not just on
// scroll/resize, since adding/removing tickets can change whether the page
// is tall enough to scroll at all.
function updateRawPanelHeight() {
  const panel = document.getElementById('rawPanelWrap');
  if (!panel) return;
  if (window.matchMedia('(max-width: 900px)').matches) {
    // Below the breakpoint the panel drops out of its sticky column and
    // just stacks in the page flow (see the max-width: 900px CSS rule) —
    // no independent scroll region there, or every screen would get two
    // nested scrollbars fighting each other.
    panel.style.maxHeight = '';
    return;
  }
  const top = panel.getBoundingClientRect().top;
  // A generous bottom margin (not just a few px) so the box visibly ends
  // well short of the viewport edge — better a little unused space than
  // any part of it still hanging off-screen.
  panel.style.maxHeight = `${Math.max(window.innerHeight - top - 140, 100)}px`;
}

// Gives a genuinely added/removed row in the production chain a short
// enter/exit animation, the same smooth-transition quality as the search
// dropdown and the ticket/recipe-detail collapse animations elsewhere in
// this app — instead of every row just snapping into/out of existence,
// which is what a plain innerHTML swap would otherwise do. The chain
// panel has no persistent per-row DOM to diff against (it's rebuilt from
// an HTML string on every render), so this does its own lightweight
// before/after comparison keyed on each row's data-row-key (see
// renderCraftRow/renderGatherRow in render.js): a key that's new gets an
// entrance animation, a key that's disappearing gets held in place with
// an exit animation for one beat before the real DOM swap happens. A row
// that merely moved position (same key, different step number) gets
// neither — only true adds/removes animate.
function updateChainPanel(html) {
  const container = document.getElementById('chainPanel');
  const oldRows = new Map(
    [...container.querySelectorAll('.step-row[data-row-key]')].map(el => [el.dataset.rowKey, el])
  );

  const temp = document.createElement('div');
  temp.innerHTML = html;
  const newRows = [...temp.querySelectorAll('.step-row[data-row-key]')];
  const newKeys = new Set(newRows.map(el => el.dataset.rowKey));

  for (const row of newRows) {
    if (!oldRows.has(row.dataset.rowKey)) row.classList.add('step-row-entering');
  }

  const exitingRows = [...oldRows.entries()].filter(([key]) => !newKeys.has(key));
  if (exitingRows.length === 0) {
    container.replaceChildren(...temp.children);
    return;
  }
  for (const [, el] of exitingRows) el.classList.add('step-row-exiting');
  setTimeout(() => container.replaceChildren(...temp.children), 180);
}

function renderResults() {
  const resultsContainer = document.getElementById('results');
  const chainContainer = document.getElementById('chainPanel');
  const rawContainer = document.getElementById('rawPanel');
  const consumedContainer = document.getElementById('consumedPanel');
  const sendToPlannerBtn = document.getElementById('sendToPlannerBtn');

  if (state.entries.length === 0) {
    resultsContainer.innerHTML = `<div class="empty-state">— NO REQUISITION SELECTED —</div>`;
    chainContainer.innerHTML = `<div class="empty-state">— NO PRODUCTION CHAIN —</div>`;
    rawContainer.innerHTML = `<div class="empty-state">— NONE NEEDED —</div>`;
    consumedContainer.innerHTML = `<div class="empty-state">— NONE YET —</div>`;
    updateRawPanelHeight();
    if (sendToPlannerBtn) sendToPlannerBtn.disabled = true;
    return;
  }

  let ticketsHtml = '';
  const trees = [];

  for (const entry of state.entries) {
    const tree = buildProductionChain(entry);
    trees.push(tree);

    ticketsHtml += entry.kind === 'aircraft'
      ? renderAircraftTicket(entry, tree.totalSeconds)
      : renderMaterialTicket(entry, tree.recipeKey, tree.totalSeconds);
  }

  resultsContainer.innerHTML = ticketsHtml;
  updateChainPanel(renderCombinedChain(state.entries, trees, state.poolRecipeChoice, state.craftRecipesOpen, state.gatherRecipesOpen, state.chainVisibility));
  const { liquids, resources, power } = aggregateRawResources(trees);
  const expanded = expandGatherChain(liquids, resources, power, state.poolRecipeChoice);
  rawContainer.innerHTML = renderRawPanel(expanded.liquids, expanded.resources, expanded.power, state.chainVisibility);
  consumedContainer.innerHTML = renderConsumedPanel(tallyConsumedMaterials(buildChainSteps(trees)));
  updateRawPanelHeight();
  if (sendToPlannerBtn) sendToPlannerBtn.disabled = false;
}

function addEntry(kind, key, quantity = 1) {
  // avoid duplicate tickets for the exact same item; bump quantity instead
  const existing = state.entries.find(e => e.kind === kind && e.key === key);
  if (existing) {
    existing.quantity += quantity;
  } else {
    const entry = { kind, key, quantity, crateMode: false, nodeOverrides: {}, collapsed: true };
    // Defaults to crate mode whenever the item actually has a crate size —
    // most requisitioning is thought of "how many crates," not raw units.
    entry.crateMode = !!ticketCrateSize(entry);
    state.entries.unshift(entry);
  }
  renderResults();
}

function selectPhrase(phrase) {
  const clean = phrase.toLowerCase().trim();
  if (clean in AIRCRAFT_ALIASES) {
    for (const key of AIRCRAFT_ALIASES[clean]) addEntry('aircraft', key, 1);
    return true;
  }
  if (clean in MATERIAL_ALIASES) {
    addEntry('material', MATERIAL_ALIASES[clean], 1);
    return true;
  }
  return false;
}

function buildSuggestions(query) {
  const clean = query.toLowerCase().trim();
  const results = [];
  const seenAircraft = new Set();
  for (const [key, aircraft] of Object.entries(AIRCRAFT_COSTS)) {
    // Every tag the dropdown actually shows (category, subcategory, class,
    // type) is searchable too, not just the name/aliases — so typing
    // "aircraft" or "transport" surfaces everything tagged that way.
    const haystack = [aircraft.full_name, key, aircraft.category, aircraft.subcategory, aircraft.class, aircraft.type, ...(aircraft.aliases||[])].join(' ').toLowerCase();
    if (haystack.includes(clean) && !seenAircraft.has(key)) {
      seenAircraft.add(key);
      results.push({ kind: 'aircraft', category: aircraft.category, subcategory: aircraft.subcategory, class: aircraft.class, type: aircraft.type, label: aircraft.full_name, phrase: key });
    }
  }
  const seenMat = new Set();

  // Multi-recipe items (Steel, Salvage, Sulfur, ...) — one dropdown entry per
  // item; selecting it defaults to its first recipe (see buildIndices). Which
  // exact recipe is used at any point in a chain can be changed per-node
  // afterward in the production chain panel.
  for (const [itemKey, itemData] of Object.entries(ITEM_MULTIPLE_RECIPES)) {
    const haystack = [itemData.full_name, itemKey, itemData.category, itemData.subcategory, itemData.tier, itemData.class, itemData.type, ...(itemData.aliases||[])].join(' ').toLowerCase();
    if (haystack.includes(clean) && !seenMat.has(itemData.full_name)) {
      seenMat.add(itemData.full_name);
      results.push({ kind: 'material', category: itemData.category, subcategory: itemData.subcategory, tier: itemData.tier, class: itemData.class, type: itemData.type, label: itemData.full_name, phrase: itemKey });
    }
  }

  // Standalone single-recipe materials
  for (const [key, recipe] of Object.entries(MATERIAL_RECIPES)) {
    if (!recipe.full_name) continue; // belongs to a multi-recipe parent, already listed above
    const haystack = [recipe.full_name, key, recipe.category, recipe.subcategory, recipe.tier, recipe.class, recipe.type, ...(recipe.aliases||[])].join(' ').toLowerCase();
    if (haystack.includes(clean) && !seenMat.has(recipe.full_name)) {
      seenMat.add(recipe.full_name);
      results.push({ kind: 'material', category: recipe.category, subcategory: recipe.subcategory, class: recipe.class, type: recipe.type, label: recipe.full_name, phrase: key });
    }
  }
  results.sort((a, b) => a.label.localeCompare(b.label));
  return results;
}

function initApp() {
  // ---- Dropdown toggle + search + full scrollable item list ----

  const searchInputWrap = document.getElementById('searchInputWrap');
  const searchInput = document.getElementById('searchInput');
  const autocompleteBox = document.getElementById('autocomplete');
  // renderAutocomplete only ever touches this inner list — #autocomplete
  // itself is the grid wrapper that animates open/closed (see .autocomplete
  // in style.css), and re-writing its innerHTML on every keystroke would
  // wipe out the "before" state a CSS transition needs to animate from.
  const autocompleteList = document.getElementById('autocompleteList');

  function renderAutocomplete(query) {
    const suggestions = buildSuggestions(query);
    if (suggestions.length === 0) {
      autocompleteList.innerHTML = `<div class="ac-item ac-empty">No matching items</div>`;
      return;
    }
    autocompleteList.innerHTML = suggestions.map(s => {
      // Vehicles (land/naval/aircraft/field weapon) skip the subcategory tag —
      // class+type already say more than "Land Vehicle"/"Naval Vehicle"/
      // "Aircraft"/"Field Weapon" would. Each vehicle subtype instead gets a
      // distinctly colored leading tag: naval uses its tier (Small/Large
      // Naval), aircraft uses its class (already reads as "Tiny"/"Small
      // Aircraft"/"Large Aircraft"), field weapons get a dedicated "FIELD
      // WEAPON" tag, and plain land vehicles fall back to "VEHICLE" — each
      // one its own hue so the four read apart at a glance. Non-vehicle
      // categories (weapon/ammo/material/item/resource) lead with category.
      const isVehicle = s.category === 'vehicle';
      const isAircraft = isVehicle && s.subcategory === 'Aircraft';
      const isNaval = isVehicle && !!s.tier;
      const isFieldWeapon = isVehicle && s.subcategory === 'Field Weapon';
      const isLandVehicle = isVehicle && !isAircraft && !isNaval && !isFieldWeapon;
      const showSubcategory = !isVehicle;

      let leadTag = '';
      if (isNaval) {
        leadTag = `<span class="ac-tag ac-tag-cat-naval">${s.tier.replace(/_/g, ' ').toUpperCase()}</span>`;
      } else if (isAircraft) {
        leadTag = s.class ? `<span class="ac-tag ac-tag-cat-aircraft">${s.class.replace(/_/g, ' ').toUpperCase()}</span>` : '';
      } else if (isLandVehicle) {
        leadTag = `<span class="ac-tag ac-tag-cat-vehicle">VEHICLE</span>`;
      } else if (isFieldWeapon) {
        leadTag = `<span class="ac-tag ac-tag-cat-fieldweapon">FIELD WEAPON</span>`;
      } else {
        leadTag = `<span class="ac-tag ac-tag-cat-${s.category || ''}">${(s.category || '').toUpperCase()}</span>`;
      }

      // Everything after the lead is a plain "detail" tag, in display order
      // (aircraft's class is consumed by the lead above, so it's excluded
      // here). Whichever detail tag ends up LAST keeps the existing neutral
      // color; any detail tag before it gets its own distinct color instead
      // of blending into the same uniform mint as the last one.
      const detailTexts = [];
      if (showSubcategory && s.subcategory) detailTexts.push(s.subcategory);
      if (!isAircraft && s.class) detailTexts.push(s.class);
      if (s.type) detailTexts.push(s.type);

      const detailTags = detailTexts.map((text, i) => {
        const cls = i === detailTexts.length - 1 ? 'ac-tag-detail-last' : 'ac-tag-detail-mid';
        return `<span class="ac-tag ${cls}">${text.replace(/_/g, ' ').toUpperCase()}</span>`;
      }).join('');

      return `<div class="ac-item" data-phrase="${s.phrase}">${iconTag(s.label, 'ac-icon')}<span class="ac-item-label">${s.label}</span><span class="ac-tags">${leadTag}${detailTags}</span></div>`;
    }).join('');
  }

  function openDropdown() {
    searchInputWrap.classList.add('open');
    autocompleteBox.classList.add('open');
    renderAutocomplete(searchInput.value);
  }

  function closeDropdown() {
    searchInputWrap.classList.remove('open');
    autocompleteBox.classList.remove('open');
  }

  searchInput.addEventListener('focus', openDropdown);
  searchInput.addEventListener('click', openDropdown);
  searchInput.addEventListener('input', () => {
    renderAutocomplete(searchInput.value);
    if (!autocompleteBox.classList.contains('open')) openDropdown();
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = autocompleteBox.querySelector('.ac-item[data-phrase]');
      if (first) {
        selectPhrase(first.dataset.phrase);
        searchInput.value = '';
        renderAutocomplete('');
      }
    }
    if (e.key === 'Escape') {
      closeDropdown();
      searchInput.blur();
    }
  });

  autocompleteBox.addEventListener('click', (e) => {
    const item = e.target.closest('.ac-item[data-phrase]');
    if (!item) return;
    selectPhrase(item.dataset.phrase);
    searchInput.value = '';
    closeDropdown();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-block')) closeDropdown();
  });

  // ---- Ticket-level interactions (qty steppers) ----

  document.getElementById('results').addEventListener('click', (e) => {
    const ticket = e.target.closest('.ticket');
    if (!ticket) return;
    const kind = ticket.dataset.kind;
    const key = ticket.dataset.key;

    const qtyBtn = e.target.closest('.qty-btn');
    if (qtyBtn) {
      const entry = state.entries.find(en => en.kind === kind && en.key === key);
      if (!entry) return;
      if (e.shiftKey) {
        // Shift = fast jump, flat +/-10 regardless of any MPF batch
        // alignment — unlike the normal step below, this doesn't snap to a
        // clean multiple; the eventual craft batch count still rounds up
        // fine on its own (see buildNode's Math.ceil), so landing off a
        // round MPF multiple here doesn't cause any real problem.
        entry.quantity = qtyBtn.dataset.action === 'inc' ? entry.quantity + 10 : Math.max(0, entry.quantity - 10);
      } else {
        // In crate mode, an MPF-batch recipe only steps in whole multiples of
        // its own batch size (see ticketCrateStep) — snapping to the nearest
        // multiple first, not just adding/subtracting it, so a quantity left
        // over from a different recipe still lands on a valid MPF batch count
        // on the very first click instead of drifting off by the remainder.
        const step = entry.crateMode ? ticketCrateStep(entry) : 1;
        if (qtyBtn.dataset.action === 'inc') {
          entry.quantity = step > 1 ? (Math.floor(entry.quantity / step) + 1) * step : entry.quantity + 1;
        }
        if (qtyBtn.dataset.action === 'dec') {
          entry.quantity = step > 1 ? Math.max(0, Math.ceil(entry.quantity / step) - 1) * step : entry.quantity - 1;
        }
      }
      // dropping to 0 removes the ticket entirely rather than sitting at 0
      if (entry.quantity <= 0) {
        state.entries = state.entries.filter(en => en !== entry);
      }
      renderResults();
      return;
    }

    // The crate-mode checkbox lives inside .ticket-head — handle it before
    // the collapse-toggle check below, and return, or checking it would
    // also collapse the ticket.
    if (e.target.closest('.crate-toggle')) {
      const entry = state.entries.find(en => en.kind === kind && en.key === key);
      if (!entry) return;
      // Reset to a clean "just one" in the new mode instead of carrying the
      // old number over — a crate count and a unit count aren't the same
      // kind of quantity, so silently reinterpreting whatever number was
      // there (the old bug) or converting it 1:1 across crateSize (a prior
      // attempt at this fix) both spring an unexpected total on the user.
      // Switching modes always restarts the stepper at 1 in that mode.
      entry.crateMode = !entry.crateMode;
      entry.quantity = 1;
      renderResults();
      return;
    }

    // Typing directly into the qty field lives inside .ticket-head too —
    // same reasoning as the crate-toggle check above, just skip the
    // collapse toggle so clicking in to type doesn't also fold the ticket.
    if (e.target.closest('.qty-val')) return;

    // Clicking a ticket's header condenses it down to just that header —
    // handy once you've got several tickets open and want to see more at once.
    // Toggle the class directly instead of going through renderResults(): that
    // rebuilds every ticket's innerHTML from scratch, which would replace this
    // exact element with a fresh one already in its final state — no "before"
    // state left for the CSS transition to animate from, so it'd just snap.
    if (e.target.closest('.ticket-head')) {
      const entry = state.entries.find(en => en.kind === kind && en.key === key);
      if (!entry) return;
      entry.collapsed = !entry.collapsed;
      ticket.classList.toggle('collapsed', entry.collapsed);
    }
  });

  // Typing a quantity directly commits on blur/Enter (a 'change' event),
  // not on every keystroke — a full re-render mid-typing would fight the
  // user for control of the input. Enter just blurs to trigger that same
  // 'change' path rather than duplicating the commit logic.
  document.getElementById('results').addEventListener('change', (e) => {
    const qtyInput = e.target.closest('.qty-val');
    if (!qtyInput) return;
    const ticket = e.target.closest('.ticket');
    if (!ticket) return;
    const entry = state.entries.find(en => en.kind === ticket.dataset.kind && en.key === ticket.dataset.key);
    if (!entry) return;
    // dropping to 0 removes the ticket entirely, same as the stepper buttons
    entry.quantity = Math.max(0, Math.floor(Number(qtyInput.value) || 0));
    if (entry.quantity <= 0) {
      state.entries = state.entries.filter(en => en !== entry);
    }
    renderResults();
  });
  document.getElementById('results').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest('.qty-val')) e.target.blur();
  });

  // ---- Production chain interactions (per-node recipe choice) ----

  document.getElementById('chainPanel').addEventListener('click', (e) => {
    // The whole YIELDS tray is the toggle now, not a separate button — see
    // renderCraftRow/renderGatherRow in render.js. A single-recipe step's
    // tray carries neither data attribute (step-yield-static, non-
    // interactive), so this simply won't match for those.
    const toggle = e.target.closest('[data-recipe-toggle], [data-gather-toggle]');
    if (toggle) {
      // Toggle the persisting DOM nodes directly instead of calling
      // renderResults() — same reasoning as the ticket collapse toggle
      // above: a full re-render replaces the detail block with a fresh
      // element already in its final state, leaving no "before" state for
      // the CSS transition to animate from. state.craftRecipesOpen/
      // gatherRecipesOpen still get updated so a later real re-render
      // (e.g. from changing a quantity) keeps showing the right state.
      const detailWrap = toggle.closest('.step-body')?.querySelector('.step-recipe-detail-wrap');
      let isOpenNow;
      if (toggle.dataset.gatherToggle) {
        const name = toggle.dataset.gatherToggle;
        isOpenNow = state.gatherRecipesOpen[name] = !state.gatherRecipesOpen[name];
      } else {
        const name = toggle.dataset.recipeToggle;
        isOpenNow = state.craftRecipesOpen[name] = !state.craftRecipesOpen[name];
      }
      toggle.classList.toggle('open', isOpenNow);
      if (detailWrap) detailWrap.classList.toggle('open', isOpenNow);
      return;
    }

    // A recipe-option card is a full preview (facility/time/inputs->output)
    // the user can look over before picking it — clicking anywhere on the
    // card selects it (see renderRecipeOptionCard in render.js).
    const optionCard = e.target.closest('.recipe-option-card');
    if (optionCard) {
      if (optionCard.dataset.paths) {
        // A real chain override. A card can represent occurrences of the
        // same recipe from several different selected outputs merged
        // together (see buildChainSteps). Each path is prefixed with its
        // own entry's root ("kind:key>..."), so route the override back to
        // whichever entry that path came from.
        for (const path of optionCard.dataset.paths.split('|')) {
          const rootPath = path.split('>')[0];
          const sep = rootPath.indexOf(':');
          const kind = rootPath.slice(0, sep);
          const key = rootPath.slice(sep + 1);
          const entry = state.entries.find(en => en.kind === kind && en.key === key);
          if (!entry) continue;
          entry.nodeOverrides[path] = optionCard.dataset.recipeKey;
          // Switching a ticket's OWN recipe (path === rootPath, not some
          // nested ingredient's) to an MPF-batch recipe resets its quantity
          // to exactly one run's worth, in crate mode — MPF only ever
          // produces crate_output crates at a time, so whatever quantity
          // was set for the previous recipe isn't meaningful anymore.
          if (path === rootPath) {
            const recipe = MATERIAL_RECIPES[optionCard.dataset.recipeKey];
            if (recipe && recipe.crate_output > 0) {
              entry.crateMode = true;
              entry.quantity = recipe.crate_output;
            }
          }
        }
      } else if (optionCard.dataset.poolItem) {
        // Purely a display choice for a gather step's own recipe preview —
        // never touches the left sidebar's totals themselves (see
        // poolItemRecipePreview in calc.js).
        state.poolRecipeChoice[optionCard.dataset.poolItem] = optionCard.dataset.recipeKey;
      }
      renderResults();
    }
  });

  // ---- Sidebar: LIQUIDS/RAW RESOURCES/POWER headers toggle their gather
  // rows out of the middle chain panel (see state.chainVisibility comment
  // and renderCombinedChain/renderRawPanel in render.js). The sidebar list
  // itself never changes — only the chain panel's rows react. ----
  document.getElementById('rawPanelWrap').addEventListener('click', (e) => {
    const section = e.target.closest('[data-chain-toggle]');
    if (!section) return;
    const kind = section.dataset.chainToggle;
    const isActiveNow = state.chainVisibility[kind] = !state.chainVisibility[kind];
    // Toggle the persisting DOM node directly instead of going through
    // renderResults(): that would replace this exact section (the one the
    // cursor is sitting on mid-click) with a fresh element, dropping its
    // continuous :hover state for a frame — a visible flicker — and
    // making the chevron/color change snap instead of transition. Same
    // reasoning as the ticket-collapse and recipe-detail toggles above.
    // The sidebar's own list never changes from this toggle, only the
    // middle chain panel's actual rows do, so that's the only real
    // re-render needed.
    const btn = section.querySelector('.raw-panel-section-toggle');
    if (btn) btn.classList.toggle('inactive', !isActiveNow);
    const trees = state.entries.map(entry => buildProductionChain(entry));
    updateChainPanel(renderCombinedChain(state.entries, trees, state.poolRecipeChoice, state.craftRecipesOpen, state.gatherRecipesOpen, state.chainVisibility));
  });

  // ---- Raw panel: scrolls in place once it reaches the bottom of the
  // viewport (see updateRawPanelHeight, defined near renderResults above,
  // which also calls it after every render). ----
  window.addEventListener('scroll', updateRawPanelHeight, { passive: true });
  window.addEventListener('resize', updateRawPanelHeight);

  // ---- Send the current combined chain to the Facility Planner: hand it
  // off via localStorage (the two pages share nothing else — no shared JS
  // state, no server) and navigate there. planner.js picks it up, lays it
  // out, and wires it on its own first render. ----
  document.getElementById('sendToPlannerBtn').addEventListener('click', () => {
    if (!state.entries.length) return;
    const trees = state.entries.map(entry => buildProductionChain(entry));
    const exportData = buildPlannerExport(trees, state.poolRecipeChoice);
    try {
      localStorage.setItem('foxholePlannerImport.v1', JSON.stringify(exportData));
    } catch (e) {
      alert('Could not hand this chain off to the planner (local storage may be full or disabled).');
      return;
    }
    window.location.href = 'planner.html';
  });

  renderResults();
}

// ============================================================
// BOOT
// ============================================================

// Transient network hiccups on first load (slow/cold connection, a brief
// blip fetching manifest.json) can fail loadData() even though a retry a
// moment later would succeed — and since every bit of the search bar's
// interactivity (typing, the dropdown) only gets wired up once loadData()
// resolves and initApp() runs, a single failed load otherwise leaves the
// search box looking completely normal while being silently dead (no
// listeners ever attached, nothing visibly wrong near the search bar
// itself). Retry a couple of times before giving up, and if it still
// fails, make the search bar itself visibly broken instead of silently
// inert.
async function bootWithRetry(retriesLeft = 2) {
  try {
    await loadData();
    initApp();
  } catch (err) {
    if (retriesLeft > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return bootWithRetry(retriesLeft - 1);
    }
    console.error('Failed to load data:', err);
    document.getElementById('results').innerHTML =
      `<div class="empty-state">— FAILED TO LOAD DATA —<br>${err.message}<br><br>if you opened this file directly (file://), your browser is blocking local JSON fetches.<br>run a local server instead — see README.md</div>`;
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.disabled = true;
      searchInput.placeholder = 'DATA FAILED TO LOAD — REFRESH THE PAGE';
    }
  }
}

bootWithRetry();
