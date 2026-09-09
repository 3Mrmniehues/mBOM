// SQLite-backed data layer (via server.py's /api/* endpoints). Every
// function keeps the exact same synchronous signature it had when this was
// a localStorage wrapper, so app.js and project.js don't need to change.
//
// It uses synchronous XHR to do that — blocking the main thread briefly on
// every save/load. That's a deliberate tradeoff: this only ever talks to a
// server on the same machine (http://localhost), so the round trip is a
// few milliseconds, and it avoids turning every call site in the rest of
// the app into an async/await chain. Don't reuse this pattern against a
// real network server.
const Store = (function () {
  function apiRequest(method, path, body) {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path, false); // false = synchronous
    xhr.setRequestHeader("Content-Type", "application/json");
    try {
      xhr.send(body === undefined ? null : JSON.stringify(body));
    } catch (e) {
      throw new Error(
        "Could not reach the local server at " + window.location.origin +
        ". Make sure it's running (python server.py)."
      );
    }
    if (xhr.status === 401) {
      // Session missing/expired — bounce to the login page.
      window.location.href = "/login.html";
      throw new Error("Not signed in.");
    }
    if (xhr.status < 200 || xhr.status >= 300) {
      let message = xhr.responseText;
      try {
        message = JSON.parse(xhr.responseText).error || message;
      } catch (e) {
        // response wasn't JSON; use raw text
      }
      throw new Error("Request to " + path + " failed (" + xhr.status + "): " + message);
    }
    return xhr.responseText ? JSON.parse(xhr.responseText) : null;
  }

  function apiGet(path) {
    return apiRequest("GET", path);
  }

  function apiPut(path, body) {
    return apiRequest("PUT", path, body);
  }

  function apiDelete(path) {
    return apiRequest("DELETE", path);
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
  }

  function getProjects() {
    return apiGet("/api/projects");
  }

  function saveProjects(list) {
    apiPut("/api/projects", list);
  }

  function getProjectById(id) {
    return getProjects().find((p) => p.id === id) || null;
  }

  function addProject(project) {
    const list = getProjects();
    list.push(project);
    saveProjects(list);
  }

  function updateProject(id, updates) {
    const list = getProjects();
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    list[idx] = Object.assign({}, list[idx], updates);
    saveProjects(list);
    return list[idx];
  }

  // Deletes a project and its BOM lines and orders (server-side cascade).
  function deleteProject(id) {
    apiDelete("/api/projects/" + encodeURIComponent(id));
  }

  function getBom(projectId) {
    return apiGet("/api/bom/" + encodeURIComponent(projectId));
  }

  function saveBom(projectId, tree) {
    apiPut("/api/bom/" + encodeURIComponent(projectId), tree);
  }

  function getStatusOptions() {
    return apiGet("/api/status-options");
  }

  function saveStatusOptions(list) {
    apiPut("/api/status-options", list);
  }

  function getCustomFields() {
    return apiGet("/api/custom-fields");
  }

  function saveCustomFields(list) {
    apiPut("/api/custom-fields", list);
  }

  function getOrders(projectId) {
    return apiGet("/api/orders/" + encodeURIComponent(projectId));
  }

  function saveOrders(projectId, list) {
    apiPut("/api/orders/" + encodeURIComponent(projectId), list);
  }

  function getParts(projectId) {
    return apiGet("/api/parts/" + encodeURIComponent(projectId));
  }

  function saveParts(projectId, list) {
    apiPut("/api/parts/" + encodeURIComponent(projectId), list);
  }

  return {
    makeId,
    getProjects,
    saveProjects,
    getProjectById,
    addProject,
    updateProject,
    deleteProject,
    getBom,
    saveBom,
    getStatusOptions,
    saveStatusOptions,
    getCustomFields,
    saveCustomFields,
    getOrders,
    saveOrders,
    getParts,
    saveParts,
  };
})();
