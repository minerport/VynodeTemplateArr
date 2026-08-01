import { useEffect, useMemo, useState } from 'react';
import type { CollectionSeerrDestination } from '@vynode/contracts';
import type {
  ArrKind,
  SeerrDestination,
  SeerrProbeResult,
} from '@vynode/downloads';
import { api } from './api';

interface CollectionSeerrDestinationFieldsProps {
  kind: ArrKind;
  value: CollectionSeerrDestination;
  options?: SeerrProbeResult;
  defaults?: SeerrDestination;
  onChange: (value: CollectionSeerrDestination) => void;
}

export const defaultCollectionSeerrDestination =
  (): CollectionSeerrDestination => ({ tagIds: [] });

export function CollectionSeerrDestinationFields({
  kind,
  value,
  options,
  defaults,
  onChange,
}: CollectionSeerrDestinationFieldsProps) {
  const serviceName = kind === 'radarr' ? 'Radarr' : 'Sonarr';
  const mediaName = kind === 'radarr' ? 'movies' : 'TV shows';
  const servers =
    kind === 'radarr' ? options?.servers.radarr : options?.servers.sonarr;
  const serverOptions =
    kind === 'radarr'
      ? options?.radarrServerOptions
      : options?.sonarrServerOptions;
  const selectedOptions =
    value.serverId !== undefined ? serverOptions?.[value.serverId] : undefined;
  const [newTag, setNewTag] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createdTags, setCreatedTags] = useState<
    readonly { serverId: number; id: number; label: string }[]
  >([]);
  const availableTags = useMemo(
    () => [
      ...(selectedOptions?.tags ?? []),
      ...createdTags
        .filter(
          (tag) =>
            tag.serverId === value.serverId &&
            !selectedOptions?.tags.some((existing) => existing.id === tag.id)
        )
        .map(({ id, label }) => ({ id, label })),
    ],
    [createdTags, selectedOptions, value.serverId]
  );

  useEffect(() => {
    if (!servers?.length || value.serverId !== undefined) return;
    const server =
      (defaults?.serverId !== undefined
        ? servers.find((candidate) => candidate.id === defaults.serverId)
        : undefined) ??
      servers.find((candidate) => candidate.isDefault && !candidate.is4k) ??
      servers.find((candidate) => candidate.isDefault) ??
      servers[0];
    if (!server) return;
    const discovered = serverOptions?.[server.id];
    onChange({
      serverId: server.id,
      profileId:
        defaults?.serverId === server.id
          ? defaults.profileId
          : discovered?.profiles[0]?.id,
      rootFolder:
        defaults?.serverId === server.id
          ? defaults.rootFolder
          : discovered?.rootFolders[0]?.path,
      tagIds:
        defaults?.serverId === server.id ? defaults.tagIds : [],
    });
  }, [defaults, onChange, serverOptions, servers, value.serverId]);

  const changeServer = (raw: string) => {
    const serverId = raw ? Number(raw) : undefined;
    const discovered =
      serverId !== undefined ? serverOptions?.[serverId] : undefined;
    const useDefaults = defaults?.serverId === serverId;
    onChange({
      serverId,
      profileId: useDefaults
        ? defaults?.profileId
        : discovered?.profiles[0]?.id,
      rootFolder: useDefaults
        ? defaults?.rootFolder
        : discovered?.rootFolders[0]?.path,
      tagIds: useDefaults ? defaults?.tagIds ?? [] : [],
    });
    setError('');
  };

  const stale = useMemo(() => {
    if (!selectedOptions) return value.serverId === undefined ? [] : ['server'];
    const fields: string[] = [];
    if (
      value.profileId !== undefined &&
      !selectedOptions.profiles.some((profile) => profile.id === value.profileId)
    ) {
      fields.push('quality profile');
    }
    if (
      value.rootFolder &&
      !selectedOptions.rootFolders.some(
        (folder) => folder.path === value.rootFolder
      )
    ) {
      fields.push('root folder');
    }
    if (
      value.tagIds.some(
        (tagId) => !availableTags.some((tag) => tag.id === tagId)
      )
    ) {
      fields.push('tag');
    }
    return fields;
  }, [availableTags, selectedOptions, value]);

  const createTag = async () => {
    const label = newTag.trim();
    if (value.serverId === undefined || !label || creating) return;
    const serverId = value.serverId;
    setCreating(true);
    setError('');
    try {
      const tag = await api.createSeerrDestinationTag(
        kind,
        serverId,
        label
      );
      setCreatedTags((current) => [
        ...current.filter(
          (entry) => entry.serverId !== serverId || entry.id !== tag.id
        ),
        { serverId, ...tag },
      ]);
      onChange({
        ...value,
        tagIds: value.tagIds.includes(tag.id)
          ? value.tagIds
          : [...value.tagIds, tag.id],
      });
      setNewTag('');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : `The ${serviceName} tag could not be created through Seerr.`
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <fieldset className="arr-destination seerr-destination">
      <legend>
        Seerr {serviceName} routing ({mediaName})
      </legend>
      <p className="field-help">
        Seerr normally uses its global destination. These values override the
        server, quality profile, and root folder for requests created by this
        collection. Tags are controlled by the selected server in Seerr.
      </p>
      {!servers?.length ? (
        <div className="dependency-notice missing">
          <strong>No Seerr {serviceName} destination is available</strong>
          <span>
            Verify the {serviceName} server inside Seerr, then reload these
            destination choices.
          </span>
          <a href="/settings/downloads">Configure Seerr</a>
        </div>
      ) : (
        <>
          <div className="field-grid">
            <label>
              {serviceName} server in Seerr
              <select
                value={value.serverId ?? ''}
                onChange={(event) => changeServer(event.target.value)}
              >
                <option value="">Select server…</option>
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                    {server.isDefault ? ' — Default' : ''}
                    {server.is4k ? ' — 4K' : ''}
                  </option>
                ))}
              </select>
              <small>
                This is Seerr’s destination identifier, not Vynode’s direct Arr
                server identifier.
              </small>
            </label>
            <label>
              Quality profile
              <select
                disabled={!selectedOptions}
                value={value.profileId ?? ''}
                onChange={(event) =>
                  onChange({
                    ...value,
                    profileId: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
              >
                <option value="">
                  {selectedOptions
                    ? 'Select quality profile…'
                    : 'Select a server first'}
                </option>
                {selectedOptions?.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <small>
                Overrides the quality profile configured for this Seerr server.
              </small>
            </label>
            <label>
              Root folder
              <select
                disabled={!selectedOptions}
                value={value.rootFolder ?? ''}
                onChange={(event) =>
                  onChange({
                    ...value,
                    rootFolder: event.target.value || undefined,
                  })
                }
              >
                <option value="">
                  {selectedOptions
                    ? 'Select root folder…'
                    : 'Select a server first'}
                </option>
                {selectedOptions?.rootFolders.map((folder) => (
                  <option key={folder.id} value={folder.path}>
                    {folder.path}
                  </option>
                ))}
              </select>
              <small>
                Seerr sends this server-reported folder with the generated
                request.
              </small>
            </label>
          </div>
          <label>
            {serviceName} server tags
            <select
              multiple
              disabled
              value={[...value.tagIds].map(String)}
              onChange={(event) =>
                onChange({
                  ...value,
                  tagIds: [...event.target.selectedOptions].map((option) =>
                    Number(option.value)
                  ),
                })
              }
            >
              {availableTags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.label}
                </option>
              ))}
            </select>
            <small>
              Seerr does not accept tag overrides on an individual request.
              Configure request tags on this server inside Seerr.
            </small>
          </label>
          <div className="inline-create">
            <label>
              Create a new {serviceName} server tag
              <input
                value={newTag}
                maxLength={64}
                disabled
                placeholder={`New ${serviceName} tag name`}
                onChange={(event) => setNewTag(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button secondary"
              disabled
              onClick={() => void createTag()}
            >
              Manage tags in Seerr
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
          {stale.length > 0 && (
            <div className="dependency-notice missing">
              <strong>Seerr destination choices changed</strong>
              <span>
                The selected {stale.join(', ')} no longer exists. Reload and
                choose current values before saving.
              </span>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
