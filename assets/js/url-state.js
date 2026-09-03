(function () {
  'use strict';
  if ((document.body.dataset.page || '') !== 'map') return;

  const wrappedReplace = history.replaceState.bind(history);
  history.replaceState = function (state, title, url) {
    if (url == null) return wrappedReplace(state, title, url);
    try {
      const current = new URL(location.href);
      const next = new URL(url, location.href);
      if (current.searchParams.get('place') && !next.searchParams.get('place')) {
        next.searchParams.delete('location');
      }
      return wrappedReplace(state, title, next.pathname + next.search + next.hash);
    } catch (error) {
      return wrappedReplace(state, title, url);
    }
  };
})();
