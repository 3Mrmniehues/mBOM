// Self-contained Excel (.xlsx) exporter for a single project's data, usable
// from any page (the home page's delete dialog and the project page).
//
// It takes raw data — { project, tree, orders, statusOptions, customFields } —
// and produces the same five-sheet workbook the project page's "Export to
// Excel" button does: Project Details, BOM (Tree), BOM (Flat), BOM (By RFx),
// and Import.
//
// NOTE: this deliberately mirrors the export logic in js/project.js so the
// home page can export without loading the whole project editor. If the
// export format changes, update both. (project.js keeps its own copy because
// its version is wired into the live editor state.)
window.Excel = (function () {
  "use strict";

  // ---- Column schema (mirrors project.js) ----
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
    { key: "rfx", label: "RFx", type: "text" },
    { key: "po", label: "PO", type: "text" },
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
  const FLAT_EXCLUDED_KEYS = [
    "partNumber", "description", "manufacturer", "commercialPartNo", "supplied3M", "qty", "itemNo",
    "includedInParent", "spare",
  ];
  const RFX_VIEW = { field: "rfx", emptyLabel: "(No RFx)", excludedKeys: FLAT_EXCLUDED_KEYS.concat(["rfx"]) };
  const CENTERED_EXPORT_KEYS = ["assy", "includedInParent", "qty", "supplied3M", "spare", "totalQty"];
  const IMPORT_SHEET_NAME = "Import";
  const STYLE_IDS = {
    normal: 0, "normal-center": 3,
    header: 1, "header-center": 4,
    groupHeader: 2, "groupHeader-center": 2,
  };

  function getAllColumns(customFields) {
    const custom = (customFields || []).map((f) => ({
      key: "custom:" + f.key, label: f.label, type: f.type, options: f.options,
      custom: true, fieldKey: f.key,
    }));
    return BASE_COLUMNS.concat(custom);
  }

  function getEditableColumns(customFields) {
    return getAllColumns(customFields).filter((c) => c.type !== "computed");
  }

  function isCenteredCol(col) {
    return CENTERED_EXPORT_KEYS.indexOf(col.key) !== -1;
  }

  function todayIso() {
    const d = new Date();
    const pad = (n) => (n < 10 ? "0" + n : String(n));
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function getExportFieldValue(node, col) {
    const raw = col.custom ? (node.custom ? node.custom[col.fieldKey] : undefined) : node[col.key];
    if (col.type === "checkbox") return raw ? "X" : "";
    if (col.type === "number") return raw === "" || raw == null ? "" : Number(raw);
    return raw == null ? "" : raw;
  }

  // ---- BOM flattening / aggregation (mirrors project.js) ----
  function lookupPoForRfx(orders, rfxValue) {
    const v = (rfxValue || "").trim();
    if (!v) return "";
    const match = (orders || []).find((o) => (o.rfx || "").trim() === v);
    return match ? (match.po || "").trim() : "";
  }

  function collectFlatNodes(nodes, orders, multiplier, out) {
    if (multiplier === undefined) multiplier = 1;
    if (out === undefined) out = [];
    nodes.forEach((n) => {
      const extendedQty = ((Number(n.qty) || 0) + (Number(n.spare) || 0)) * multiplier;
      if (!n.includedInParent && (n.partNumber || "").trim()) {
        out.push(Object.assign({}, n, { qty: extendedQty, po: lookupPoForRfx(orders, n.rfx) }));
      }
      if (n.children && n.children.length) collectFlatNodes(n.children, orders, extendedQty, out);
    });
    return out;
  }

  function aggregateByPartNumber(nodes) {
    const map = new Map();
    nodes.forEach((n) => {
      const key = n.partNumber.trim();
      if (!map.has(key)) {
        map.set(key, {
          partNumber: key, description: n.description, manufacturer: n.manufacturer,
          commercialPartNo: n.commercialPartNo, supplied3M: n.supplied3M, assy: n.assy,
          rfx: n.rfx, po: n.po, status: n.status, notes: n.notes,
          custom: Object.assign({}, n.custom), totalQty: 0, occurrences: 0,
        });
      }
      const agg = map.get(key);
      agg.totalQty += Number(n.qty) || 0;
      agg.occurrences += 1;
    });
    return Array.from(map.values());
  }

  function computeItemNumbers(nodes, prefix, map) {
    nodes.forEach((n, idx) => {
      const num = prefix ? prefix + "." + (idx + 1) : String(idx + 1);
      map.set(n.guid, num);
      if (n.children && n.children.length) computeItemNumbers(n.children, num, map);
    });
    return map;
  }

  function buildParentMap(nodes, parent, map) {
    if (map === undefined) map = new Map();
    nodes.forEach((n) => {
      map.set(n.guid, parent || null);
      if (n.children && n.children.length) buildParentMap(n.children, n, map);
    });
    return map;
  }

  function resolveOrderInfo(node, parentMap, orders) {
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
    return { rfx: rfx, po: lookupPoForRfx(orders, rfx), status: source.status || "" };
  }

  function flattenTreeForExport(nodes, depth, out) {
    nodes.forEach((n) => {
      out.push({ node: n, depth: depth });
      if (n.children && n.children.length) flattenTreeForExport(n.children, depth + 1, out);
    });
  }

  // The group header row as individual cells (not one merged cell), so each
  // piece — RFx, PO, description, supplier, delivery date, status, and the
  // part/qty roll-up — lands in its own spreadsheet cell.
  function groupHeaderCells(orders, g) {
    const cells = [{ value: g.group, style: "groupHeader" }];
    const order = (orders || []).find((o) => (o.rfx || "").trim() === g.group);
    if (order) {
      cells.push({ value: "PO: " + ((order.po || "").trim() || "(none)"), style: "groupHeader" });
      if ((order.description || "").trim()) cells.push({ value: order.description.trim(), style: "groupHeader" });
      if ((order.supplierName || "").trim()) cells.push({ value: order.supplierName.trim(), style: "groupHeader" });
      if ((order.deliveryDate || "").trim()) cells.push({ value: "Due " + order.deliveryDate.trim(), style: "groupHeader" });
      if ((order.status || "").trim()) cells.push({ value: order.status.trim(), style: "groupHeader" });
    }
    cells.push({ value: g.rows.length + " part" + (g.rows.length === 1 ? "" : "s"), style: "groupHeader" });
    cells.push({ value: "Qty " + g.totalQty, style: "groupHeader" });
    return cells;
  }

  // ---- Sheet model ----
  function makeSheet(name) { return { name: name, rows: [] }; }
  function addRow(sheet, cells, opts) {
    if (opts) {
      if (opts.outlineLevel) cells.outlineLevel = opts.outlineLevel;
      if (opts.collapsed) cells.collapsed = true;
      if (opts.hidden) cells.hidden = true;
    }
    sheet.rows.push(cells);
    return cells;
  }

  function getExportAggregateColumns(customFields, excludeKeys) {
    const extra = getAllColumns(customFields).filter((c) => excludeKeys.indexOf(c.key) === -1);
    return FLAT_COLUMNS.concat(extra);
  }

  // ---- Sheet builders ----
  function buildDetailsSheet(project) {
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

  function buildTreeSheet(data) {
    const cols = getAllColumns(data.customFields);
    const sheet = makeSheet("BOM (Tree)");
    sheet.grouped = true;
    addRow(sheet, [{ value: "Level", style: "header", center: true }].concat(
      cols.map((c) => ({ value: c.label, style: "header", center: isCenteredCol(c) }))
    ));
    const flat = [];
    flattenTreeForExport(data.tree, 0, flat);
    const itemNumbers = computeItemNumbers(data.tree, "", new Map());
    const parentMap = buildParentMap(data.tree, null);
    flat.forEach(({ node, depth }) => {
      const info = resolveOrderInfo(node, parentMap, data.orders);
      const cells = [{ value: depth, center: true }];
      cols.forEach((c) => {
        const value = c.key === "itemNo" ? itemNumbers.get(node.guid) || ""
          : c.key === "po" ? info.po
          : c.key === "rfx" ? info.rfx
          : c.key === "status" ? info.status
          : getExportFieldValue(node, c);
        const cellValue = c.key === "description" && typeof value === "string" && value
          ? "  ".repeat(depth) + value : value;
        cells.push({ value: cellValue, center: isCenteredCol(c) });
      });
      addRow(sheet, cells, { outlineLevel: Math.min(depth, 7) });
    });
    return sheet;
  }

  function buildFlatSheet(data) {
    const cols = getExportAggregateColumns(data.customFields, FLAT_EXCLUDED_KEYS);
    const sheet = makeSheet("BOM (Flat)");
    addRow(sheet, cols.map((c) => ({ value: c.label, style: "header", center: isCenteredCol(c) })));
    const aggregated = aggregateByPartNumber(collectFlatNodes(data.tree, data.orders));
    aggregated.sort((a, b) => a.partNumber.localeCompare(b.partNumber));
    aggregated.forEach((r) => {
      addRow(sheet, cols.map((c) => ({ value: getExportFieldValue(r, c), center: isCenteredCol(c) })));
    });
    return sheet;
  }

  function buildRfxSheet(data) {
    const cols = getExportAggregateColumns(data.customFields, RFX_VIEW.excludedKeys);
    const sheet = makeSheet("BOM (By RFx)");
    sheet.grouped = true;
    addRow(sheet, cols.map((c) => ({ value: c.label, style: "header", center: isCenteredCol(c) })));

    const nodes = collectFlatNodes(data.tree, data.orders);
    const groups = new Map();
    nodes.forEach((n) => {
      const key = (n[RFX_VIEW.field] || "").trim() || RFX_VIEW.emptyLabel;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    });
    let entries = Array.from(groups.entries()).map(([group, groupNodes]) => ({
      group: group,
      rows: aggregateByPartNumber(groupNodes).sort((a, b) => a.partNumber.localeCompare(b.partNumber)),
    }));
    entries.sort((a, b) => {
      if (a.group === RFX_VIEW.emptyLabel) return 1;
      if (b.group === RFX_VIEW.emptyLabel) return -1;
      return a.group.localeCompare(b.group);
    });
    entries.forEach((g) => {
      g.totalQty = g.rows.reduce((sum, r) => sum + r.totalQty, 0);
      // Each header piece is its own cell (no merge); pad with empty
      // groupHeader cells so the shaded band spans the table width.
      const headerCells = groupHeaderCells(data.orders, g);
      while (headerCells.length < cols.length) headerCells.push({ value: "", style: "groupHeader" });
      addRow(sheet, headerCells, { collapsed: true });
      g.rows.forEach((r) => {
        addRow(sheet, cols.map((c) => ({ value: getExportFieldValue(r, c), center: isCenteredCol(c) })), { outlineLevel: 1, hidden: true });
      });
    });
    return sheet;
  }

  function buildImportSheet(data) {
    const cols = getEditableColumns(data.customFields);
    const sheet = makeSheet(IMPORT_SHEET_NAME);
    addRow(sheet, [{ value: "Level", style: "header", center: true }].concat(
      cols.map((c) => ({ value: c.label, style: "header", center: isCenteredCol(c) }))
    ));
    const flat = [];
    flattenTreeForExport(data.tree, 0, flat);
    const parentMap = buildParentMap(data.tree, null);
    flat.forEach(({ node, depth }) => {
      const info = resolveOrderInfo(node, parentMap, data.orders);
      const cells = [{ value: depth, center: true }];
      cols.forEach((c) => {
        const value = c.key === "po" ? info.po
          : c.key === "rfx" ? info.rfx
          : c.key === "status" ? info.status
          : getExportFieldValue(node, c);
        const cellValue = c.key === "description" && typeof value === "string" && value
          ? "  ".repeat(depth) + value : value;
        cells.push({ value: cellValue, center: isCenteredCol(c) });
      });
      addRow(sheet, cells);
    });
    return sheet;
  }

  // ---- .xlsx writer (mirrors project.js) ----
  function xmlEscape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
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
    const rowsXml = sheet.rows.map((row, rIdx) => {
      const rowNum = rIdx + 1;
      let colIdx = 0;
      const cellsXml = row.map((cell) => {
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
      }).join("");
      let rowAttrs = "";
      if (row.outlineLevel) rowAttrs += ' outlineLevel="' + row.outlineLevel + '"';
      if (row.hidden) rowAttrs += ' hidden="1"';
      if (row.collapsed) rowAttrs += ' collapsed="1"';
      return '<row r="' + rowNum + '"' + rowAttrs + ">" + cellsXml + "</row>";
    }).join("");
    const mergesXml = merges.length
      ? '<mergeCells count="' + merges.length + '">' +
        merges.map((m) => '<mergeCell ref="' + m + '"/>').join("") + "</mergeCells>"
      : "";
    const sheetPrXml = sheet.grouped ? '<sheetPr><outlinePr summaryBelow="0"/></sheetPr>' : "";
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      sheetPrXml + "<cols>" + colsXml + "</cols>" +
      "<sheetData>" + rowsXml + "</sheetData>" + mergesXml + "</worksheet>"
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
  function u16le(n) { return [n & 0xff, (n >>> 8) & 0xff]; }
  function u32le(n) { return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; }

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
    allParts.forEach((p) => { result.set(p, pos); pos += p.length; });
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
      sheets.map((s, i) =>
        '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ' +
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") +
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
      sheets.map((s, i) => '<sheet name="' + xmlEscape(safeNames[i]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") +
      "</sheets></workbook>";
    const workbookRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s, i) =>
        '<Relationship Id="rId' + (i + 1) + '" ' +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
        'Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") +
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
      '<cellXfs count="5">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
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

  // ---- Public API ----
  // data = { project, tree, orders, statusOptions, customFields }
  function buildProjectWorkbook(data) {
    return buildXlsxWorkbook([
      buildDetailsSheet(data.project),
      buildTreeSheet(data),
      buildFlatSheet(data),
      buildRfxSheet(data),
      buildImportSheet(data),
    ]);
  }

  function downloadWorkbook(bytes, filename) {
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadProjectWorkbook(data) {
    const baseName = (data.project.wbs || data.project.name || "project").replace(/[^a-z0-9\-_.]+/gi, "_");
    downloadWorkbook(buildProjectWorkbook(data), baseName + "-export.xlsx");
  }

  return {
    buildProjectWorkbook: buildProjectWorkbook,
    downloadProjectWorkbook: downloadProjectWorkbook,
    downloadWorkbook: downloadWorkbook,
  };
})();
