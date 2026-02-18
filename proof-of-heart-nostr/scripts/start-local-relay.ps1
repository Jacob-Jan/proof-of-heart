$ErrorActionPreference = 'Stop'

$containerName = 'poh-local-relay'
$image = 'scsibug/nostr-rs-relay:latest'
$port = '7777'

Write-Host "Starting local Nostr relay ($containerName) on ws://127.0.0.1:$port ..."

# Ensure Docker daemon is reachable
try {
  docker info | Out-Null
} catch {
  Write-Error "Docker daemon is not running. Start Docker Desktop first, then run this script again."
  exit 1
}

# Pull latest image

docker pull $image | Out-Null

# Remove any old container
$exists = docker ps -a --format '{{.Names}}' | Select-String -SimpleMatch $containerName
if ($exists) {
  docker rm -f $containerName | Out-Null
}

# Start relay

docker run -d --name $containerName -p ${port}:8080 $image | Out-Null

Start-Sleep -Seconds 2

docker ps --filter "name=$containerName"
Write-Host "Done. Local relay endpoint: ws://127.0.0.1:$port"
