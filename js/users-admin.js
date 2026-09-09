// Admin-only user management modal (home page), backed by the /api/users
// endpoints. Preset accounts: an admin creates users, resets passwords, and
// deletes them (which removes that user's data). Not shown to non-admins.
(function () {
  var dialog = document.getElementById("usersDialog");
  if (!dialog) return;
  var openBtn = document.getElementById("manageUsersBtn");
  var closeBtn = document.getElementById("closeUsersDialogBtn");
  var tbody = document.getElementById("usersTableBody");
  var emptyEl = document.getElementById("usersEmpty");
  var form = document.getElementById("addUserForm");
  var errEl = document.getElementById("usersError");

  function showError(msg) { errEl.textContent = msg; errEl.hidden = false; }
  function clearError() { errEl.hidden = true; }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || ("Request failed (" + r.status + ")"));
        return d;
      });
    });
  }

  function render(users) {
    tbody.innerHTML = "";
    emptyEl.hidden = users.length !== 0;
    users.forEach(function (u) {
      var tr = document.createElement("tr");
      var name = document.createElement("td");
      name.textContent = u.username;
      tr.appendChild(name);
      var role = document.createElement("td");
      role.textContent = u.isAdmin ? "Admin" : "User";
      tr.appendChild(role);
      var actions = document.createElement("td");
      actions.className = "users-row-actions";
      var reset = document.createElement("button");
      reset.type = "button"; reset.className = "tool-btn"; reset.textContent = "Reset password";
      reset.addEventListener("click", function () { resetPassword(u); });
      var del = document.createElement("button");
      del.type = "button"; del.className = "tool-btn danger"; del.textContent = "Delete";
      del.addEventListener("click", function () { deleteUser(u); });
      actions.appendChild(reset);
      actions.appendChild(del);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
  }

  function load() {
    clearError();
    api("GET", "/api/users").then(render).catch(function (e) { showError(e.message); });
  }

  function resetPassword(u) {
    var pw = window.prompt('New password for "' + u.username + '":');
    if (!pw) return;
    api("POST", "/api/users/" + encodeURIComponent(u.id) + "/password", { password: pw })
      .then(function () { window.alert("Password updated for " + u.username + "."); })
      .catch(function (e) { showError(e.message); });
  }

  function deleteUser(u) {
    if (!window.confirm('Delete user "' + u.username +
        '" and ALL of their projects, BOMs, and orders? This can\'t be undone.')) return;
    api("DELETE", "/api/users/" + encodeURIComponent(u.id)).then(load)
      .catch(function (e) { showError(e.message); });
  }

  if (openBtn) openBtn.addEventListener("click", function () { load(); dialog.showModal(); });
  if (closeBtn) closeBtn.addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearError();
    var body = {
      username: document.getElementById("newUsername").value,
      password: document.getElementById("newUserPassword").value,
      isAdmin: document.getElementById("newUserAdmin").checked,
    };
    api("POST", "/api/users", body).then(function () {
      form.reset();
      load();
    }).catch(function (e) { showError(e.message); });
  });
})();
