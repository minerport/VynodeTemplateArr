import { useEffect, useState } from 'react';
import type { CollectionContentFilters, CollectionDraft, CollectionFilterGroup, CollectionMissingMediaSettings } from '@vynode/contracts';
import type { ArrConfigurationView, SeerrConfigurationView, SeerrProbeResult, WatchlistDestinationOptions } from '@vynode/downloads';
import { api } from './api';
import { CollectionArrDestinationFields, defaultCollectionArrDestination } from './CollectionArrDestinationFields';
import { CollectionSeerrDestinationFields, defaultCollectionSeerrDestination } from './CollectionSeerrDestinationFields';

const emptyFilters = (): CollectionContentFilters => ({
  maximumPosition: 0,
  minimumYear: 0,
  minimumImdbRating: 0,
  minimumRottenTomatoesRating: 0,
  minimumRottenTomatoesAudienceRating: 0,
  genres: { mode: 'exclude', values: [] },
  countries: { mode: 'exclude', values: [] },
  languages: { mode: 'exclude', values: [] },
  keywords: { mode: 'exclude', values: [] },
});

export const defaultMissingMediaSettings: CollectionMissingMediaSettings = {
  enabled: false,
  downloadMode: 'seerr',
  searchMissingMovies: false,
  searchMissingTv: false,
  autoApproveMovies: false,
  autoApproveTv: false,
  maxSeasonsToRequest: 0,
  seasonsPerShowLimit: 0,
  seasonGrabOrder: 'first',
  createPlaceholders: false,
  placeholderDaysAhead: 360,
  includeAllReleasedItems: true,
  placeholderReleasedDays: 7,
  directRadarr: defaultCollectionArrDestination('radarr'),
  directSonarr: defaultCollectionArrDestination('sonarr'),
  seerrRadarr: defaultCollectionSeerrDestination(),
  seerrSonarr: defaultCollectionSeerrDestination(),
  requestFilters: emptyFilters(),
  placeholderFilters: emptyFilters(),
};

const choices = {
  genres: ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Science Fiction', 'Thriller'],
  countries: ['US', 'GB', 'CA', 'AU', 'FR', 'DE', 'ES', 'IT', 'JP', 'KR', 'IN'],
  languages: ['en', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'hi', 'pt', 'zh'],
};

function FilterGroup({ label, help, value, options, onChange }: { label: string; help: string; value: CollectionFilterGroup; options?: readonly string[]; onChange: (value: CollectionFilterGroup) => void }) {
  return <div className="content-filter"><div><strong>{label}</strong><select aria-label={`${label} mode`} value={value.mode} onChange={(event) => onChange({ ...value, mode: event.target.value as CollectionFilterGroup['mode'] })}><option value="exclude">Exclude</option><option value="include">Include only</option></select></div>{options ? <><div className="filter-actions"><button type="button" className="text-button" onClick={() => onChange({ ...value, values: options })}>Select all</button><button type="button" className="text-button" disabled={!value.values.length} onClick={() => onChange({ ...value, values: [] })}>Deselect all</button></div><select multiple aria-label={label} value={[...value.values]} onChange={(event) => onChange({ ...value, values: [...event.target.selectedOptions].map((option) => option.value) })}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></> : <input aria-label={label} value={value.values.join(', ')} placeholder="Search terms separated by commas" onChange={(event) => onChange({ ...value, values: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />}<small>{help}</small></div>;
}

function FilterEditor({ title, value, onChange }: { title: string; value: CollectionContentFilters; onChange: (value: CollectionContentFilters) => void }) {
  const group = (key: 'genres' | 'countries' | 'languages' | 'keywords', next: CollectionFilterGroup) => onChange({ ...value, [key]: next });
  return <details className="filter-editor"><summary>{title}</summary><div className="field-grid filter-numbers"><label>Maximum source position<input type="number" min={0} max={9999} value={value.maximumPosition} onChange={(event) => onChange({ ...value, maximumPosition: Number(event.target.value) })} /><small>Only process positions 1–X. Use 0 for no limit.</small></label><label>Minimum release year<input type="number" min={0} max={2200} value={value.minimumYear} onChange={(event) => onChange({ ...value, minimumYear: Number(event.target.value) })} /><small>Use 0 for no year limit.</small></label><label>Minimum IMDb rating<input type="number" min={0} max={10} step={0.1} value={value.minimumImdbRating} onChange={(event) => onChange({ ...value, minimumImdbRating: Number(event.target.value) })} /><small>Items without ratings pass when set above zero.</small></label><label>Minimum RT critics<input type="number" min={0} max={100} value={value.minimumRottenTomatoesRating} onChange={(event) => onChange({ ...value, minimumRottenTomatoesRating: Number(event.target.value) })} /></label><label>Minimum RT audience<input type="number" min={0} max={100} value={value.minimumRottenTomatoesAudienceRating} onChange={(event) => onChange({ ...value, minimumRottenTomatoesAudienceRating: Number(event.target.value) })} /></label></div><FilterGroup label="Genre filter" help="Exclude skips items with any selected genre; Include keeps items with any selected genre." value={value.genres} options={choices.genres} onChange={(next) => group('genres', next)} /><FilterGroup label="Country filter" help="Match production countries using include-any or exclude-any behavior." value={value.countries} options={choices.countries} onChange={(next) => group('countries', next)} /><FilterGroup label="Language filter" help="Match original languages using include-any or exclude-any behavior." value={value.languages} options={choices.languages} onChange={(next) => group('languages', next)} /><FilterGroup label="Keyword filter" help="Enter TMDB keyword names. Include keeps any match; Exclude skips any match." value={value.keywords} onChange={(next) => group('keywords', next)} /></details>;
}

export function CollectionMissingMediaFields({ draft, onChange }: { draft: CollectionDraft; onChange: (draft: CollectionDraft) => void }) {
  const settings: CollectionMissingMediaSettings = {
    ...defaultMissingMediaSettings,
    ...draft.missingMediaSettings,
    directRadarr: {
      ...defaultCollectionArrDestination('radarr'),
      ...draft.missingMediaSettings.directRadarr,
    },
    directSonarr: {
      ...defaultCollectionArrDestination('sonarr'),
      ...draft.missingMediaSettings.directSonarr,
    },
    seerrRadarr: {
      ...defaultCollectionSeerrDestination(),
      ...draft.missingMediaSettings.seerrRadarr,
    },
    seerrSonarr: {
      ...defaultCollectionSeerrDestination(),
      ...draft.missingMediaSettings.seerrSonarr,
    },
  };
  const update = (value: Partial<typeof settings>) => onChange({ ...draft, missingMediaSettings: { ...settings, ...value } });
  const [dependencies, setDependencies] = useState<{ seerr: boolean; radarr: boolean; sonarr: boolean; placeholders: boolean }>();
  const [arrOptions, setArrOptions] = useState<{
    radarr?: WatchlistDestinationOptions;
    sonarr?: WatchlistDestinationOptions;
    radarrConfigurations: readonly ArrConfigurationView[];
    sonarrConfigurations: readonly ArrConfigurationView[];
  }>({ radarrConfigurations: [], sonarrConfigurations: [] });
  const [seerrRouting, setSeerrRouting] = useState<{
    configuration?: SeerrConfigurationView;
    options?: SeerrProbeResult;
  }>({});
  useEffect(() => {
    void Promise.all([api.seerr(), api.downloadServices('radarr'), api.downloadServices('sonarr'), api.placeholders()])
      .then(([seerr, radarr, sonarr, placeholders]) => setDependencies({ seerr: !!seerr, radarr: radarr.length > 0, sonarr: sonarr.length > 0, placeholders: Object.values(placeholders.libraryRoots).some(Boolean) }))
      .catch(() => setDependencies({ seerr: false, radarr: false, sonarr: false, placeholders: false }));
  }, []);
  useEffect(() => {
    void Promise.all([api.seerr(), api.seerrDestinationOptions()])
      .then(([configuration, options]) =>
        setSeerrRouting({ configuration, options })
      )
      .catch(() => setSeerrRouting({}));
  }, []);
  useEffect(() => {
    void Promise.all([
      api.watchlistOptions('radarr'),
      api.watchlistOptions('sonarr'),
      api.downloadServices('radarr'),
      api.downloadServices('sonarr'),
    ])
      .then(([radarr, sonarr, radarrConfigurations, sonarrConfigurations]) =>
        setArrOptions({
          radarr,
          sonarr,
          radarrConfigurations,
          sonarrConfigurations,
        })
      )
      .catch(() =>
        setArrOptions({
          radarrConfigurations: [],
          sonarrConfigurations: [],
        })
      );
  }, []);
  const downloadReady = settings.downloadMode === 'seerr'
    ? dependencies?.seerr
    : (!settings.searchMissingMovies || Boolean(arrOptions.radarr?.servers.length)) &&
      (!settings.searchMissingTv || Boolean(arrOptions.sonarr?.servers.length));
  return <fieldset className="missing-media-settings"><legend>Missing media</legend>
    <label className="check-row"><input type="checkbox" checked={settings.enabled} onChange={(event) => update({ enabled: event.target.checked })} /><span><strong>Grab missing items</strong><small>Request or directly add source items that are not already available in the selected Plex library.</small></span></label>
    {settings.enabled && <>
      <label>Download mode<select value={settings.downloadMode} onChange={(event) => update({ downloadMode: event.target.value as typeof settings.downloadMode })}><option value="seerr">Send requests through Seerr</option><option value="direct">Add directly to Radarr and Sonarr</option></select><small>Seerr applies its request permissions and routing. Direct mode uses the selected Arr defaults.</small></label>
      {dependencies && <div className={`dependency-notice ${downloadReady ? 'ready' : 'missing'}`}><strong>{downloadReady ? 'Download routing ready' : 'Download setup required'}</strong><span>{downloadReady ? 'Required services are configured for the selected media types.' : 'Configure the required Seerr, Radarr, or Sonarr destination before synchronization.'}</span>{!downloadReady && <a href="/settings/downloads">Configure downloads</a>}</div>}
      <div className="field-grid"><label className="check-row"><input type="checkbox" checked={settings.searchMissingMovies} onChange={(event) => update({ searchMissingMovies: event.target.checked })} /><span><strong>Missing movies</strong><small>Process movie results not found in Plex.</small></span></label><label className="check-row"><input type="checkbox" checked={settings.searchMissingTv} onChange={(event) => update({ searchMissingTv: event.target.checked })} /><span><strong>Missing TV shows</strong><small>Process series results not found in Plex.</small></span></label></div>
      {settings.downloadMode === 'seerr' && <div className="field-grid"><label className="check-row"><input type="checkbox" checked={settings.autoApproveMovies} disabled={!settings.searchMissingMovies} onChange={(event) => update({ autoApproveMovies: event.target.checked })} /><span><strong>Auto-approve movies</strong><small>Approve generated Seerr movie requests immediately.</small></span></label><label className="check-row"><input type="checkbox" checked={settings.autoApproveTv} disabled={!settings.searchMissingTv} onChange={(event) => update({ autoApproveTv: event.target.checked })} /><span><strong>Auto-approve TV</strong><small>Approve generated Seerr series requests immediately.</small></span></label></div>}
      {settings.downloadMode === 'seerr' && settings.searchMissingMovies && <CollectionSeerrDestinationFields kind="radarr" value={settings.seerrRadarr} options={seerrRouting.options} defaults={seerrRouting.configuration?.radarr} onChange={(seerrRadarr) => update({ seerrRadarr })} />}
      {settings.downloadMode === 'seerr' && settings.searchMissingTv && <CollectionSeerrDestinationFields kind="sonarr" value={settings.seerrSonarr} options={seerrRouting.options} defaults={seerrRouting.configuration?.sonarr} onChange={(seerrSonarr) => update({ seerrSonarr })} />}
      {settings.downloadMode === 'direct' && settings.searchMissingMovies && <CollectionArrDestinationFields kind="radarr" value={settings.directRadarr} options={arrOptions.radarr} configurations={arrOptions.radarrConfigurations} onChange={(directRadarr) => update({ directRadarr })} />}
      {settings.downloadMode === 'direct' && settings.searchMissingTv && <CollectionArrDestinationFields kind="sonarr" value={settings.directSonarr} options={arrOptions.sonarr} configurations={arrOptions.sonarrConfigurations} onChange={(directSonarr) => update({ directSonarr })} />}
      {settings.searchMissingTv && <div className="field-grid"><label>Maximum seasons<input type="number" min={0} max={50} value={settings.maxSeasonsToRequest} onChange={(event) => update({ maxSeasonsToRequest: Number(event.target.value) })} /><small>0 requests every available season.</small></label><label>Seasons per show<input type="number" min={0} max={50} value={settings.seasonsPerShowLimit} onChange={(event) => update({ seasonsPerShowLimit: Number(event.target.value) })} /><small>Limit each show independently; 0 means all.</small></label><label>Season grab order<select value={settings.seasonGrabOrder} onChange={(event) => update({ seasonGrabOrder: event.target.value as typeof settings.seasonGrabOrder })}><option value="first">Earliest seasons first</option><option value="latest">Latest seasons first</option><option value="airing">Currently airing first</option></select></label></div>}
      <FilterEditor title="Request and download filters" value={settings.requestFilters} onChange={(requestFilters) => update({ requestFilters })} />
    </>}
    <label className="check-row"><input type="checkbox" checked={settings.createPlaceholders} onChange={(event) => update({ createPlaceholders: event.target.checked })} /><span><strong>Create placeholders for missing items</strong><small>Create Plex-visible placeholder files with release information for unavailable source items.</small></span></label>
    {settings.createPlaceholders && <>{dependencies && <div className={`dependency-notice ${dependencies.placeholders ? 'ready' : 'missing'}`}><strong>{dependencies.placeholders ? 'Placeholder folders ready' : 'Placeholder root folders required'}</strong><span>{dependencies.placeholders ? 'At least one selected Plex library has a configured placeholder root.' : 'Configure a mounted placeholder folder for the target library before synchronization.'}</span>{!dependencies.placeholders && <a href="/settings/downloads">Configure placeholder folders</a>}</div>}<div className="field-grid"><label>Days ahead<input type="number" min={1} max={730} value={settings.placeholderDaysAhead} onChange={(event) => update({ placeholderDaysAhead: Number(event.target.value) })} /><small>Create placeholders for releases within this many days.</small></label><label>Released item retention<input type="number" min={1} max={30} value={settings.placeholderReleasedDays} onChange={(event) => update({ placeholderReleasedDays: Number(event.target.value) })} /><small>Keep orphaned placeholders this many days after release.</small></label></div><label className="check-row"><input type="checkbox" checked={settings.includeAllReleasedItems} onChange={(event) => update({ includeAllReleasedItems: event.target.checked })} /><span><strong>Include all released items</strong><small>Create placeholders for released source items regardless of release age.</small></span></label><FilterEditor title="Placeholder-only filters" value={settings.placeholderFilters} onChange={(placeholderFilters) => update({ placeholderFilters })} /></>}
  </fieldset>;
}
