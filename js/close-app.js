// "Close App" button: stops the local server (the same graceful shutdown that
// stop-app.bat triggers via POST /api/shutdown -- a web page can't launch a
// .bat directly) and closes the browser window.
//
// window.close() is only honored when it runs synchronously inside the user's
// click (an active user gesture), and only for app-mode / installed-PWA /
// script-opened windows -- which is how start-app.bat launches the app (Chrome
// app mode). So we close the window directly in the handler, and send the
// shutdown as a fire-and-forget keepalive request that still completes as the
// window goes away. In a normal browser tab the browser won't let a script
// close it, so we fall back to a "you can close this window" message.
(function () {
  var btn = document.getElementById("closeAppBtn");
  if (!btn) return;

  // Hosted (not localhost): "Close App" would stop the shared server for
  // everyone, so it's a local-only control — hide it.
  var host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "") {
    btn.hidden = true;
    return;
  }

  btn.addEventListener("click", function () {
    if (!window.confirm("Close mBOM? This stops the local server.")) return;
    btn.disabled = true;

    // Ask the server to stop. keepalive lets the request finish even while the
    // window is closing, so we don't have to wait for it first.
    try {
      fetch("/api/shutdown", { method: "POST", keepalive: true });
    } catch (e) {
      /* ignore -- the server may drop the connection as it goes down */
    }

    // Close the window now, synchronously within the click gesture (required
    // for window.close() to be allowed on an app-mode / PWA window).
    window.close();

    // If the window is still here shortly after, the browser refused to close
    // it (a normal tab, not app mode) -- tell the user the app has stopped.
    setTimeout(function () {
      document.title = "mBOM - closed";
      document.body.innerHTML =
        '<div style="font:16px/1.5 system-ui,Segoe UI,Arial,sans-serif;' +
        'padding:48px;max-width:520px;margin:0 auto;color:#1f2430">' +
        "<h1 style=\"font-size:1.3rem;margin:0 0 8px\">mBOM has been closed</h1>" +
        "<p style=\"color:#6b7280\">The local server has stopped. You can close " +
        "this window. To use the app again, launch it from the mBOM shortcut " +
        "(or run start-app.bat).</p></div>";
    }, 400);
  });
})();
