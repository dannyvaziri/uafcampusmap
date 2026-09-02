<?php
declare(strict_types=1);

function uaf_read_json(string $path, mixed $fallback = []): mixed {
    if (!is_file($path)) return $fallback;
    $value = json_decode((string) file_get_contents($path), true);
    return $value ?? $fallback;
}

function uaf_valid_coordinate(mixed $pair): bool {
    return is_array($pair)
        && count($pair) >= 2
        && is_numeric($pair[0])
        && is_numeric($pair[1])
        && (float) $pair[0] >= -180
        && (float) $pair[0] <= 180
        && (float) $pair[1] >= -90
        && (float) $pair[1] <= 90;
}

function uaf_valid_geometry(mixed $feature): bool {
    if (!is_array($feature) || !is_array($feature['geometry'] ?? null)) return false;
    $geometry = $feature['geometry'];
    $type = (string) ($geometry['type'] ?? '');
    $coords = $geometry['coordinates'] ?? null;
    if ($type === 'Point') return uaf_valid_coordinate($coords);
    if ($type === 'LineString' && is_array($coords) && count($coords) >= 2) {
        foreach ($coords as $pair) if (!uaf_valid_coordinate($pair)) return false;
        $unique = array_unique(array_map(static fn($pair) => implode(',', $pair), $coords));
        return count($unique) >= 2;
    }
    if ($type === 'Polygon' && is_array($coords) && is_array($coords[0] ?? null) && count($coords[0]) >= 4) {
        foreach ($coords[0] as $pair) if (!uaf_valid_coordinate($pair)) return false;
        $unique = array_unique(array_map(static fn($pair) => implode(',', $pair), $coords[0]));
        return count($unique) >= 3;
    }
    return false;
}

function uaf_sanitize_config(mixed $input): array {
    $config = is_array($input) ? $input : [];
    $config['buildingOverrides'] = is_array($config['buildingOverrides'] ?? null) ? $config['buildingOverrides'] : [];
    $config['parkingOverrides'] = is_array($config['parkingOverrides'] ?? null) ? $config['parkingOverrides'] : [];
    $config['customBuildings'] = is_array($config['customBuildings'] ?? null) ? $config['customBuildings'] : [];
    $config['customParking'] = is_array($config['customParking'] ?? null) ? $config['customParking'] : [];
    $config['contentOverrides'] = is_array($config['contentOverrides'] ?? null) ? $config['contentOverrides'] : [];
    $config['imageOverlays'] = is_array($config['imageOverlays'] ?? null) ? $config['imageOverlays'] : [];
    $shapes = is_array($config['shapes'] ?? null) ? $config['shapes'] : [];
    $cleanShapes = [];
    foreach ($shapes as $shape) {
        if (!uaf_valid_geometry($shape)) continue;
        if (isset($shape['properties']['building_id']) && $shape['properties']['building_id'] !== '' && isset($shape['properties']['parking_id'])) {
            unset($shape['properties']['parking_id']);
        }
        $cleanShapes[] = $shape;
    }
    $config['shapes'] = $cleanShapes;
    return $config;
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
$config = uaf_sanitize_config(uaf_read_json($uafRoot . '/data/map-config.json', uaf_read_json($uafRoot . '/public/map-config.json', [])));

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
