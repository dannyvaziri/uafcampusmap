<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'POST required.']);
    exit;
}

$token = trim((string) getenv('UAF_GITHUB_TOKEN'));
if ($token === '') {
    http_response_code(503);
    echo json_encode(['ok' => false, 'error' => 'Server publishing is not configured. Add UAF_GITHUB_TOKEN in Hostinger server configuration.']);
    exit;
}

$raw = file_get_contents('php://input');
$input = json_decode((string) $raw, true);
if (!is_array($input) || !is_array($input['config'] ?? null)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'A valid map configuration is required.']);
    exit;
}

$scope = (string) ($input['scope'] ?? 'admin');
if (!in_array($scope, ['admin', 'images', 'overlays'], true)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid publish scope.']);
    exit;
}

$config = $input['config'];
$repo = 'dannyvaziri/uafcampusmap';
$path = 'data/map-config.json';
$branch = 'main';
$api = 'https://api.github.com/repos/' . $repo . '/contents/' . $path;

function github_request(string $method, string $url, string $token, ?array $body = null): array {
    $ch = curl_init($url);
    $headers = [
        'Accept: application/vnd.github+json',
        'Authorization: Bearer ' . $token,
        'X-GitHub-Api-Version: 2022-11-28',
        'User-Agent: UAF-Campus-Map-Publisher',
    ];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_CONNECTTIMEOUT => 8,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_SLASHES));
    $response = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($response === false) throw new RuntimeException('GitHub request failed: ' . ($error ?: 'unknown network error'));
    $decoded = json_decode((string) $response, true);
    return [$status, is_array($decoded) ? $decoded : []];
}

function merge_scope(array $latest, array $draft, string $scope): array {
    if ($scope === 'images') {
        $latest['imageOverlays'] = is_array($draft['imageOverlays'] ?? null) ? $draft['imageOverlays'] : [];
        return $latest;
    }
    if ($scope === 'overlays') {
        $latest['shapes'] = is_array($draft['shapes'] ?? null) ? $draft['shapes'] : [];
        return $latest;
    }
    $remoteArcgis = $latest['settings']['map']['arcgisApiKey'] ?? null;
    if ($remoteArcgis !== null) {
        $draft['settings'] = is_array($draft['settings'] ?? null) ? $draft['settings'] : [];
        $draft['settings']['map'] = is_array($draft['settings']['map'] ?? null) ? $draft['settings']['map'] : [];
        $draft['settings']['map']['arcgisApiKey'] = $remoteArcgis;
    }
    return $draft;
}

try {
    [$getStatus, $current] = github_request('GET', $api . '?ref=' . rawurlencode($branch), $token);
    if ($getStatus !== 200 || empty($current['sha']) || empty($current['content'])) {
        throw new RuntimeException('Could not read the latest map configuration from GitHub.');
    }

    $latestJson = base64_decode(str_replace("\n", '', (string) $current['content']), true);
    $latest = json_decode((string) $latestJson, true);
    if (!is_array($latest)) throw new RuntimeException('The current GitHub map configuration is invalid.');

    $out = merge_scope($latest, $config, $scope);
    $encoded = json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($encoded === false) throw new RuntimeException('Could not encode the map configuration.');

    $message = match ($scope) {
        'images' => 'Update UAF map PNG overlays',
        'overlays' => 'Update UAF map overlays and key-linked geometry',
        default => 'Update UAF campus map from admin',
    };

    [$putStatus, $result] = github_request('PUT', $api, $token, [
        'message' => $message,
        'content' => base64_encode($encoded . "\n"),
        'sha' => (string) $current['sha'],
        'branch' => $branch,
    ]);

    if (!in_array($putStatus, [200, 201], true)) {
        $message = (string) ($result['message'] ?? 'GitHub rejected the publish request.');
        throw new RuntimeException($message);
    }

    echo json_encode([
        'ok' => true,
        'sha' => (string) ($result['commit']['sha'] ?? ''),
        'message' => 'Published successfully. Hostinger deployment should start from main.',
    ]);
} catch (Throwable $error) {
    http_response_code(502);
    echo json_encode(['ok' => false, 'error' => $error->getMessage()]);
}
