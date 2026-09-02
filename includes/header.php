<?php
declare(strict_types=1);
$navCurrent = static fn(string $target): string => $page === $target ? ' aria-current="page"' : '';
?>
<a class="skip" href="#main">Skip to main content</a>
<header class="site-header">
  <a class="brand" href="/" aria-label="University of Alaska Fairbanks Campus Map home">
    <img src="/assets/images/uaf-logo.svg" alt="University of Alaska Fairbanks">
    <span>Campus Map</span>
  </a>
  <nav aria-label="Campus map tools">
    <a href="/"<?= $navCurrent('map') ?>>Map</a>
    <a href="/accessible"<?= $navCurrent('accessible') ?>>Text map</a>
    <a href="/print"<?= $navCurrent('print') ?>>Print</a>
    <?php if ($page === 'admin' || $page === 'images'): ?>
      <a href="/admin"<?= $navCurrent('admin') ?>>Admin</a>
      <a href="/admin/images"<?= $navCurrent('images') ?>>PNG overlays</a>
    <?php endif; ?>
  </nav>
</header>
