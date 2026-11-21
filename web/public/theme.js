// Apply the remembered theme before first paint, so dark mode never flashes light.
try {
  var t = localStorage.getItem('inkstat.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
