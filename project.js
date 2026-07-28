(function () {
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((k) => {
        if (k === "class") node.className = props[k];
        else if (k === "text") node.textContent = props[k];
        else if (k.indexOf("on") === 0 && typeof props[k] === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), props[k]);
        } else {
          node.setAttribute(k, props[k]);
        }
      });
    }
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  }

  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("id");
  const project = projectId ? Store.getProjectById(projectId) : null;

  const notFound = document.getElementById("notFound");
  const projectContent = document.getElementById("projectContent");

  if (!project) {
    notFound.hidden = false;
    return;
  }
  projectContent.hidden = false;

  // ---------- Tabs ----------
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
      tabPanels.forEach((p) => p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab));
    });
  });

  // ---------- Project details ----------
  const projectTitle = document.getElementById("projectTitle");
  const projectMeta = document.getElementById("projectMeta");
  const saveIndicator = document.getElementById("saveIndicator");
  const detailsForm = document.getElementById("detailsForm");
  const detailsFormError = document.getElementById("detailsFormError");
  const detailWbs = document.getElementById("detailWbs");
  const detailEwr = document.getElementById("detailEwr");
  const detailName = document.getElementById("detailName");
  const detailStatus = document.getElementById("detailStatus");
  const detailDateCreated = document.getElementById("detailDateCreated");

  function populateDetailsForm() {
    detailWbs.value = project.wbs;
    detailEwr.value = project.ewr;
    detailName.value = project.name;
    detailStatus.value = project.status;
    detailDateCreated.value = project.dateCreated;
    projectTitle.textContent = project.name;
    projectMeta.textContent = "WBS " + project.wbs + " · EWR " + project.ewr;
    document.title = project.name + " — Project Detail";
  }

  let saveIndicatorTimer = null;
  function flashSaveIndicator() {
    saveIndicator.classList.add("visible");
    clearTimeout(saveIndicatorTimer);
    saveIndicatorTimer = setTimeout(() => saveIndicator.classList.remove("visible"), 1800);
  }

  detailsForm.addEventListener("submit", (e) => {
    e.preventDefault();
    detailsFormError.hidden = true;

    if (!detailsForm.checkValidity()) {
      detailsForm.reportValidity();
      return;
    }

    const wbs = detailWbs.value.trim();
    const ewr = detailEwr.value.trim();
    const name = detailName.value.trim();
    const status = detailStatus.value;
    const dateCreated = detailDateCreated.value;

    const duplicate = Store.getProjects().some(
      (p) => p.id !== project.id && p.wbs.toLowerCase() === wbs.toLowerCase()
    );
    if (duplicate) {
      detailsFormError.textContent = "A project with WBS \"" + wbs + "\" already exists.";
      detailsFormError.hidden = false;
      return;
    }

    Object.assign(project, { wbs, ewr, name, status, dateCreated });
    Store.updateProject(project.id, { wbs, ewr, name, status, dateCreated });
    populateDetailsForm();
    flashSaveIndicator();
  });

  // ---------- BOM state ----------
  let tree = Store.getBom(project.id);
  let statusOptions = Store.getStatusOptions();
  let customFields = Store.getCustomFields();
  let orders = Store.getOrders(project.id);
  let currentView = "tree";
  const collapsed = new Set();
  let searchQuery = "";
  // When set, Tree view shows only this assembly and its descendants
  // (siblings/parents hidden). Cleared with the banner button or Esc.
  let assemblyFilterGuid = null;
  const flatSortState = { key: "partNumber", dir: "asc" };
  const flatColumnFilters = {};

  const BASE_COLUMNS = [
    { key: "itemNo", label: "Item No", type: "computed" },
    { key: "assy", label: "Assy", type: "checkbox" },
    { key: "includedInParent", label: "Included in Parent", type: "checkbox" },
    { key: "partNumber", label: "3M Part Number", type: "text" },
    { key: "qty", label: "Qty", type: "number" },
    { key: "spare", label: "Spare", type: "number" },
    { key: "manufacturer", label: "Manufacturer", type: "text" },
    { key: "commercialPartNo", label: "Commercial Part No", type: "text" },
    { key: "supplied3M", label: "3M Supplied", type: "checkbox" },
    { key: "description", label: "Description", type: "text" },
    { key: "rfx", label: "RFx", type: "order-lookup", orderField: "rfx" },
    // PO is never typed in — it's read from the Orders row matching this
    // line's RFx. See lookupPoForRfx.
    { key: "po", label: "PO", type: "derived-po" },
    { key: "status", label: "Status", type: "status-choice" },
    { key: "notes", label: "Notes", type: "text" },
  ];

  const FLAT_COLUMNS = [
    { key: "partNumber", label: "3M Part Number", type: "text" },
    { key: "description", label: "Description", type: "text" },
    { key: "manufacturer", label: "Manufacturer", type: "text" },
    { key: "commercialPartNo", label: "Commercial Part No", type: "text" },
    { key: "supplied3M", label: "3M Supplied", type: "checkbox" },
    { key: "totalQty", label: "Total Qty", type: "number" },
    { key: "occurrences", label: "Occurrences", type: "number" },
  ];

  // Tree columns that can additionally be pulled into the flat/grouped views.
  // (partNumber/description/manufacturer/commercialPartNo/supplied3M/qty are
  // already represented above, so they're excluded here. Each grouped view
  // additionally excludes its own grouping field, since that's implied by
  // the group header instead of being a per-row column. Item No is excluded
  // everywhere outside Tree View since it's derived from tree position — a
  // single aggregated row can span several tree positions, so it has no one
  // meaningful item number. Included in Parent is excluded too: any row that
  // reaches these views already has it false by construction — see
  // collectFlatNodes — so the column would just always read blank.)
  // ("spare" is excluded because it's already rolled into Total Qty.)
  const FLAT_EXCLUDED_KEYS = [
    "partNumber", "description", "manufacturer", "commercialPartNo", "supplied3M", "qty", "itemNo",
    "includedInParent", "spare",
  ];
  const flatExtraColumns = [];

  // Tree View column visibility (session-scoped; see the Columns menu).
  const hiddenTreeColumns = new Set();

  // "Grouped" views (PO, RFx, ...) all share the same shape: aggregate BOM
  // lines by part number within buckets of a chosen field, with a
  // collapsible header row per bucket. Add a new one here to add a new view.
  function makeGroupedViewState(field, label, emptyLabel) {
    return {
      field: field,
      label: label,
      emptyLabel: emptyLabel,
      excludedKeys: FLAT_EXCLUDED_KEYS.concat([field]),
      extraColumns: [],
      colWidths: { __toggle__: TOGGLE_COL_WIDTH },
      collapsed: new Set(),
      sortState: { key: "partNumber", dir: "asc" },
      columnFilters: {},
      groupFilter: "",
      poFilter: "", // RFx View only — narrows to lines whose derived PO matches
    };
  }

  // ---------- Column widths (resizable grid) ----------
  const MIN_COL_WIDTH = 44;
  const TOGGLE_COL_WIDTH = 34;
  const TREE_INDENT = 18; // px of indentation per tree depth level
  const TOGGLE_BTN_SPACE = 32; // room for the toggle button itself + padding
  const DEFAULT_COL_WIDTHS = {
    itemNo: 70, assy: 55, includedInParent: 90, partNumber: 150, manufacturer: 130, commercialPartNo: 140,
    supplied3M: 60, description: 200, qty: 70, spare: 70, rfx: 110, po: 110, status: 120, notes: 160,
    totalQty: 100, occurrences: 110,
  };
  const TYPE_DEFAULT_WIDTH = {
    text: 130, number: 70, checkbox: 60, choice: 120, "status-choice": 120, "order-lookup": 110,
    "derived-po": 110,
  };

  function getDefaultColWidth(col) {
    if (DEFAULT_COL_WIDTHS[col.key] !== undefined) return DEFAULT_COL_WIDTHS[col.key];
    return TYPE_DEFAULT_WIDTH[col.type] || 130;
  }

  const treeColWidths = { __actions__: 70 };
  const flatColWidths = {};
  const groupedViews = {
    rfx: makeGroupedViewState("rfx", "RFx", "(No RFx)"),
  };

  function renderColgroup(colgroupEl, colDefs) {
    colgroupEl.innerHTML = "";
    colDefs.forEach((cd) => {
      colgroupEl.appendChild(el("col", { style: "width:" + cd.width + "px" }));
    });
  }

  function attachColumnResize(th, colEl, widthsMap, key) {
    const handle = el("span", { class: "col-resize-handle" });
    handle.addEventListener("click", (e) => e.stopPropagation());
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = colEl.getBoundingClientRect().width;
      handle.classList.add("active");

      function onMove(ev) {
        const newWidth = Math.max(MIN_COL_WIDTH, Math.round(startWidth + (ev.clientX - startX)));
        colEl.style.width = newWidth + "px";
      }
      function onUp() {
        widthsMap[key] = parseInt(colEl.style.width, 10);
        handle.classList.remove("active");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    th.appendChild(handle);
  }

  function getAllColumns() {
    const custom = customFields.map((f) => ({
      key: "custom:" + f.key,
      label: f.label,
      type: f.type,
      options: f.options,
      custom: true,
      fieldKey: f.key,
    }));
    return BASE_COLUMNS.concat(custom);
  }

  // Columns with real, user-entered data — excludes derived/computed ones
  // (currently just Item No) that don't make sense to export as fill-in
  // fields or accept back in on import.
  function getEditableColumns() {
    return getAllColumns().filter((c) => c.type !== "computed");
  }

  function getAddableColumns(excludedKeys, extraList) {
    return getAllColumns()
      .filter((c) => excludedKeys.indexOf(c.key) === -1)
      .filter((c) => extraList.indexOf(c.key) === -1);
  }

  function getColumnsForView(extraList) {
    const allCols = getAllColumns();
    const extra = extraList
      .map((key) => allCols.find((c) => c.key === key))
      .filter(Boolean);
    return FLAT_COLUMNS.concat(extra);
  }

  function getFlatCellValue(row, colDef) {
    if (colDef.custom) return row.custom ? row.custom[colDef.fieldKey] : undefined;
    return row[colDef.key];
  }

  function getFlatCellText(row, colDef) {
    const raw = getFlatCellValue(row, colDef);
    if (colDef.type === "checkbox") return raw ? "X" : "";
    return raw == null ? "" : String(raw);
  }

  function makeNewNode() {
    return {
      guid: Store.makeId(),
      assy: false,
      includedInParent: false,
      partNumber: "",
      manufacturer: "",
      commercialPartNo: "",
      supplied3M: false,
      description: "",
      qty: 1,
      spare: 0,
      rfx: "",
      po: "",
      status: statusOptions[0] || "",
      notes: "",
      custom: {},
      children: [],
    };
  }

  function findContext(guid) {
    function search(nodes, parentNode) {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].guid === guid) {
          return { node: nodes[i], siblings: nodes, index: i, parent: parentNode };
        }
        if (nodes[i].children && nodes[i].children.length) {
          const r = search(nodes[i].children, nodes[i]);
          if (r) return r;
        }
      }
      return null;
    }
    return search(tree, null);
  }

  // Item No is derived from tree position, not user-entered: 1, 2, 2.1,
  // 2.2, 2.2.1, etc. Recomputed on every render so it always matches the
  // current structure, including after add/delete/indent/outdent.
  function computeItemNumbers(nodes, prefix, map) {
    nodes.forEach((n, idx) => {
      const num = prefix ? prefix + "." + (idx + 1) : String(idx + 1);
      map.set(n.guid, num);
      if (n.children && n.children.length) computeItemNumbers(n.children, num, map);
    });
    return map;
  }

  function persistAndRender() {
    Store.saveBom(project.id, tree);
    renderBom();
  }

  function addChild(guid) {
    const newNode = makeNewNode();
    if (!guid) {
      tree.push(newNode);
    } else {
      const ctx = findContext(guid);
      if (!ctx) return;
      ctx.node.children = ctx.node.children || [];
      ctx.node.children.push(newNode);
      ctx.node.assy = true;
      collapsed.delete(ctx.node.guid);
    }
    persistAndRender();
  }

  function addSibling(guid) {
    const ctx = findContext(guid);
    if (!ctx) return;
    ctx.siblings.splice(ctx.index + 1, 0, makeNewNode());
    persistAndRender();
  }

  function addSiblingAbove(guid) {
    const ctx = findContext(guid);
    if (!ctx) return;
    ctx.siblings.splice(ctx.index, 0, makeNewNode());
    persistAndRender();
  }

  function deleteNode(guid) {
    const ctx = findContext(guid);
    if (!ctx) return;
    const hasChildren = ctx.node.children && ctx.node.children.length > 0;
    const msg = hasChildren ? "Delete this item and all its sub-items?" : "Delete this item?";
    if (!window.confirm(msg)) return;
    ctx.siblings.splice(ctx.index, 1);
    persistAndRender();
  }

  function indentNode(guid) {
    const ctx = findContext(guid);
    if (!ctx || ctx.index === 0) return;
    const prevSibling = ctx.siblings[ctx.index - 1];
    ctx.siblings.splice(ctx.index, 1);
    prevSibling.children = prevSibling.children || [];
    prevSibling.children.push(ctx.node);
    prevSibling.assy = true;
    collapsed.delete(prevSibling.guid);
    persistAndRender();
  }

  function outdentNode(guid) {
    const ctx = findContext(guid);
    if (!ctx || !ctx.parent) return;
    const grandCtx = findContext(ctx.parent.guid);
    if (!grandCtx) return;
    ctx.siblings.splice(ctx.index, 1);
    grandCtx.siblings.splice(grandCtx.index + 1, 0, ctx.node);
    persistAndRender();
  }

  function setNodeValue(node, col, value, trEl) {
    if (col.custom) {
      node.custom = node.custom || {};
      node.custom[col.fieldKey] = value;
    } else {
      node[col.key] = value;
      if (col.key === "assy" && trEl) {
        trEl.classList.toggle("assy-row", !!value);
      }
    }
    Store.saveBom(project.id, tree);
  }

  function getSearchableValues(node) {
    const vals = [
      node.partNumber, node.manufacturer, node.commercialPartNo,
      node.description, node.rfx, node.po, node.status, node.notes,
    ].map((v) => (v == null ? "" : String(v)));
    customFields.forEach((f) => {
      const v = node.custom ? node.custom[f.key] : undefined;
      vals.push(v == null ? "" : String(v));
    });
    return vals;
  }

  function subtreeMatches(node) {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const selfMatch = getSearchableValues(node).some((v) => v.toLowerCase().includes(q));
    if (selfMatch) return true;
    return (node.children || []).some(subtreeMatches);
  }

  function buildVisibleRows(nodes, depth, out) {
    nodes.forEach((node) => {
      if (!subtreeMatches(node)) return;
      out.push({ node: node, depth: depth });
      const hasChildren = node.children && node.children.length > 0;
      const isCollapsed = collapsed.has(node.guid) && !searchQuery;
      if (hasChildren && !isCollapsed) {
        buildVisibleRows(node.children, depth + 1, out);
      }
    });
  }

  // PO is never entered on a BOM line — it's read from the Orders row whose
  // RFx matches the line's RFx. A line with no RFx (or an RFx with no PO
  // recorded against it yet) simply has no PO.
  function lookupPoForRfx(rfxValue) {
    const v = (rfxValue || "").trim();
    if (!v) return "";
    const match = orders.find((o) => (o.rfx || "").trim() === v);
    return match ? (match.po || "").trim() : "";
  }

  function buildParentMap(nodes, parent, map) {
    if (map === undefined) map = new Map();
    nodes.forEach((n) => {
      map.set(n.guid, parent || null);
      if (n.children && n.children.length) buildParentMap(n.children, n, map);
    });
    return map;
  }

  // ---------- Duplicate part-number consistency check ----------
  // Fields that should read the same wherever a given 3M Part Number is
  // used; if any of them disagrees across occurrences the lines are flagged.
  // (Per-line fields like Qty, Spare, Item No, Assy, Included-in-Parent, PO
  // and Notes are intentionally not compared, since they legitimately vary
  // between occurrences.) RFx and Status are marked "resolved" so the value
  // compared is the effective one shown in the grid — for an
  // Included-in-Parent line that's the value inherited from its parent, not
  // its own blank field.
  const IDENTITY_COLUMNS = [
    { key: "manufacturer", label: "Manufacturer" },
    { key: "commercialPartNo", label: "Commercial Part No" },
    { key: "supplied3M", label: "3M Supplied", checkbox: true },
    { key: "description", label: "Description" },
    { key: "rfx", label: "RFx", resolved: true },
    { key: "status", label: "Status", resolved: true },
  ];

  function identityValue(node, col, info) {
    if (col.checkbox) return node[col.key] ? "Yes" : "No";
    const v = col.resolved && info ? info[col.key] : node[col.key];
    return v == null ? "" : String(v).trim();
  }

  // Returns Map(partNumber -> { count, columns: [{ label, values: [...] }] })
  // for every part number used on 2+ lines whose identity fields disagree.
  function computePartNumberConflicts() {
    // parentMap lets identityValue resolve inherited RFx/Status per line.
    const parentMap = buildParentMap(tree, null);
    const byPartNumber = new Map();
    (function walk(nodes) {
      nodes.forEach((n) => {
        const pn = (n.partNumber || "").trim();
        if (pn) {
          if (!byPartNumber.has(pn)) byPartNumber.set(pn, []);
          byPartNumber.get(pn).push(n);
        }
        if (n.children && n.children.length) walk(n.children);
      });
    })(tree);

    const conflicts = new Map();
    byPartNumber.forEach((nodes, pn) => {
      if (nodes.length < 2) return;
      const infos = nodes.map((n) => resolveOrderInfo(n, parentMap));
      const columns = [];
      IDENTITY_COLUMNS.forEach((col) => {
        const values = [];
        nodes.forEach((n, i) => {
          const v = identityValue(n, col, infos[i]);
          if (values.indexOf(v) === -1) values.push(v);
        });
        if (values.length > 1) columns.push({ label: col.label, values: values });
      });
      if (columns.length) conflicts.set(pn, { count: nodes.length, columns: columns });
    });
    return conflicts;
  }

  function conflictTooltip(pn, conflict) {
    const lines = [
      "⚠ 3M Part Number \"" + pn + "\" is used on " + conflict.count +
        " lines, but these fields don't match across them:",
      "",
    ];
    conflict.columns.forEach((c) => {
      const shown = c.values.map((v) => (v === "" ? "(blank)" : v));
      lines.push("• " + c.label + ":  " + shown.join("   /   "));
    });
    lines.push("");
    lines.push("Make these fields consistent, or use distinct part numbers.");
    return lines.join("\n");
  }

  // Sets/clears the highlight, badge and hover explanation on a tree row.
  // Split out so it can refresh in place after an inline edit without
  // rebuilding (and disturbing focus in) the whole table.
  function applyConflictStyling(tr, node, conflicts) {
    const pn = (node.partNumber || "").trim();
    const conflict = pn ? conflicts.get(pn) : null;
    tr.classList.toggle("conflict-row", !!conflict);
    if (conflict) tr.title = conflictTooltip(pn, conflict);
    else tr.removeAttribute("title");

    const pnCell = tr.querySelector("td.cell-part-number");
    if (pnCell) {
      const existing = pnCell.querySelector(".conflict-badge");
      if (existing) existing.remove();
      if (conflict) {
        pnCell.appendChild(el("span", {
          class: "conflict-badge",
          text: "⚠",
          title: conflictTooltip(pn, conflict),
        }));
      }
    }
  }

  function refreshConflictHighlights() {
    if (currentView !== "tree") return;
    const conflicts = computePartNumberConflicts();
    bomTbody.querySelectorAll("tr[data-guid]").forEach((tr) => {
      const ctx = findContext(tr.dataset.guid);
      if (ctx) applyConflictStyling(tr, ctx.node, conflicts);
    });
  }

  // Editing one of these can create or resolve a duplicate-part conflict.
  function isConflictField(key) {
    return key === "partNumber" || IDENTITY_COLUMNS.some((c) => c.key === key);
  }

  // A line flagged "Included in Parent" is bought as part of its parent, so
  // it doesn't carry its own order info — RFx / PO / Status are inherited
  // from the nearest ancestor that isn't itself included in its parent.
  function resolveOrderInfo(node, parentMap) {
    let source = node;
    const guard = new Set();
    while (source && source.includedInParent && !guard.has(source.guid)) {
      guard.add(source.guid);
      const parent = parentMap.get(source.guid);
      if (!parent) break;
      source = parent;
    }
    if (!source) source = node;
    const rfx = (source.rfx || "").trim();
    return {
      rfx: rfx,
      po: lookupPoForRfx(rfx),
      status: source.status || "",
      inherited: source !== node,
    };
  }

  function moveNode(guid, delta) {
    const ctx = findContext(guid);
    if (!ctx) return;
    const target = ctx.index + delta;
    if (target < 0 || target >= ctx.siblings.length) return;
    const [moved] = ctx.siblings.splice(ctx.index, 1);
    ctx.siblings.splice(target, 0, moved);
    persistAndRender();
  }

  // Distinct, non-blank values from the Orders list for a given field
  // ("rfx" or "po") — these are the RFx/PO dropdown options on the BOM grid.
  function getOrderOptions(field) {
    const set = new Set();
    orders.forEach((o) => {
      const v = (o[field] || "").trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  function renderEditableCell(node, col, trEl) {
    const td = el("td");
    const rawValue = col.custom ? (node.custom ? node.custom[col.fieldKey] : undefined) : node[col.key];

    if (col.type === "checkbox") {
      td.className = "cell-checkbox";
      const input = el("input", { type: "checkbox" });
      input.checked = !!rawValue;
      input.addEventListener("change", () => {
        setNodeValue(node, col, input.checked, trEl);
        // Toggling this flips RFx/PO/Status between editable and inherited.
        if (col.key === "includedInParent") renderBom();
        else if (isConflictField(col.key)) refreshConflictHighlights();
      });
      td.appendChild(input);
      return td;
    }

    if (col.type === "status-choice" || col.type === "choice" || col.type === "order-lookup") {
      const options = col.type === "status-choice" ? statusOptions
        : col.type === "order-lookup" ? getOrderOptions(col.orderField)
        : (col.options || []);
      const select = el("select", { class: "cell-select" });
      select.appendChild(el("option", { value: "", text: "(none)" }));
      options.forEach((opt) => select.appendChild(el("option", { value: opt, text: opt })));
      // Keep a value that's no longer in the option list visible (e.g. a
      // status saved before the options were changed) rather than silently
      // showing it as blank.
      if (rawValue && options.indexOf(rawValue) === -1) {
        select.appendChild(el("option", { value: rawValue, text: rawValue + " (legacy)" }));
      }
      select.value = rawValue || "";
      select.addEventListener("change", () => {
        setNodeValue(node, col, select.value, trEl);
        // Picking an RFx re-derives this line's PO, and a line's RFx/Status
        // may be inherited by "included in parent" descendants, so redraw.
        if (col.key === "rfx") {
          node.po = lookupPoForRfx(select.value);
          Store.saveBom(project.id, tree);
        }
        if (col.key === "rfx" || col.key === "status") renderBom();
      });
      td.appendChild(select);
      return td;
    }

    if (col.type === "number") {
      const input = el("input", { class: "cell-input narrow", type: "number" });
      input.value = rawValue === undefined || rawValue === null || rawValue === "" ? "" : rawValue;
      input.addEventListener("change", () => {
        setNodeValue(node, col, input.value === "" ? "" : Number(input.value), trEl);
      });
      td.appendChild(input);
      return td;
    }

    const input = el("input", { class: "cell-input", type: "text" });
    input.value = rawValue == null ? "" : rawValue;
    input.addEventListener("change", () => {
      setNodeValue(node, col, input.value, trEl);
      if (isConflictField(col.key)) refreshConflictHighlights();
    });
    td.appendChild(input);
    return td;
  }

  // ---------- Popup menus (row actions, column chooser) ----------
  // Menus are appended to <body> and positioned fixed: the grid clips its
  // cells (overflow:hidden) and scrolls horizontally, so a menu rendered
  // inside a cell would be cut off.
  let openMenu = null;

  function closePopupMenu() {
    if (!openMenu) return;
    openMenu.remove();
    openMenu = null;
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onMenuKeydown, true);
    window.removeEventListener("resize", closePopupMenu);
  }

  function onDocMouseDown(e) {
    if (openMenu && !openMenu.contains(e.target)) closePopupMenu();
  }

  function onMenuKeydown(e) {
    if (e.key === "Escape") closePopupMenu();
  }

  // items: [{ label, disabled, danger, checked, keepOpen, onClick }]
  // A `checked` property (true/false) renders the item as a checkbox row.
  function openPopupMenu(anchorEl, items) {
    closePopupMenu();
    const menu = el("div", { class: "popup-menu" });

    items.forEach((item) => {
      if (item.separator) {
        menu.appendChild(el("div", { class: "popup-menu-sep" }));
        return;
      }
      const btn = el("button", { type: "button", class: "popup-menu-item" });
      if (item.danger) btn.classList.add("danger");
      if (item.checked !== undefined) {
        btn.appendChild(el("span", { class: "popup-check", text: item.checked ? "✓" : "" }));
      }
      btn.appendChild(el("span", { text: item.label }));
      if (item.disabled) btn.disabled = true;
      btn.addEventListener("click", () => {
        if (item.disabled) return;
        if (!item.keepOpen) closePopupMenu();
        item.onClick();
      });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    const rect = anchorEl.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = rect.right - menuRect.width;
    let top = rect.bottom + 4;
    if (left < 4) left = 4;
    if (top + menuRect.height > window.innerHeight - 4) {
      top = Math.max(4, rect.top - menuRect.height - 4);
    }
    menu.style.left = left + "px";
    menu.style.top = top + "px";

    openMenu = menu;
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onMenuKeydown, true);
    window.addEventListener("resize", closePopupMenu);
  }

  function renderActionsCell(node, depth) {
    const td = el("td", { class: "cell-actions" });
    const ctx = findContext(node.guid);
    const index = ctx ? ctx.index : 0;
    const siblingCount = ctx ? ctx.siblings.length : 1;

    const btn = el("button", {
      type: "button",
      class: "row-menu-btn",
      title: "Row actions",
      text: "⋮",
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPopupMenu(btn, [
        { label: "Move Up", disabled: index === 0, onClick: () => moveNode(node.guid, -1) },
        { label: "Move Down", disabled: index >= siblingCount - 1, onClick: () => moveNode(node.guid, 1) },
        { separator: true },
        { label: "Insert Row Above", onClick: () => addSiblingAbove(node.guid) },
        { label: "Insert Row Below", onClick: () => addSibling(node.guid) },
        { label: "Add Sub-Item", onClick: () => addChild(node.guid) },
        { separator: true },
        { label: "Indent", disabled: index === 0, onClick: () => indentNode(node.guid) },
        { label: "Outdent", disabled: depth === 0, onClick: () => outdentNode(node.guid) },
        { separator: true },
        { label: "Delete", danger: true, onClick: () => deleteNode(node.guid) },
      ]);
    });

    td.appendChild(btn);
    return td;
  }

  function toggleCollapse(guid) {
    if (collapsed.has(guid)) collapsed.delete(guid);
    else collapsed.add(guid);
    renderBom();
  }

  function filterToAssembly(guid) {
    assemblyFilterGuid = guid;
    collapsed.delete(guid); // make sure the focused assembly is expanded
    renderBom();
  }

  function clearAssemblyFilter() {
    if (!assemblyFilterGuid) return;
    assemblyFilterGuid = null;
    renderBom();
  }

  const bomColgroup = document.getElementById("bomColgroup");
  const bomThead = document.getElementById("bomThead");
  const bomTbody = document.getElementById("bomTbody");
  const bomEmpty = document.getElementById("bomEmpty");
  const assemblyFilterBanner = document.getElementById("assemblyFilterBanner");
  const assemblyFilterLabel = document.getElementById("assemblyFilterLabel");

  function updateAssemblyFilterBanner() {
    if (!assemblyFilterBanner) return;
    let show = false;
    if (currentView === "tree" && assemblyFilterGuid) {
      const ctx = findContext(assemblyFilterGuid);
      if (ctx) {
        const itemNo = computeItemNumbers(tree, "", new Map()).get(assemblyFilterGuid) || "";
        const pn = (ctx.node.partNumber || "").trim() || "(no part number)";
        const desc = (ctx.node.description || "").trim();
        assemblyFilterLabel.textContent =
          "Showing only assembly " + (itemNo ? itemNo + " · " : "") + pn + (desc ? " — " + desc : "");
        show = true;
      }
    }
    assemblyFilterBanner.hidden = !show;
  }

  function renderTreeView() {
    const cols = getAllColumns().filter((c) => !hiddenTreeColumns.has(c.key));

    // "Filter to this assembly": render only the chosen subtree. Item numbers
    // still come from the full tree, so a focused node keeps its real path
    // (e.g. 1.7.1.1); depth is re-based to 0 so the view isn't deeply indented.
    let filterRoot = null;
    if (assemblyFilterGuid) {
      const ctx = findContext(assemblyFilterGuid);
      if (ctx) filterRoot = ctx.node;
      else assemblyFilterGuid = null; // node no longer exists — drop the filter
    }
    const renderRoots = filterRoot ? [filterRoot] : tree;

    const rows = [];
    buildVisibleRows(renderRoots, 0, rows);
    const itemNumbers = computeItemNumbers(tree, "", new Map());
    const parentMap = buildParentMap(tree, null);
    const conflicts = computePartNumberConflicts();

    // The toggle sits in its own fixed leading column and is indented by
    // depth. Size that column to fit the deepest *visible* row so toggles
    // never get clipped, no matter how many levels deep the tree goes.
    const maxDepth = rows.reduce((max, r) => Math.max(max, r.depth), 0);
    const toggleColWidth = Math.max(TOGGLE_COL_WIDTH, maxDepth * TREE_INDENT + TOGGLE_BTN_SPACE);

    const colDefs = [{ key: "__toggle__", width: toggleColWidth }];
    cols.forEach((c) => colDefs.push({ key: c.key, width: treeColWidths[c.key] || getDefaultColWidth(c) }));
    colDefs.push({ key: "__actions__", width: treeColWidths.__actions__ });
    renderColgroup(bomColgroup, colDefs);
    const colEls = bomColgroup.querySelectorAll("col");

    const headRow = el("tr");
    headRow.appendChild(el("th", {}));
    cols.forEach((c) => {
      const th = el("th", {}, [el("span", { class: "th-label", text: c.label })]);
      headRow.appendChild(th);
    });
    headRow.appendChild(el("th", {}, [el("span", { class: "th-label", text: "Actions" })]));
    bomThead.innerHTML = "";
    bomThead.appendChild(headRow);

    const headThs = headRow.querySelectorAll("th");
    headThs.forEach((th, idx) => {
      if (idx === 0) return; // toggle column isn't resizable
      attachColumnResize(th, colEls[idx], treeColWidths, colDefs[idx].key);
    });

    bomTbody.innerHTML = "";
    bomEmpty.hidden = rows.length !== 0;
    bomEmpty.textContent =
      tree.length === 0
        ? "No BOM items yet. Use \"+ Add Top-Level Item\" to start."
        : "No items match your search.";

    rows.forEach(({ node, depth }) => {
      const tr = el("tr", { class: node.assy ? "assy-row" : "" });
      tr.dataset.guid = node.guid;

      const hasChildren = node.children && node.children.length > 0;
      const toggleTd = el("td");
      toggleTd.style.paddingLeft = depth * TREE_INDENT + "px";
      const toggleBtn = el("button", {
        class: "tree-toggle" + (hasChildren ? "" : " spacer"),
        type: "button",
        text: hasChildren ? (collapsed.has(node.guid) ? "▸" : "▾") : "",
      });
      if (hasChildren) toggleBtn.addEventListener("click", () => toggleCollapse(node.guid));
      toggleTd.appendChild(toggleBtn);
      tr.appendChild(toggleTd);

      const info = resolveOrderInfo(node, parentMap);
      cols.forEach((c) => {
        if (c.key === "itemNo") {
          tr.appendChild(el("td", { class: "cell-computed", text: itemNumbers.get(node.guid) || "" }));
        } else if (c.key === "po") {
          // Always read-only: derived from the Orders row matching the RFx.
          tr.appendChild(el("td", {
            class: "cell-computed",
            text: info.po,
            title: info.po ? "From the Orders table (RFx " + info.rfx + ")" : "Set an RFx that has a PO on the Orders page",
          }));
        } else if (info.inherited && (c.key === "rfx" || c.key === "status")) {
          // Included in Parent: this line rides on its parent's order.
          tr.appendChild(el("td", {
            class: "cell-computed cell-inherited",
            text: c.key === "rfx" ? info.rfx : info.status,
            title: "Inherited from parent assembly (Included in Parent)",
          }));
        } else {
          const td = renderEditableCell(node, c, tr);
          if (c.key === "partNumber") {
            td.classList.add("cell-part-number");
            // Assemblies (rows with children) get a 3-dots menu here to focus
            // the tree on just this assembly and its parts.
            if (hasChildren) {
              td.classList.add("has-assembly-menu");
              const asmBtn = el("button", {
                type: "button", class: "assembly-menu-btn", title: "Assembly options", text: "⋮",
              });
              asmBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                openPopupMenu(asmBtn, [
                  { label: "Filter to this assembly", onClick: () => filterToAssembly(node.guid) },
                ]);
              });
              td.appendChild(asmBtn);
            }
          }
          tr.appendChild(td);
        }
      });
      tr.appendChild(renderActionsCell(node, depth));

      applyConflictStyling(tr, node, conflicts);
      bomTbody.appendChild(tr);
    });
  }

  // Flattens the tree for the Flat/PO/RFx views, extending each node's Qty
  // by the Qty of every ancestor above it — a sub-item under a parent with
  // Qty 2 is needed twice per parent, so it contributes 2x its own Qty to
  // the aggregated totals. Tree View is unaffected: it always shows each
  // item's own, un-multiplied Qty, since that's the editable source value.
  // Items flagged "Included in Parent" are left out of the flattened list
  // entirely (their material is already accounted for in the parent's own
  // part number), though their own children are still evaluated normally.
  function collectFlatNodes(nodes, multiplier, out) {
    if (multiplier === undefined) multiplier = 1;
    if (out === undefined) out = [];
    nodes.forEach((n) => {
      // Spare units count as additional units of the line, so they're added
      // to Qty before rolling up — and they carry down to children too (a
      // spare assembly needs a full set of its own parts).
      const extendedQty = ((Number(n.qty) || 0) + (Number(n.spare) || 0)) * multiplier;
      if (!n.includedInParent && (n.partNumber || "").trim()) {
        const copy = Object.assign({}, n, { qty: extendedQty, po: lookupPoForRfx(n.rfx) });
        // Keep a link back to the real tree node so the aggregated views can
        // edit it (see aggregateByPartNumber's `sources`).
        copy.__node = n;
        out.push(copy);
      }
      if (n.children && n.children.length) collectFlatNodes(n.children, extendedQty, out);
    });
    return out;
  }

  function aggregateByPartNumber(nodes) {
    const map = new Map();
    nodes.forEach((n) => {
      const key = n.partNumber.trim();
      if (!map.has(key)) {
        map.set(key, {
          partNumber: key,
          description: n.description,
          manufacturer: n.manufacturer,
          commercialPartNo: n.commercialPartNo,
          supplied3M: n.supplied3M,
          assy: n.assy,
          rfx: n.rfx,
          po: n.po,
          status: n.status,
          notes: n.notes,
          custom: Object.assign({}, n.custom),
          totalQty: 0,
          occurrences: 0,
          sources: [], // real tree nodes this aggregate row stands for
        });
      }
      const agg = map.get(key);
      agg.totalQty += Number(n.qty) || 0;
      agg.occurrences += 1;
      agg.sources.push(n.__node || n);
    });
    return Array.from(map.values());
  }

  // ---------- Editing in the aggregated (Flat / RFx) views ----------
  // An aggregated row stands for one or more real tree nodes (row.sources).
  // Editing a cell writes to every one of them; a confirm popup guards any
  // edit that would touch more than one line.
  //
  // Not editable here: aggregate figures (Total Qty, Occurrences), the
  // derived PO, the computed Item No, structural flags (Assy, Included in
  // Parent) and the per-line quantities (Qty, Spare) — none of which have a
  // single sensible value to push across occurrences.
  const AGG_READONLY_KEYS = [
    "itemNo", "po", "totalQty", "occurrences", "qty", "spare", "assy", "includedInParent",
  ];

  function isAggregateEditable(col) {
    if (col.type === "computed" || col.type === "derived-po") return false;
    return AGG_READONLY_KEYS.indexOf(col.key) === -1;
  }

  // Fields checked when summarising how the affected lines already differ.
  const DIFF_SUMMARY_COLUMNS = [
    { key: "description", label: "Description" },
    { key: "manufacturer", label: "Manufacturer" },
    { key: "commercialPartNo", label: "Commercial Part No" },
    { key: "supplied3M", label: "3M Supplied", type: "checkbox" },
    { key: "rfx", label: "RFx" },
    { key: "status", label: "Status" },
    { key: "notes", label: "Notes" },
  ];

  function nodeColValue(node, col) {
    if (col.custom) return node.custom ? node.custom[col.fieldKey] : undefined;
    return node[col.key];
  }

  function displayColValue(value, col) {
    if (col.type === "checkbox") return value ? "Yes" : "No";
    const s = value == null ? "" : String(value).trim();
    return s === "" ? "(blank)" : s;
  }

  function distinctDisplayValues(nodes, col) {
    const seen = [];
    nodes.forEach((n) => {
      const d = displayColValue(nodeColValue(n, col), col);
      if (seen.indexOf(d) === -1) seen.push(d);
    });
    return seen;
  }

  function applyValueToNode(node, col, value) {
    if (col.custom) {
      node.custom = node.custom || {};
      node.custom[col.fieldKey] = value;
    } else {
      node[col.key] = value;
      // RFx drives the derived PO, same as in the tree editor.
      if (col.key === "rfx") node.po = lookupPoForRfx(value);
    }
  }

  function buildBulkEditWarning(pn, col, newValue, sources) {
    const n = sources.length;
    const newDisplay = displayColValue(newValue, col);
    const lines = [
      "3M Part Number \"" + pn + "\" is used on " + n + " lines.",
      "",
      "Set " + col.label + " to \"" + newDisplay + "\" on all " + n + " of them?",
    ];

    const currentValues = distinctDisplayValues(sources, col);
    if (currentValues.length > 1) {
      lines.push("");
      lines.push("Replacing these current " + col.label + " values:");
      currentValues.forEach((v) => lines.push("   • " + v));
    }

    // Note any *other* fields where the affected lines aren't identical.
    const otherDiffs = DIFF_SUMMARY_COLUMNS
      .filter((dc) => dc.key !== col.key && !(col.custom && ("custom:" + col.fieldKey) === dc.key))
      .filter((dc) => distinctDisplayValues(sources, dc).length > 1)
      .map((dc) => dc.label);
    if (otherDiffs.length) {
      lines.push("");
      lines.push("These lines also differ in: " + otherDiffs.join(", ") + ".");
    }

    return lines.join("\n");
  }

  // Commits an edit made in an aggregated view to every source line, warning
  // first when more than one line is affected. Returns nothing; re-renders.
  function commitAggregateEdit(row, col, newValue) {
    const sources = row.sources || [];
    if (sources.length === 0) return;

    if (sources.length > 1) {
      const ok = window.confirm(buildBulkEditWarning(row.partNumber, col, newValue, sources));
      if (!ok) {
        renderBom(); // discard the uncommitted input value
        return;
      }
    }

    sources.forEach((node) => applyValueToNode(node, col, newValue));
    Store.saveBom(project.id, tree);
    renderBom();
  }

  // An editable cell for an aggregated row, mirroring the tree editor's
  // input types but committing through commitAggregateEdit.
  function renderAggregateCell(row, col) {
    const td = el("td");
    const rawValue = getFlatCellValue(row, col);

    if (col.type === "checkbox") {
      td.className = "cell-checkbox";
      const input = el("input", { type: "checkbox" });
      input.checked = !!rawValue;
      input.addEventListener("change", () => commitAggregateEdit(row, col, input.checked));
      td.appendChild(input);
      return td;
    }

    if (col.type === "status-choice" || col.type === "choice" || col.type === "order-lookup") {
      const options = col.type === "status-choice" ? statusOptions
        : col.type === "order-lookup" ? getOrderOptions(col.orderField)
        : (col.options || []);
      const select = el("select", { class: "cell-select" });
      select.appendChild(el("option", { value: "", text: "(none)" }));
      options.forEach((opt) => select.appendChild(el("option", { value: opt, text: opt })));
      if (rawValue && options.indexOf(rawValue) === -1) {
        select.appendChild(el("option", { value: rawValue, text: rawValue + " (legacy)" }));
      }
      select.value = rawValue || "";
      select.addEventListener("change", () => commitAggregateEdit(row, col, select.value));
      td.appendChild(select);
      return td;
    }

    if (col.type === "number") {
      const input = el("input", { class: "cell-input narrow", type: "number" });
      input.value = rawValue === undefined || rawValue === null || rawValue === "" ? "" : rawValue;
      input.addEventListener("change", () => {
        commitAggregateEdit(row, col, input.value === "" ? "" : Number(input.value));
      });
      td.appendChild(input);
      return td;
    }

    const input = el("input", { class: "cell-input", type: "text" });
    input.value = rawValue == null ? "" : rawValue;
    input.addEventListener("change", () => commitAggregateEdit(row, col, input.value));
    td.appendChild(input);
    return td;
  }

  // A cell for an aggregated row: editable where it makes sense, plain text
  // for aggregates / derived values.
  function renderAggregateRowCell(row, col) {
    if (isAggregateEditable(col)) return renderAggregateCell(row, col);
    return el("td", { text: getFlatCellText(row, col) });
  }

  function getSortValue(row, key) {
    if (key.indexOf("custom:") === 0) {
      const fieldKey = key.slice(7);
      return row.custom ? row.custom[fieldKey] : undefined;
    }
    return row[key];
  }

  function sortRows(rows, sortState) {
    rows.sort((a, b) => {
      let av = getSortValue(a, sortState.key);
      let bv = getSortValue(b, sortState.key);
      if (typeof av === "string") {
        av = av.toLowerCase();
        bv = (bv || "").toLowerCase();
      }
      if (av < bv) return sortState.dir === "asc" ? -1 : 1;
      if (av > bv) return sortState.dir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }

  function filterRowsBySearch(rows) {
    if (!searchQuery) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter((r) =>
      [r.partNumber, r.description, r.manufacturer, r.commercialPartNo].some((v) =>
        (v || "").toLowerCase().includes(q)
      )
    );
  }

  function applyColumnFilters(rows, cols, columnFilters) {
    const activeKeys = Object.keys(columnFilters).filter((k) => columnFilters[k]);
    if (activeKeys.length === 0) return rows;
    return rows.filter((r) =>
      activeKeys.every((key) => {
        const col = cols.find((c) => c.key === key);
        if (!col) return true;
        const text = getFlatCellText(r, col);
        const filterVal = columnFilters[key];
        if (filterVal === "(blank)") return text === "";
        return text === filterVal;
      })
    );
  }

  function getDistinctColumnValues(rowsSource, col) {
    const set = new Set();
    let hasBlank = false;
    rowsSource.forEach((r) => {
      const text = getFlatCellText(r, col);
      if (text === "") hasBlank = true;
      else set.add(text);
    });
    const values = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (hasBlank) values.push("(blank)");
    return values;
  }

  const NO_PO_LABEL = "(No PO)";

  function getDistinctPoValues() {
    const nodes = collectFlatNodes(tree);
    const set = new Set();
    let hasBlank = false;
    nodes.forEach((n) => {
      const po = (n.po || "").trim();
      if (po) set.add(po);
      else hasBlank = true;
    });
    const values = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (hasBlank) values.push(NO_PO_LABEL);
    return values;
  }

  function getDistinctGroupValues(viewState) {
    const nodes = collectFlatNodes(tree);
    const set = new Set();
    nodes.forEach((n) => set.add((n[viewState.field] || "").trim() || viewState.emptyLabel));
    return Array.from(set).sort((a, b) => {
      if (a === viewState.emptyLabel) return 1;
      if (b === viewState.emptyLabel) return -1;
      return a.localeCompare(b);
    });
  }

  function computeFlatRows() {
    const cols = getColumnsForView(flatExtraColumns);
    let rows = aggregateByPartNumber(collectFlatNodes(tree));
    rows = filterRowsBySearch(rows);
    rows = applyColumnFilters(rows, cols, flatColumnFilters);
    return sortRows(rows, flatSortState);
  }

  function computeGroupedRows(viewState) {
    const cols = getColumnsForView(viewState.extraColumns);
    const nodes = collectFlatNodes(tree);
    const groups = new Map();
    nodes.forEach((n) => {
      const key = (n[viewState.field] || "").trim() || viewState.emptyLabel;
      if (viewState.groupFilter && key !== viewState.groupFilter) return;
      // PO is derived from RFx, so filtering by PO keeps only the lines
      // whose RFx maps to that PO on the Orders page.
      if (viewState.poFilter) {
        const po = (n.po || "").trim() || NO_PO_LABEL;
        if (po !== viewState.poFilter) return;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    });

    let entries = Array.from(groups.entries()).map(([group, groupNodes]) => {
      let rows = aggregateByPartNumber(groupNodes);
      rows = filterRowsBySearch(rows);
      rows = applyColumnFilters(rows, cols, viewState.columnFilters);
      rows = sortRows(rows, viewState.sortState);
      const totalQty = rows.reduce((sum, r) => sum + r.totalQty, 0);
      return { group: group, rows: rows, totalQty: totalQty };
    });

    entries = entries.filter((g) => g.rows.length > 0);
    entries.sort((a, b) => {
      if (a.group === viewState.emptyLabel) return 1;
      if (b.group === viewState.emptyLabel) return -1;
      return a.group.localeCompare(b.group);
    });
    return entries;
  }

  function buildFlatHeaderRow(cols, extraList, sortState, widthsMap, columnFilters) {
    const headRow = el("tr");
    cols.forEach((c) => {
      const arrow = sortState.key === c.key ? (sortState.dir === "asc" ? " ▲" : " ▼") : "";
      const th = el("th", { class: "sortable" });
      const content = el("div", { class: "th-content" }, [el("span", { class: "th-label", text: c.label + arrow })]);
      if (extraList.indexOf(c.key) !== -1) {
        const removeBtn = el("button", { type: "button", class: "col-remove-btn", text: "×", title: "Remove column" });
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const pos = extraList.indexOf(c.key);
          if (pos !== -1) extraList.splice(pos, 1);
          if (sortState.key === c.key) {
            sortState.key = "partNumber";
            sortState.dir = "asc";
          }
          delete widthsMap[c.key];
          delete columnFilters[c.key];
          renderBom();
        });
        content.appendChild(removeBtn);
      }
      th.appendChild(content);
      th.addEventListener("click", () => {
        if (sortState.key === c.key) sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
        else {
          sortState.key = c.key;
          sortState.dir = "asc";
        }
        renderBom();
      });
      headRow.appendChild(th);
    });
    return headRow;
  }

  function buildFilterRow(cols, columnFilters, optionRows) {
    const tr = el("tr", { class: "filter-row" });
    cols.forEach((c) => {
      const td = el("td");
      const values = getDistinctColumnValues(optionRows, c);
      const active = !!columnFilters[c.key];
      const select = el("select", { class: "filter-select" + (active ? " active" : "") });
      select.appendChild(el("option", { value: "", text: "All" }));
      values.forEach((v) => select.appendChild(el("option", { value: v, text: v })));
      select.value = columnFilters[c.key] || "";
      select.addEventListener("change", () => {
        if (select.value) columnFilters[c.key] = select.value;
        else delete columnFilters[c.key];
        renderBom();
      });
      td.appendChild(select);
      tr.appendChild(td);
    });
    return tr;
  }

  // Everything shown in a group header after the group value itself: the
  // order's details (description, supplier, delivery date, status) plus the
  // part/qty roll-up.
  function groupLabelSuffix(viewState, g) {
    const parts = [];
    if (viewState.field === "rfx") {
      const order = orders.find((o) => (o.rfx || "").trim() === g.group);
      if (order) {
        if ((order.description || "").trim()) parts.push(order.description.trim());
        if ((order.supplierName || "").trim()) parts.push(order.supplierName.trim());
        if ((order.deliveryDate || "").trim()) parts.push("Due " + order.deliveryDate.trim());
        if ((order.status || "").trim()) parts.push(order.status.trim());
      }
    }
    parts.push(g.rows.length + " part" + (g.rows.length === 1 ? "" : "s"));
    parts.push("Qty " + g.totalQty);
    return parts.join("  ·  ");
  }

  // Full plain-text group label (used by the Excel export).
  function buildGroupLabel(viewState, g) {
    return g.group + "  ·  " + groupLabelSuffix(viewState, g);
  }

  // Reassigns every line shown under an RFx group to a different RFx (or to
  // no RFx). PO is re-derived from the new RFx on each line, mirroring the
  // per-line editors. Warns first when more than one line is affected.
  function reassignGroupRfx(g, viewState, newRfx) {
    newRfx = (newRfx || "").trim();
    const oldRfx = g.group === viewState.emptyLabel ? "" : g.group;
    if (newRfx === oldRfx) return;

    const nodeSet = new Set();
    g.rows.forEach((r) => (r.sources || []).forEach((n) => nodeSet.add(n)));
    const nodes = Array.from(nodeSet);
    if (nodes.length === 0) return;

    if (nodes.length > 1) {
      const newDisplay = newRfx || viewState.emptyLabel;
      const msg =
        "Move " + nodes.length + " BOM line" + (nodes.length === 1 ? "" : "s") +
        " from RFx \"" + g.group + "\" to \"" + newDisplay + "\"?\n\n" +
        "Every line currently on this RFx is reassigned, and its PO is re-derived from the new RFx.";
      if (!window.confirm(msg)) {
        renderBom(); // reset the dropdown to its stored value
        return;
      }
    }

    nodes.forEach((n) => {
      n.rfx = newRfx;
      n.po = lookupPoForRfx(newRfx);
    });
    Store.saveBom(project.id, tree);
    renderBom();
  }

  function renderFlatView() {
    const cols = getColumnsForView(flatExtraColumns);
    const rows = computeFlatRows();

    const colDefs = cols.map((c) => ({ key: c.key, width: flatColWidths[c.key] || getDefaultColWidth(c) }));
    renderColgroup(bomColgroup, colDefs);
    const colEls = bomColgroup.querySelectorAll("col");

    const headRow = buildFlatHeaderRow(cols, flatExtraColumns, flatSortState, flatColWidths, flatColumnFilters);
    bomThead.innerHTML = "";
    bomThead.appendChild(headRow);

    const headThs = headRow.querySelectorAll("th");
    headThs.forEach((th, idx) => attachColumnResize(th, colEls[idx], flatColWidths, colDefs[idx].key));

    const optionRows = filterRowsBySearch(aggregateByPartNumber(collectFlatNodes(tree)));
    bomThead.appendChild(buildFilterRow(cols, flatColumnFilters, optionRows));

    bomTbody.innerHTML = "";
    bomEmpty.hidden = rows.length !== 0;
    bomEmpty.textContent =
      tree.length === 0
        ? "No BOM items yet. Use \"+ Add Top-Level Item\" in Tree View to start."
        : "No parts match your search.";

    rows.forEach((r) => {
      const tr = el("tr");
      cols.forEach((c) => tr.appendChild(renderAggregateRowCell(r, c)));
      bomTbody.appendChild(tr);
    });

    updateAddColumnOptions();
  }

  function renderGroupedView(viewState) {
    const cols = getColumnsForView(viewState.extraColumns);
    const groups = computeGroupedRows(viewState);

    const colDefs = [{ key: "__toggle__", width: viewState.colWidths.__toggle__ }].concat(
      cols.map((c) => ({ key: c.key, width: viewState.colWidths[c.key] || getDefaultColWidth(c) }))
    );
    renderColgroup(bomColgroup, colDefs);
    const colEls = bomColgroup.querySelectorAll("col");

    const innerHeadRow = buildFlatHeaderRow(
      cols, viewState.extraColumns, viewState.sortState, viewState.colWidths, viewState.columnFilters
    );
    const headRow = el("tr");
    headRow.appendChild(el("th", {}));
    Array.from(innerHeadRow.children).forEach((th) => headRow.appendChild(th));
    bomThead.innerHTML = "";
    bomThead.appendChild(headRow);

    const headThs = headRow.querySelectorAll("th");
    headThs.forEach((th, idx) => {
      if (idx === 0) return; // toggle column isn't resizable
      attachColumnResize(th, colEls[idx], viewState.colWidths, colDefs[idx].key);
    });

    const filteredNodes = collectFlatNodes(tree).filter((n) => {
      if (!viewState.groupFilter) return true;
      const key = (n[viewState.field] || "").trim() || viewState.emptyLabel;
      return key === viewState.groupFilter;
    });
    const optionRows = filterRowsBySearch(aggregateByPartNumber(filteredNodes));
    const innerFilterRow = buildFilterRow(cols, viewState.columnFilters, optionRows);
    const filterRow = el("tr", { class: "filter-row" }, [el("td")]);
    Array.from(innerFilterRow.children).forEach((td) => filterRow.appendChild(td));
    bomThead.appendChild(filterRow);

    updateGroupFilterOptions(viewState);

    bomTbody.innerHTML = "";
    bomEmpty.hidden = groups.length !== 0;
    bomEmpty.textContent =
      tree.length === 0
        ? "No BOM items yet. Use \"+ Add Top-Level Item\" in Tree View to start."
        : "No parts match your search.";

    groups.forEach((g) => {
      const groupTr = el("tr", { class: "group-row" });
      const toggleTd = el("td");
      const toggleBtn = el("button", {
        class: "tree-toggle",
        type: "button",
        text: viewState.collapsed.has(g.group) ? "▸" : "▾",
      });
      toggleBtn.addEventListener("click", () => {
        if (viewState.collapsed.has(g.group)) viewState.collapsed.delete(g.group);
        else viewState.collapsed.add(g.group);
        renderBom();
      });
      toggleTd.appendChild(toggleBtn);
      groupTr.appendChild(toggleTd);

      const labelTd = el("td", { colspan: String(cols.length) });
      if (viewState.field === "rfx") {
        // Editable RFx: change it to reassign the whole group (see reassignGroupRfx).
        const current = g.group === viewState.emptyLabel ? "" : g.group;
        const select = el("select", {
          class: "group-rfx-select",
          title: "Reassign every line in this group to another RFx",
        });
        select.appendChild(el("option", { value: "", text: viewState.emptyLabel }));
        const rfxOptions = getOrderOptions("rfx");
        rfxOptions.forEach((o) => select.appendChild(el("option", { value: o, text: o })));
        if (current && rfxOptions.indexOf(current) === -1) {
          select.appendChild(el("option", { value: current, text: current + " (not in Orders)" }));
        }
        select.value = current;
        select.addEventListener("change", () => reassignGroupRfx(g, viewState, select.value));
        // Don't let a click on the dropdown collapse the group.
        select.addEventListener("click", (e) => e.stopPropagation());
        labelTd.appendChild(select);
        labelTd.appendChild(document.createTextNode("  ·  " + groupLabelSuffix(viewState, g)));
      } else {
        labelTd.textContent = buildGroupLabel(viewState, g);
      }
      groupTr.appendChild(labelTd);
      bomTbody.appendChild(groupTr);

      if (!viewState.collapsed.has(g.group)) {
        g.rows.forEach((r) => {
          const tr = el("tr");
          tr.appendChild(el("td"));
          cols.forEach((c, idx) => {
            const td = renderAggregateRowCell(r, c);
            if (idx === 0) td.style.paddingLeft = "20px";
            tr.appendChild(td);
          });
          bomTbody.appendChild(tr);
        });
      }
    });

    updateAddColumnOptions();
  }

  const addRootItemBtn = document.getElementById("addRootItemBtn");
  const expandAllBtn = document.getElementById("expandAllBtn");
  const collapseAllBtn = document.getElementById("collapseAllBtn");
  const bomSearch = document.getElementById("bomSearch");
  const viewSwitchButtons = document.querySelectorAll(".view-switch button");
  const addColumnSelect = document.getElementById("addColumnSelect");
  const groupFilterSelect = document.getElementById("groupFilterSelect");
  const poFilterSelect = document.getElementById("poFilterSelect");
  const columnsBtn = document.getElementById("columnsBtn");

  function updateGroupFilterOptions(viewState) {
    const values = getDistinctGroupValues(viewState);
    groupFilterSelect.innerHTML = "";
    groupFilterSelect.appendChild(el("option", { value: "", text: "All " + viewState.label }));
    values.forEach((v) => groupFilterSelect.appendChild(el("option", { value: v, text: v })));
    groupFilterSelect.value = viewState.groupFilter || "";
    groupFilterSelect.classList.toggle("active", !!viewState.groupFilter);

    poFilterSelect.innerHTML = "";
    poFilterSelect.appendChild(el("option", { value: "", text: "All PO" }));
    getDistinctPoValues().forEach((v) => poFilterSelect.appendChild(el("option", { value: v, text: v })));
    poFilterSelect.value = viewState.poFilter || "";
    poFilterSelect.classList.toggle("active", !!viewState.poFilter);
  }

  groupFilterSelect.addEventListener("change", () => {
    const gv = groupedViews[currentView];
    if (!gv) return;
    gv.groupFilter = groupFilterSelect.value;
    renderBom();
  });

  poFilterSelect.addEventListener("change", () => {
    const gv = groupedViews[currentView];
    if (!gv) return;
    gv.poFilter = poFilterSelect.value;
    renderBom();
  });

  columnsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openPopupMenu(
      columnsBtn,
      getAllColumns().map((c) => ({
        label: c.label,
        checked: !hiddenTreeColumns.has(c.key),
        keepOpen: true,
        onClick: () => {
          if (hiddenTreeColumns.has(c.key)) hiddenTreeColumns.delete(c.key);
          else hiddenTreeColumns.add(c.key);
          renderBom();
          // Rebuild the menu in place so the checkmarks stay in sync.
          columnsBtn.click();
        },
      }))
    );
  });

  function currentExtraColumns() {
    const gv = groupedViews[currentView];
    return gv ? gv.extraColumns : flatExtraColumns;
  }

  function currentExcludedKeys() {
    const gv = groupedViews[currentView];
    return gv ? gv.excludedKeys : FLAT_EXCLUDED_KEYS;
  }

  function updateAddColumnOptions() {
    const addable = getAddableColumns(currentExcludedKeys(), currentExtraColumns());
    addColumnSelect.innerHTML = "";
    addColumnSelect.appendChild(
      el("option", { value: "", text: addable.length ? "+ Add Column" : "No more columns to add" })
    );
    addable.forEach((c) => addColumnSelect.appendChild(el("option", { value: c.key, text: c.label })));
    addColumnSelect.disabled = addable.length === 0;
  }

  addColumnSelect.addEventListener("change", () => {
    const key = addColumnSelect.value;
    if (!key) return;
    currentExtraColumns().push(key);
    renderBom();
  });

  function renderBom() {
    const isTree = currentView === "tree";
    const gv = groupedViews[currentView];
    addRootItemBtn.style.display = isTree ? "" : "none";
    expandAllBtn.style.display = isTree || gv ? "" : "none";
    collapseAllBtn.style.display = isTree || gv ? "" : "none";
    addColumnSelect.style.display = isTree ? "none" : "";
    columnsBtn.style.display = isTree ? "" : "none";
    groupFilterSelect.style.display = gv ? "" : "none";
    // PO filter only makes sense on the RFx view, where PO isn't the grouping key.
    poFilterSelect.style.display = gv ? "" : "none";
    if (isTree) renderTreeView();
    else if (gv) renderGroupedView(gv);
    else renderFlatView();
    updateAssemblyFilterBanner();
  }

  if (assemblyFilterBanner) {
    const clearBtn = document.getElementById("clearAssemblyFilterBtn");
    if (clearBtn) clearBtn.addEventListener("click", clearAssemblyFilter);
  }

  // Esc clears the assembly filter — but only when nothing else is claiming
  // Esc. Capture phase + running before the popup menu's own Esc handler
  // means an open menu (or dialog) is left to handle its own Escape.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (openMenu) return;
    if (document.querySelector("dialog[open]")) return;
    if (assemblyFilterGuid) clearAssemblyFilter();
  }, true);

  viewSwitchButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentView = btn.dataset.view;
      viewSwitchButtons.forEach((b) => b.classList.toggle("active", b === btn));
      renderBom();
    });
  });

  bomSearch.addEventListener("input", () => {
    searchQuery = bomSearch.value.trim();
    renderBom();
  });

  expandAllBtn.addEventListener("click", () => {
    const gv = groupedViews[currentView];
    if (gv) gv.collapsed.clear();
    else collapsed.clear();
    renderBom();
  });

  collapseAllBtn.addEventListener("click", () => {
    const gv = groupedViews[currentView];
    if (gv) {
      computeGroupedRows(gv).forEach((g) => gv.collapsed.add(g.group));
    } else {
      function walk(nodes) {
        nodes.forEach((n) => {
          if (n.children && n.children.length) {
            collapsed.add(n.guid);
            walk(n.children);
          }
        });
      }
      walk(tree);
    }
    renderBom();
  });

  addRootItemBtn.addEventListener("click", () => addChild(null));

  // ---------- BOM settings (status options + custom fields) ----------
  const bomSettingsBtn = document.getElementById("bomSettingsBtn");
  const bomSettingsDialog = document.getElementById("bomSettingsDialog");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");
  const statusChipList = document.getElementById("statusChipList");
  const newStatusOption = document.getElementById("newStatusOption");
  const addStatusOptionBtn = document.getElementById("addStatusOptionBtn");
  const customFieldList = document.getElementById("customFieldList");
  const newFieldName = document.getElementById("newFieldName");
  const newFieldType = document.getElementById("newFieldType");
  const newFieldChoices = document.getElementById("newFieldChoices");
  const addFieldBtn = document.getElementById("addFieldBtn");
  const fieldFormError = document.getElementById("fieldFormError");

  function renderSettingsDialog() {
    statusChipList.innerHTML = "";
    statusOptions.forEach((opt, idx) => {
      const chip = el("span", { class: "chip" });
      chip.appendChild(document.createTextNode(opt));
      const removeBtn = el("button", { type: "button", text: "×", title: "Remove" });
      removeBtn.addEventListener("click", () => removeStatusOption(idx));
      chip.appendChild(removeBtn);
      statusChipList.appendChild(chip);
    });

    customFieldList.innerHTML = "";
    if (customFields.length === 0) {
      customFieldList.appendChild(el("p", { class: "field-meta", text: "No custom fields yet." }));
    }
    customFields.forEach((f, idx) => {
      const row = el("div", { class: "field-row" });
      const labelWrap = el("div");
      labelWrap.appendChild(el("div", { text: f.label }));
      const metaText = f.type + (f.type === "choice" ? ": " + (f.options || []).join(", ") : "");
      labelWrap.appendChild(el("div", { class: "field-meta", text: metaText }));
      row.appendChild(labelWrap);
      const removeBtn = el("button", { type: "button", text: "Remove" });
      removeBtn.addEventListener("click", () => removeCustomField(idx));
      row.appendChild(removeBtn);
      customFieldList.appendChild(row);
    });
  }

  function removeStatusOption(idx) {
    if (statusOptions.length <= 1) {
      window.alert("At least one status option is required.");
      return;
    }
    statusOptions.splice(idx, 1);
    Store.saveStatusOptions(statusOptions);
    renderSettingsDialog();
    renderBom();
  }

  addStatusOptionBtn.addEventListener("click", () => {
    const val = newStatusOption.value.trim();
    if (!val) return;
    if (statusOptions.some((o) => o.toLowerCase() === val.toLowerCase())) {
      newStatusOption.value = "";
      return;
    }
    statusOptions.push(val);
    Store.saveStatusOptions(statusOptions);
    newStatusOption.value = "";
    renderSettingsDialog();
    renderBom();
  });

  function slugify(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field_" + Date.now();
  }

  newFieldType.addEventListener("change", () => {
    newFieldChoices.hidden = newFieldType.value !== "choice";
  });

  addFieldBtn.addEventListener("click", () => {
    fieldFormError.hidden = true;
    const name = newFieldName.value.trim();
    const type = newFieldType.value;

    if (!name) {
      fieldFormError.textContent = "Field name is required.";
      fieldFormError.hidden = false;
      return;
    }

    const key = slugify(name);
    if (customFields.some((f) => f.key === key) || BASE_COLUMNS.some((c) => c.key === key)) {
      fieldFormError.textContent = "A field with this name already exists.";
      fieldFormError.hidden = false;
      return;
    }

    const field = { key: key, label: name, type: type };
    if (type === "choice") {
      const opts = newFieldChoices.value.split(",").map((s) => s.trim()).filter(Boolean);
      if (opts.length === 0) {
        fieldFormError.textContent = "Provide at least one choice option.";
        fieldFormError.hidden = false;
        return;
      }
      field.options = opts;
    }

    customFields.push(field);
    Store.saveCustomFields(customFields);
    newFieldName.value = "";
    newFieldChoices.value = "";
    newFieldChoices.hidden = true;
    newFieldType.value = "text";
    renderSettingsDialog();
    renderBom();
  });

  function removeCustomField(idx) {
    const removedKey = "custom:" + customFields[idx].key;
    customFields.splice(idx, 1);
    Store.saveCustomFields(customFields);

    const groupedList = Object.keys(groupedViews).map((k) => groupedViews[k]);
    [flatExtraColumns].concat(groupedList.map((gv) => gv.extraColumns)).forEach((list) => {
      const pos = list.indexOf(removedKey);
      if (pos !== -1) list.splice(pos, 1);
    });
    delete treeColWidths[removedKey];
    delete flatColWidths[removedKey];
    delete flatColumnFilters[removedKey];
    groupedList.forEach((gv) => {
      delete gv.colWidths[removedKey];
      delete gv.columnFilters[removedKey];
    });
    [flatSortState].concat(groupedList.map((gv) => gv.sortState)).forEach((sortState) => {
      if (sortState.key === removedKey) {
        sortState.key = "partNumber";
        sortState.dir = "asc";
      }
    });
    renderSettingsDialog();
    renderBom();
  }

  bomSettingsBtn.addEventListener("click", () => {
    renderSettingsDialog();
    bomSettingsDialog.showModal();
  });
  closeSettingsBtn.addEventListener("click", () => bomSettingsDialog.close());
  bomSettingsDialog.addEventListener("click", (e) => {
    if (e.target === bomSettingsDialog) bomSettingsDialog.close();
  });

  // ---------- Orders ----------
  // A per-project reference list of RFx/PO values. The BOM grid's RFx and PO
  // columns are lookups against this list (see getOrderOptions above)
  // instead of free text, so they always match a real order.
  const ordersThead = document.getElementById("ordersThead");
  const ordersTbody = document.getElementById("ordersTbody");
  const ordersEmpty = document.getElementById("ordersEmpty");
  const addOrderBtn = document.getElementById("addOrderBtn");

  // Columns that can be sorted/filtered (the Actions column can't).
  const ORDER_COLUMNS = [
    { key: "rfx", label: "RFx" },
    { key: "po", label: "PO" },
    { key: "description", label: "Description" },
    { key: "supplierName", label: "Supplier Name" },
    { key: "deliveryDate", label: "Delivery Date" },
    { key: "status", label: "Status" },
  ];
  const orderSortState = { key: null, dir: "asc" };
  const orderColumnFilters = {};

  function orderCellText(order, key) {
    const v = order[key];
    return v == null ? "" : String(v).trim();
  }

  function orderDistinctValues(key) {
    const set = new Set();
    let hasBlank = false;
    orders.forEach((o) => {
      const t = orderCellText(o, key);
      if (t === "") hasBlank = true;
      else set.add(t);
    });
    const values = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (hasBlank) values.push("(blank)");
    return values;
  }

  // Filtered + sorted for display. The underlying `orders` array keeps its
  // saved order, so editing (which references the real order object) and the
  // stored positions are unaffected.
  function getVisibleOrders() {
    let list = orders.slice();

    const activeKeys = Object.keys(orderColumnFilters).filter((k) => orderColumnFilters[k]);
    if (activeKeys.length) {
      list = list.filter((o) =>
        activeKeys.every((k) => {
          const t = orderCellText(o, k);
          return orderColumnFilters[k] === "(blank)" ? t === "" : t === orderColumnFilters[k];
        })
      );
    }

    if (orderSortState.key) {
      const key = orderSortState.key;
      const dir = orderSortState.dir === "asc" ? 1 : -1;
      list.sort((a, b) => {
        const av = orderCellText(a, key);
        const bv = orderCellText(b, key);
        // Blanks always sort last, regardless of direction.
        if (av === "" && bv === "") return 0;
        if (av === "") return 1;
        if (bv === "") return -1;
        return av.localeCompare(bv, undefined, { numeric: true }) * dir;
      });
    }
    return list;
  }

  function renderOrdersHeader() {
    ordersThead.innerHTML = "";

    const headRow = el("tr");
    ORDER_COLUMNS.forEach((c) => {
      const arrow = orderSortState.key === c.key ? (orderSortState.dir === "asc" ? " ▲" : " ▼") : "";
      const th = el("th", { class: "sortable" }, [el("span", { class: "th-label", text: c.label + arrow })]);
      th.addEventListener("click", () => {
        if (orderSortState.key === c.key) orderSortState.dir = orderSortState.dir === "asc" ? "desc" : "asc";
        else {
          orderSortState.key = c.key;
          orderSortState.dir = "asc";
        }
        renderOrders();
      });
      headRow.appendChild(th);
    });
    headRow.appendChild(el("th", {}, [el("span", { class: "th-label", text: "Actions" })]));
    ordersThead.appendChild(headRow);

    const filterRow = el("tr", { class: "filter-row" });
    ORDER_COLUMNS.forEach((c) => {
      const td = el("td");
      const active = !!orderColumnFilters[c.key];
      const select = el("select", { class: "filter-select" + (active ? " active" : "") });
      select.appendChild(el("option", { value: "", text: "All" }));
      orderDistinctValues(c.key).forEach((v) => select.appendChild(el("option", { value: v, text: v })));
      select.value = orderColumnFilters[c.key] || "";
      select.addEventListener("change", () => {
        if (select.value) orderColumnFilters[c.key] = select.value;
        else delete orderColumnFilters[c.key];
        renderOrders();
      });
      td.appendChild(select);
      filterRow.appendChild(td);
    });
    filterRow.appendChild(el("td")); // Actions column has no filter
    ordersThead.appendChild(filterRow);
  }

  function saveOrders() {
    Store.saveOrders(project.id, orders);
    flashSaveIndicator();
  }

  // Applies an order's status to every BOM line on that RFx. Lines flagged
  // "Included in Parent" inherit their status from a parent, so they're left
  // alone — setting them directly would have no visible effect.
  function applyOrderStatusToBom(order) {
    const rfx = (order.rfx || "").trim();
    const status = (order.status || "").trim();
    if (!rfx) {
      window.alert("Give this order an RFx first — that's how its parts are identified.");
      return;
    }
    if (!status) {
      window.alert("Pick a Status for this order first.");
      return;
    }

    const matches = [];
    (function walk(nodes) {
      nodes.forEach((n) => {
        if (!n.includedInParent && (n.rfx || "").trim() === rfx) matches.push(n);
        if (n.children && n.children.length) walk(n.children);
      });
    })(tree);

    if (matches.length === 0) {
      window.alert("No BOM parts are on RFx " + rfx + " yet.");
      return;
    }
    const msg = "Set Status to \"" + status + "\" on " + matches.length +
      " BOM part" + (matches.length === 1 ? "" : "s") + " on RFx " + rfx + "?";
    if (!window.confirm(msg)) return;

    matches.forEach((n) => { n.status = status; });
    Store.saveBom(project.id, tree);
    renderBom();
    flashSaveIndicator();
  }

  function orderTextCell(order, field, tr) {
    const input = el("input", { class: "cell-input", type: "text" });
    input.value = order[field] || "";
    input.addEventListener("change", () => {
      order[field] = input.value.trim();
      saveOrders();
      renderBom();
    });
    return el("td", {}, [input]);
  }

  function renderOrders() {
    renderOrdersHeader();
    ordersTbody.innerHTML = "";
    ordersEmpty.hidden = orders.length !== 0;

    const visible = getVisibleOrders();
    if (orders.length && visible.length === 0) {
      ordersEmpty.hidden = false;
      ordersEmpty.textContent = "No orders match the current filters.";
    } else {
      ordersEmpty.textContent = "No orders yet. Use \"+ Add Order\" to start.";
    }

    visible.forEach((order) => {
      const tr = el("tr");

      tr.appendChild(orderTextCell(order, "rfx", tr));
      tr.appendChild(orderTextCell(order, "po", tr));
      tr.appendChild(orderTextCell(order, "description", tr));
      tr.appendChild(orderTextCell(order, "supplierName", tr));

      const dateInput = el("input", { class: "cell-input", type: "date" });
      dateInput.value = order.deliveryDate || "";
      dateInput.addEventListener("change", () => {
        order.deliveryDate = dateInput.value;
        saveOrders();
        renderBom();
      });
      tr.appendChild(el("td", {}, [dateInput]));

      // Same option list as the BOM Status column.
      const statusSelect = el("select", { class: "cell-select" });
      statusSelect.appendChild(el("option", { value: "", text: "(none)" }));
      statusOptions.forEach((opt) => statusSelect.appendChild(el("option", { value: opt, text: opt })));
      if (order.status && statusOptions.indexOf(order.status) === -1) {
        statusSelect.appendChild(el("option", { value: order.status, text: order.status + " (legacy)" }));
      }
      statusSelect.value = order.status || "";
      statusSelect.addEventListener("change", () => {
        order.status = statusSelect.value;
        saveOrders();
        renderBom();
      });
      tr.appendChild(el("td", {}, [statusSelect]));

      const actionsTd = el("td", { class: "cell-actions" });
      const menuBtn = el("button", { type: "button", class: "row-menu-btn", title: "Order actions", text: "⋮" });
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openPopupMenu(menuBtn, [
          { label: "Update Status", onClick: () => applyOrderStatusToBom(order) },
          { separator: true },
          {
            label: "Delete",
            danger: true,
            onClick: () => {
              if (!window.confirm("Delete this order?")) return;
              const idx = orders.indexOf(order);
              if (idx !== -1) orders.splice(idx, 1);
              saveOrders();
              renderOrders();
              renderBom();
            },
          },
        ]);
      });
      actionsTd.appendChild(menuBtn);
      tr.appendChild(actionsTd);

      ordersTbody.appendChild(tr);
    });
  }

  addOrderBtn.addEventListener("click", () => {
    // Clear any active filters so the new blank row is always visible (an
    // all-blank order wouldn't match a value filter).
    Object.keys(orderColumnFilters).forEach((k) => delete orderColumnFilters[k]);
    orders.push({
      guid: Store.makeId(), rfx: "", po: "", description: "",
      supplierName: "", deliveryDate: "", status: "",
    });
    saveOrders();
    renderOrders();
  });

  // ---------- Export to Excel ----------
  // Produces a genuine .xlsx (Office Open XML) workbook: a small hand-rolled
  // zip writer + minimal spreadsheet XML parts, no external library. Export
  // always dumps the full data set, ignoring whatever search/collapse/
  // column state the UI happens to be in.
  const exportExcelBtn = document.getElementById("exportExcelBtn");

  function xmlEscape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function getExportFieldValue(node, col) {
    const raw = col.custom ? (node.custom ? node.custom[col.fieldKey] : undefined) : node[col.key];
    if (col.type === "checkbox") return raw ? "X" : "";
    if (col.type === "number") return raw === "" || raw == null ? "" : Number(raw);
    return raw == null ? "" : raw;
  }

  function flattenTreeForExport(nodes, depth, out) {
    nodes.forEach((n) => {
      out.push({ node: n, depth: depth });
      if (n.children && n.children.length) flattenTreeForExport(n.children, depth + 1, out);
    });
  }

  // ---- Sheet builder: a plain { name, rows } structure, independent of any
  // file format, converted to real worksheet XML by sheetToXml() below. ----
  function makeSheet(name) {
    return { name: name, rows: [] };
  }

  // cells: array of { value, style: undefined|"header"|"groupHeader",
  //                   center: bool, span: N }
  // opts:  { outlineLevel: N, collapsed: bool, hidden: bool } for Excel row
  //        grouping. `hidden` is what makes a group ship collapsed; a row can
  //        carry an outlineLevel and still be visible (an expanded outline).
  function addRow(sheet, cells, opts) {
    if (opts) {
      if (opts.outlineLevel) cells.outlineLevel = opts.outlineLevel;
      if (opts.collapsed) cells.collapsed = true;
      if (opts.hidden) cells.hidden = true;
    }
    sheet.rows.push(cells);
    return cells;
  }

  const STYLE_IDS = {
    normal: 0, "normal-center": 3,
    header: 1, "header-center": 4,
    groupHeader: 2, "groupHeader-center": 2,
  };

  // Columns whose values read better centered in the spreadsheet.
  const CENTERED_EXPORT_KEYS = ["assy", "includedInParent", "qty", "supplied3M", "spare", "totalQty"];

  // The sheet the importer reads, and the one the export/template writes.
  const IMPORT_SHEET_NAME = "Import";

  function isCenteredCol(col) {
    return CENTERED_EXPORT_KEYS.indexOf(col.key) !== -1;
  }

  function todayIso() {
    const d = new Date();
    const pad = (n) => (n < 10 ? "0" + n : String(n));
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function buildDetailsSheet() {
    const sheet = makeSheet("Project Details");
    addRow(sheet, [{ value: "Field", style: "header" }, { value: "Value", style: "header" }]);
    addRow(sheet, [{ value: "WBS" }, { value: project.wbs }]);
    addRow(sheet, [{ value: "EWR" }, { value: project.ewr }]);
    addRow(sheet, [{ value: "Project Name" }, { value: project.name }]);
    addRow(sheet, [{ value: "Status" }, { value: project.status }]);
    addRow(sheet, [{ value: "Date Created" }, { value: project.dateCreated }]);
    addRow(sheet, [{ value: "Date Exported" }, { value: todayIso() }]);
    return sheet;
  }

  function buildTreeSheet() {
    const cols = getAllColumns();
    const sheet = makeSheet("BOM (Tree)");
    sheet.grouped = true; // outline level mirrors the BOM depth
    addRow(
      sheet,
      [{ value: "Level", style: "header", center: true }].concat(
        cols.map((c) => ({ value: c.label, style: "header", center: isCenteredCol(c) }))
      )
    );

    const flat = [];
    flattenTreeForExport(tree, 0, flat);
    const itemNumbers = computeItemNumbers(tree, "", new Map());
    const parentMap = buildParentMap(tree, null);
    flat.forEach(({ node, depth }) => {
      const info = resolveOrderInfo(node, parentMap);
      const cells = [{ value: depth, center: true }];
      cols.forEach((c) => {
        // Match what the grid shows: PO is derived, and RFx/Status are
        // inherited for lines marked "Included in Parent".
        const value = c.key === "itemNo" ? itemNumbers.get(node.guid) || ""
          : c.key === "po" ? info.po
          : c.key === "rfx" ? info.rfx
          : c.key === "status" ? info.status
          : getExportFieldValue(node, c);
        const cellValue = c.key === "description" && typeof value === "string" && value
          ? "  ".repeat(depth) + value
          : value;
        cells.push({ value: cellValue, center: isCenteredCol(c) });
      });
      // Outline level = tree depth, so Excel's +/- buttons collapse an
      // assembly and everything beneath it. (Excel caps outlines at 7.)
      // Rows stay visible: the outline ships expanded so the sheet reads
      // normally, and the user collapses what they want.
      addRow(sheet, cells, { outlineLevel: Math.min(depth, 7) });
    });
    return sheet;
  }

  function getExportAggregateColumns(excludeKeys) {
    const extra = getAllColumns().filter((c) => excludeKeys.indexOf(c.key) === -1);
    return FLAT_COLUMNS.concat(extra);
  }

  function buildFlatSheet() {
    const cols = getExportAggregateColumns(FLAT_EXCLUDED_KEYS);
    const sheet = makeSheet("BOM (Flat)");
    addRow(sheet, cols.map((c) => ({ value: c.label, style: "header", center: isCenteredCol(c) })));

    const aggregated = aggregateByPartNumber(collectFlatNodes(tree));
    aggregated.sort((a, b) => a.partNumber.localeCompare(b.partNumber));
    aggregated.forEach((r) => {
      addRow(sheet, cols.map((c) => ({ value: getExportFieldValue(r, c), center: isCenteredCol(c) })));
    });
    return sheet;
  }

  // The group header row for the export, as individual cells (not one merged
  // cell) so each piece — RFx, PO, description, supplier, delivery date,
  // status, and the part/qty roll-up — lands in its own spreadsheet cell.
  function exportGroupHeaderCells(viewState, g) {
    const cells = [{ value: g.group, style: "groupHeader" }];
    if (viewState.field === "rfx") {
      const order = orders.find((o) => (o.rfx || "").trim() === g.group);
      if (order) {
        cells.push({ value: "PO: " + ((order.po || "").trim() || "(none)"), style: "groupHeader" });
        if ((order.description || "").trim()) cells.push({ value: order.description.trim(), style: "groupHeader" });
        if ((order.supplierName || "").trim()) cells.push({ value: order.supplierName.trim(), style: "groupHeader" });
        if ((order.deliveryDate || "").trim()) cells.push({ value: "Due " + order.deliveryDate.trim(), style: "groupHeader" });
        if ((order.status || "").trim()) cells.push({ value: order.status.trim(), style: "groupHeader" });
      }
    }
    cells.push({ value: g.rows.length + " part" + (g.rows.length === 1 ? "" : "s"), style: "groupHeader" });
    cells.push({ value: "Qty " + g.totalQty, style: "groupHeader" });
    return cells;
  }

  // Shared by the PO and RFx export sheets — both group BOM lines by a
  // field and aggregate by part number within each group, same as their
  // on-screen views (see groupedViews / computeGroupedRows).
  function buildGroupedSheet(viewState, sheetName) {
    const cols = getExportAggregateColumns(viewState.excludedKeys);
    const sheet = makeSheet(sheetName);
    sheet.grouped = true; // emit Excel outline grouping (see sheetToXml)
    addRow(sheet, cols.map((c) => ({ value: c.label, style: "header", center: isCenteredCol(c) })));

    const nodes = collectFlatNodes(tree);
    const groups = new Map();
    nodes.forEach((n) => {
      const key = (n[viewState.field] || "").trim() || viewState.emptyLabel;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    });

    let entries = Array.from(groups.entries()).map(([group, groupNodes]) => ({
      group: group,
      rows: aggregateByPartNumber(groupNodes).sort((a, b) => a.partNumber.localeCompare(b.partNumber)),
    }));
    entries.sort((a, b) => {
      if (a.group === viewState.emptyLabel) return 1;
      if (b.group === viewState.emptyLabel) return -1;
      return a.group.localeCompare(b.group);
    });

    entries.forEach((g) => {
      g.totalQty = g.rows.reduce((sum, r) => sum + r.totalQty, 0);
      // Summary row for the group; its member rows below are one outline
      // level deeper, so Excel shows a collapsible +/- next to this row.
      // Each header piece is its own cell (no merge); pad with empty
      // groupHeader cells so the shaded band spans the table width.
      const headerCells = exportGroupHeaderCells(viewState, g);
      while (headerCells.length < cols.length) headerCells.push({ value: "", style: "groupHeader" });
      addRow(sheet, headerCells, { collapsed: true });
      g.rows.forEach((r) => {
        addRow(
          sheet,
          cols.map((c) => ({ value: getExportFieldValue(r, c), center: isCenteredCol(c) })),
          { outlineLevel: 1, hidden: true }
        );
      });
    });
    return sheet;
  }

  function buildRfxSheet() {
    return buildGroupedSheet(groupedViews.rfx, "BOM (By RFx)");
  }

  // A round-trip sheet: exactly the columns the CSV importer expects
  // ("Level" + every editable field), populated with this project's BOM.
  // Save it as CSV and it can be fed straight back into Import from Excel.
  function buildImportSheet() {
    const cols = getEditableColumns();
    const sheet = makeSheet(IMPORT_SHEET_NAME);
    addRow(
      sheet,
      [{ value: "Level", style: "header", center: true }].concat(
        cols.map((c) => ({ value: c.label, style: "header", center: isCenteredCol(c) }))
      )
    );

    const flat = [];
    flattenTreeForExport(tree, 0, flat);
    const parentMap = buildParentMap(tree, null);
    flat.forEach(({ node, depth }) => {
      const info = resolveOrderInfo(node, parentMap);
      const cells = [{ value: depth, center: true }];
      cols.forEach((c) => {
        const value = c.key === "po" ? info.po
          : c.key === "rfx" ? info.rfx
          : c.key === "status" ? info.status
          : getExportFieldValue(node, c);
        const cellValue = c.key === "description" && typeof value === "string" && value
          ? "  ".repeat(depth) + value
          : value;
        cells.push({ value: cellValue, center: isCenteredCol(c) });
      });
      addRow(sheet, cells);
    });
    return sheet;
  }

  // ---- .xlsx (Office Open XML) writer: minimal styles + auto-sized
  // columns + a hand-rolled ZIP (stored/uncompressed entries only, so no
  // DEFLATE implementation is needed — just CRC32 and the ZIP record
  // layout, both of which are simple and well-defined). ----

  function colLetter(index) {
    let letter = "";
    let n = index + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      letter = String.fromCharCode(65 + rem) + letter;
      n = Math.floor((n - 1) / 26);
    }
    return letter;
  }

  function computeColumnWidths(sheet) {
    const widths = [];
    sheet.rows.forEach((row) => {
      let colIdx = 0;
      row.forEach((cell) => {
        const span = cell.span || 1;
        if (span === 1) {
          const text = cell.value == null ? "" : String(cell.value);
          widths[colIdx] = Math.max(widths[colIdx] || 0, text.length);
        }
        colIdx += span;
      });
    });
    return widths.map((w) => Math.min(60, Math.max(8, w + 2)));
  }

  function sheetToXml(sheet) {
    const widths = computeColumnWidths(sheet);
    const colsXml = widths
      .map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>')
      .join("");

    const merges = [];
    const rowsXml = sheet.rows
      .map((row, rIdx) => {
        const rowNum = rIdx + 1;
        let colIdx = 0;
        const cellsXml = row
          .map((cell) => {
            const span = cell.span || 1;
            const ref = colLetter(colIdx) + rowNum;
            if (span > 1) merges.push(ref + ":" + colLetter(colIdx + span - 1) + rowNum);
            const styleId = STYLE_IDS[(cell.style || "normal") + (cell.center ? "-center" : "")];
            const styleAttr = styleId ? ' s="' + styleId + '"' : "";
            let xml;
            if (typeof cell.value === "number" && isFinite(cell.value)) {
              xml = '<c r="' + ref + '"' + styleAttr + "><v>" + cell.value + "</v></c>";
            } else {
              const text = cell.value == null ? "" : String(cell.value);
              xml = '<c r="' + ref + '" t="inlineStr"' + styleAttr + '><is><t xml:space="preserve">' +
                xmlEscape(text) + "</t></is></c>";
            }
            colIdx += span;
            return xml;
          })
          .join("");
        // Excel row grouping: a group header row is a summary row (level 0,
        // marked collapsed) and its member rows sit at outlineLevel 1,
        // hidden so the sheet opens collapsed — matching outlinePr below.
        let rowAttrs = "";
        if (row.outlineLevel) rowAttrs += ' outlineLevel="' + row.outlineLevel + '"';
        if (row.hidden) rowAttrs += ' hidden="1"';
        if (row.collapsed) rowAttrs += ' collapsed="1"';
        return '<row r="' + rowNum + '"' + rowAttrs + ">" + cellsXml + "</row>";
      })
      .join("");

    const mergesXml = merges.length
      ? '<mergeCells count="' + merges.length + '">' +
        merges.map((m) => '<mergeCell ref="' + m + '"/>').join("") +
        "</mergeCells>"
      : "";

    // summaryBelow="0": the group's summary (header) row is above its detail
    // rows, so Excel puts the +/- outline button on the header.
    const sheetPrXml = sheet.grouped ? '<sheetPr><outlinePr summaryBelow="0"/></sheetPr>' : "";

    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      sheetPrXml +
      "<cols>" + colsXml + "</cols>" +
      "<sheetData>" + rowsXml + "</sheetData>" +
      mergesXml +
      "</worksheet>"
    );
  }

  let crcTable = null;
  function getCrcTable() {
    if (crcTable) return crcTable;
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    crcTable = table;
    return table;
  }

  function crc32(bytes) {
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function u16le(n) {
    return [n & 0xff, (n >>> 8) & 0xff];
  }

  function u32le(n) {
    return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  }

  // files: array of { name, content } (content = text; encoded as UTF-8).
  // Every entry is stored uncompressed — a valid, simple ZIP that any
  // unzip implementation (including Excel's) reads fine, just larger than
  // a compressed one would be. Not worth a DEFLATE implementation for
  // workbooks this size.
  function buildZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach((file) => {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = encoder.encode(file.content);
      const crc = crc32(dataBytes);

      const localHeader = new Uint8Array([
        ...u32le(0x04034b50), ...u16le(20), ...u16le(0x0800), ...u16le(0),
        ...u16le(0), ...u16le(0x21),
        ...u32le(crc), ...u32le(dataBytes.length), ...u32le(dataBytes.length),
        ...u16le(nameBytes.length), ...u16le(0),
      ]);
      localParts.push(localHeader, nameBytes, dataBytes);

      const centralHeader = new Uint8Array([
        ...u32le(0x02014b50), ...u16le(20), ...u16le(20), ...u16le(0x0800), ...u16le(0),
        ...u16le(0), ...u16le(0x21),
        ...u32le(crc), ...u32le(dataBytes.length), ...u32le(dataBytes.length),
        ...u16le(nameBytes.length), ...u16le(0), ...u16le(0),
        ...u16le(0), ...u16le(0), ...u32le(0), ...u32le(offset),
      ]);
      centralParts.push(centralHeader, nameBytes);

      offset += localHeader.length + nameBytes.length + dataBytes.length;
    });

    const centralDirOffset = offset;
    const centralDirSize = centralParts.reduce((sum, p) => sum + p.length, 0);

    const eocd = new Uint8Array([
      ...u32le(0x06054b50), ...u16le(0), ...u16le(0),
      ...u16le(files.length), ...u16le(files.length),
      ...u32le(centralDirSize), ...u32le(centralDirOffset), ...u16le(0),
    ]);

    const allParts = localParts.concat(centralParts, [eocd]);
    const totalLength = allParts.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLength);
    let pos = 0;
    allParts.forEach((p) => {
      result.set(p, pos);
      pos += p.length;
    });
    return result;
  }

  function buildXlsxWorkbook(sheets) {
    const safeNames = sheets.map((s) => s.name.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Sheet");

    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets
        .map(
          (s, i) =>
            '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ' +
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
        .join("") +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      "</Types>";

    const rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      "</Relationships>";

    const workbookXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      "<sheets>" +
      sheets
        .map((s, i) => '<sheet name="' + xmlEscape(safeNames[i]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>')
        .join("") +
      "</sheets></workbook>";

    const workbookRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (s, i) =>
            '<Relationship Id="rId' + (i + 1) + '" ' +
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
            'Target="worksheets/sheet' + (i + 1) + '.xml"/>'
        )
        .join("") +
      '<Relationship Id="rId' + (sheets.length + 1) + '" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>";

    const stylesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="10"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="10"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      // 0 = normal, 1 = header, 2 = group header, 3 = centered,
      // 4 = centered header (see STYLE_IDS in sheetToXml).
      '<cellXfs count="5">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
      '<alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">' +
      '<alignment horizontal="center"/></xf>' +
      "</cellXfs>" +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      "</styleSheet>";

    const coreXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      "<dc:creator>Project Selector</dc:creator><cp:lastModifiedBy>Project Selector</cp:lastModifiedBy>" +
      "</cp:coreProperties>";

    const appXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
      "<Application>Project Selector</Application></Properties>";

    const files = [
      { name: "[Content_Types].xml", content: contentTypes },
      { name: "_rels/.rels", content: rootRels },
      { name: "xl/workbook.xml", content: workbookXml },
      { name: "xl/_rels/workbook.xml.rels", content: workbookRels },
      { name: "xl/styles.xml", content: stylesXml },
      { name: "docProps/core.xml", content: coreXml },
      { name: "docProps/app.xml", content: appXml },
    ];
    sheets.forEach((s, i) => {
      files.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", content: sheetToXml(s) });
    });

    return buildZip(files);
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  exportExcelBtn.addEventListener("click", () => {
    const sheets = [
      buildDetailsSheet(), buildTreeSheet(), buildFlatSheet(), buildRfxSheet(), buildImportSheet(),
    ];
    const xlsxBytes = buildXlsxWorkbook(sheets);
    const baseName = (project.wbs || project.name || "project").replace(/[^a-z0-9\-_.]+/gi, "_");
    downloadFile(
      xlsxBytes,
      baseName + "-export.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  // ---------- Import from Excel (CSV template round-trip) ----------
  // CSV is the interchange format: Excel opens/edits/saves it natively with
  // zero friction, and it's simple to parse reliably without a library —
  // unlike binary .xlsx, which isn't practical to parse by hand.
  const importExcelBtn = document.getElementById("importExcelBtn");
  const importDialog = document.getElementById("importDialog");
  const closeImportBtn = document.getElementById("closeImportBtn");
  const downloadTemplateBtn = document.getElementById("downloadTemplateBtn");
  const importFileInput = document.getElementById("importFileInput");
  const replaceExistingCheckbox = document.getElementById("replaceExistingCheckbox");
  const importResultMsg = document.getElementById("importResultMsg");
  const runImportBtn = document.getElementById("runImportBtn");

  function csvField(value) {
    const str = value == null ? "" : String(value);
    if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        field += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        row.push(field);
        field = "";
        i += 1;
        continue;
      }
      if (ch === "\r") {
        i += 1;
        continue;
      }
      if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
  }

  function templateExampleNodes() {
    return [
      {
        level: 0, assy: true, partNumber: "ASSY-100", qty: 1, spare: 0, manufacturer: "3M",
        commercialPartNo: "", supplied3M: true, description: "Example Assembly", rfx: "RFX-100", po: "",
        status: statusOptions[0] || "", notes: "", custom: {},
      },
      {
        level: 1, assy: false, partNumber: "PN-1000", qty: 2, spare: 1, manufacturer: "Acme Supply",
        commercialPartNo: "CP-1000", supplied3M: false,
        description: "Example Part (child of the row above — raise Level to nest deeper)",
        rfx: "RFX-100", po: "", status: statusOptions[0] || "", notes: "", custom: {},
      },
    ];
  }

  // The template is a workbook with the same "Import" sheet the export
  // produces, so an exported file can be edited and fed straight back in.
  function buildTemplateWorkbook() {
    const cols = getEditableColumns();
    const sheet = makeSheet(IMPORT_SHEET_NAME);
    addRow(
      sheet,
      [{ value: "Level", style: "header", center: true }].concat(
        cols.map((c) => ({ value: c.label, style: "header", center: isCenteredCol(c) }))
      )
    );
    templateExampleNodes().forEach((n) => {
      addRow(
        sheet,
        [{ value: n.level, center: true }].concat(
          cols.map((c) => ({ value: getExportFieldValue(n, c), center: isCenteredCol(c) }))
        )
      );
    });
    return buildXlsxWorkbook([sheet]);
  }

  function makeImportedNode(rowValues, cols, colIndexByKey) {
    const node = {
      guid: Store.makeId(), assy: false, includedInParent: false, partNumber: "", manufacturer: "",
      commercialPartNo: "", supplied3M: false, description: "", qty: 1, rfx: "", po: "",
      status: statusOptions[0] || "", notes: "", custom: {}, children: [],
    };
    cols.forEach((c) => {
      const idx = colIndexByKey[c.key];
      if (idx === undefined) return;
      const raw = (rowValues[idx] || "").trim();
      let value;
      if (c.type === "checkbox") value = ["x", "1", "true", "yes"].indexOf(raw.toLowerCase()) !== -1;
      else if (c.type === "number") value = raw === "" ? (c.key === "qty" ? 1 : 0) : Number(raw) || 0;
      else value = raw;
      if (c.custom) node.custom[c.fieldKey] = value;
      else node[c.key] = value;
    });
    return node;
  }

  function buildTreeFromLeveledRows(leveledRows) {
    const roots = [];
    const stack = [];
    leveledRows.forEach(({ node, level }) => {
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      if (stack.length === 0) {
        roots.push(node);
      } else {
        const parent = stack[stack.length - 1].node;
        parent.children = parent.children || [];
        parent.children.push(node);
        parent.assy = true;
      }
      stack.push({ node: node, level: level });
    });
    return roots;
  }

  // ---- Minimal .xlsx reader ----
  // Enough of the ZIP + SpreadsheetML format to pull a named sheet back out
  // of a workbook we (or Excel) wrote. Excel deflates its entries, so this
  // leans on the browser's built-in DecompressionStream rather than
  // bundling an inflate implementation.
  function readU16(b, o) { return b[o] | (b[o + 1] << 8); }
  function readU32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This browser can't unzip .xlsx files. Save the sheet as CSV and import that instead.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Returns { name -> Uint8Array } for every entry in the zip.
  async function unzip(buffer) {
    const b = new Uint8Array(buffer);
    // End of Central Directory: scan back from the tail for its signature.
    let eocd = -1;
    for (let i = b.length - 22; i >= 0 && i > b.length - 65558; i--) {
      if (readU32(b, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error("That doesn't look like a valid .xlsx file.");

    const count = readU16(b, eocd + 10);
    let p = readU32(b, eocd + 16);
    const files = {};
    for (let i = 0; i < count; i++) {
      if (readU32(b, p) !== 0x02014b50) break;
      const method = readU16(b, p + 10);
      const compSize = readU32(b, p + 20);
      const nameLen = readU16(b, p + 28);
      const extraLen = readU16(b, p + 30);
      const commentLen = readU16(b, p + 32);
      const localOff = readU32(b, p + 42);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));

      // Jump to the local header to find where the data actually starts.
      const lNameLen = readU16(b, localOff + 26);
      const lExtraLen = readU16(b, localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = b.subarray(dataStart, dataStart + compSize);
      files[name] = method === 0 ? raw : await inflateRaw(raw);

      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  function xmlDoc(bytes) {
    return new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  }

  function colRefToIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || "");
    if (!m) return 0;
    let n = 0;
    for (let i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }

  function textOfAllT(node) {
    const ts = node.getElementsByTagName("t");
    let s = "";
    for (let i = 0; i < ts.length; i++) s += ts[i].textContent;
    return s;
  }

  // Reads one named worksheet into rows of plain strings.
  async function readXlsxSheet(buffer, sheetName) {
    const files = await unzip(buffer);
    if (!files["xl/workbook.xml"]) throw new Error("That .xlsx has no workbook — is the file corrupt?");

    const wb = xmlDoc(files["xl/workbook.xml"]);
    const sheetEls = wb.getElementsByTagName("sheet");
    let relId = null;
    const available = [];
    for (let i = 0; i < sheetEls.length; i++) {
      const nm = sheetEls[i].getAttribute("name");
      available.push(nm);
      if (nm && nm.toLowerCase() === sheetName.toLowerCase()) {
        relId = sheetEls[i].getAttribute("r:id") || sheetEls[i].getAttribute("id");
      }
    }
    if (!relId) {
      throw new Error(
        'No "' + sheetName + '" sheet in that workbook. Found: ' + (available.join(", ") || "none") + "."
      );
    }

    const rels = xmlDoc(files["xl/_rels/workbook.xml.rels"]);
    const relEls = rels.getElementsByTagName("Relationship");
    let target = null;
    for (let i = 0; i < relEls.length; i++) {
      if (relEls[i].getAttribute("Id") === relId) target = relEls[i].getAttribute("Target");
    }
    if (!target) throw new Error("Couldn't locate that sheet inside the workbook.");
    const path = target.replace(/^\//, "").replace(/^xl\//, "");
    const sheetBytes = files["xl/" + path];
    if (!sheetBytes) throw new Error("Couldn't read that sheet from the workbook.");

    const shared = [];
    if (files["xl/sharedStrings.xml"]) {
      const sst = xmlDoc(files["xl/sharedStrings.xml"]);
      const sis = sst.getElementsByTagName("si");
      for (let i = 0; i < sis.length; i++) shared.push(textOfAllT(sis[i]));
    }

    const doc = xmlDoc(sheetBytes);
    const rowEls = doc.getElementsByTagName("row");
    const rows = [];
    for (let i = 0; i < rowEls.length; i++) {
      const cellEls = rowEls[i].getElementsByTagName("c");
      const cells = [];
      for (let j = 0; j < cellEls.length; j++) {
        const c = cellEls[j];
        const idx = colRefToIndex(c.getAttribute("r"));
        const t = c.getAttribute("t");
        let val = "";
        if (t === "s") {
          const v = c.getElementsByTagName("v")[0];
          val = v ? (shared[parseInt(v.textContent, 10)] || "") : "";
        } else if (t === "inlineStr") {
          val = textOfAllT(c);
        } else {
          const v = c.getElementsByTagName("v")[0];
          val = v ? v.textContent : "";
        }
        cells[idx] = val;
      }
      for (let k = 0; k < cells.length; k++) if (cells[k] === undefined) cells[k] = "";
      rows.push(cells);
    }
    return rows;
  }

  function importCsvText(text, replace) {
    return importRows(parseCsv(text), replace);
  }

  function importRows(rows, replace) {
    if (rows.length === 0) throw new Error("The file is empty.");

    const header = rows[0].map((h) => (h || "").trim());
    const dataRows = rows.slice(1);
    if (dataRows.length === 0) throw new Error("No data rows found below the header.");

    const levelIdx = header.findIndex((h) => h.toLowerCase() === "level");
    if (levelIdx === -1) {
      throw new Error('Missing a "Level" column. Start from the downloaded template.');
    }

    const cols = getEditableColumns();
    const colIndexByKey = {};
    cols.forEach((c) => {
      const idx = header.findIndex((h) => h.toLowerCase() === c.label.toLowerCase());
      if (idx !== -1) colIndexByKey[c.key] = idx;
    });

    let skipped = 0;
    const leveledRows = [];
    dataRows.forEach((r) => {
      if (r.every((v) => (v || "").trim() === "")) {
        skipped += 1;
        return;
      }
      const level = Math.max(0, parseInt(r[levelIdx], 10) || 0);
      leveledRows.push({ node: makeImportedNode(r, cols, colIndexByKey), level: level });
    });

    if (leveledRows.length === 0) throw new Error("No usable data rows found.");

    const importedRoots = buildTreeFromLeveledRows(leveledRows);
    if (replace) tree.length = 0;
    importedRoots.forEach((n) => tree.push(n));
    Store.saveBom(project.id, tree);

    const addedOrders = syncOrdersFromImport(leveledRows.map((r) => r.node));

    renderBom();
    renderOrders();

    return { imported: leveledRows.length, skipped: skipped, addedOrders: addedOrders };
  }

  // Any RFx referenced by imported rows that isn't in the Orders table yet
  // gets an order created for it, so the imported BOM's RFx values resolve
  // to real orders (and their PO, if the sheet paired one with the RFx).
  function syncOrdersFromImport(nodes) {
    const seen = new Map();
    nodes.forEach((n) => {
      const rfx = (n.rfx || "").trim();
      if (!rfx) return;
      const po = (n.po || "").trim();
      if (!seen.has(rfx) || (!seen.get(rfx) && po)) seen.set(rfx, po);
    });

    let added = 0;
    seen.forEach((po, rfx) => {
      const existing = orders.find((o) => (o.rfx || "").trim().toLowerCase() === rfx.toLowerCase());
      if (existing) {
        // Fill in a PO we learned from the sheet, but never overwrite one.
        if (po && !(existing.po || "").trim()) existing.po = po;
        return;
      }
      orders.push({
        guid: Store.makeId(), rfx: rfx, po: po,
        description: "", supplierName: "", deliveryDate: "", status: "",
      });
      added += 1;
    });

    if (added || seen.size) Store.saveOrders(project.id, orders);
    return added;
  }

  function openImportDialog() {
    importFileInput.value = "";
    replaceExistingCheckbox.checked = false;
    runImportBtn.disabled = true;
    importResultMsg.hidden = true;
    importDialog.showModal();
  }

  importExcelBtn.addEventListener("click", openImportDialog);
  closeImportBtn.addEventListener("click", () => importDialog.close());
  importDialog.addEventListener("click", (e) => {
    if (e.target === importDialog) importDialog.close();
  });

  downloadTemplateBtn.addEventListener("click", () => {
    const baseName = (project.wbs || project.name || "project").replace(/[^a-z0-9\-_.]+/gi, "_");
    downloadFile(
      buildTemplateWorkbook(),
      baseName + "-bom-template.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  importFileInput.addEventListener("change", () => {
    importResultMsg.hidden = true;
    runImportBtn.disabled = importFileInput.files.length === 0;
  });

  function readFile(file, asArrayBuffer) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read that file."));
      if (asArrayBuffer) reader.readAsArrayBuffer(file);
      else reader.readAsText(file);
    });
  }

  runImportBtn.addEventListener("click", async () => {
    const file = importFileInput.files[0];
    if (!file) return;

    if (
      replaceExistingCheckbox.checked &&
      !window.confirm("This deletes every current BOM item and replaces them with the imported file. Continue?")
    ) {
      return;
    }

    runImportBtn.disabled = true;
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      let rows;
      if (isXlsx) {
        const buffer = await readFile(file, true);
        rows = await readXlsxSheet(buffer, IMPORT_SHEET_NAME);
      } else {
        rows = parseCsv(String(await readFile(file, false)));
      }

      const result = importRows(rows, replaceExistingCheckbox.checked);
      importResultMsg.className = "import-result success";
      importResultMsg.textContent =
        "Imported " + result.imported + " item" + (result.imported === 1 ? "" : "s") +
        (isXlsx ? ' from the "' + IMPORT_SHEET_NAME + '" sheet' : "") + "." +
        (result.skipped ? " Skipped " + result.skipped + " blank row" + (result.skipped === 1 ? "" : "s") + "." : "") +
        (result.addedOrders
          ? " Added " + result.addedOrders + " RFx" + (result.addedOrders === 1 ? "" : "s") + " to Orders."
          : "");
      importResultMsg.hidden = false;
      importFileInput.value = "";
    } catch (err) {
      importResultMsg.className = "import-result error";
      importResultMsg.textContent = "Import failed: " + err.message;
      importResultMsg.hidden = false;
      runImportBtn.disabled = importFileInput.files.length === 0;
    }
  });

  // ---------- Init ----------
  populateDetailsForm();
  renderBom();
  renderOrders();
})();
