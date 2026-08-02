# Unraid Community Applications submission

The repository contains the artifacts required for an Unraid Community
Applications template repository:

- `ca_profile.xml` provides maintainer metadata.
- `unraid/vynode.xml` is the Docker template and contains its raw `TemplateURL`.
- `unraid/vynode-icon.svg` is the public application icon.
- `ghcr.io/minerport/vynodetemplatearr:0.1.0-rc.9` is the immutable
  release-candidate container tag.
- `ghcr.io/minerport/vynodetemplatearr:serious-test` tracks the latest approved
  serious-testing build.

Before submitting the repository URL to Community Applications, confirm the
GHCR package is public and both image tags resolve without authentication.
Use GitHub Issues as the support destination until a dedicated Unraid forum
support thread is available.
