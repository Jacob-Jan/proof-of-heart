$containerName = 'poh-local-relay'

docker rm -f $containerName | Out-Null
Write-Host "Stopped local relay container: $containerName"
