<?php
declare(strict_types=1);
$navCurrent = static fn(string $target): string => $page === $target ? ' aria-current="page"' : '';
$adminPages = ['admin', 'images', 'overlays'];
?>
<a class="skip" href="#main">Skip to main content</a>
<header class="site-header">
  <a class="brand" href="/" aria-label="University of Alaska Fairbanks Campus Map home">
    <img src="/assets/images/uaf-logo.svg" alt="University of Alaska Fairbanks">
    <span>Campus Map</span>
  </a>
  <?php if ($page === 'map'): ?>
    <nav class="public-map-nav" aria-label="Campus map navigation">
      <a href="https://www.uaf.edu/admissions/visit/">Visit</a>
      <button type="button" data-map-command="layer:Parking">Parking</button>
      <button type="button" data-map-command="layer:Transportation">Transportation</button>
      <button type="button" data-map-command="layer:Accessibility">Accessibility</button>
      <a href="/print">Printable Map</a>
    </nav>
    <div class="public-map-tools" aria-label="Map tools">
      <button type="button" data-map-command="search" aria-label="Search campus map"><span>Search</span></button>
      <button type="button" data-map-command="locations" aria-label="Browse locations"><span>Locations</span></button>
      <button type="button" data-map-command="layers" aria-label="Browse map layers"><span>Layers</span></button>
      <button type="button" data-map-command="share" aria-label="Share current map"><span>Share</span></button>
    </div>
  <?php else: ?>
    <nav aria-label="Campus map tools">
      <a href="/"<?= $navCurrent('map') ?>>Map</a>
      <a href="/accessible"<?= $navCurrent('accessible') ?>>Text map</a>
      <a href="/print"<?= $navCurrent('print') ?>>Print</a>
      <?php if (in_array($page, $adminPages, true)): ?>
        <a href="/admin"<?= $navCurrent('admin') ?>>Admin</a>
        <a href="/admin/overlays"<?= $navCurrent('overlays') ?>>Overlays & key</a>
        <a href="/admin/images"<?= $navCurrent('images') ?>>PNG overlays</a>
      <?php endif; ?>
    </nav>
  <?php endif; ?>
</header>
