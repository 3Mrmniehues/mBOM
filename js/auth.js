// Shared header auth for the app pages: shows the signed-in user, reveals any
// [data-admin-only] controls for admins, and wires the Log out button.
// Exposes window.AuthReady — a promise resolving to {username, isAdmin} (or null).
(function () {
  window.AuthReady = fetch("/api/me", { headers: { Accept: "application/json" } })
    .then(function (r) {
      if (r.status === 401) { window.location.href = "/login.html"; return null; }
      return r.json();
    })
    .then(function (me) {
      if (!me) return null;
      var nameEl = document.getElementById("currentUser");
      if (nameEl) nameEl.textContent = me.username + (me.isAdmin ? " (admin)" : "");
      var admins = document.querySelectorAll("[data-admin-only]");
      for (var i = 0; i < admins.length; i++) admins[i].hidden = !me.isAdmin;
      return me;
    })
    .catch(function () { return null; });

  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("#logoutBtn") : null;
    if (!btn) return;
    e.preventDefault();
    btn.disabled = true;
    fetch("/api/logout", { method: "POST" }).then(function () {
      window.location.href = "/login.html";
    }, function () {
      window.location.href = "/login.html";
    });
  });
})();
