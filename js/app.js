(function () {
  const cardGrid = document.getElementById("projectCards");
  const emptyState = document.getElementById("emptyState");
  const resultCount = document.getElementById("resultCount");
  const searchInput = document.getElementById("searchInput");
  const statusFilter = document.getElementById("statusFilter");
  const sortSelect = document.getElementById("sortSelect");
  const clearFiltersBtn = document.getElementById("clearFiltersBtn");
  const themeBtn = document.getElementById("themeBtn");

  const newProjectBtn = document.getElementById("newProjectBtn");
  const newProjectDialog = document.getElementById("newProjectDialog");
  const newProjectForm = document.getElementById("newProjectForm");
  const cancelNewProjectBtn = document.getElementById("cancelNewProjectBtn");
  const formError = document.getElementById("formError");
  const fieldWbs = document.getElementById("fieldWbs");
  const fieldEwr = document.getElementById("fieldEwr");
  const fieldName = document.getElementById("fieldName");
  const fieldStatus = document.getElementById("fieldStatus");
  const fieldDateCreated = document.getElementById("fieldDateCreated");

  // Before loading data, check the server has a data location configured. On a
  // fresh install it won't — show first-run setup instead of a load error.
  let dataInfo = null;
  try {
    dataInfo = Store.getDataInfo();
  } catch (e) {
    // Server unreachable; the first-run prompt is a reasonable fallback.
  }
  const dataConfigured = !!(dataInfo && dataInfo.configured);

  let projects = dataConfigured ? Store.getProjects() : [];
  let sortKey = "dateCreated";
  let sortDir = "desc"; // "asc" | "desc"

  function statusClass(status) {
    return "status-" + status.toLowerCase().replace(/\s+/g, "");
  }

  function populateStatusOptions() {
    const statuses = Array.from(new Set(projects.map((p) => p.status))).sort();
    statuses.forEach((status) => {
      const opt = document.createElement("option");
      opt.value = status;
      opt.textContent = status;
      statusFilter.appendChild(opt);
    });
  }

  function getFiltered() {
    const query = searchInput.value.trim().toLowerCase();
    const status = statusFilter.value;
    return projects.filter((p) => {
      const matchesQuery =
        !query ||
        (p.wbs || "").toLowerCase().includes(query) ||
        (p.ewr || "").toLowerCase().includes(query) ||
        (p.name || "").toLowerCase().includes(query);
      const matchesStatus = !status || p.status === status;
      return matchesQuery && matchesStatus;
    });
  }

  function getSorted(list) {
    const sorted = list.slice().sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === "dateCreated") {
        av = new Date(av).getTime();
        bv = new Date(bv).getTime();
      } else {
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function render() {
    const filtered = getSorted(getFiltered());

    cardGrid.innerHTML = "";
    filtered.forEach((p) => {
      const card = document.createElement("div");
      card.className = "proj-card";
      card.innerHTML =
        (p.wbs ? '<span class="card-wbs">WBS ' + escapeHtml(p.wbs) + "</span>" : '<span class="card-wbs muted">No WBS</span>') +
        "<h3>" + escapeHtml(p.name || "(untitled)") + "</h3>" +
        '<div class="card-meta">' +
          "<span>" + (p.ewr ? "EWR " + escapeHtml(p.ewr) : "—") + "</span>" +
          "<span>Created " + escapeHtml(formatDate(p.dateCreated)) + "</span>" +
        "</div>" +
        '<div class="card-foot">' +
          '<span class="status-pill ' + statusClass(p.status || "") + '">' + escapeHtml(p.status || "—") + "</span>" +
          '<div class="card-actions">' +
            '<button type="button" class="card-edit" title="Edit project" aria-label="Edit project">' +
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>' +
            "</button>" +
            '<button type="button" class="card-delete" title="Delete project" aria-label="Delete project">Delete</button>' +
          "</div>" +
        "</div>";

      card.addEventListener("click", () => goToProject(p.id));
      card.querySelector(".card-edit").addEventListener("click", (e) => {
        e.stopPropagation(); // don't open the project
        openEditDialog(p);
      });
      card.querySelector(".card-delete").addEventListener("click", (e) => {
        e.stopPropagation(); // don't open the project
        openDeleteDialog(p);
      });
      cardGrid.appendChild(card);
    });

    emptyState.hidden = filtered.length !== 0;
    resultCount.textContent =
      filtered.length === projects.length
        ? filtered.length + " project" + (filtered.length === 1 ? "" : "s")
        : "Showing " + filtered.length + " of " + projects.length + " projects";
  }

  function goToProject(id) {
    // Navigate by id, not WBS: WBS is now optional, so it may be blank or
    // shared between projects.
    if (!id) return;
    window.location.href = "project.html?id=" + encodeURIComponent(id);
  }

  if (sortSelect) {
    sortSelect.value = sortKey + "-" + sortDir;
    sortSelect.addEventListener("change", () => {
      const parts = sortSelect.value.split("-");
      sortKey = parts[0];
      sortDir = parts[1] || "asc";
      render();
    });
  }

  // ---------- Theme toggle ----------
  var sunIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5 3.6 3.6M20.4 20.4 19 19M19 5l1.4-1.4M3.6 20.4 5 19"/></svg>';
  var moonIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z"/></svg>';
  function paintThemeBtn() {
    if (!themeBtn || !window.MBOMTheme) return;
    themeBtn.innerHTML = window.MBOMTheme.effective() === "dark" ? sunIcon : moonIcon;
  }
  if (themeBtn && window.MBOMTheme) {
    window.MBOMTheme.onChange = paintThemeBtn;
    paintThemeBtn();
    themeBtn.addEventListener("click", function () { window.MBOMTheme.toggle(); });
  }

  searchInput.addEventListener("input", render);
  statusFilter.addEventListener("change", render);
  clearFiltersBtn.addEventListener("click", () => {
    searchInput.value = "";
    statusFilter.value = "";
    if (sortSelect) { sortKey = "dateCreated"; sortDir = "desc"; sortSelect.value = "dateCreated-desc"; }
    render();
  });

  function openNewProjectDialog() {
    newProjectForm.reset();
    fieldDateCreated.value = new Date().toISOString().slice(0, 10);
    formError.hidden = true;
    newProjectDialog.showModal();
    fieldWbs.focus();
  }

  function closeNewProjectDialog() {
    newProjectDialog.close();
  }

  newProjectBtn.addEventListener("click", openNewProjectDialog);
  cancelNewProjectBtn.addEventListener("click", closeNewProjectDialog);

  newProjectDialog.addEventListener("click", (e) => {
    if (e.target === newProjectDialog) closeNewProjectDialog();
  });

  newProjectForm.addEventListener("submit", (e) => {
    e.preventDefault();
    formError.hidden = true;

    if (!newProjectForm.checkValidity()) {
      newProjectForm.reportValidity();
      return;
    }

    const wbs = fieldWbs.value.trim();
    const ewr = fieldEwr.value.trim();
    const name = fieldName.value.trim();
    const status = fieldStatus.value;
    const dateCreated = fieldDateCreated.value;

    // Only enforce WBS uniqueness when a WBS was entered — it's optional now.
    const duplicate = wbs && projects.some((p) => (p.wbs || "").toLowerCase() === wbs.toLowerCase());
    if (duplicate) {
      formError.textContent = "A project with WBS \"" + wbs + "\" already exists.";
      formError.hidden = false;
      fieldWbs.focus();
      return;
    }

    const project = { id: Store.makeId(), wbs, ewr, name, status, dateCreated };
    Store.addProject(project);
    projects = Store.getProjects();
    searchInput.value = "";
    statusFilter.value = "";
    render();
    closeNewProjectDialog();
  });

  // ---------- Edit project dialog ----------
  const editProjectDialog = document.getElementById("editProjectDialog");
  const editProjectForm = document.getElementById("editProjectForm");
  const editWbs = document.getElementById("editWbs");
  const editEwr = document.getElementById("editEwr");
  const editName = document.getElementById("editName");
  const editStatus = document.getElementById("editStatus");
  const editDateCreated = document.getElementById("editDateCreated");
  const editFormError = document.getElementById("editFormError");
  const cancelEditProjectBtn = document.getElementById("cancelEditProjectBtn");
  let editingId = null;

  function openEditDialog(p) {
    editingId = p.id;
    editWbs.value = p.wbs || "";
    editEwr.value = p.ewr || "";
    editName.value = p.name || "";
    editStatus.value = p.status || "Active";
    editDateCreated.value = p.dateCreated || "";
    editFormError.hidden = true;
    editProjectDialog.showModal();
    editName.focus();
  }
  cancelEditProjectBtn.addEventListener("click", () => editProjectDialog.close());
  editProjectDialog.addEventListener("click", (e) => { if (e.target === editProjectDialog) editProjectDialog.close(); });
  editProjectForm.addEventListener("submit", (e) => {
    e.preventDefault();
    editFormError.hidden = true;
    if (!editProjectForm.checkValidity()) { editProjectForm.reportValidity(); return; }
    const wbs = editWbs.value.trim();
    const ewr = editEwr.value.trim();
    const name = editName.value.trim();
    const status = editStatus.value;
    const dateCreated = editDateCreated.value;
    const duplicate = wbs && projects.some((p) => p.id !== editingId && (p.wbs || "").toLowerCase() === wbs.toLowerCase());
    if (duplicate) {
      editFormError.textContent = "A project with WBS \"" + wbs + "\" already exists.";
      editFormError.hidden = false;
      editWbs.focus();
      return;
    }
    Store.updateProject(editingId, { wbs, ewr, name, status, dateCreated });
    projects = Store.getProjects();
    render();
    editProjectDialog.close();
  });

  // ---------- Excel data connection dialog ----------
  const excelDataBtn = document.getElementById("excelDataBtn");
  const excelDataDialog = document.getElementById("excelDataDialog");
  const excelUrl = document.getElementById("excelUrl");
  const excelFilePath = document.getElementById("excelFilePath");
  const copyUrlBtn = document.getElementById("copyUrlBtn");
  const copyPathBtn = document.getElementById("copyPathBtn");
  const downloadJsonBtn = document.getElementById("downloadJsonBtn");
  const closeExcelDialogBtn = document.getElementById("closeExcelDialogBtn");

  const dataUrl = window.location.origin + "/api/data.json";

  function copyToClipboard(text, btn) {
    const done = () => {
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = original), 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  excelDataBtn.addEventListener("click", () => {
    excelUrl.value = dataUrl;
    excelFilePath.value = "(loading…)";
    // Fetch the on-disk path from the server (it may be relocated to a shared
    // drive via config.ini, so always ask rather than assume).
    fetch("/api/data-info")
      .then((r) => r.json())
      .then((info) => { excelFilePath.value = info.filePath || "data/export.json"; })
      .catch(() => { excelFilePath.value = "(unavailable — is the app server running?)"; });
    excelDataDialog.showModal();
  });

  closeExcelDialogBtn.addEventListener("click", () => excelDataDialog.close());
  excelDataDialog.addEventListener("click", (e) => {
    if (e.target === excelDataDialog) excelDataDialog.close();
  });

  copyUrlBtn.addEventListener("click", () => copyToClipboard(excelUrl.value, copyUrlBtn));
  copyPathBtn.addEventListener("click", () => copyToClipboard(excelFilePath.value, copyPathBtn));

  downloadJsonBtn.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "bom-data.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  // ---------- Delete project (with optional Excel export first) ----------
  const deleteProjectDialog = document.getElementById("deleteProjectDialog");
  const deleteWarning = document.getElementById("deleteWarning");
  const deleteExportBtn = document.getElementById("deleteExportBtn");
  const deleteExportMsg = document.getElementById("deleteExportMsg");
  const deleteCancelBtn = document.getElementById("deleteCancelBtn");
  const deleteConfirmBtn = document.getElementById("deleteConfirmBtn");
  let projectPendingDelete = null;

  function openDeleteDialog(project) {
    projectPendingDelete = project;
    deleteWarning.textContent = "“" + project.name + "” (WBS " + project.wbs + ")";
    deleteExportMsg.hidden = true;
    deleteConfirmBtn.disabled = false;
    deleteProjectDialog.showModal();
  }

  function closeDeleteDialog() {
    deleteProjectDialog.close();
    projectPendingDelete = null;
  }

  deleteExportBtn.addEventListener("click", () => {
    if (!projectPendingDelete) return;
    try {
      const id = projectPendingDelete.id;
      Excel.downloadProjectWorkbook({
        project: projectPendingDelete,
        tree: Store.getBom(id),
        orders: Store.getOrders(id),
        statusOptions: Store.getStatusOptions(),
        customFields: Store.getCustomFields(),
      });
      deleteExportMsg.className = "import-result success";
      deleteExportMsg.textContent = "Exported. You can now delete the project.";
      deleteExportMsg.hidden = false;
    } catch (err) {
      deleteExportMsg.className = "import-result error";
      deleteExportMsg.textContent = "Export failed: " + err.message;
      deleteExportMsg.hidden = false;
    }
  });

  deleteConfirmBtn.addEventListener("click", () => {
    if (!projectPendingDelete) return;
    try {
      Store.deleteProject(projectPendingDelete.id);
      projects = Store.getProjects();
      closeDeleteDialog();
      render();
    } catch (err) {
      deleteExportMsg.className = "import-result error";
      deleteExportMsg.textContent = "Delete failed: " + err.message;
      deleteExportMsg.hidden = false;
    }
  });

  deleteCancelBtn.addEventListener("click", closeDeleteDialog);
  deleteProjectDialog.addEventListener("click", (e) => {
    if (e.target === deleteProjectDialog) closeDeleteDialog();
  });

  // ---------- Data location (first-run setup + change later) ----------
  const dataLocationBtn = document.getElementById("dataLocationBtn");
  const dataLocationDialog = document.getElementById("dataLocationDialog");
  const dataLocationCurrent = document.getElementById("dataLocationCurrent");
  const dataLocationNew = document.getElementById("dataLocationNew");
  const dataLocationSaveBtn = document.getElementById("dataLocationSaveBtn");
  const dataLocationMsg = document.getElementById("dataLocationMsg");
  const dataLocationConfigPath = document.getElementById("dataLocationConfigPath");
  const copyDbPathBtn = document.getElementById("copyDbPathBtn");
  const closeDataLocationBtn = document.getElementById("closeDataLocationBtn");

  const firstRunDialog = document.getElementById("firstRunDialog");
  const firstRunPath = document.getElementById("firstRunPath");
  const firstRunSaveBtn = document.getElementById("firstRunSaveBtn");
  const firstRunError = document.getElementById("firstRunError");

  function showDlMsg(text, isError) {
    dataLocationMsg.textContent = text;
    dataLocationMsg.className = "import-result " + (isError ? "error" : "success");
    dataLocationMsg.hidden = false;
  }

  function openDataLocationDialog() {
    let info = dataInfo;
    try { info = Store.getDataInfo(); } catch (e) { /* use cached */ }
    dataLocationCurrent.value = (info && info.dbPath) || "(unknown)";
    dataLocationConfigPath.textContent = (info && info.configPath) || "";
    dataLocationNew.value = "";
    dataLocationMsg.hidden = true;
    dataLocationDialog.showModal();
  }
  if (dataLocationBtn) dataLocationBtn.addEventListener("click", openDataLocationDialog);
  if (closeDataLocationBtn) closeDataLocationBtn.addEventListener("click", () => dataLocationDialog.close());
  dataLocationDialog.addEventListener("click", (e) => { if (e.target === dataLocationDialog) dataLocationDialog.close(); });
  if (copyDbPathBtn) copyDbPathBtn.addEventListener("click", () => copyToClipboard(dataLocationCurrent.value, copyDbPathBtn));

  if (dataLocationSaveBtn) dataLocationSaveBtn.addEventListener("click", () => {
    const path = dataLocationNew.value.trim();
    if (!path) { showDlMsg("Enter a folder path.", true); return; }
    dataLocationSaveBtn.disabled = true;
    try {
      const res = Store.setDataDir(path);
      const copied = res && res.migrated ? " Your existing data was copied there." : "";
      showDlMsg("Saved." + copied + " Restart the app (close and reopen) to use the new location.", false);
    } catch (err) {
      showDlMsg(err.message, true);
    } finally {
      dataLocationSaveBtn.disabled = false;
    }
  });

  // First-run: block until a data folder is chosen, then reload into the app.
  firstRunDialog.addEventListener("cancel", (e) => e.preventDefault()); // not dismissible
  function showFirstRun() {
    firstRunPath.value = (dataInfo && dataInfo.suggestedDataDir) || "";
    firstRunError.hidden = true;
    firstRunDialog.showModal();
    firstRunPath.focus();
  }
  if (firstRunSaveBtn) firstRunSaveBtn.addEventListener("click", () => {
    const path = firstRunPath.value.trim();
    if (!path) {
      firstRunError.textContent = "Enter a folder path.";
      firstRunError.className = "import-result error";
      firstRunError.hidden = false;
      return;
    }
    firstRunSaveBtn.disabled = true;
    try {
      Store.setDataDir(path);
      location.reload(); // comes back configured
    } catch (err) {
      firstRunError.textContent = err.message;
      firstRunError.className = "import-result error";
      firstRunError.hidden = false;
      firstRunSaveBtn.disabled = false;
    }
  });

  populateStatusOptions();
  // Open filtered to Active projects; "Clear filters" still resets to All.
  if (projects.some((p) => p.status === "Active")) statusFilter.value = "Active";
  render();

  if (!dataConfigured) showFirstRun();
})();
