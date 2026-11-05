// External (MV3 forbids inline scripts): applies the saved colour scheme before first paint. The look is always the card design.
try {
  var t = localStorage.getItem('famcal-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
document.documentElement.setAttribute('data-design', 'modern');
