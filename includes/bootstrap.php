<?php
declare(strict_types=1);

function uaf_read_json(string $path, mixed $fallback = []): mixed {
    if (!is_file($path)) return $fallback;
    $value = json_decode((string) file_get_contents($path), true);
    return $value ?? $fallback;
}

$uafRoot = dirname(__DIR__);
$buildings = [];
foreach (glob($uafRoot . '/data/buildings-*.json') ?: [] as $file) {
    $rows = uaf_read_json($file, []);
    if (is_array($rows)) $buildings = array_merge($buildings, $rows);
}
$parking = [];
foreach (glob($uafRoot . '/data/parking-*.json') ?: [] as $file) {
    $rows = uaf_read_json($file, []);
    if (is_array($rows)) $parking = array_merge($parking, $rows);
}
$meta = uaf_read_json($uafRoot . '/data/meta.json', []);
$config = uaf_read_json($uafRoot . '/data/map-config.json', uaf_read_json($uafRoot . '/public/map-config.json', []));

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$page = match (true) {
    $path === '/admin' || str_ends_with($path, '/admin/index.php') => 'admin',
    $path === '/admin/images' || str_ends_with($path, '/admin/images.php') => 'images',
    $path === '/print' || str_ends_with($path, '/print.php') => 'print',
    $path === '/accessible' || str_ends_with($path, '/accessible.php') => 'accessible',
    default => 'map',
};

$pageTitles = [
    'map' => 'Campus Map',
    'accessible' => 'Text-only Campus Map',
    'admin' => 'Campus Map Editor',
    'images' => 'PNG Overlay Editor',
    'print' => 'Print Campus Map',
];
$pageTitle = ($pageTitles[$page] ?? 'Campus Map') . ' | University of Alaska Fairbanks';
$assetVersion = (string) max(
    (int) (@filemtime($uafRoot . '/assets/css/omni.css') ?: 0),
    (int) (@filemtime($uafRoot . '/assets/js/app.js') ?: 0),
    (int) (@filemtime($uafRoot . '/index.php') ?: 0)
);

function uaf_json_for_script(mixed $value): string {
    return (string) json_encode(
        $value,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
    );
}
