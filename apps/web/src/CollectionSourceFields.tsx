import type {
  CollectionDraft,
  CollectionSourceType,
  PlexContentRatingGroup,
  PlexLibraryGeneratorSubtype,
  PlexLibraryGeneratorValue,
} from '@vynode/contracts';
import type {
  IntegrationConfiguration,
  IntegrationId,
} from '@vynode/integrations';
import { useEffect, useState } from 'react';
import { api } from './api';

export const collectionSourceOptions: readonly {
  value: CollectionSourceType;
  label: string;
}[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'seerr', label: 'Seerr Requests' },
  { value: 'tautulli', label: 'Tautulli Statistics' },
  { value: 'trakt', label: 'Trakt Lists' },
  { value: 'plex', label: 'Plex Library' },
  { value: 'letterboxd', label: 'Letterboxd Lists' },
  { value: 'tmdb', label: 'TMDB Lists' },
  { value: 'imdb', label: 'IMDb Lists' },
  { value: 'mdblist', label: 'MDBList Lists' },
  { value: 'networks', label: 'Networks Top 10' },
  { value: 'originals', label: 'Network Originals' },
  { value: 'anilist', label: 'AniList' },
  { value: 'mal', label: 'MyAnimeList' },
  { value: 'radarrtag', label: 'Radarr Tag' },
  { value: 'sonarrtag', label: 'Sonarr Tag' },
  { value: 'comingsoon', label: 'Coming Soon' },
  { value: 'filtered-hub', label: 'Filtered Plex Hub' },
  { value: 'multi-source', label: 'Multiple Sources' },
];

export const collectionSubtypes: Partial<
  Record<
    CollectionSourceType,
    readonly { value: string; label: string; help?: string }[]
  >
> = {
  seerr: [
    {
      value: 'users',
      label: 'All linked-user requests',
      help: 'Combines requests from every Seerr user except the server owner.',
    },
    {
      value: 'user',
      label: 'One Seerr user',
      help: 'Includes requests from exactly one non-owner Seerr user ID.',
    },
    {
      value: 'server_owner',
      label: 'Server owner requests',
      help: 'Includes only requests made by the Seerr server owner.',
    },
    {
      value: 'global',
      label: 'All requests',
      help: 'Combines owner and linked-user requests.',
    },
  ],
  tautulli: [
    {
      value: 'most_popular_plays',
      label: 'Most Popular — play count',
      help: 'Ranks titles by unique viewers, using play-count statistics for the selected number of days.',
    },
    {
      value: 'most_popular_duration',
      label: 'Most Popular — watch duration',
      help: 'Ranks titles by unique viewers, using watch-duration statistics for the selected number of days.',
    },
    {
      value: 'most_watched_plays',
      label: 'Most Watched — play count',
      help: 'Ranks titles by total plays during the selected number of days.',
    },
    {
      value: 'most_watched_duration',
      label: 'Most Watched — watch duration',
      help: 'Ranks titles by total watch duration during the selected number of days.',
    },
  ],
  trakt: [
    {
      value: 'trending',
      label: 'Trending Now',
      help: 'Current Trakt activity, updated as viewers watch.',
    },
    {
      value: 'popular',
      label: 'Popular',
      help: 'All-time popular titles from Trakt.',
    },
    {
      value: 'recommendations',
      label: 'Recommendations',
      help: 'Personalized results from the connected Trakt account. OAuth authorization is required.',
    },
    {
      value: 'watchlist',
      label: 'Watchlist',
      help: 'Titles saved to the connected Trakt account watchlist. OAuth authorization is required.',
    },
    { value: 'played', label: 'Most Played' },
    { value: 'watched', label: 'Most Watched' },
    { value: 'collected', label: 'Most Collected' },
    { value: 'favorited', label: 'Most Favorited' },
    {
      value: 'boxoffice',
      label: 'Box Office',
      help: 'Current theatrical box office ranking. Available for Movies only.',
    },
    {
      value: 'custom',
      label: 'Custom List',
      help: 'Use one Trakt user or official list URL. Private lists use the connected account authorization.',
    },
    {
      value: 'random',
      label: 'Random Lists',
      help: 'Choose one configured Trakt list on every preview or synchronization run. Private lists use the connected account authorization.',
    },
  ],
  tmdb: [
    { value: 'trending_day', label: 'Trending Today' },
    { value: 'trending_week', label: 'Trending This Week' },
    { value: 'popular', label: 'Popular' },
    { value: 'top_rated', label: 'Top Rated' },
    { value: 'advanced_custom_tmdb', label: 'Custom Advanced Filters' },
    { value: 'auto_franchise', label: 'Auto Franchise Collections' },
    { value: 'custom', label: 'Custom Collection or List' },
    { value: 'random', label: 'Random Lists' },
  ],
  imdb: [
    { value: 'top_250', label: 'Top 250' },
    { value: 'top_250_english', label: 'Top 250 English' },
    { value: 'popular', label: 'Popular Meter' },
    { value: 'boxoffice', label: 'Box Office' },
    { value: 'custom', label: 'Custom List' },
    { value: 'random', label: 'Random Lists' },
  ],
  letterboxd: [
    { value: 'custom', label: 'Custom List' },
    { value: 'watchlist', label: 'Watchlist' },
    { value: 'random', label: 'Random Lists' },
  ],
  mdblist: [{ value: 'custom', label: 'Custom List' }],
  networks: [
    { value: 'netflix_top_10', label: 'Netflix Top 10' },
    { value: 'amazon-prime_top_10', label: 'Amazon Prime Top 10' },
    { value: 'disney_top_10', label: 'Disney+ Top 10' },
    { value: 'hbo-max_top_10', label: 'Max Top 10' },
    { value: 'apple-tv_top_10', label: 'Apple TV+ Top 10' },
    { value: 'paramount_top_10', label: 'Paramount+ Top 10' },
    { value: 'hulu_top_10', label: 'Hulu Top 10' },
    { value: 'peacock_top_10', label: 'Peacock Top 10' },
    { value: 'crunchyroll_top_10', label: 'Crunchyroll Top 10' },
    { value: 'discovery-plus_top_10', label: 'Discovery+ Top 10' },
  ],
  originals: [
    { value: 'netflix_originals', label: 'Netflix Originals' },
    { value: 'amazon_originals', label: 'Amazon Originals' },
    { value: 'disney_originals', label: 'Disney+ Originals' },
    { value: 'hbomax_originals', label: 'Max Originals' },
    { value: 'paramount_originals', label: 'Paramount+ Originals' },
    { value: 'hulu_originals', label: 'Hulu Originals' },
    { value: 'peacock_originals', label: 'Peacock Originals' },
    { value: 'apple_originals', label: 'Apple TV+ Originals' },
    { value: 'discovery_originals', label: 'Discovery+ Movies' },
  ],
  anilist: [
    { value: 'trending', label: 'Trending Anime' },
    { value: 'popular', label: 'Popular Anime' },
    { value: 'top_rated', label: 'Top Rated Anime' },
    { value: 'custom', label: 'Custom List' },
  ],
  mal: [
    {
      value: 'all',
      label: 'Top Anime Series',
      help: 'Highest-rated anime overall. Vynode keeps only entries compatible with the selected Plex library.',
    },
    {
      value: 'airing',
      label: 'Top Airing Anime',
      help: 'Highest-rated anime currently airing. Available for TV libraries.',
    },
    {
      value: 'tv',
      label: 'Top Anime TV Series',
      help: 'Highest-rated television anime. Available for TV libraries.',
    },
    {
      value: 'movie',
      label: 'Top Anime Movies',
      help: 'Highest-rated anime films. Available for Movie libraries.',
    },
    {
      value: 'ova',
      label: 'Top OVA Series',
      help: 'Highest-rated original video animation titles. Available for TV libraries.',
    },
    {
      value: 'special',
      label: 'Top Anime Specials',
      help: 'Highest-rated anime specials. Available for TV libraries.',
    },
    {
      value: 'bypopularity',
      label: 'Most Popular Anime',
      help: 'Anime ordered by MyAnimeList member count, filtered for the selected library type.',
    },
    {
      value: 'favorite',
      label: 'Most Favorited Anime',
      help: 'Anime ordered by MyAnimeList user favorites, filtered for the selected library type.',
    },
  ],
  plex: [
    { value: 'directors', label: 'Auto Director Collections' },
    { value: 'actors', label: 'Auto Actor Collections' },
    {
      value: 'genres',
      label: 'One smart collection per genre',
      help: 'Reads every genre currently present in the selected Plex library.',
    },
    {
      value: 'decades',
      label: 'One smart collection per decade',
      help: 'Groups Plex years into decades such as 1990s and 2020s.',
    },
    {
      value: 'resolutions',
      label: 'One smart collection per resolution',
      help: 'Reads the video resolutions Plex reports for library items.',
    },
    {
      value: 'content-ratings',
      label: 'One smart collection per content rating',
      help: 'Reads Plex content ratings and groups them into regional families.',
    },
  ],
  comingsoon: [
    { value: 'monitored', label: 'Monitored in Radarr or Sonarr' },
    {
      value: 'trakt_anticipated',
      label: 'Trakt Anticipated',
      help: 'Most anticipated upcoming Movies or TV shows from Trakt.',
    },
    { value: 'tmdb_anticipated', label: 'TMDB Coming Soon' },
  ],
  'filtered-hub': [
    { value: 'recently_added', label: 'Recently Added' },
    { value: 'recently_released', label: 'Recently Released' },
    { value: 'recently_released_episodes', label: 'Recently Added Episodes' },
  ],
};

export const collectionCustomUrlPlaceholders: Partial<
  Record<CollectionSourceType, string>
> = {
  trakt: 'https://trakt.tv/users/username/lists/list-name',
  tmdb: 'https://www.themoviedb.org/list/12345',
  imdb: 'https://www.imdb.com/list/ls123456789/',
  letterboxd: 'https://letterboxd.com/username/list/list-name/',
  mdblist: 'https://mdblist.com/lists/username/list-name',
  anilist: 'https://anilist.co/user/username/animelist',
};

export function CollectionSourceFields({
  draft,
  onChange,
}: {
  draft: CollectionDraft;
  onChange: (draft: CollectionDraft) => void;
}) {
  const settings = draft.sourceSettings;
  const integrationId: IntegrationId | undefined =
    draft.sourceType === 'mal'
      ? 'myanimelist'
      : draft.sourceType === 'comingsoon' &&
          settings.subtype === 'trakt_anticipated'
        ? 'trakt'
        : ['trakt', 'tmdb', 'mdblist', 'tautulli'].includes(draft.sourceType)
          ? (draft.sourceType as IntegrationId)
          : undefined;
  const [integration, setIntegration] = useState<IntegrationConfiguration>();
  const [integrationChecked, setIntegrationChecked] = useState(false);
  const [traktAccountConnected, setTraktAccountConnected] = useState<
    boolean | undefined
  >();
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState<
    Awaited<ReturnType<typeof api.searchCollectionPlexItems>>['results']
  >([]);
  const [manualMessage, setManualMessage] = useState('');
  const [manualSearching, setManualSearching] = useState(false);
  const [sourceValidationMessage, setSourceValidationMessage] = useState('');
  const [sourceValidating, setSourceValidating] = useState(false);
  const [arrServers, setArrServers] = useState<
    readonly { id: string; name: string; kind: 'radarr' | 'sonarr' }[]
  >([]);
  const [arrTags, setArrTags] = useState<
    readonly { id: number; label: string }[]
  >([]);
  const [arrSourceStatus, setArrSourceStatus] = useState('');
  const [plexGeneratorValues, setPlexGeneratorValues] = useState<
    readonly PlexLibraryGeneratorValue[]
  >([]);
  const [plexGeneratorStatus, setPlexGeneratorStatus] = useState('');
  const integrationLabel =
    integrationId === 'trakt'
      ? 'Trakt'
      : collectionSourceOptions.find((item) => item.value === draft.sourceType)
          ?.label;
  useEffect(() => {
    setIntegration(undefined);
    setIntegrationChecked(false);
    if (!integrationId) return;
    void api
      .integration(integrationId)
      .then((value) => setIntegration(value))
      .catch(() => setIntegration(undefined))
      .finally(() => setIntegrationChecked(true));
  }, [integrationId]);
  useEffect(() => {
    setTraktAccountConnected(undefined);
    if (integrationId !== 'trakt') return;
    void api
      .traktOAuthStatus()
      .then((value) => setTraktAccountConnected(value.connected))
      .catch(() => setTraktAccountConnected(false));
  }, [integrationId]);
  useEffect(() => {
    if (
      draft.mediaType === 'show' &&
      draft.sourceType === 'trakt' &&
      settings.subtype === 'boxoffice'
    ) {
      onChange({
        ...draft,
        sourceSettings: { ...settings, subtype: '' },
      });
    }
  }, [draft, onChange, settings]);
  const options = (collectionSubtypes[draft.sourceType] ?? []).filter(
    (option) => {
      if (
        draft.mediaType === 'show' &&
        draft.sourceType === 'trakt' &&
        option.value === 'boxoffice'
      )
        return false;
      if (draft.sourceType === 'mal') {
        if (draft.mediaType === 'movie')
          return !['airing', 'tv', 'ova', 'special'].includes(option.value);
        if (draft.mediaType === 'show') return option.value !== 'movie';
      }
      return true;
    }
  );
  useEffect(() => {
    if (
      draft.sourceType === 'mal' &&
      settings.subtype &&
      !options.some((option) => option.value === settings.subtype)
    ) {
      onChange({
        ...draft,
        sourceSettings: { ...settings, subtype: '' },
      });
    }
  }, [draft, onChange, options, settings]);
  const update = (value: Partial<typeof settings>) =>
    onChange({ ...draft, sourceSettings: { ...settings, ...value } });
  const plexGeneratorSubtype = (
    ['genres', 'decades', 'resolutions', 'content-ratings'] as const
  ).includes(settings.subtype as PlexLibraryGeneratorSubtype)
    ? (settings.subtype as PlexLibraryGeneratorSubtype)
    : undefined;
  useEffect(() => {
    setPlexGeneratorValues([]);
    if (!plexGeneratorSubtype || !/^\d+$/.test(draft.libraryId)) {
      setPlexGeneratorStatus('');
      return;
    }
    let active = true;
    setPlexGeneratorStatus('Reading values from the selected Plex library…');
    void api
      .plexCollectionGeneratorValues(draft.libraryId, plexGeneratorSubtype)
      .then((result) => {
        if (!active) return;
        setPlexGeneratorValues(result.values);
        setPlexGeneratorStatus(
          result.values.length
            ? `${result.values.length} value${result.values.length === 1 ? '' : 's'} found in Plex.`
            : 'Plex did not report any values for this generator.'
        );
      })
      .catch((error) => {
        if (!active) return;
        setPlexGeneratorStatus(
          error instanceof Error
            ? error.message
            : 'Unable to read Plex library values.'
        );
      });
    return () => {
      active = false;
    };
  }, [draft.libraryId, plexGeneratorSubtype]);
  const arrKind =
    draft.sourceType === 'radarrtag'
      ? ('radarr' as const)
      : draft.sourceType === 'sonarrtag'
        ? ('sonarr' as const)
        : undefined;
  useEffect(() => {
    setArrServers([]);
    setArrTags([]);
    setArrSourceStatus('');
    if (!arrKind) return;
    let active = true;
    setArrSourceStatus(
      `Loading verified ${arrKind === 'radarr' ? 'Radarr' : 'Sonarr'} servers…`
    );
    void api
      .collectionArrServers(arrKind)
      .then((servers) => {
        if (!active) return;
        setArrServers(servers);
        setArrSourceStatus(
          servers.length
            ? ''
            : `No verified ${arrKind === 'radarr' ? 'Radarr' : 'Sonarr'} server is configured.`
        );
      })
      .catch((error) => {
        if (!active) return;
        setArrSourceStatus(
          error instanceof Error
            ? error.message
            : 'Unable to load download servers.'
        );
      });
    return () => {
      active = false;
    };
  }, [arrKind]);
  useEffect(() => {
    setArrTags([]);
    if (!arrKind || !settings.arrServerId) return;
    let active = true;
    setArrSourceStatus('Loading tags from the selected server…');
    void api
      .collectionArrTags(settings.arrServerId)
      .then((tags) => {
        if (!active) return;
        setArrTags(tags);
        setArrSourceStatus(
          tags.length ? '' : 'This server does not currently contain any tags.'
        );
      })
      .catch((error) => {
        if (!active) return;
        setArrSourceStatus(
          error instanceof Error ? error.message : 'Unable to load tags.'
        );
      });
    return () => {
      active = false;
    };
  }, [arrKind, settings.arrServerId]);
  const urlPlaceholder = collectionCustomUrlPlaceholders[draft.sourceType];
  const needsUrl =
    !!urlPlaceholder &&
    (settings.subtype === 'custom' ||
      (draft.sourceType === 'letterboxd' && settings.subtype === 'watchlist'));
  const needsRandomPool =
    settings.subtype === 'random' &&
    ['trakt', 'imdb', 'letterboxd'].includes(draft.sourceType);
  const hasPeriod =
    draft.sourceType === 'trakt' &&
    ['played', 'watched', 'collected', 'favorited'].includes(settings.subtype);
  const needsTraktAccount =
    draft.sourceType === 'trakt' &&
    ['recommendations', 'watchlist'].includes(settings.subtype);
  const updateManualMembers = (
    manualMembers: NonNullable<typeof settings.manualMembers>
  ) => update({ manualMembers });
  const searchManualItems = async () => {
    if (manualQuery.trim().length < 2) {
      setManualMessage('Enter at least two characters to search.');
      return;
    }
    setManualSearching(true);
    setManualMessage('Searching the selected Plex library…');
    try {
      const response = await api.searchCollectionPlexItems(
        draft.libraryId,
        manualQuery.trim(),
        draft.itemType ?? draft.mediaType
      );
      setManualResults(response.results);
      setManualMessage(
        response.results.length
          ? `${response.results.length} matching Plex item${response.results.length === 1 ? '' : 's'} found.`
          : 'No matching items were found in this library.'
      );
    } catch (error) {
      setManualResults([]);
      setManualMessage(
        error instanceof Error ? error.message : 'Plex search failed.'
      );
    } finally {
      setManualSearching(false);
    }
  };
  const validateCustomSource = async () => {
    if (!settings.customUrl?.trim()) {
      setSourceValidationMessage('Enter an MDBList list URL first.');
      return;
    }
    setSourceValidating(true);
    setSourceValidationMessage('Checking the list with MDBList…');
    try {
      const result = await api.validateCollectionSource(
        draft.sourceType,
        settings.subtype,
        settings.customUrl.trim()
      );
      onChange({
        ...draft,
        ...(result.title ? { title: result.title } : {}),
        sourceSettings: {
          ...settings,
          customUrl: settings.customUrl.trim(),
        },
      });
      setSourceValidationMessage(
        [
          result.message ?? 'MDBList verified.',
          result.contentType
            ? `Content: ${result.contentType === 'show' ? 'TV' : result.contentType}.`
            : undefined,
          result.title
            ? `Collection name updated to “${result.title}”.`
            : undefined,
        ]
          .filter(Boolean)
          .join(' ')
      );
    } catch (error) {
      setSourceValidationMessage(
        error instanceof Error ? error.message : 'MDBList validation failed.'
      );
    } finally {
      setSourceValidating(false);
    }
  };
  if (draft.sourceType === 'manual') {
    const members = settings.manualMembers ?? [];
    const selected = new Set(members.map((item) => item.ratingKey));
    return (
      <fieldset className="source-settings">
        <legend>Manual collection items</legend>
        <p className="field-help">
          Search only the selected Plex library, add the exact items you want,
          and arrange them in the order Plex should display. Saving the
          collection preserves this list for every synchronization.
        </p>
        <div className="inline-search">
          <label>
            Plex title search
            <input
              value={manualQuery}
              placeholder={
                draft.itemType === 'season'
                  ? 'Enter a season or series title'
                  : draft.itemType === 'episode'
                    ? 'Enter an episode or series title'
                  : 'Enter a movie or series title'
              }
              onChange={(event) => setManualQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void searchManualItems();
                }
              }}
            />
            <small>
              At least two characters. Results are limited to 50 items from the
              selected library.
            </small>
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={
              manualSearching ||
              manualQuery.trim().length < 2 ||
              !/^\d+$/.test(draft.libraryId)
            }
            onClick={() => void searchManualItems()}
          >
            {manualSearching ? 'Searching…' : 'Search Plex'}
          </button>
        </div>
        {!/^\d+$/.test(draft.libraryId) && (
          <p className="dependency-notice missing">
            <strong>Select a verified Plex library</strong>
            <span>
              Manual search requires the numeric library returned by the
              connected Plex server.
            </span>
          </p>
        )}
        {manualMessage && (
          <p className="field-help" role="status">
            {manualMessage}
          </p>
        )}
        {manualResults.length > 0 && (
          <div className="manual-result-list" aria-label="Plex search results">
            {manualResults.map((item) => (
              <article key={item.ratingKey}>
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.year ? `${item.year} · ` : ''}
                    {item.libraryName} · Plex key {item.ratingKey}
                  </small>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={selected.has(item.ratingKey)}
                  onClick={() =>
                    updateManualMembers([
                      ...members,
                      {
                        ratingKey: item.ratingKey,
                        title: item.title,
                        type: item.type,
                        ...(item.year ? { year: item.year } : {}),
                        ...(item.parentRatingKey
                          ? { parentRatingKey: item.parentRatingKey }
                          : {}),
                        ...(item.grandparentRatingKey
                          ? { grandparentRatingKey: item.grandparentRatingKey }
                          : {}),
                        ...(item.seasonNumber !== undefined
                          ? { seasonNumber: item.seasonNumber }
                          : {}),
                        ...(item.episodeNumber !== undefined
                          ? { episodeNumber: item.episodeNumber }
                          : {}),
                      },
                    ])
                  }
                >
                  {selected.has(item.ratingKey) ? 'Added' : 'Add'}
                </button>
              </article>
            ))}
          </div>
        )}
        <div className="manual-selection">
          <div className="section-heading">
            <div>
              <strong>Selected items</strong>
              <small>
                {members.length} item{members.length === 1 ? '' : 's'} in
                synchronization order
              </small>
            </div>
          </div>
          {members.length ? (
            members.map((item, index) => (
              <article key={item.ratingKey}>
                <div>
                  <strong>
                    {index + 1}. {item.title}
                  </strong>
                  <small>
                    {item.year ? `${item.year} · ` : ''}Plex key{' '}
                    {item.ratingKey}
                  </small>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={index === 0}
                    aria-label={`Move ${item.title} up`}
                    onClick={() => {
                      const next = [...members];
                      [next[index - 1], next[index]] = [
                        next[index]!,
                        next[index - 1]!,
                      ];
                      updateManualMembers(next);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={index === members.length - 1}
                    aria-label={`Move ${item.title} down`}
                    onClick={() => {
                      const next = [...members];
                      [next[index], next[index + 1]] = [
                        next[index + 1]!,
                        next[index]!,
                      ];
                      updateManualMembers(next);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="text-button danger-text"
                    onClick={() =>
                      updateManualMembers(
                        members.filter(
                          (member) => member.ratingKey !== item.ratingKey
                        )
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="empty-state">
              No items selected. Search Plex and add at least one item before
              synchronization.
            </p>
          )}
        </div>
      </fieldset>
    );
  }
  return (
    <fieldset className="source-settings">
      <legend>Source configuration</legend>
      {integrationId && integrationChecked && (
        <div
          className={`dependency-notice ${integration?.configured ? 'ready' : 'missing'}`}
        >
          <strong>
            {integration?.configured
              ? `${integrationLabel} connected`
              : 'Provider setup required'}
          </strong>
          <span>
            {integration?.configured
              ? 'This collection will refresh through the verified connection in Settings → Sources.'
              : `Configure and test ${integrationLabel} before this collection can synchronize.`}
          </span>
          {!integration?.configured && (
            <a href="/settings/sources">Configure source</a>
          )}
        </div>
      )}
      {draft.sourceType === 'mal' && (
        <div className="dependency-notice ready">
          <strong>How MyAnimeList matching works</strong>
          <span>
            Vynode reads the selected public anime ranking with your Client ID,
            converts MAL identities through maintained anime mappings, then
            matches TMDB, TVDB, IMDb, or native MyAnimeList GUIDs in this Plex
            library. Unmatched mapped titles can follow the collection&apos;s
            Radarr or Sonarr missing-media policy.
          </span>
        </div>
      )}
      {draft.sourceType === 'tautulli' && (
        <div className="dependency-notice ready">
          <strong>How Tautulli collections work</strong>
          <span>
            Vynode requests real play statistics from Tautulli for the selected
            Plex library type, keeps titles meeting the minimum play count, then
            matches Tautulli&apos;s Plex rating keys directly against this
            library. The four modes choose unique-viewer popularity or total
            watching, measured by plays or duration.
          </span>
        </div>
      )}
      {arrKind && (
        <section className="arr-tag-source-settings">
          <div
            className={`dependency-notice ${draft.mediaType === (arrKind === 'radarr' ? 'movie' : 'show') ? 'ready' : 'missing'}`}
          >
            <strong>
              {arrKind === 'radarr'
                ? 'Radarr movie tag source'
                : 'Sonarr TV tag source'}
            </strong>
            <span>
              {draft.mediaType === (arrKind === 'radarr' ? 'movie' : 'show')
                ? `Vynode reads every item currently assigned to the selected ${arrKind === 'radarr' ? 'Radarr' : 'Sonarr'} tag, preserves the chosen order, and matches provider IDs directly to this Plex library.`
                : `Choose a ${arrKind === 'radarr' ? 'Movie' : 'TV'} Plex library for this source.`}
            </span>
          </div>
          <div className="field-grid">
            <label>
              <span className="field-label">
                {arrKind === 'radarr' ? 'Radarr' : 'Sonarr'} server{' '}
                <span className="required-marker" aria-hidden="true">
                  *
                </span>
              </span>
              <select
                required
                value={settings.arrServerId ?? ''}
                onChange={(event) =>
                  update({
                    arrServerId: event.target.value || undefined,
                    arrTagId: undefined,
                  })
                }
              >
                <option value="">Select verified server…</option>
                {arrServers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                  </option>
                ))}
              </select>
              <small>
                Servers come from Settings → Downloads and must have a verified,
                saved connection.
              </small>
            </label>
            <label>
              <span className="field-label">
                Tag{' '}
                <span className="required-marker" aria-hidden="true">
                  *
                </span>
              </span>
              <select
                required
                disabled={!settings.arrServerId}
                value={settings.arrTagId ?? ''}
                onChange={(event) =>
                  update({
                    arrTagId: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
              >
                <option value="">Select tag…</option>
                {arrTags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.label}
                  </option>
                ))}
              </select>
              <small>
                Only items carrying this exact tag are included. Removing the
                tag from an item removes it on the next synchronization.
              </small>
            </label>
          </div>
          {arrSourceStatus && (
            <p className="field-help" role="status">
              {arrSourceStatus}
            </p>
          )}
          {!arrServers.length && !arrSourceStatus.startsWith('Loading') && (
            <a
              className="button secondary"
              href={`/settings/downloads#${arrKind}`}
            >
              Configure {arrKind === 'radarr' ? 'Radarr' : 'Sonarr'}
            </a>
          )}
        </section>
      )}
      {needsTraktAccount && traktAccountConnected === false && (
        <div className="dependency-notice missing">
          <strong>Connect a Trakt account</strong>
          <span>
            {settings.subtype === 'watchlist' ? 'Watchlist' : 'Recommendations'}{' '}
            requires OAuth account authorization; a public Client ID alone is
            not enough.
          </span>
          <a href="/settings/sources">Authorize Trakt</a>
        </div>
      )}
      {options.length > 0 && (
        <label>
          <span className="field-label">
            Collection subtype{' '}
            <span className="required-marker" aria-hidden="true">
              *
            </span>
          </span>
          <select
            required
            value={settings.subtype}
            onChange={(event) =>
              update({ subtype: event.target.value, customUrl: undefined })
            }
          >
            <option value="">Select subtype…</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <small>
            {options.find((option) => option.value === settings.subtype)
              ?.help ??
              'Choose the list or calculation this collection follows.'}
          </small>
        </label>
      )}
      {draft.sourceType === 'seerr' && settings.subtype === 'user' && (
        <label>
          <span className="field-label">
            Seerr user ID{' '}
            <span className="required-marker" aria-hidden="true">
              *
            </span>
          </span>
          <input
            required
            type="number"
            min={1}
            step={1}
            value={settings.seerrUserId ?? ''}
            onChange={(event) =>
              update({ seerrUserId: Number(event.target.value) || undefined })
            }
          />
          <small>
            Use the immutable numeric user ID shown in Seerr. Owner requests are
            excluded from this private-user mode.
          </small>
        </label>
      )}
      {draft.sourceType === 'plex' &&
        ['directors', 'actors'].includes(settings.subtype) && (
          <>
            <label>
              <span className="field-label">
                Minimum items per person{' '}
                <span className="required-marker" aria-hidden="true">
                  *
                </span>
              </span>
              <input
                required
                type="number"
                min={2}
                max={50}
                value={settings.personMinimumItems ?? 5}
                onChange={(event) =>
                  update({ personMinimumItems: Number(event.target.value) })
                }
              />
              <small>
                Only create a{' '}
                {settings.subtype === 'actors' ? 'performer' : 'director'}{' '}
                collection when that person appears on at least this many items
                in the selected Plex library.
              </small>
            </label>
            <label className="choice-card">
              <input
                type="checkbox"
                checked={settings.useSeparator ?? false}
                onChange={(event) =>
                  update({
                    useSeparator: event.target.checked,
                    ...(event.target.checked && !settings.separatorTitle?.trim()
                      ? {
                          separatorTitle:
                            settings.subtype === 'actors'
                              ? 'Actor Collections'
                              : 'Director Collections',
                        }
                      : {}),
                  })
                }
              />
              <span>
                <strong>Create a separator collection</strong>
                <small>
                  Add a library-only heading before the generated{' '}
                  {settings.subtype === 'actors' ? 'actor' : 'director'}{' '}
                  collections.
                </small>
              </span>
            </label>
            {settings.useSeparator && (
              <label>
                <span className="field-label">
                  Separator title{' '}
                  <span className="required-marker" aria-hidden="true">
                    *
                  </span>
                </span>
                <input
                  required
                  maxLength={120}
                  value={settings.separatorTitle ?? ''}
                  placeholder={
                    settings.subtype === 'actors'
                      ? 'Actor Collections'
                      : 'Director Collections'
                  }
                  onChange={(event) =>
                    update({ separatorTitle: event.target.value })
                  }
                />
                <small>
                  This collection groups the generated person collections in
                  Plex. The default is{' '}
                  {settings.subtype === 'actors'
                    ? 'Actor Collections'
                    : 'Director Collections'}
                  .
                </small>
              </label>
            )}
            <p className="dependency-notice ready">
              <strong>Production generation enabled</strong>
              <span>
                Vynode creates verified Plex smart collections for qualifying
                people and safely reconciles only the collections owned by this
                generator.
              </span>
            </p>
          </>
        )}
      {draft.sourceType === 'plex' &&
        plexGeneratorSubtype &&
        (() => {
          const generator = settings.plexGenerator ?? {
            selectionMode: 'include' as const,
            selectedValues: [],
            enabledRatingGroups: [
              'australia',
              'television',
              'numeric',
              'other',
            ] as PlexContentRatingGroup[],
            titleTemplate: '{value}',
            cleanupMissing: true,
          };
          const selected = new Set(generator.selectedValues);
          const enabledGroups = new Set(generator.enabledRatingGroups);
          const setGenerator = (
            next: Partial<NonNullable<typeof settings.plexGenerator>>
          ) =>
            update({
              plexGenerator: {
                ...generator,
                ...next,
              },
            });
          const groupLabels: Record<PlexContentRatingGroup, string> = {
            australia: 'Australian ratings',
            television: 'TV ratings',
            numeric: 'Numeric ages',
            other: 'Other ratings',
          };
          const visibleValues = plexGeneratorValues.filter(
            (entry) => !entry.group || enabledGroups.has(entry.group)
          );
          return (
            <section className="plex-generator-settings">
              <div className="section-heading">
                <div>
                  <strong>Plex library value generator</strong>
                  <small>
                    Each checked value becomes an independent Plex smart
                    collection. Membership updates automatically as Plex
                    metadata changes.
                  </small>
                </div>
              </div>
              <fieldset className="segmented-choice">
                <legend>Selection mode</legend>
                <label>
                  <input
                    type="radio"
                    name="plex-generator-mode"
                    checked={generator.selectionMode === 'include'}
                    onChange={() =>
                      setGenerator({
                        selectionMode: 'include',
                        selectedValues: [],
                      })
                    }
                  />
                  <span>
                    <strong>Include selected</strong>
                    <small>
                      Start empty and choose the collections to create.
                    </small>
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="plex-generator-mode"
                    checked={generator.selectionMode === 'exclude'}
                    onChange={() =>
                      setGenerator({
                        selectionMode: 'exclude',
                        selectedValues: plexGeneratorValues.map(
                          (entry) => entry.value
                        ),
                      })
                    }
                  />
                  <span>
                    <strong>Exclude unchecked</strong>
                    <small>
                      Start with every value and uncheck the collections you do
                      not want.
                    </small>
                  </span>
                </label>
              </fieldset>
              {plexGeneratorSubtype === 'content-ratings' && (
                <fieldset className="rating-group-choices">
                  <legend>Content-rating groups</legend>
                  {(Object.keys(groupLabels) as PlexContentRatingGroup[]).map(
                    (group) => (
                      <label key={group}>
                        <input
                          type="checkbox"
                          checked={enabledGroups.has(group)}
                          onChange={(event) =>
                            setGenerator({
                              enabledRatingGroups: event.target.checked
                                ? [...enabledGroups, group]
                                : [...enabledGroups].filter(
                                    (item) => item !== group
                                  ),
                            })
                          }
                        />
                        <span>{groupLabels[group]}</span>
                      </label>
                    )
                  )}
                </fieldset>
              )}
              <div className="generator-value-heading">
                <strong>Collections to generate</strong>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setGenerator({
                      selectedValues: visibleValues.map((entry) => entry.value),
                    })
                  }
                >
                  Select all shown
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setGenerator({
                      selectedValues: generator.selectedValues.filter(
                        (value) =>
                          !visibleValues.some((entry) => entry.value === value)
                      ),
                    })
                  }
                >
                  Clear shown
                </button>
              </div>
              {plexGeneratorStatus && (
                <p className="field-help" role="status">
                  {plexGeneratorStatus}
                </p>
              )}
              <div className="generator-value-list">
                {visibleValues.map((entry) => (
                  <label key={entry.value}>
                    <input
                      type="checkbox"
                      checked={selected.has(entry.value)}
                      onChange={(event) =>
                        setGenerator({
                          selectedValues: event.target.checked
                            ? [...selected, entry.value]
                            : [...selected].filter(
                                (value) => value !== entry.value
                              ),
                        })
                      }
                    />
                    <span>
                      <strong>{entry.label}</strong>
                      <small>
                        {entry.count} library item{entry.count === 1 ? '' : 's'}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              <label>
                Collection title template
                <input
                  required
                  value={generator.titleTemplate}
                  placeholder="{value} Movies"
                  onChange={(event) =>
                    setGenerator({ titleTemplate: event.target.value })
                  }
                />
                <small>
                  Use <code>{'{value}'}</code> where the Plex value belongs.
                  Example:{' '}
                  <code>
                    {'{value}'}{' '}
                    {draft.mediaType === 'movie' ? 'Movies' : 'TV Shows'}
                  </code>
                  .
                </small>
              </label>
              <label className="choice-card">
                <input
                  type="checkbox"
                  checked={generator.cleanupMissing}
                  onChange={(event) =>
                    setGenerator({ cleanupMissing: event.target.checked })
                  }
                />
                <span>
                  <strong>
                    Remove generated collections whose values disappear
                  </strong>
                  <small>
                    During synchronization, Vynode deletes only collections
                    previously created by this generator. Media files and
                    unrelated Plex collections are untouched.
                  </small>
                </span>
              </label>
            </section>
          );
        })()}
      {needsUrl && (
        <label>
          <span className="field-label">
            List URL{' '}
            <span className="required-marker" aria-hidden="true">
              *
            </span>
          </span>
          <div className="inline-search">
            <input
              required
              type="url"
              value={settings.customUrl ?? ''}
              placeholder={urlPlaceholder}
              onChange={(event) => {
                setSourceValidationMessage('');
                update({ customUrl: event.target.value });
              }}
            />
            {draft.sourceType === 'mdblist' && (
              <button
                type="button"
                className="button secondary"
                disabled={sourceValidating || !settings.customUrl?.trim()}
                onClick={() => void validateCustomSource()}
              >
                {sourceValidating ? 'Checking…' : 'Fetch list details'}
              </button>
            )}
          </div>
          <small>
            {draft.sourceType === 'mdblist'
              ? 'Paste a public or private MDBList URL, then fetch its saved name, media type, and availability before saving.'
              : draft.sourceType === 'anilist'
                ? 'Paste the public Anime List page for an AniList user. Vynode reads compatible entries without requiring that user’s credentials.'
                : 'Paste the list URL. Vynode resolves and validates its provider identifier when the collection is saved; private Trakt lists require the connected account.'}
          </small>
          {draft.sourceType === 'mdblist' && sourceValidationMessage && (
            <small role="status">{sourceValidationMessage}</small>
          )}
        </label>
      )}
      {needsRandomPool && (
        <label>
          <span className="field-label">
            Random list pool{' '}
            <span className="required-marker" aria-hidden="true">
              *
            </span>
          </span>
          <textarea
            required
            rows={6}
            value={(settings.randomListUrls ?? []).join('\n')}
            placeholder={
              draft.sourceType === 'trakt'
                ? 'https://trakt.tv/users/username/lists/list-one\nhttps://trakt.tv/users/username/lists/list-two'
                : `Enter one ${draft.sourceType} list URL per line`
            }
            onChange={(event) =>
              update({ randomListUrls: event.target.value.split(/\r?\n/) })
            }
          />
          <small>
            Enter one public list URL per line. Blank lines and lines beginning
            with # are ignored; duplicate lists are removed. Vynode chooses one
            list for each preview or synchronization run.
          </small>
        </label>
      )}
      {hasPeriod && (
        <label>
          Time period
          <select
            value={settings.timePeriod ?? 'weekly'}
            onChange={(event) =>
              update({
                timePeriod: event.target.value as NonNullable<
                  typeof settings.timePeriod
                >,
              })
            }
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="all">All time</option>
          </select>
          <small>
            Controls the statistics window requested from{' '}
            {draft.sourceType === 'tautulli' ? 'Tautulli' : 'Trakt'}.
          </small>
        </label>
      )}
      {draft.sourceType === 'filtered-hub' && (
        <label>
          Recent window (days)
          <input
            required
            type="number"
            min={1}
            max={365}
            value={settings.customDays ?? 30}
            onChange={(event) =>
              update({ customDays: Number(event.target.value) })
            }
          />
          <small>
            Include only Plex items added or released during this rolling
            window.
          </small>
        </label>
      )}
      {draft.sourceType === 'tautulli' && (
        <div className="field-grid">
          <label>
            Minimum play count
            <input
              required
              type="number"
              min={1}
              max={100}
              value={settings.minimumPlays ?? 3}
              onChange={(event) =>
                update({ minimumPlays: Number(event.target.value) })
              }
            />
            <small>
              Only include titles with at least this many plays, from 1 through
              100.
            </small>
          </label>
          <label>
            Statistics days
            <input
              required
              type="number"
              min={1}
              max={365}
              value={settings.customDays ?? 30}
              onChange={(event) =>
                update({ customDays: Number(event.target.value) })
              }
            />
            <small>
              Measure activity across the most recent 1 through 365 days. Use
              365 for a year-in-review collection.
            </small>
          </label>
        </div>
      )}
      {draft.sourceType === 'networks' && (
        <label>
          Network country
          <select
            value={settings.networkCountry ?? 'US'}
            onChange={(event) => update({ networkCountry: event.target.value })}
          >
            <option value="US">United States</option>
            <option value="GB">United Kingdom</option>
            <option value="CA">Canada</option>
            <option value="AU">Australia</option>
            <option value="JP">Japan</option>
            <option value="KR">South Korea</option>
          </select>
          <small>
            Network choices and rankings are localized to this country.
          </small>
        </label>
      )}
      {['tmdb', 'networks', 'originals'].includes(draft.sourceType) && (
        <label>
          Region
          <input
            value={settings.region ?? 'US'}
            maxLength={2}
            pattern="[A-Za-z]{2}"
            onChange={(event) =>
              update({ region: event.target.value.toUpperCase() })
            }
          />
          <small>
            Two-letter ISO country code used for regional availability and
            provider data.
          </small>
        </label>
      )}
      <div className="field-grid">
        <label>
          Maximum items
          <input
            required
            type="number"
            min={1}
            max={9999}
            value={settings.maxItems}
            onChange={(event) =>
              update({ maxItems: Number(event.target.value) })
            }
          />
          <small>Limit this collection to between 1 and 9,999 items.</small>
        </label>
        <label>
          Item order
          <select
            value={settings.itemOrder}
            onChange={(event) =>
              update({
                itemOrder: event.target.value as typeof settings.itemOrder,
              })
            }
          >
            <option value="default">Default source order</option>
            <option value="reverse">Reverse source order</option>
            <option value="random">Random on each sync</option>
            <option value="rating-desc">Rating — highest first</option>
            <option value="rating-asc">Rating — lowest first</option>
            <option value="release-desc">Release date — newest first</option>
            <option value="release-asc">Release date — oldest first</option>
            <option value="alphabetical">Alphabetical</option>
          </select>
          <small>
            Applied after provider results are combined and filtered.
          </small>
        </label>
      </div>
    </fieldset>
  );
}
