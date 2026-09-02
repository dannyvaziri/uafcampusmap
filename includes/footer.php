<?php
declare(strict_types=1);
$mapPages = ['map', 'admin', 'images', 'overlays', 'print'];
?>
<footer class="site-footer">
  <div><strong>University of Alaska Fairbanks</strong><span>Troth Yeddha' Campus · Fairbanks, Alaska</span></div>
  <div class="footer-links">
    <a href="https://www.uaf.edu/">UAF home</a>
    <a href="mailto:uaf-web@alaska.edu">Map corrections</a>
  </div>
</footer>
<?php if (in_array($page, $mapPages, true)): ?>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<?php endif; ?>
<?php if ($page === 'admin' || $page === 'overlays'): ?>
<script src="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js" crossorigin=""></script>
<?php endif; ?>
<?php if ($page === 'print'): ?>
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jspdf@3.0.2/dist/jspdf.umd.min.js"></script>
<?php endif; ?>
<script src="/assets/js/legend.js?v=<?= htmlspecialchars($assetVersion, ENT_QUOTES) ?>"></script>
<?php if ($page === 'overlays'): ?>
<script src="/assets/js/overlay-manager.js?v=<?= htmlspecialchars($assetVersion, ENT_QUOTES) ?>"></script>
<?php else: ?>
<script src="/assets/js/app.js?v=<?= htmlspecialchars($assetVersion, ENT_QUOTES) ?>"></script>
<?php endif; ?>
