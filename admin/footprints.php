<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, max-age=300');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'GET required.']);
    exit;
}

if (!function_exists('curl_init')) {
    http_response_code(503);
    echo json_encode(['ok' => false, 'error' => 'Building-footprint lookup is unavailable on this server.']);
    exit;
}

$endpoint = 'https://services.arcgis.com/f4rR7WnIfGBdVYFd/arcgis/rest/services/Building_Outlines_2023_Pictometry/FeatureServer/22/query';
$params = [
    'where' => '1=1',
    'geometry' => '-147.8565,64.8485,-147.8095,64.8635',
    'geometryType' => 'esriGeometryEnvelope',
    'inSR' => '4326',
    'spatialRel' => 'esriSpatialRelIntersects',
    'outSR' => '4326',
    'returnGeometry' => 'true',
    'outFields' => 'OBJECTID',
    'resultRecordCount' => '2000',
    'geometryPrecision' => '7',
    'f' => 'json',
];
$url = $endpoint . '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: UAF-Campus-Map-Footprint-Importer'],
    CURLOPT_CONNECTTIMEOUT => 4,
    CURLOPT_TIMEOUT => 9,
    CURLOPT_FOLLOWLOCATION => false,
]);
$raw = curl_exec($ch);
$status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($raw === false || $status !== 200) {
    http_response_code(502);
    echo json_encode(['ok' => false, 'error' => 'The building-footprint source did not respond in time. Retry in a moment.']);
    exit;
}

$data = json_decode((string) $raw, true);
if (!is_array($data) || isset($data['error']) || !is_array($data['features'] ?? null)) {
    http_response_code(502);
    $message = is_array($data['error'] ?? null) ? (string) ($data['error']['message'] ?? '') : '';
    echo json_encode(['ok' => false, 'error' => $message !== '' ? $message : 'The building-footprint source returned an invalid response.']);
    exit;
}

function valid_pair(mixed $pair): bool {
    if (!is_array($pair) || count($pair) < 2) return false;
    if (!is_numeric($pair[0]) || !is_numeric($pair[1])) return false;
    $lng = (float) $pair[0];
    $lat = (float) $pair[1];
    return $lng >= -180 && $lng <= 180 && $lat >= -90 && $lat <= 90;
}

$features = [];
foreach ($data['features'] as $feature) {
    if (!is_array($feature)) continue;
    $rings = $feature['geometry']['rings'] ?? null;
    if (!is_array($rings)) continue;
    $cleanRings = [];
    foreach ($rings as $ring) {
        if (!is_array($ring)) continue;
        $clean = [];
        foreach ($ring as $pair) {
            if (valid_pair($pair)) $clean[] = [(float) $pair[0], (float) $pair[1]];
        }
        if (count($clean) >= 4) $cleanRings[] = $clean;
    }
    if (!$cleanRings) continue;
    $features[] = [
        'attributes' => ['OBJECTID' => (string) ($feature['attributes']['OBJECTID'] ?? '')],
        'geometry' => ['rings' => $cleanRings],
    ];
}

if (!$features) {
    http_response_code(502);
    echo json_encode(['ok' => false, 'error' => 'No usable campus building footprints were returned.']);
    exit;
}

echo json_encode([
    'ok' => true,
    'source' => 'FNSB 2023 Pictometry building outlines',
    'count' => count($features),
    'features' => $features,
], JSON_UNESCAPED_SLASHES);
