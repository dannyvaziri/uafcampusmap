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

function uaf_parking_legend_key(?array $row): string {
    $text = strtolower((string) ($row['restrictions'] ?? ''));
    if (str_contains($text, 'no parking unless otherwise posted')) return 'parking_no_parking';
    if (str_contains($text, 'visitors only') && str_contains($text, 'metered')) return 'parking_visitor_only';
    if (str_contains($text, 'visitors and uaf-affiliated') && str_contains($text, 'metered')) return 'parking_visitor_metered';
    if (str_contains($text, 'pay-by-plate short-term')) return 'parking_short_term';
    if (str_contains($text, 'gold decal')) return 'parking_gold';
    if (str_contains($text, 'restricted parking') || str_contains($text, 'no parking')) return 'parking_restricted';
    return match ((string) ($row['type'] ?? '')) {
        'visitor_short_term' => 'parking_short_term',
        'gold' => 'parking_gold',
        'restricted' => 'parking_restricted',
        default => 'parking_permit',
    };
}

function uaf_legend_index(array $legend): array {
    $index = [];
    foreach (($legend['items'] ?? []) as $item) {
        if (is_array($item) && isset($item['id'])) $index[(string) $item['id']] = $item;
    }
    return $index;
}

function uaf_find_parking(array $parking, string $id): ?array {
    foreach ($parking as $row) {
        if (!is_array($row)) continue;
        if ((string) ($row['id'] ?? '') === $id || (string) ($row['code'] ?? '') === $id) return $row;
    }
    return null;
}

function uaf_infer_legend_key(array $shape, array $legendIndex, array $parking): string {
    $props = is_array($shape['properties'] ?? null) ? $shape['properties'] : [];
    $stored = (string) ($props['legend_key'] ?? '');
    $kind = (string) ($props['kind'] ?? '');
    if ($kind === 'building-footprint' || !empty($props['building_id'])) return 'building';
    if ($kind === 'parking-area' || !empty($props['parking_id'])) {
        if ($stored !== '' && str_starts_with($stored, 'parking_') && isset($legendIndex[$stored])) return $stored;
        $row = uaf_find_parking($parking, (string) ($props['parking_id'] ?? ''));
        return uaf_parking_legend_key($row);
    }
    if ($stored !== '' && isset($legendIndex[$stored])) return $stored;
    return match ($kind) {
        'trail' => 'trail',
        'construction', 'closure' => 'construction',
        'stairs' => 'stairs',
        'bridge' => 'bridge',
        'shuttle-stop' => 'shuttle_stop',
        'macs-stop' => 'macs_stop',
        'accessible-parking' => 'accessible_parking',
        'parking-kiosk' => 'parking_kiosk',
        'one-way-road' => 'road_one_way',
        default => 'custom_area',
    };
}

function uaf_apply_legend_style(array $shape, array $legendIndex, array $parking): array {
    $key = uaf_infer_legend_key($shape, $legendIndex, $parking);
    $style = $legendIndex[$key] ?? $legendIndex['custom_area'] ?? null;
    if (!is_array($style)) return $shape;
    $shape['properties'] = is_array($shape['properties'] ?? null) ? $shape['properties'] : [];
    $shape['properties']['legend_key'] = $key;
    foreach (['stroke', 'fill', 'weight', 'opacity', 'fillOpacity'] as $property) {
        if (array_key_exists($property, $style)) $shape['properties'][$property] = $style[$property];
    }
    if (!empty($style['dashArray'])) $shape['properties']['dashArray'] = $style['dashArray'];
    else unset($shape['properties']['dashArray']);
    return $shape;
}

function uaf_sanitize_config(mixed $input, array $legend = [], array $parking = []): array {
    $config = is_array($input) ? $input : [];
    $config['buildingOverrides'] = is_array($config['buildingOverrides'] ?? null) ? $config['buildingOverrides'] : [];
    $config['parkingOverrides'] = is_array($config['parkingOverrides'] ?? null) ? $config['parkingOverrides'] : [];
    $config['customBuildings'] = is_array($config['customBuildings'] ?? null) ? $config['customBuildings'] : [];
    $config['customParking'] = is_array($config['customParking'] ?? null) ? $config['customParking'] : [];
    $config['contentOverrides'] = is_array($config['contentOverrides'] ?? null) ? $config['contentOverrides'] : [];
    $config['imageOverlays'] = is_array($config['imageOverlays'] ?? null) ? $config['imageOverlays'] : [];
    $shapes = is_array($config['shapes'] ?? null) ? $config['shapes'] : [];
    $legendIndex = uaf_legend_index($legend);
    $cleanShapes = [];
    foreach ($shapes as $shape) {
        if (!uaf_valid_geometry($shape)) continue;
        if (isset($shape['properties']['building_id']) && $shape['properties']['building_id'] !== '' && isset($shape['properties']['parking_id'])) {
            unset($shape['properties']['parking_id']);
        }
        $cleanShapes[] = $legendIndex ? uaf_apply_legend_style($shape, $legendIndex, $parking) : $shape;
    }
    $config['shapes'] = $cleanShapes;
    return $config;
}

function uaf_public_headers(): void {
    static $sent = false;
    if ($sent) return;
    $sent = true;
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Permissions-Policy: geolocation=(self), camera=(), microphone=()');
}

uaf_public_headers();

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
$legend = uaf_read_json($uafRoot . '/data/legend.json', ['items' => []]);
$config = uaf_sanitize_config(uaf_read_json($uafRoot . '/data/map-config.json', []), is_array($legend) ? $legend : [], $parking);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$page = match (true) {
    $path === '/admin' || str_ends_with($path, '/admin/index.php') => 'admin',
    $path === '/admin/images' || str_ends_with($path, '/admin/images.php') => 'images',
    $path === '/admin/overlays' || str_ends_with($path, '/admin/overlays.php') => 'overlays',
    $path === '/print' || str_ends_with($path, '/print.php') => 'print',
    $path === '/accessible' || str_ends_with($path, '/accessible.php') => 'accessible',
    default => 'map',
};

$pageTitles = [
    'map' => 'Campus Map',
    'accessible' => 'Text-only Campus Map',
    'admin' => 'Campus Map Editor',
    'images' => 'PNG Overlay Editor',
    'overlays' => 'Map Overlays & Key',
    'print' => 'Print Campus Map',
];
$pageTitle = ($pageTitles[$page] ?? 'Campus Map') . ' | University of Alaska Fairbanks';
$assetVersion = (string) max(
    (int) (@filemtime($uafRoot . '/assets/css/omni.css') ?: 0),
    (int) (@filemtime($uafRoot . '/assets/css/overlays.css') ?: 0),
    (int) (@filemtime($uafRoot . '/assets/js/app.js') ?: 0),
    (int) (@filemtime($uafRoot . '/assets/js/legend.js') ?: 0),
    (int) (@filemtime($uafRoot . '/assets/js/overlay-manager.js') ?: 0),
    (int) (@filemtime($uafRoot . '/data/legend.json') ?: 0),
    (int) (@filemtime($uafRoot . '/index.php') ?: 0)
);

function uaf_json_for_script(mixed $value): string {
    return (string) json_encode(
        $value,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
    );
}
