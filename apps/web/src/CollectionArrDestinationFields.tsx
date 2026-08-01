import { useEffect, useMemo, useState } from 'react';
import type {
  CollectionArrDestination,
  CollectionSonarrMonitorType,
} from '@vynode/contracts';
import type {
  ArrConfigurationView,
  ArrKind,
  WatchlistDestinationOptions,
} from '@vynode/downloads';
import { api } from './api';

interface CollectionArrDestinationFieldsProps {
  kind: ArrKind;
  value: CollectionArrDestination;
  options?: WatchlistDestinationOptions;
  configurations: readonly ArrConfigurationView[];
  onChange: (value: CollectionArrDestination) => void;
}

const monitorTypes: readonly [CollectionSonarrMonitorType, string][] = [
  ['all', 'All episodes except specials'],
  ['future', 'Future episodes not yet aired'],
  ['missing', 'Missing episodes'],
  ['existing', 'Existing episodes'],
  ['pilot', 'Pilot episode only'],
  ['firstSeason', 'First season'],
  ['latestSeason', 'Latest season'],
  ['none', 'None'],
];

export const defaultCollectionArrDestination = (
  kind: ArrKind
): CollectionArrDestination => ({
  tagIds: [],
  monitor: true,
  monitorType: kind === 'sonarr' ? 'all' : 'none',
  searchOnAdd: true,
});

export function CollectionArrDestinationFields({
  kind,
  value,
  options,
  configurations,
  onChange,
}: CollectionArrDestinationFieldsProps) {
  const serviceName = kind === 'radarr' ? 'Radarr' : 'Sonarr';
  const mediaName = kind === 'radarr' ? 'movies' : 'TV shows';
  const [newTag, setNewTag] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);
  const [tagError, setTagError] = useState('');
  const [createdTags, setCreatedTags] = useState<
    readonly { serverId: string; id: number; label: string }[]
  >([]);

  const selectedServer = options?.servers.find(
    (server) => server.id === value.serverId
  );
  const selectedOptions = value.serverId
    ? options?.serverOptions[value.serverId]
    : undefined;
  const selectedConfiguration = configurations.find(
    (configuration) => configuration.id === value.serverId
  );
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
    if (!options?.servers.length || value.serverId) return;
    const defaultServer =
      options.servers.find((server) => server.isDefault && !server.is4k) ??
      options.servers.find((server) => server.isDefault) ??
      options.servers[0];
    const configuration = configurations.find(
      (entry) => entry.id === defaultServer?.id
    );
    if (!defaultServer) return;
    const discovered = options.serverOptions[defaultServer.id];
    onChange({
      ...value,
      serverId: defaultServer.id,
      profileId:
        configuration?.selection.profileId ?? discovered?.profiles[0]?.id,
      rootFolder:
        configuration?.selection.rootFolder ?? discovered?.rootFolders[0]?.path,
      tagIds: configuration?.selection.tagIds ?? [],
      monitor: configuration?.selection.monitorByDefault ?? true,
      monitorType:
        configuration?.selection.kind === 'sonarr'
          ? configuration.selection.monitorType
          : value.monitorType,
      searchOnAdd: configuration?.selection.searchOnAdd ?? true,
    });
  }, [configurations, onChange, options, value]);

  const staleSelections = useMemo(() => {
    if (!value.serverId || !selectedOptions) return [];
    const stale: string[] = [];
    if (
      value.profileId !== undefined &&
      !selectedOptions.profiles.some((profile) => profile.id === value.profileId)
    ) {
      stale.push('quality profile');
    }
    if (
      value.rootFolder &&
      !selectedOptions.rootFolders.some(
        (folder) => folder.path === value.rootFolder
      )
    ) {
      stale.push('root folder');
    }
    if (
      value.tagIds.some(
        (tagId) => !availableTags.some((tag) => tag.id === tagId)
      )
    ) {
      stale.push('tag');
    }
    return stale;
  }, [availableTags, selectedOptions, value]);

  const selectServer = (serverId: string) => {
    const configuration = configurations.find(
      (entry) => entry.id === serverId
    );
    const discovered = options?.serverOptions[serverId];
    onChange({
      ...value,
      serverId: serverId || undefined,
      profileId:
        configuration?.selection.profileId ?? discovered?.profiles[0]?.id,
      rootFolder:
        configuration?.selection.rootFolder ?? discovered?.rootFolders[0]?.path,
      tagIds: configuration?.selection.tagIds ?? [],
      monitor: configuration?.selection.monitorByDefault ?? true,
      monitorType:
        configuration?.selection.kind === 'sonarr'
          ? configuration.selection.monitorType
          : value.monitorType,
      searchOnAdd: configuration?.selection.searchOnAdd ?? true,
    });
    setTagError('');
  };

  const createTag = async () => {
    const label = newTag.trim();
    if (!value.serverId || !label || creatingTag) return;
    const serverId = value.serverId;
    setCreatingTag(true);
    setTagError('');
    try {
      const created = await api.createWatchlistTag(kind, serverId, label);
      setCreatedTags((current) => [
        ...current.filter(
          (tag) =>
            tag.serverId !== serverId || tag.id !== created.id
        ),
        { serverId, ...created },
      ]);
      onChange({
        ...value,
        tagIds: value.tagIds.includes(created.id)
          ? value.tagIds
          : [...value.tagIds, created.id],
      });
      setNewTag('');
    } catch (error) {
      setTagError(
        error instanceof Error
          ? error.message
          : `The ${serviceName} tag could not be created.`
      );
    } finally {
      setCreatingTag(false);
    }
  };

  return (
    <fieldset className="arr-destination">
      <legend>
        {serviceName} destination ({mediaName})
      </legend>
      <p className="field-help">
        These values override the selected {serviceName} server defaults for
        this collection only. Changing the server resets every dependent value
        to that server’s active defaults.
      </p>

      {!options?.servers.length ? (
        <div className="dependency-notice missing">
          <strong>No {serviceName} destination is available</strong>
          <span>
            Add and test a {serviceName} server before enabling direct
            downloads for {mediaName}.
          </span>
          <a href="/settings/downloads">Configure downloads</a>
        </div>
      ) : (
        <>
          <div className="field-grid">
            <label>
              {serviceName} server
              <select
                value={value.serverId ?? ''}
                onChange={(event) => selectServer(event.target.value)}
              >
                <option value="">Select server…</option>
                {options.servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                    {server.isDefault ? ' — Default' : ''}
                    {server.is4k ? ' — 4K' : ''}
                  </option>
                ))}
              </select>
              <small>
                {selectedServer
                  ? `${selectedServer.name} supplies the available profiles, folders, and tags below.`
                  : `Choose which ${serviceName} instance receives ${mediaName}.`}
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
                Overrides the server’s active quality profile for this
                collection.
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
                Files added by this collection are placed under this
                server-reported folder.
              </small>
            </label>
          </div>

          <label>
            {serviceName} tags
            <select
              multiple
              disabled={!selectedOptions}
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
              Hold Ctrl or Command to select multiple tags. Existing automatic
              tags remain selected when supplied by the server default.
            </small>
          </label>

          <div className="inline-create">
            <label>
              Create a new {serviceName} tag
              <input
                disabled={!value.serverId || creatingTag}
                value={newTag}
                maxLength={100}
                placeholder={`New ${serviceName} tag name`}
                onChange={(event) => setNewTag(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={!value.serverId || !newTag.trim() || creatingTag}
              onClick={() => void createTag()}
            >
              {creatingTag ? 'Creating tag…' : 'Create and select tag'}
            </button>
          </div>
          {tagError && <p className="form-error">{tagError}</p>}

          {staleSelections.length > 0 && (
            <div className="dependency-notice missing">
              <strong>Destination choices changed</strong>
              <span>
                The selected {staleSelections.join(', ')} no longer exists on{' '}
                {serviceName}. Choose a current value before saving.
              </span>
            </div>
          )}

          {kind === 'radarr' ? (
            <label className="check-row">
              <input
                type="checkbox"
                checked={value.monitor}
                onChange={(event) =>
                  onChange({ ...value, monitor: event.target.checked })
                }
              />
              <span>
                <strong>Monitor movies</strong>
                <small>Monitor movies when they are added to Radarr.</small>
              </span>
            </label>
          ) : (
            <label>
              Monitor type
              <select
                value={value.monitorType}
                onChange={(event) =>
                  onChange({
                    ...value,
                    monitorType: event.target
                      .value as CollectionSonarrMonitorType,
                  })
                }
              >
                {monitorTypes.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <small>
                Choose which episodes Sonarr monitors when this collection adds
                a show.
              </small>
            </label>
          )}

          <label className="check-row">
            <input
              type="checkbox"
              checked={value.searchOnAdd}
              onChange={(event) =>
                onChange({ ...value, searchOnAdd: event.target.checked })
              }
            />
            <span>
              <strong>Search on add</strong>
              <small>
                Immediately search for {mediaName} after adding them to{' '}
                {serviceName}.
              </small>
            </span>
          </label>

          {selectedConfiguration && (
            <p className="field-help">
              Defaults loaded from {selectedConfiguration.endpoint.name}.
              Changing values here does not modify the global server
              configuration.
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
