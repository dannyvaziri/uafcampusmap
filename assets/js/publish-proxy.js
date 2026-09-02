(function () {
  'use strict';

  const page = document.body.dataset.page || '';
  if (!['admin', 'images', 'overlays'].includes(page)) return;

  const scopeByButton = {
    'publish-live': 'admin',
    'publish-overlays': 'images',
    'publish-overlay-config': 'overlays'
  };
  const saveByScope = {
    admin: 'save-publish-draft',
    images: 'save-overlay-draft',
    overlays: 'save-overlay-draft'
  };
  const statusByScope = {
    admin: 'publish-status',
    images: 'image-status',
    overlays: 'overlay-status'
  };

  // Remove any credential left over from older browser-side publishing.
  try { sessionStorage.removeItem('uaf-github-token'); } catch (error) {}

  function setStatus(scope, message) {
    const node = document.getElementById(statusByScope[scope]);
    if (node) node.textContent = message;
  }

  function readDraft() {
    try {
      const parsed = JSON.parse(localStorage.getItem('uaf-map-config-draft') || 'null');
      return parsed && parsed.config ? parsed.config : null;
    } catch (error) {
      return null;
    }
  }

  async function serverPublish(config, scope) {
    const response = await fetch('/admin/publish.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
      body: JSON.stringify({scope, config})
    });
    let data = null;
    try { data = await response.json(); } catch (error) {}
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || ('Publishing failed (' + response.status + ').'));
    }
    return data;
  }

  function configureUi() {
    const tokenInputs = ['github-token', 'overlay-token', 'overlay-github-token'];
    tokenInputs.forEach(id => {
      const input = document.getElementById(id);
      if (!input) return;
      const wrapper = input.closest('label') || input;
      wrapper.hidden = true;
    });
    const test = document.getElementById('test-github');
    if (test) test.hidden = true;

    const connect = document.querySelector('.github-connect > p');
    if (connect) connect.textContent = 'Publishing uses the protected Hostinger server connection. No GitHub token is stored in this browser.';

    const overlayPublish = document.querySelector('.overlay-publish .muted');
    if (overlayPublish) overlayPublish.textContent = 'Publishing uses the protected Hostinger server connection.';
  }

  const observer = new MutationObserver(configureUi);
  observer.observe(document.documentElement, {subtree: true, childList: true});
  configureUi();

  document.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || !scopeByButton[button.id]) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const scope = scopeByButton[button.id];
    if (button.disabled) return;

    const save = document.getElementById(saveByScope[scope]);
    if (save) save.click();
    const config = readDraft();
    if (!config) {
      setStatus(scope, 'Could not prepare the current draft for publishing. Save the draft and try again.');
      return;
    }

    button.disabled = true;
    setStatus(scope, 'Publishing securely through Hostinger…');
    try {
      const result = await serverPublish(config, scope);
      localStorage.setItem('uaf-map-live-config', JSON.stringify({time: Date.now(), config}));
      localStorage.removeItem('uaf-map-config-draft');
      if ('BroadcastChannel' in window) {
        const channel = new BroadcastChannel('uaf-map-live');
        channel.postMessage({type: 'published', sha: result.sha || ''});
        channel.close();
      }
      setStatus(scope, 'Published' + (result.sha ? ' (' + result.sha.slice(0, 7) + ')' : '') + '. Hostinger deployment should now start from main.');
    } catch (error) {
      setStatus(scope, error.message || 'Publishing failed.');
    } finally {
      button.disabled = false;
    }
  }, true);
})();
