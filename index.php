<?php
declare(strict_types=1);
require __DIR__ . '/includes/bootstrap.php';

$locationContent = uaf_read_json(__DIR__ . '/data/location-content.json', ['locations' => []]);
$locationAdditions = is_array($locationContent['locations'] ?? null) ? $locationContent['locations'] : [];
foreach ($buildings as &$building) {
    if (!is_array($building) || empty($building['id'])) continue;
    $extra = $locationAdditions[(string) $building['id']] ?? null;
    if (!is_array($extra)) continue;
    $searchTerms = array_values(array_unique(array_filter(array_merge(
        is_array($building['search_terms'] ?? null) ? $building['search_terms'] : [],
        is_array($extra['aliases'] ?? null) ? $extra['aliases'] : [],
        is_array($extra['departments'] ?? null) ? $extra['departments'] : [],
        is_array($extra['services'] ?? null) ? $extra['services'] : []
    ))));
    $services = array_values(array_unique(array_filter(array_merge(
        is_array($building['services'] ?? null) ? $building['services'] : [],
        is_array($extra['services'] ?? null) ? $extra['services'] : [],
        is_array($extra['departments'] ?? null) ? $extra['departments'] : []
    ))));
    $building = array_merge($building, $extra, ['search_terms' => $searchTerms, 'services' => $services]);
}
unset($building);
$experienceVersion = (string) max(
    (int) $assetVersion,
    (int) (@filemtime(__DIR__ . '/assets/css/experience.css') ?: 0),
    (int) (@filemtime(__DIR__ . '/assets/css/map-color.css') ?: 0),
    (int) (@filemtime(__DIR__ . '/assets/css/live-fixes.css') ?: 0),
    (int) (@filemtime(__DIR__ . '/assets/js/experience.js') ?: 0),
    (int) (@filemtime(__DIR__ . '/assets/js/surface-fix.js') ?: 0),
    (int) (@filemtime(__DIR__ . '/assets/js/basemap.js') ?: 0),
    (int) (@filemtime(__DIR__ . '/data/location-content.json') ?: 0),
    (int) (@filemtime(__DIR__ . '/data/modes.json') ?: 0)
);
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
<?php if (in_array($page, ['map','admin','images','overlays','print'], true)): ?>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
<?php endif; ?>
<?php if ($page === 'admin' || $page === 'overlays'): ?>
<link rel="stylesheet" href="https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css" crossorigin="">
<?php endif; ?>
<link rel="stylesheet" href="/assets/css/omni.css?v=<?= htmlspecialchars($assetVersion, ENT_QUOTES) ?>">
<link rel="stylesheet" href="/assets/css/overlays.css?v=<?= htmlspecialchars($assetVersion, ENT_QUOTES) ?>">
<link rel="stylesheet" href="/assets/css/basemap.css?v=<?= htmlspecialchars($assetVersion, ENT_QUOTES) ?>">
<?php if ($page === 'map'): ?>
<link rel="stylesheet" href="/assets/css/experience.css?v=<?= htmlspecialchars($experienceVersion, ENT_QUOTES) ?>">
<link rel="stylesheet" href="/assets/css/map-color.css?v=<?= htmlspecialchars($experienceVersion, ENT_QUOTES) ?>">
<link rel="stylesheet" href="/assets/css/live-fixes.css?v=<?= htmlspecialchars($experienceVersion, ENT_QUOTES) ?>">
<?php endif; ?>
</head>
<body data-page="<?= htmlspecialchars($page, ENT_QUOTES) ?>">
<?php require __DIR__ . '/includes/header.php'; ?>
<div id="app"></div>
<script id="uaf-buildings" type="application/json"><?= uaf_json_for_script($buildings) ?></script>
<script id="uaf-parking" type="application/json"><?= uaf_json_for_script($parking) ?></script>
<script id="uaf-meta" type="application/json"><?= uaf_json_for_script($meta) ?></script>
<script id="uaf-config" type="application/json"><?= uaf_json_for_script($config) ?></script>
<script id="uaf-legend" type="application/json"><?= uaf_json_for_script($legend) ?></script>
<?php require __DIR__ . '/includes/footer.php'; ?>
</body>
</html>
