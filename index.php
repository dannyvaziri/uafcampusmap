<?php
declare(strict_types=1);

function read_json(string $path, mixed $fallback = []): mixed {
    if (!is_file($path)) return $fallback;
    $value = json_decode((string) file_get_contents($path), true);
    return $value ?? $fallback;
}

$root = __DIR__;
$buildings = [];
foreach (glob($root . '/data/buildings-*.json') ?: [] as $file) $buildings = array_merge($buildings, read_json($file, []));
$parking = [];
foreach (glob($root . '/data/parking-*.json') ?: [] as $file) $parking = array_merge($parking, read_json($file, []));
$meta = read_json($root . '/data/meta.json', []);
$config = read_json($root . '/data/map-config.json', read_json($root . '/public/map-config.json', []));
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$page = ($path === '/admin' || str_ends_with($path, '/admin/index.php')) ? 'admin' : (($path === '/admin/images' || str_ends_with($path, '/admin/images.php')) ? 'images' : (($path === '/print' || str_ends_with($path, '/print.php')) ? 'print' : (($path === '/accessible' || str_ends_with($path, '/accessible.php')) ? 'accessible' : 'map')));
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#236192"><title>Campus Map | University of Alaska Fairbanks</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
<link rel="stylesheet" href="/assets/css/omni.css">
</head>
<body data-page="<?= htmlspecialchars($page, ENT_QUOTES) ?>">
<a class="skip" href="#main">Skip to main content</a>
<header class="site-header"><a class="brand" href="/"><img src="/assets/images/uaf-logo.svg" alt="University of Alaska Fairbanks"><span>Campus Map</span></a><nav><a href="/">Map</a><a href="/accessible">Text map</a><a href="/print">Print</a><a href="/admin">Admin</a></nav></header>
<div id="app" data-buildings="<?= htmlspecialchars(json_encode($buildings), ENT_QUOTES) ?>" data-parking="<?= htmlspecialchars(json_encode($parking), ENT_QUOTES) ?>" data-meta="<?= htmlspecialchars(json_encode($meta), ENT_QUOTES) ?>" data-config="<?= htmlspecialchars(json_encode($config), ENT_QUOTES) ?>"></div>
<footer class="site-footer"><strong>University of Alaska Fairbanks</strong><span>Troth Yeddha' Campus · Fairbanks, Alaska</span><a href="https://www.uaf.edu/">UAF home</a></footer>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jspdf@3.0.2/dist/jspdf.umd.min.js"></script>
<script src="/assets/js/app.js"></script>
</body></html>
