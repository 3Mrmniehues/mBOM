// Shared light/dark theme control. Loaded in <head> so the stored choice is
// applied before first paint (no flash). A missing choice means "follow the OS".
// Pages wire a toggle button to MBOMTheme.toggle() and may set MBOMTheme.onChange
// to refresh a button icon/label.
(function () {
  var KEY = "mbomTheme";
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function apply(t) {
    var el = document.documentElement;
    if (t === "light" || t === "dark") el.setAttribute("data-theme", t);
    else el.removeAttribute("data-theme");
  }
  function effective() {
    var t = stored();
    if (t === "light" || t === "dark") return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function set(t) {
    try { localStorage.setItem(KEY, t); } catch (e) {}
    apply(t);
    if (window.MBOMTheme && typeof window.MBOMTheme.onChange === "function") window.MBOMTheme.onChange(effective());
  }
  function toggle() { set(effective() === "dark" ? "light" : "dark"); }
  apply(stored()); // run now (in <head>) to avoid a flash of the wrong theme
  window.MBOMTheme = { toggle: toggle, effective: effective, set: set, apply: apply, onChange: null };
})();
