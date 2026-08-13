// ============================================================
// TICKET RENDERING
// ============================================================

// "heavy_bomber" -> "Heavy Bomber" — the data's own snake_case type/class
// tags, turned into the Title Case text actually shown to the player.
function titleCaseFromSnake(str) {
  return str.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// The ticket subtitle: the classification tier directly above the item's
// own name in the data hierarchy (category > subcategory > class > type >
// name) — its type if it has one ("motorcycle" -> Motorcycle, "heavy_bomber"
// -> Heavy Bomber), else its class ("Field Cannon"), else its subcategory.
function categoryLabel(obj) {
  if (!obj) return '';
  if (obj.type) return titleCaseFromSnake(obj.type);
  if (obj.class) return obj.class;
  if (obj.subcategory) return obj.subcategory;
  return '';
}

// Builds one aircraft's requisition ticket (right column): header with
// icon/qty stepper/crate toggle, its direct assembly materials + parts,
// and the direct-vs-cumulative craft time split. Mirrors
// renderMaterialTicket's shape closely — kept as its own function rather
// than a shared one because an aircraft has no MATERIAL_RECIPES entry to
// read facility/inputs/outputs off (see buildProductionChain's aircraft
// branch in calc.js), so nearly every line here reads from AIRCRAFT_COSTS
// instead.
function renderAircraftTicket(entry, cumulativeSeconds, queueCounts) {
  const { key, quantity, crateMode, collapsed } = entry;
  const aircraft = AIRCRAFT_COSTS[key];
  const { crateSize, effectiveQuantity } = resolveTicketQuantity(entry);
  // Matches whatever queue depth is set on this ticket's own root step in
  // the chain panel (see buildProductionChain's aircraft branch) — keeps
  // this reading in sync with CUMULATIVE CRAFT TIME below it, which
  // already reflects that same queue speedup via cumulativeSeconds.
  const queueCount = clampQueueCount((queueCounts && queueCounts[`aircraft:${key}`]) || 1, aircraft);
  const directSeconds = effectiveCraftingTime(aircraft, queueCount) * effectiveQuantity;

  const directInputs = {};
  for (const [m, a] of Object.entries(aircraft.assembly_materials)) directInputs[m] = (directInputs[m] || 0) + a * effectiveQuantity;
  for (const [p, a] of Object.entries(aircraft.aircraft_parts)) directInputs[p] = (directInputs[p] || 0) + a * effectiveQuantity;

  // Only items with a known crate size (and not Garage/Shipyard-built) get
  // a usable toggle — but it's always rendered in the DOM either way (just
  // hidden via visibility, not display) so the ticket's height doesn't
  // shift depending on which recipe happens to be active — switching a
  // recipe in the chain panel (e.g. Garage -> MPF) can change whether this
  // item has a crate size without the ticket itself resizing around it.
  const crateToggle = `<label class="crate-toggle ${crateSize ? '' : 'crate-toggle-hidden'}">
        <input type="checkbox" class="crate-toggle-input" ${crateMode ? 'checked' : ''} ${crateSize ? '' : 'disabled tabindex="-1"'}>
        <span class="crate-toggle-box"></span>
        <span class="crate-toggle-label">CRATES</span>
      </label>`;

  let html = `<div class="ticket ${collapsed ? 'collapsed' : ''}" data-kind="aircraft" data-key="${key}">`;
  html += `<div class="ticket-head">
    ${iconTag(aircraft.full_name, 'ticket-icon')}
    <div class="ticket-title-block">
      <div class="ticket-eyebrow">AIRCRAFT REQUISITION</div>
      <div class="ticket-title">${aircraft.full_name}</div>
      <div class="ticket-class">${categoryLabel(aircraft)}</div>
      ${crateToggle}
    </div>
    <div class="ticket-head-right">
      <div class="seal">COL<br>ARMY</div>
      <div class="ticket-qty-compact">
        <button class="qty-btn" data-action="dec">−</button>
        <input type="number" class="qty-val" value="${quantity}" min="0" step="1" inputmode="numeric">
        <button class="qty-btn" data-action="inc">+</button>
      </div>
    </div>
    <span class="ticket-caret" aria-hidden="true"></span>
  </div>`;

  html += `<div class="ticket-body-wrap"><div class="ticket-body">`;

  html += `<div class="facility-note">FACILITY: ${aircraft.facility || 'Unknown'}</div>`;

  html += `<div class="ticket-section"><div class="section-label parts">DIRECT INPUTS REQUIRED</div>${Object.entries(directInputs).map(([m,a]) => itemLine(a,m,facilityOfOutput(m))).join("")}</div>`;

  html += `<div class="time-row">
    <div class="time-block"><div class="time-label">DIRECT CRAFT TIME</div><div class="time-val">${fmtTime(directSeconds)}</div></div>
    <div class="time-block"><div class="time-label">CUMULATIVE CRAFT TIME</div><div class="time-val">${fmtTime(cumulativeSeconds)}</div></div>
    ${aircraft.power_mw ? `<div class="time-block"><div class="time-label">FACILITY POWER</div><div class="time-val">${aircraft.power_mw} MW</div></div>` : ''}
  </div>`;

  html += `</div></div>`;

  html += `</div>`;
  return html;
}

// entryKey identifies the ticket itself (stable — used for qty-stepper lookups
// and never changes). displayRecipeKey is whichever recipe is currently in
// effect at the root of the chain (entryKey's own recipe by default, or
// whatever the user picked for that root node in the chain panel) — facility,
// outputs, and direct time are read from that one.
function renderMaterialTicket(entry, displayRecipeKey, cumulativeSeconds, queueCounts) {
  const { key: entryKey, quantity, crateMode, collapsed } = entry;
  const recipe = MATERIAL_RECIPES[displayRecipeKey];
  const parent = findMultiRecipeParent(displayRecipeKey); // null for standalone single-recipe materials

  // Standalone materials carry their own full_name; recipes that belong to
  // a multi-recipe parent (Steel, Salvage, Sulfur...) don't, so fall back
  // to the parent item's name, then to the recipe's own name.
  const titleName = recipe.full_name || (parent && parent.itemData.full_name) || recipe.recipe_name;
  const subtitle = categoryLabel(parent ? parent.itemData : recipe);

  const outputName = Object.keys(recipe.outputs)[0];
  const outputPerBatch = recipe.outputs[outputName];

  // effectiveQuantity is already the real unit target — crate-mode's ×crateSize
  // conversion happened once, up front — so the same ceil(qty/outputPerBatch)
  // math covers MPF and non-MPF recipes alike, no special-casing needed.
  const { crateSize, effectiveQuantity } = resolveTicketQuantity(entry);
  const batches = Math.ceil(effectiveQuantity / outputPerBatch);

  const scaledOutputs = {};
  for (const [item, amt] of Object.entries(recipe.outputs)) scaledOutputs[item] = amt * batches;

  // Matches whatever queue depth is set on this ticket's own root step in
  // the chain panel (see buildNode) — keeps this reading in sync with
  // CUMULATIVE CRAFT TIME below it, which already reflects that same queue
  // speedup via cumulativeSeconds.
  const queueCount = clampQueueCount((queueCounts && queueCounts[recipe.recipeKey]) || 1, recipe);
  const directSeconds = effectiveCraftingTime(recipe, queueCount) * batches;

  // Only items with a known crate size (and not Garage/Shipyard-built) get
  // a usable toggle — but it's always rendered in the DOM either way (just
  // hidden via visibility, not display) so the ticket's height doesn't
  // shift depending on which recipe happens to be active — switching a
  // recipe in the chain panel (e.g. Garage -> MPF) can change whether this
  // item has a crate size without the ticket itself resizing around it.
  const crateToggle = `<label class="crate-toggle ${crateSize ? '' : 'crate-toggle-hidden'}">
        <input type="checkbox" class="crate-toggle-input" ${crateMode ? 'checked' : ''} ${crateSize ? '' : 'disabled tabindex="-1"'}>
        <span class="crate-toggle-box"></span>
        <span class="crate-toggle-label">CRATES</span>
      </label>`;

  let html = `<div class="ticket ${collapsed ? 'collapsed' : ''}" data-kind="material" data-key="${entryKey}">`;
  html += `<div class="ticket-head">
    ${iconTag(titleName, 'ticket-icon')}
    <div class="ticket-title-block">
      <div class="ticket-eyebrow">MATERIAL REQUISITION</div>
      <div class="ticket-title">${titleName}</div>
      <div class="ticket-class">${subtitle}</div>
      ${crateToggle}
    </div>
    <div class="ticket-head-right">
      <div class="seal">COL<br>ARMY</div>
      <div class="ticket-qty-compact">
        <button class="qty-btn" data-action="dec">−</button>
        <input type="number" class="qty-val" value="${quantity}" min="0" step="1" inputmode="numeric">
        <button class="qty-btn" data-action="inc">+</button>
      </div>
    </div>
    <span class="ticket-caret" aria-hidden="true"></span>
  </div>`;

  html += `<div class="ticket-body-wrap"><div class="ticket-body">`;

  html += `<div class="facility-note">FACILITY: ${recipe.facility || 'Unknown'}</div>`;

  const scaledInputs = {};
  for (const [item, amt] of Object.entries(recipe.inputs)) scaledInputs[item] = amt * batches;

  html += `<div class="ticket-section"><div class="section-label parts">DIRECT INPUTS REQUIRED</div>${Object.entries(scaledInputs).map(([m,a]) => itemLine(a,m,facilityOfOutput(m))).join("")}</div>`;

  html += `<div class="ticket-section"><div class="section-label">OUTPUTS PRODUCED</div>${Object.entries(scaledOutputs).map(([m,a]) => itemLine(a,m,recipe.facility)).join("")}</div>`;

  html += `<div class="time-row">
    <div class="time-block"><div class="time-label">DIRECT CRAFT TIME</div><div class="time-val">${fmtTime(directSeconds)}</div></div>
    <div class="time-block"><div class="time-label">CUMULATIVE CRAFT TIME</div><div class="time-val">${fmtTime(cumulativeSeconds)}</div></div>
    ${recipe.power_mw ? `<div class="time-block"><div class="time-label">FACILITY POWER</div><div class="time-val">${recipe.power_mw} MW</div></div>` : ''}
  </div>`;

  html += `</div></div>`;

  html += `</div>`;
  return html;
}

// ============================================================
// PRODUCTION CHAIN RENDERING (middle panel)
// One numbered step per row, read straight down like a checklist: gather
// the raw resources first, then each crafting stage in order, ending with
// the direct inputs for the requested ticket(s) as the last step(s) at the
// bottom. Every step is a single facility/recipe conversion — inputs,
// arrow, outputs, nothing implied or left for the reader to multiply out.
// Any step with more than one possible recipe gets a select scoped to that
// exact node's path (data-path), so choosing a recipe for one occurrence
// of an item never affects another occurrence elsewhere in the chain.
// ============================================================

// Matches an item's text color to whichever step type it belongs to —
// blue for liquids, brown for the base raw resources, yellow for power,
// green for everything else — same split used for the step-number
// badges (poolKindOf is defined in calc.js).
function stepColorClass(name) {
  const kind = poolKindOf(name);
  if (kind === 'liquid') return 'step-color-liquid';
  if (kind === 'resource') return 'step-color-resource';
  if (kind === 'power') return 'step-color-power';
  return 'step-color-craft';
}

// One item's icon-forward "chip": icon in a category-colored frame with a
// text caption underneath (a quantity or rate, plus the name) so it's
// still fully readable, not icon-only. The shared shape behind both
// stepIconChip (a total-for-the-order quantity) and stepRateChip (a live
// per-minute/hour throughput figure) below — captionText is already fully
// formatted by the caller, this only ever lays it out. Shared by both
// inputs and outputs — position decides the styling, not the item itself:
// every NEEDS-side chip is dashed, every YIELDS-side chip is solid (plus
// `large`, the output's own headline treatment), so the same item (e.g.
// Petrol (L)) reads dashed when it's being consumed and solid when it's
// what a step produces, with no exceptions either way.
function iconChipHtml(name, captionText, { dashed = false, large = false, colorClass } = {}) {
  return `<div class="step-icon-chip ${large ? 'step-icon-chip-lg' : ''} ${dashed ? 'step-icon-dashed' : ''} ${colorClass || stepColorClass(name)}">
    <div class="step-icon-frame">
      ${iconTag(name, 'step-icon-img')}
    </div>
    <div class="step-icon-caption">
      <span class="step-icon-qty">${captionText}</span>
      <span class="step-icon-name">${name}</span>
    </div>
  </div>`;
}

// facility here is whatever produced THIS item elsewhere in the chain (the
// child node's own facility) — a Battering Ram fed into another step still
// shows plain, not crated, if it was itself built at a Garage.
function stepIconChip(name, qty, facility, opts) { return iconChipHtml(name, fmtQty(name, qty, facility), opts); }
function stepNeedItem(name, qty, facility) { return stepIconChip(name, qty, facility, { dashed: true }); }
function stepOutputItem(name, qty, facility, colorClass) { return stepIconChip(name, qty, facility, { large: true, colorClass }); }

// Used by a step row's live NEEDS/YIELDS once a queue count is in play
// (see renderCraftRow/renderGatherRow), where "how fast" matters more than
// "how many total."
function stepRateChip(name, rateText, opts) { return iconChipHtml(name, rateText, opts); }
function stepNeedRate(name, rateText) { return stepRateChip(name, rateText, { dashed: true }); }
function stepOutputRate(name, rateText, colorClass) { return stepRateChip(name, rateText, { large: true, colorClass }); }

// The queue stepper that replaces a step's old "×N RUNS" + time block — 1
// to maxQueues (see maxQueuesForRecipe in calc.js), scaling that recipe's
// effective craft time (and so its YIELDS-side rate) up to maxQueues×
// faster. A recipe capped at 1 (power generation) has nothing to step
// between, so it gets a plain static readout instead of dead +/- buttons.
function stepQueueStepperHtml(queueKey, queueCount, maxQueues) {
  if (!queueKey) return '';
  if (maxQueues <= 1) {
    return `<div class="step-queue-stepper step-queue-static" title="This facility can't run parallel queues">
      <span class="step-queue-label">QUEUE</span>
      <span class="step-queue-val">1</span>
    </div>`;
  }
  return `<div class="step-queue-stepper" data-recipe-key="${queueKey}" data-max-queues="${maxQueues}" title="Parallel production queues (1-${maxQueues})">
    <span class="step-queue-label">QUEUES</span>
    <button class="step-queue-btn" data-action="queue-dec" title="One fewer queue">−</button>
    <input type="number" class="qty-val step-queue-val-input" value="${queueCount}" min="1" max="${maxQueues}" step="1" inputmode="numeric">
    <button class="step-queue-btn" data-action="queue-inc" title="One more queue">+</button>
  </div>`;
}

// One selectable recipe option inside a "CHOOSE RECIPE" picker — a full
// preview (facility, batch count, time, and its own inputs -> output flow,
// built from the same icon chips as a real step) instead of a bare text
// label, so the user can see what a recipe actually entails before picking
// it. Clicking anywhere on the card selects it (see the
// .recipe-option-card click handler in app.js). extraDataAttrs carries
// whatever the caller needs to route that click back to the right
// entry/node (a real chain override) or pooled-item preview choice.
// Deliberately still the old "×N RUNS + time" format (via stepIconChip),
// not the live per-minute/hour rate chips renderCraftRow/renderGatherRow
// show on the row itself — this card's job is comparing whole ALTERNATIVE
// recipes for the order as a whole ("if I switched to this, here's the
// total run count and inputs"), not showing a queue-scaled live rate for
// whichever recipe happens to already be active. Reused as-is by the
// Facility Planner's own recipe picker (openRecipePicker in planner.js),
// which has no queue/rate concept of its own to match anyway.
function renderRecipeOptionCard(preview, isActive, extraDataAttrs) {
  const inputsHtml = preview.inputs.length
    ? preview.inputs.map(inp => stepNeedItem(inp.name, inp.qty, inp.facility)).join('')
    : `<span class="step-io-empty">—</span>`;
  const outputsHtml = preview.outputs
    .map(o => stepOutputItem(o.name, o.qty, preview.facility))
    .join('<span class="step-output-plus">+</span>');

  return `<div class="recipe-option-card ${isActive ? 'active' : ''}" data-recipe-key="${preview.recipeKey}" ${extraDataAttrs}>
    <div class="recipe-option-head">
      <div class="step-facility-icon-wrap">${iconTag(preview.facility || '', 'step-facility-icon')}</div>
      <div class="recipe-option-label">${preview.label}</div>
      ${isActive ? `<span class="recipe-option-active-tag">ACTIVE</span>` : ''}
    </div>
    <div class="step-line-flow">
      <div class="step-flow-side step-flow-inputs">${inputsHtml}</div>
      <div class="step-flow-runs-time">
        <span class="step-flow-runs">×${fmtNum(preview.batches)} RUNS</span>
        <div class="step-time"><span class="step-clock-icon" aria-hidden="true"></span>${fmtTime(preview.craftSeconds)}</div>
      </div>
      <span class="step-flow-arrow" aria-hidden="true">&rarr;</span>
      <div class="step-flow-side step-flow-output">${outputsHtml}</div>
    </div>
  </div>`;
}

// A gather step: the facility that actually produces one pooled liquid, raw
// resource, or unit of power (Water Pump, Oil Refinery [Petrol], Stationary
// Harvester (Salvage), Power Station, ...) — one row per pooled item. The
// LIQUIDS/RAW/POWER totals themselves live in the left sidebar
// (renderRawPanel) now, not in the chain, so this is the only place left to
// see/choose the recipe behind them. Same NEEDS -> arrow -> YIELDS shape as
// a regular craft row (renderCraftRow), and purely informational (see
// poolItemRecipePreview in calc.js): picking a different recipe here never
// changes the sidebar's totals, only what this row shows. An item with no
// recipe at all (Rare Metal, gathered by hand) still gets a row — NEEDS
// reads empty and there's no facility/RECIPES toggle, same treatment as an
// Oil Well's own empty-inputs recipe.
function renderGatherRow(num, itemName, totalQty, preview, isOpen) {
  // NEEDS and YIELDS both scale with the current queue count — running N
  // queues is exactly like running N copies of this recipe's facility (see
  // poolItemRecipePreview in calc.js). An item with no recipe at all (Rare
  // Metal — gathered by hand, no craft-time basis for a rate) falls back to
  // its old plain total-quantity display instead.
  const hasRecipe = !!preview.recipeKey;
  const inputsHtml = preview.inputs.length
    ? preview.inputs.map(inp => stepNeedRate(inp.name, fmtItemRate(inp.name, inp.rate))).join('')
    : `<span class="step-io-empty">—</span>`;
  const outputHtml = preview.outputs
    .map(o => hasRecipe ? stepOutputRate(o.name, fmtItemRate(o.name, o.rate)) : stepOutputItem(o.name, o.qty, preview.facility))
    .join('<span class="step-output-plus">+</span>');

  const yieldToggleAttrs = preview.isMultiRecipe ? `data-gather-toggle="${itemName}"` : '';
  const yieldToggleClass = preview.isMultiRecipe ? `step-yield-toggle ${isOpen ? 'open' : ''}` : 'step-yield-static';
  const yieldIndicator = preview.isMultiRecipe
    ? `<span class="step-yield-status"><span class="step-yield-recipe-label">RECIPES</span><span class="step-yield-indicator step-yield-indicator-toggle" aria-hidden="true"></span></span>`
    : `<span class="step-yield-status"><span class="step-yield-indicator step-yield-indicator-static" aria-hidden="true" title="No alternate recipes"></span></span>`;

  // Always rendered when multi-recipe (not just when open) — same reasoning
  // as renderCraftRow's recipeDetail: a CSS collapse animation needs a
  // persisting "before" state to animate from.
  const recipeDetail = preview.isMultiRecipe
    ? `<div class="step-recipe-detail-wrap ${isOpen ? 'open' : ''}">
        <div class="step-recipe-detail">
          <span class="step-choice-label">CHOOSE RECIPE</span>
          <div class="recipe-option-list">${recipeAlternativePreviews(itemName, totalQty).map(p =>
            renderRecipeOptionCard(p, p.recipeKey === preview.recipeKey, `data-pool-item="${itemName}"`)
          ).join('')}</div>
        </div>
      </div>`
    : '';

  const kind = poolKindOf(itemName);
  const numClass = kind === 'liquid' ? 'step-num-liquid' : kind === 'power' ? 'step-num-power' : 'step-num-resource';

  // A stable identity independent of this row's number (which shifts
  // whenever anything above it is added/removed) — lets updateChainPanel
  // in app.js tell a genuinely new/removed row apart from one that just
  // moved position, so only real adds/removes get the enter/exit
  // animation instead of every row replaying it on every render.
  return `<div class="step-row" data-row-key="gather:${itemName}">
    <div class="step-num ${numClass}">${num}</div>
    <div class="step-body">
      <div class="step-head ${yieldToggleClass}" ${yieldToggleAttrs}>
        <div class="step-line-facility">
          <div class="step-facility-icon-wrap">${iconTag(preview.facility || '', 'step-facility-icon')}</div>
          <div class="step-facility-text">
            <div class="step-facility-inline">${preview.facility || 'GATHER'}</div>
          </div>
        </div>
        <div class="step-line-flow">
          <div class="step-flow-side step-flow-inputs">
            <span class="step-needs-label">NEEDS</span>
            ${inputsHtml}
          </div>
          ${stepQueueStepperHtml(preview.queueKey, preview.queueCount, preview.maxQueues)}
          <span class="step-flow-arrow" aria-hidden="true">&rarr;</span>
          <div class="step-flow-side step-flow-output">
            <span class="step-yields-label">YIELDS</span>
            ${outputHtml}
            ${yieldIndicator}
          </div>
        </div>
      </div>
      ${recipeDetail}
    </div>
  </div>`;
}

// isOpen: whether this step's "view/choose recipe" detail is currently
// expanded (state.craftRecipesOpen, keyed by item name — see app.js).
function renderCraftRow(num, node, isOpen) {
  // Running N queues is exactly like running N copies of this recipe's
  // facility — NEEDS scales right alongside YIELDS, both against the
  // CURRENT queue count (see buildNode in calc.js). Facility Power is the
  // one exception: it isn't part of recipeInputs (it's pushed as a
  // separate implicit child — see buildNode's power_mw handling) and is a
  // flat steady-state MW draw to the physical building, not a per-batch
  // quantity that multiplies with more queues — one shared power
  // connection regardless of how many queues run through it — so it's
  // read off that child instead of run through the rate math.
  const powerChild = node.children.find(c => c.itemName === 'Facility Power');
  const materialInputsHtml = Object.entries(node.recipeInputs || {}).map(([name, perBatchQty]) => {
    const rate = node.craftSecondsPerBatch > 0 ? perBatchQty / node.craftSecondsPerBatch * 60 : 0;
    return stepNeedRate(name, fmtItemRate(name, rate));
  }).join('');
  const powerInputHtml = powerChild ? stepNeedRate('Facility Power', fmtItemRate('Facility Power', powerChild.quantity)) : '';
  const inputsHtml = node.children.length ? (materialInputsHtml + powerInputHtml) : `<span class="step-io-empty">—</span>`;

  // YIELDS scales the same way — the DIRECT INPUT step's
  // own requested item (not any byproduct it also happens to produce) gets
  // the "final product" color instead of blending into the same green as
  // every other crafted intermediate.
  const outputHtml = Object.entries(node.recipeOutputs)
    .map(([name, perBatchQty]) => {
      const rate = node.craftSecondsPerBatch > 0 ? perBatchQty / node.craftSecondsPerBatch * 60 : 0;
      return stepOutputRate(name, fmtItemRate(name, rate), node.isDirect && name === node.itemName ? 'step-color-final' : undefined);
    })
    .join('<span class="step-output-plus">+</span>');

  // The whole YIELDS tray doubles as the recipe-picker toggle — no separate
  // button. A step with more than one possible recipe gets the interactive
  // treatment (clickable, chevron indicator); a single-recipe step still
  // shows a small dot in its place so it's clear at a glance there's
  // nothing to pick between, rather than just silently not reacting to a
  // click.
  const yieldToggleAttrs = node.isMultiRecipe
    ? `data-recipe-toggle="${node.itemName}"`
    : '';
  const yieldToggleClass = node.isMultiRecipe ? `step-yield-toggle ${isOpen ? 'open' : ''}` : 'step-yield-static';
  const yieldIndicator = node.isMultiRecipe
    ? `<span class="step-yield-status"><span class="step-yield-recipe-label">RECIPES</span><span class="step-yield-indicator step-yield-indicator-toggle" aria-hidden="true"></span></span>`
    : `<span class="step-yield-status"><span class="step-yield-indicator step-yield-indicator-static" aria-hidden="true" title="No alternate recipes"></span></span>`;
  // The true recipe-agnostic total demand for node.itemName (see
  // buildChainSteps) — NOT reconstructed from the active recipe's own
  // batches * output-per-batch, which over-produces whenever that recipe's
  // batch size doesn't evenly divide the amount actually needed (e.g. a
  // 9-crate MPF run for a demand of 40 rounds up to 360) and would wrongly
  // inflate every other alternative's preview to match that overproduction.
  const totalUnitsNeeded = node.quantity;
  // Always rendered when multi-recipe (not just when open) so the collapse/
  // expand can animate smoothly — see the matching note in renderGatherRow.
  const recipeDetail = node.isMultiRecipe
    ? `<div class="step-recipe-detail-wrap ${isOpen ? 'open' : ''}">
        <div class="step-recipe-detail">
          <span class="step-choice-label">CHOOSE RECIPE</span>
          <div class="recipe-option-list">${recipeAlternativePreviews(node.itemName, totalUnitsNeeded).map(p =>
            renderRecipeOptionCard(p, p.recipeKey === node.recipeKey, `data-paths="${node.paths.join('|')}"`)
          ).join('')}</div>
        </div>
      </div>`
    : '';

  // Only reachable for a pooled item (raw resource/power) when it was
  // requested directly as its own ticket (root) — nested occurrences never
  // get here, they're truncated straight into the pooled step instead.
  const poolBadgeClass = isRawResourceName(node.itemName) ? 'step-num-resource'
    : node.itemName === 'Facility Power' ? 'step-num-power'
    : '';

  // Same stable-identity reasoning as renderGatherRow's data-row-key —
  // recipeKey when this step has one, else the first merged occurrence's
  // own path (matches buildChainSteps' own groupKey fallback exactly).
  const rowKey = node.recipeKey || node.paths[0];

  return `<div class="step-row ${node.isDirect ? 'step-row-direct' : ''}" data-row-key="craft:${rowKey}">
    <div class="step-num ${poolBadgeClass}">${num}</div>
    <div class="step-body">
      <div class="step-head ${yieldToggleClass}" ${yieldToggleAttrs}>
        <div class="step-line-facility">
          <div class="step-facility-icon-wrap">${iconTag(node.facility || '', 'step-facility-icon')}</div>
          <div class="step-facility-text">
            ${node.isDirect ? `<div class="step-direct-tag">DIRECT INPUT</div>` : ''}
            <div class="step-facility-inline">${node.facility || 'ASSEMBLE'}</div>
          </div>
        </div>
        <div class="step-line-flow">
          <div class="step-flow-side step-flow-inputs">
            <span class="step-needs-label">NEEDS</span>
            ${inputsHtml}
          </div>
          ${stepQueueStepperHtml(node.queueKey, node.queueCount, node.maxQueues)}
          <span class="step-flow-arrow" aria-hidden="true">&rarr;</span>
          <div class="step-flow-side step-flow-output">
            <span class="step-yields-label">YIELDS</span>
            ${outputHtml}
            ${yieldIndicator}
          </div>
        </div>
      </div>
      ${recipeDetail}
    </div>
  </div>`;
}

// A compact, always-visible shopping list for the three pooled totals —
// liquids, raw resources, and power — the exact amount actually needed
// across the whole chain, not rounded up to whole batches the way the
// gather steps in the chain itself are (e.g. 2 Stationary Harvester runs
// yield 100 Salvage, but only 60 of that is actually spent downstream, so
// this list still reads 60). Lives in the left sidebar so it's visible
// without scrolling through the whole chain to find it.
// No facility passed to fmtQty here, unlike itemLine/stepIconChip's own
// calls — item.qty is a POOLED total that can legitimately come from
// several different gather recipes/facilities across the chain at once
// (see aggregateRawResources), so there's no single correct facility to
// pass; fmtQty's Garage/Shipyard-uncrated exception just never applies to
// this list as a result, which is fine since none of these three pools are
// ever Garage/Shipyard output anyway.
function rawPanelRow(item) {
  return `<div class="raw-panel-row">
    ${iconTag(item.name, 'raw-panel-icon')}
    <span class="raw-panel-name ${stepColorClass(item.name)}">${item.name}</span>
    <span class="raw-panel-qty">${fmtQty(item.name, item.qty)}</span>
  </div>`;
}

// LIQUIDS/RAW RESOURCES/POWER each double as a toggle: click the header to
// drop that category's gather rows out of the middle production chain
// (see renderCombinedChain) without ever touching this sidebar list
// itself — the totals here always stay fully visible/accurate regardless
// of the toggle, only the chain's own rows are what get hidden. MATERIALS
// CONSUMED below has no toggle at all — plain, non-interactive title.
function renderRawPanel(liquids, resources, power, chainVisibility) {
  if (!liquids.length && !resources.length && !power.length) return `<div class="empty-state">— NONE NEEDED —</div>`;
  const section = (label, items, toggleKind) => {
    if (!items.length) return '';
    const titleHtml = toggleKind
      ? `<button type="button" class="raw-panel-section-title raw-panel-section-toggle ${chainVisibility[toggleKind] ? '' : 'inactive'}">
          <span class="raw-panel-toggle-chevron" aria-hidden="true"></span>${label}
        </button>`
      : `<div class="raw-panel-section-title">${label}</div>`;
    // data-chain-toggle lives on the whole section wrapper, not just the
    // header button, so the click/hover hitbox covers the entire shaded
    // area (header + every row under it), not just the label text.
    const toggleAttr = toggleKind ? ` data-chain-toggle="${toggleKind}"` : '';
    return `<div class="raw-panel-section"${toggleAttr}>
      ${titleHtml}
      <div class="raw-panel-list">${items.map(rawPanelRow).join('')}</div>
    </div>`;
  };
  return section('LIQUIDS', liquids, 'liquid') + section('RAW RESOURCES', resources, 'resource') + section('POWER', power, 'power');
}

// A running ledger of every CRAFTED/intermediate material actually spent
// across the whole chain (see tallyConsumedMaterials in calc.js) — Basic
// Materials, Refined Materials, Steel, whatever else gets produced by one
// step and eaten by another. Same row shape as the raw panel above it, just
// a second list underneath so the sidebar covers everything consumed, not
// only the raw/liquid/power tier.
function renderConsumedPanel(items) {
  if (!items.length) return `<div class="empty-state">— NONE YET —</div>`;
  return `<div class="raw-panel-list">${items.map(rawPanelRow).join('')}</div>`;
}

// entries/trees are parallel arrays (trees[i] is the production chain for
// entries[i]). All selected outputs share one flattened, merged step list —
// a step needed by two different outputs shows up once with its run count
// summed, instead of being duplicated per output.
function renderCombinedChain(entries, trees, poolRecipeChoice, craftRecipesOpen, gatherRecipesOpen, chainVisibility, queueCounts) {
  const { liquids, resources, power } = aggregateRawResources(trees);
  const expandedGather = expandGatherChain(liquids, resources, power, poolRecipeChoice);
  const craftSteps = buildChainSteps(trees);

  const outputsHtml = entries.map((entry, i) =>
    `<span class="chain-output-chip">${trees[i].itemName} <span class="chain-output-qty">×${entry.quantity}</span></span>`
  ).join('');

  // Same scope as each ticket's own "CUMULATIVE CRAFT TIME" (see
  // renderMaterialTicket/renderAircraftTicket) — every real crafting step,
  // not the raw-gathering steps above them (Oil Well/Water Pump/Harvester
  // runs, which never carry a totalSeconds contribution either) — just
  // summed once across ALL selected tickets combined instead of one.
  // craftSteps is already the deduped/merged list (see buildChainSteps),
  // so a recipe shared by two different tickets contributes its combined
  // (larger) batch time exactly once here, not double-counted the way
  // naively summing each tree's own totalSeconds would.
  const totalCraftSeconds = craftSteps.reduce((sum, s) => sum + s.craftSeconds, 0);

  // Fixed order: the facilities that actually generate the liquids/raw
  // resources/power — expanded all the way down (Oil Well feeding the
  // Petrol that feeds a Harvester, not just the first tier — see
  // expandGatherChain), most-primitive first — then the real
  // crafting/refining/assembly steps. The LIQUIDS/RAW/POWER totals
  // themselves live in the left sidebar now (see renderRawPanel), not as
  // their own chain rows. Items with no recipe of their own (Rare Metal —
  // gathered by hand) still get a row, reading NEEDS nothing / YIELDS the
  // total, same as an Oil Well's empty-inputs recipe does.
  // LIQUIDS/RAW RESOURCES/POWER can each be toggled out of the chain via
  // the sidebar header (see renderRawPanel) — filtered here, at the very
  // last step before rendering, so it never touches expandGatherChain's
  // own totals (which the sidebar reads separately and always shows in
  // full, regardless of this toggle) or anything a craft row's own NEEDS
  // side still legitimately shows consuming.
  const visibleGatherItems = expandedGather.items.filter(it => {
    const kind = poolKindOf(it.name);
    if (kind === 'liquid') return chainVisibility.liquid;
    if (kind === 'resource') return chainVisibility.resource;
    if (kind === 'power') return chainVisibility.power;
    return true;
  });
  let stepNum = 0;
  const gatherRowsHtml = visibleGatherItems.map(it => {
    const preview = poolItemRecipePreview(it.name, it.qty, poolRecipeChoice[it.name], queueCounts);
    return renderGatherRow(++stepNum, it.name, it.qty, preview, gatherRecipesOpen[it.name]);
  }).join('');
  const rowsHtml =
    gatherRowsHtml +
    craftSteps.map(s => renderCraftRow(++stepNum, s, craftRecipesOpen[s.itemName])).join('');

  const legend = `<div class="chain-legend">
    <span class="chain-legend-item"><span class="chain-legend-swatch chain-legend-swatch-dashed"></span>CONSUMED</span>
    <span class="chain-legend-item"><span class="chain-legend-swatch chain-legend-swatch-solid"></span>PRODUCED</span>
    <span class="chain-legend-divider" aria-hidden="true"></span>
    <span class="chain-legend-item"><span class="chain-legend-swatch chain-legend-color-liquid"></span>LIQUID</span>
    <span class="chain-legend-item"><span class="chain-legend-swatch chain-legend-color-resource"></span>RESOURCE</span>
    <span class="chain-legend-item"><span class="chain-legend-swatch chain-legend-color-power"></span>POWER</span>
    <span class="chain-legend-item"><span class="chain-legend-swatch chain-legend-color-craft"></span>CRAFTED</span>
    <span class="chain-legend-item"><span class="chain-legend-swatch chain-legend-color-final"></span>FINAL PRODUCT</span>
  </div>`;

  return `<div class="chain-card">
    <div class="chain-card-title"><span>COMBINED PRODUCTION CHAIN</span>${legend}</div>
    <div class="chain-outputs-row">${outputsHtml}<span class="chain-total-time"><span class="step-clock-icon" aria-hidden="true"></span>TOTAL CRAFT TIME ${fmtTime(totalCraftSeconds)}</span></div>
    <div class="step-list">${rowsHtml}</div>
  </div>`;
}
