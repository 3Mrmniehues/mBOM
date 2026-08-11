(function () {
  const tableBody = document.getElementById("projectTableBody");
  const emptyState = document.getElementById("emptyState");
  const resultCount = document.getElementById("resultCount");
  const searchInput = document.getElementById("searchInput");
  const statusFilter = document.getElementById("statusFilter");
  const clearFiltersBtn = document.getElementById("clearFiltersBtn");
  const headers = document.querySelectorAll("thead th[data-key]");

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

  let projects = Store.getProjects();
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
        p.wbs.toLowerCase().includes(query) ||
        p.ewr.toLowerCase().includes(query) ||
        p.name.toLowerCase().includes(query);
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

  function updateHeaderIndicators() {
    headers.forEach((th) => {
      const key = th.dataset.key;
      const indicator = th.querySelector(".sort-indicator");
      if (key === sortKey) {
        th.setAttribute("aria-sort", sortDir === "asc" ? "ascending" : "descending");
        indicator.textContent = sortDir === "asc" ? "▲" : "▼";
      } else {
        th.removeAttribute("aria-sort");
        indicator.textContent = "";
      }
    });
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function render() {
    const filtered = getSorted(getFiltered());

    tableBody.innerHTML = "";
    filtered.forEach((p) => {
      const tr = document.createElement("tr");
      tr.dataset.wbs = p.wbs;

      tr.innerHTML =
        "<td>" + p.wbs + "</td>" +
        "<td>" + p.ewr + "</td>" +
        "<td>" + p.name + "</td>" +
        "<td><span class=\"status-pill " + statusClass(p.status) + "\">" + p.status + "</span></td>" +
        "<td>" + formatDate(p.dateCreated) + "</td>";

      const actionsTd = document.createElement("td");
      actionsTd.className = "row-actions-cell";
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "row-delete-btn";
      delBtn.title = "Delete project";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // don't open the project
        openDeleteDialog(p);
      });
      actionsTd.appendChild(delBtn);
      tr.appendChild(actionsTd);

      tr.addEventListener("click", () => goToProject(p.wbs));
      tableBody.appendChild(tr);
    });

    emptyState.hidden = filtered.length !== 0;
    resultCount.textContent =
      filtered.length === projects.length
        ? filtered.length + " project" + (filtered.length === 1 ? "" : "s")
        : "Showing " + filtered.length + " of " + projects.length + " projects";

    updateHeaderIndicators();
  }

  function goToProject(wbs) {
    const project = projects.find((p) => p.wbs === wbs);
    if (!project) return;
    window.location.href = "project.html?id=" + encodeURIComponent(project.id);
  }

  headers.forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = key;
        sortDir = "asc";
      }
      render();
    });
  });

  searchInput.addEventListener("input", render);
  statusFilter.addEventListener("change", render);
  clearFiltersBtn.addEventListener("click", () => {
    searchInput.value = "";
    statusFilter.value = "";
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

    const duplicate = projects.some((p) => p.wbs.toLowerCase() === wbs.toLowerCase());
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

  populateStatusOptions();
  // Open filtered to Active projects; "Clear filters" still resets to All.
  if (projects.some((p) => p.status === "Active")) statusFilter.value = "Active";
  render();
})();
