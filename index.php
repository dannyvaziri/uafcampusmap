<?php
declare(strict_types=1);
require __DIR__ . '/includes/bootstrap.php';
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#236192">
<title><?= htmlspecialchars($pageTitle, ENT_QUOTES) ?></title>
<meta name="description" content="University of Alaska Fairbanks campus map for buildings, parking, services, accessibility resources, shuttles, trails and campus updates.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Merriweather:wght@400;700&family=Zilla+Slab:wght@600;700&display=swap" rel="stylesheet">
<?php if (in_array($page, ['map','admin','images','print'], true)): ?>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
<?php endif; ?>
<?php if ($page === 'admin'): ?>
<link rel="stylesheet" href="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css" crossorigin="">
<?php endif; ?>
<link rel="stylesheet" href="/assets/css/omni.css?v=<?= htmlspecialchars($assetVersion, ENT_QUOTES) ?>">
</head>
<body data-page="<?= htmlspecialchars($page, ENT_QUOTES) ?>">
<?php require __DIR__ . '/includes/header.php'; ?>
<div id="app"></div>
<script id="uaf-buildings" type="application/json"><?= uaf_json_for_script($buildings) ?></script>
<script id="uaf-parking" type="application/json"><?= uaf_json_for_script($parking) ?></script>
<script id="uaf-meta" type="application/json"><?= uaf_json_for_script($meta) ?></script>
<script id="uaf-config" type="application/json"><?= uaf_json_for_script($config) ?></script>
<?php require __DIR__ . '/includes/footer.php'; ?>
</body>
</html>
