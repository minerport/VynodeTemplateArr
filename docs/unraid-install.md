# Unraid serious-testing installation

Vynode stores its database, encrypted credentials, job state, uploaded assets,
and logs under `/var/lib/vynode`. Never launch the container without a persistent
appdata mapping or without retaining the master key.

## Build and install

The Unraid template pulls the published release-candidate image:

```sh
docker pull ghcr.io/minerport/vynodetemplatearr:0.1.0-rc.13
```

To build the same image locally on a Docker-capable host:

```sh
docker build -t vynode:local .
```

On Windows, the included helper can also build and optionally export a tar file
that can be loaded on Unraid with `docker load --input FILE.tar`:

```powershell
.\scripts\build-unraid-image.ps1 -Tag vynode:serious-test
.\scripts\build-unraid-image.ps1 -Tag vynode:serious-test -Archive .\release\vynode-amd64.tar
```

The export helper targets `linux/amd64` by default and writes a neighboring
`.sha256` file. Verify it on Unraid before loading:

```sh
sha256sum --check vynode-amd64.tar.sha256
docker load --input vynode-amd64.tar
```

For manual installation, copy `unraid/vynode.xml` to
`/boot/config/plugins/dockerMan/templates-user/` on the Unraid server, then add
the Vynode container from the Docker page. For Community Applications, use the
repository template after it has been accepted into the CA catalog.

Generate the required key once:

```sh
openssl rand -base64 32
```

Paste that value into **Master Key** and store a recovery copy outside the
appdata share. Use `/mnt/user/appdata/vynode` for Appdata. Prefer mapping only
the media shares Vynode needs instead of all `/mnt/user`.

## Upgrade and rollback

Back up both appdata and the master key before replacing the image. Stop the
container, take an appdata snapshot, install the new image, then verify
`http://SERVER-IP:7171/health` (or the API-compatible alias
`http://SERVER-IP:7171/api/health`) before allowing scheduled mutations. Rollback is
the reverse: stop Vynode, restore the matching appdata snapshot and master key,
select the prior image tag, and start the container.

## First serious-test checklist

- Complete owner Plex authentication and verify the exact server and libraries.
- Configure one provider at a time and use its connection test.
- Preview collections and overlays before enabling schedules.
- Start with a small test library and confirm Plex read-back/reset behavior.
- Confirm Appdata files are owned by the configured PUID/PGID after restart.
- Keep `VYNODE_TRUST_PROXY=false` unless a trusted reverse proxy terminates access.
