import {
  dynamicValueIconForField,
  dynamicValueIcons,
  overlayShapeById,
  overlayShapes,
  streamingServiceIcons,
  type DynamicValueIcon,
  type OverlayLibraryConfiguration,
  type OverlayApplicationCondition,
  type OverlayConditionOperator,
  type OverlayLayer,
  type OverlayLayerType,
  type OverlayTemplateDesign,
  type OverlayTemplateSummary,
  type PosterEditorAsset,
} from '@vynode/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { InteractivePosterLayer } from './InteractivePosterLayer';
import {
  OverlayDesignPreview,
  overlayPreviewContext,
} from './OverlayDesignPreview';
import {
  posterPreviewSample,
  posterPreviewSamples,
  templatePreviewMediaType,
} from './posterPreviewSamples';

const emptyDesign = (): OverlayTemplateDesign => ({
  width: 1000,
  height: 1500,
  elements: [],
});
const variableFields = [
  'title',
  'year',
  'director',
  'studio',
  'network',
  'streamingProvider',
  'streamingProviderId',
  'genre',
  'runtime',
  'runtimeHHMM',
  'tmdbStatus',
  'tvdbStatus',
  'resolution',
  'width',
  'height',
  'aspectRatio',
  'videoCodec',
  'videoProfile',
  'videoFrameRate',
  'bitDepth',
  'hdr',
  'dolbyVision',
  'dolbyVisionProfile',
  'colorTrc',
  'audioFormat',
  'audioCodec',
  'audioChannels',
  'audioChannelLayout',
  'audioLanguage',
  'audioLanguageCode',
  'audioLanguages',
  'audioLanguageCodes',
  'subtitleLanguages',
  'subtitleLanguageCodes',
  'hasSubtitles',
  'container',
  'bitrate',
  'fileSize',
  'filePath',
  'viewCount',
  'lastPlayed',
  'dateAdded',
  'daysSinceAdded',
  'daysSinceLastPlayed',
  'imdbRating',
  'imdbVotes',
  'imdbContentRating',
  'imdbGenres',
  'imdbKeywords',
  'imdbActors',
  'imdbDirectors',
  'imdbCreators',
  'imdbPlot',
  'imdbAlternateTitle',
  'imdbReleaseDate',
  'imdbRuntime',
  'imdbTop250Rank',
  'isImdbTop250',
  'rtCriticsScore',
  'rtAudienceScore',
  'rtCertifiedFresh',
  'rtVerifiedHot',
  'plexUserRating',
  'collection',
  'mediaType',
  'isPlaceholder',
  'releaseDate',
  'daysUntilRelease',
  'daysAgo',
  'nextEpisodeAirDate',
  'daysUntilNextEpisode',
  'nextSeasonAirDate',
  'daysUntilNextSeason',
  'daysAgoNextSeason',
  'totalSeasons',
  'seasonsAvailable',
  'seasonNumber',
  'episodeNumber',
  'episodeLabel',
  'isMonitored',
  'inRadarr',
  'inSonarr',
  'downloaded',
  'radarrTags',
  'sonarrTags',
  'plexLabels',
  'daysUntilAction',
  'episodeCount',
  'episode4kCount',
  'episode4kPercent',
  'episodeHdrCount',
  'episodeHdrPercent',
  'episodeDvCount',
  'episodeDvPercent',
  'episodeMediaSource',
  'showResolution',
  'showHdr',
  'showDolbyVision',
  'showDolbyVisionProfile',
  'showAudioCodec',
  'showAudioChannels',
  'showVideoCodec',
  'showBitDepth',
];
const variableFieldLabels: Record<string, string> = {
  streamingProvider: 'Originating service logo',
  streamingProviderId: 'Originating service ID',
  runtimeHHMM: 'Runtime (hours and minutes)',
  tmdbStatus: 'TMDB release status',
  tvdbStatus: 'TVDB series status',
  hdr: 'HDR availability',
  dolbyVision: 'Dolby Vision availability',
  colorTrc: 'Color transfer characteristic',
  audioFormat: 'Audio format',
  audioCodec: 'Audio codec',
  audioChannels: 'Audio channel count',
  audioChannelLayout: 'Audio channel layout',
  audioLanguage: 'Primary audio language',
  audioLanguageCode: 'Primary audio language code',
  audioLanguages: 'All audio languages',
  audioLanguageCodes: 'All audio language codes',
  subtitleLanguages: 'Subtitle languages',
  subtitleLanguageCodes: 'Subtitle language codes',
  hasSubtitles: 'Has subtitles',
  fileSize: 'Media file size',
  filePath: 'Media file path',
  viewCount: 'Plex play count',
  lastPlayed: 'Last played date',
  dateAdded: 'Date added to Plex',
  imdbRating: 'IMDb rating',
  imdbVotes: 'IMDb vote count',
  imdbContentRating: 'IMDb content rating',
  imdbGenres: 'IMDb genres',
  imdbKeywords: 'IMDb keywords',
  imdbActors: 'IMDb cast',
  imdbDirectors: 'IMDb directors',
  imdbCreators: 'IMDb creators',
  imdbPlot: 'IMDb plot summary',
  imdbAlternateTitle: 'IMDb alternate title',
  imdbReleaseDate: 'IMDb release date',
  imdbRuntime: 'IMDb runtime (minutes)',
  imdbTop250Rank: 'IMDb Top 250 rank',
  isImdbTop250: 'Appears in IMDb Top 250',
  rtCriticsScore: 'Rotten Tomatoes critics score',
  rtAudienceScore: 'Rotten Tomatoes audience score',
  rtCertifiedFresh: 'Rotten Tomatoes Certified Fresh',
  rtVerifiedHot: 'Rotten Tomatoes Verified Hot',
  plexUserRating: 'Plex user rating',
  mediaType: 'Media type',
  releaseDate: 'Release date',
  nextEpisodeAirDate: 'Next episode air date',
  nextSeasonAirDate: 'Next season air date',
  inRadarr: 'Present in Radarr',
  inSonarr: 'Present in Sonarr',
  radarrTags: 'Radarr tags',
  sonarrTags: 'Sonarr tags',
  plexLabels: 'Plex labels',
  daysUntilAction: 'Days until Maintainerr action',
  episode4kCount: '4K episode count',
  episode4kPercent: '4K episode percentage',
  episodeHdrCount: 'HDR episode count',
  episodeHdrPercent: 'HDR episode percentage',
  episodeDvCount: 'Dolby Vision episode count',
  episodeDvPercent: 'Dolby Vision episode percentage',
  showHdr: 'Show has HDR episodes',
  showDolbyVision: 'Show has Dolby Vision episodes',
};
const friendlyVariableName = (field: string) =>
  variableFieldLabels[field] ??
  field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\bimdb\b/gi, 'IMDb')
    .replace(/\btmdb\b/gi, 'TMDB')
    .replace(/\btvdb\b/gi, 'TVDB')
    .replace(/\bhdr\b/gi, 'HDR')
    .replace(/\bdv\b/gi, 'Dolby Vision')
    .replace(/\b4k\b/gi, '4K')
    .replace(/^./, (value) => value.toUpperCase());
const variableDescription = (field: string) => {
  const label = friendlyVariableName(field);
  if (/^(audio|subtitle|show audio)/i.test(label))
    return `${label} read from the selected media file's audio and subtitle streams.`;
  if (
    /(resolution|codec|profile|frame rate|bit depth|HDR|Dolby Vision|container|bitrate|aspect ratio|file)/i.test(
      label
    )
  )
    return `${label} read from the selected media file's technical details.`;
  if (/(IMDb|Rotten Tomatoes|rating|Top 250)/i.test(label))
    return `${label} from the item's matched ratings metadata.`;
  if (/(Radarr|Sonarr|monitored|downloaded)/i.test(label))
    return `${label} from the connected download-management service.`;
  if (/(date|days|played|release|air)/i.test(label))
    return `${label} calculated for this media item at render time.`;
  if (/(episode|season|show)/i.test(label))
    return `${label} calculated from the TV library and episode files.`;
  return `${label} from the selected Plex media item's metadata.`;
};
const variableGroups = [
  { label: 'Identity and Plex', match: /^(title|year|director|studio|network|genre|collection|mediaType|plexLabels|plexUserRating|viewCount|lastPlayed|dateAdded|daysSince)/ },
  { label: 'Video and file', match: /^(resolution|width|height|aspectRatio|video|bitDepth|hdr|dolby|colorTrc|container|bitrate|file)/ },
  { label: 'Audio and subtitles', match: /^(audio|subtitle|hasSubtitles)/ },
  { label: 'Ratings and providers', match: /^(imdb|rt|streaming|tmdb|tvdb)/ },
  { label: 'Release and TV', match: /^(release|daysUntilRelease|daysAgo|next|totalSeasons|seasonsAvailable|season|episode|show)/ },
  { label: 'Radarr, Sonarr, and Maintainerr', match: /^(isMonitored|inRadarr|inSonarr|downloaded|radarr|sonarr|daysUntilAction)/ },
] as const;
const VariableOptions = () => (
  <>
    {variableGroups.map((group) => (
      <optgroup label={group.label} key={group.label}>
        {variableFields.filter((field) => group.match.test(field)).map((field) => (
          <option value={field} key={field}>{friendlyVariableName(field)}</option>
        ))}
      </optgroup>
    ))}
    <optgroup label="Other">
      {variableFields
        .filter((field) => !variableGroups.some((group) => group.match.test(field)))
        .map((field) => (
          <option value={field} key={field}>{friendlyVariableName(field)}</option>
        ))}
    </optgroup>
  </>
);
const operators: { value: OverlayConditionOperator; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'does not equal' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'at least' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'at most' },
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'does not contain' },
  { value: 'regex', label: 'matches regex' },
  { value: 'begins', label: 'begins with' },
  { value: 'ends', label: 'ends with' },
  { value: 'in', label: 'is in' },
  { value: 'exists', label: 'exists' },
];

export const OverlayTemplateEditor = ({
  template,
  otherTemplates,
  libraries,
  onClose,
  onSave,
  previewSampleIndex = 0,
}: {
  template?: OverlayTemplateSummary;
  otherTemplates: readonly OverlayTemplateSummary[];
  libraries: readonly OverlayLibraryConfiguration[];
  onClose(): void;
  onSave(
    input: Omit<OverlayTemplateSummary, 'id' | 'displayOrder' | 'elementCount'>
  ): Promise<void>;
  previewSampleIndex?: number;
}) => {
  const initialDesign = template
    ? structuredClone(template.design)
    : emptyDesign();
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [tags, setTags] = useState(template?.tags.join(', ') ?? '');
  const [enabled, setEnabled] = useState(template?.enabled ?? true);
  const [condition, setCondition] = useState<OverlayApplicationCondition>(
    template?.condition ? structuredClone(template.condition) : { sections: [] }
  );
  const [history, setHistory] = useState<OverlayTemplateDesign[]>([
    initialDesign,
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const design = history[historyIndex];
  const [selectedId, setSelectedId] = useState<string | undefined>(
    design.elements[0]?.id
  );
  const [groupSelection,setGroupSelection]=useState<string[]>([]);
  const [liveGeometry,setLiveGeometry]=useState<Record<string,Pick<OverlayLayer,'x'|'y'|'width'|'height'>>>({});
  const [savedItems,setSavedItems]=useState<{id:string;name:string;kind:'icon'|'image'|'title';layer:OverlayLayer}[]>(()=>{try{return JSON.parse(localStorage.getItem('vynode-overlay-items')??'[]');}catch{return[];}});
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [sample, setSample] = useState(previewSampleIndex);
  const [previewLibraryId, setPreviewLibraryId] = useState('');
  const [previewItems, setPreviewItems] = useState<
    Awaited<ReturnType<typeof api.searchPosterTestItems>>['results']
  >([]);
  const [previewItemIndex, setPreviewItemIndex] = useState(0);
  const [previewContext, setPreviewContext] = useState<
    Readonly<Record<string, string | number | boolean | null>>
  >({});
  const [previewStatus, setPreviewStatus] = useState('');
  const [previewIds, setPreviewIds] = useState<string[]>([]);
  const [assetBusy, setAssetBusy] = useState<OverlayLayerType>();
  const [posterAssets, setPosterAssets] = useState<PosterEditorAsset[]>([]);
  const [assetMessage, setAssetMessage] = useState('');
  const [replaceAsset, setReplaceAsset] = useState(false);
  const [copiedLayer, setCopiedLayer] = useState<OverlayLayer>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const rasterInput = useRef<HTMLInputElement>(null);
  const svgInput = useRef<HTMLInputElement>(null);
  const [collectionOptions, setCollectionOptions] = useState<
    { id: string; title: string; libraryName: string }[]
  >([]);
  const [conditionValueOptions, setConditionValueOptions] = useState<Record<string, string[]>>({});
  useEffect(() => {
    void api
      .collections()
      .then((result) =>
        setCollectionOptions(
          result.collections.map((item) => ({
            id: item.id,
            title: item.title,
            libraryName: item.libraryName,
          }))
        )
      )
      .catch(() => setCollectionOptions([]));
  }, []);
  useEffect(() => {
    let active = true;
    void api.overlayPlexLabels().then((labels) => {
      if (active) setConditionValueOptions((current) => ({ ...current, plexLabels: [...labels] }));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all((['radarr', 'sonarr'] as const).map(async (kind) => {
      const servers = await api.collectionArrServers(kind).catch(() => []);
      const tags = await Promise.all(servers.map((server) => api.collectionArrTags(server.id).catch(() => [])));
      return [kind === 'radarr' ? 'radarrTags' : 'sonarrTags', [...new Set(tags.flat().map((tag) => tag.label))].sort()] as const;
    })).then((entries) => { if (active) setConditionValueOptions(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    void api
      .collectionPosters()
      .then((workspace) => setPosterAssets([...workspace.assets]))
      .catch(() => setPosterAssets([]));
  }, []);
  const selected = useMemo(
    () => design.elements.find((item) => item.id === selectedId),
    [design, selectedId]
  );
  const initialSnapshot = useRef(JSON.stringify({
    name: template?.name ?? '',
    description: template?.description ?? '',
    tags: template?.tags.join(', ') ?? '',
    enabled: template?.enabled ?? true,
    condition: template?.condition ? structuredClone(template.condition) : { sections: [] },
    design: initialDesign,
  }));
  const dirty = JSON.stringify({ name, description, tags, enabled, condition, design }) !== initialSnapshot.current;
  const requestClose = () => dirty ? setConfirmDiscard(true) : onClose();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmDiscard) setConfirmDiscard(false);
      else requestClose();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty, confirmDiscard]);
  const visibleDesign=useMemo(()=>({...design,elements:design.elements.map((layer)=>liveGeometry[layer.id]?{...layer,...liveGeometry[layer.id]}:layer)}),[design,liveGeometry]);
  const previewMediaType = templatePreviewMediaType({
    condition,
    tags: tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    type: condition.sections[0]?.rules[0]?.field ?? template?.type ?? 'generic',
  });
  const compatibleLibraries = libraries.filter(
    (library) => library.type === previewMediaType
  );
  const effectivePreviewMediaType =
    libraries.find((library) => library.id === previewLibraryId)?.type ??
    previewMediaType;
  const selectedPreviewItem = previewItems[previewItemIndex];
  const previewSample = selectedPreviewItem?.posterUrl
    ? {
        title: selectedPreviewItem.title,
        imageUrl: selectedPreviewItem.posterUrl,
      }
    : posterPreviewSample(effectivePreviewMediaType, sample);
  const effectivePreviewContext =
    selectedPreviewItem && Object.keys(previewContext).length
      ? previewContext
      : overlayPreviewContext;
  const editorPreviewTemplate: OverlayTemplateSummary = {
    id: template?.id ?? 'draft-preview',
    name: name || template?.name || 'Draft overlay',
    description,
    type: template?.type ?? 'generic',
    tags: tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    enabled,
    displayOrder: template?.displayOrder ?? 0,
    elementCount: design.elements.length,
    conditionSummary: template?.conditionSummary ?? '',
    accent: template?.accent ?? '#f3ad32',
    design: visibleDesign,
    condition,
  };
  useEffect(() => {
    if (
      previewLibraryId &&
      !libraries.some((library) => library.id === previewLibraryId)
    )
      setPreviewLibraryId('');
  }, [previewMediaType, libraries, previewLibraryId]);
  useEffect(() => {
    if (!previewLibraryId) {
      setPreviewItems([]);
      setPreviewItemIndex(0);
      setPreviewContext({});
      setPreviewStatus('');
      return;
    }
    setPreviewStatus('Loading synchronized library items…');
    void api
      .searchPosterTestItems('', previewLibraryId)
      .then((result) => {
        setPreviewItems([...result.results]);
        setPreviewItemIndex(0);
        setPreviewStatus(
          result.results.length
            ? ''
            : 'No synchronized items are available in this library.'
        );
      })
      .catch((error) => {
        setPreviewItems([]);
        setPreviewStatus(
          error instanceof Error
            ? error.message
            : 'Unable to load library preview items.'
        );
      });
  }, [previewLibraryId]);
  useEffect(() => {
    if (!selectedPreviewItem) {
      setPreviewContext({});
      return;
    }
    void api
      .testPosterItem(selectedPreviewItem.ratingKey)
      .then((result) => setPreviewContext(result.context))
      .catch(() => setPreviewContext({}));
  }, [selectedPreviewItem?.ratingKey]);
  const cyclePreview = (direction: -1 | 1) => {
    if (!previewItems.length) {
      setSample(
        (value) =>
          (value +
            direction +
            posterPreviewSamples[effectivePreviewMediaType].length) %
          posterPreviewSamples[effectivePreviewMediaType].length
      );
      return;
    }
    setPreviewItemIndex(
      (value) =>
        (value + direction + previewItems.length) % previewItems.length
    );
  };
  const commit = (next: OverlayTemplateDesign) => {
    setLiveGeometry({});
    const updated = [...history.slice(0, historyIndex + 1), next].slice(-50);
    setHistory(updated);
    setHistoryIndex(updated.length - 1);
  };
  const persistSavedItems=(items:typeof savedItems)=>{setSavedItems(items);localStorage.setItem('vynode-overlay-items',JSON.stringify(items));};
  const groupLayers=()=>{if(groupSelection.length<2)return;const groupId=`group-${crypto.randomUUID().slice(0,8)}`;commit({...design,elements:design.elements.map((layer)=>groupSelection.includes(layer.id)?{...layer,groupId}:layer)});setGroupSelection([]);};
  const ungroupLayers=()=>{const groupId=selected?.groupId;const ids=new Set(groupSelection);commit({...design,elements:design.elements.map((layer)=>(groupId&&layer.groupId===groupId)||ids.has(layer.id)?{...layer,groupId:undefined}:layer)});setGroupSelection([]);};
  const saveReusable=()=>{if(!selected||!['text','icon','svg','raster'].includes(selected.type))return;const name=window.prompt('Name this reusable overlay item',selected.name);if(!name?.trim())return;const kind=selected.type==='text'?'title':selected.type==='raster'?'image':'icon';persistSavedItems([...savedItems,{id:`saved-${crypto.randomUUID().slice(0,8)}`,name:name.trim(),kind,layer:structuredClone(selected)}]);};
  const insertReusable=(saved:typeof savedItems[number])=>{const id=`${saved.layer.type}-${crypto.randomUUID().slice(0,7)}`;const layer={...structuredClone(saved.layer),id,groupId:undefined,name:saved.name,layerOrder:design.elements.length,x:100,y:150};commit({...design,elements:[...design.elements,layer]});setSelectedId(id);};
  const groupGeometry=(layer:OverlayLayer,geometry:Pick<OverlayLayer,'x'|'y'|'width'|'height'>)=>{if(!layer.groupId)return{[layer.id]:geometry};const sx=geometry.width/layer.width;const sy=geometry.height/layer.height;return Object.fromEntries(design.elements.filter((item)=>item.groupId===layer.groupId).map((item)=>[item.id,item.id===layer.id?geometry:{x:geometry.x+(item.x-layer.x)*sx,y:geometry.y+(item.y-layer.y)*sy,width:Math.max(20,item.width*sx),height:Math.max(20,item.height*sy)}]));};
  const updateLayer = (
    input: Partial<OverlayLayer>,
    properties?: Record<string, any>
  ) =>
    commit({
      ...design,
      elements: design.elements.map((item) =>
        item.id === selectedId
          ? {
              ...item,
              ...input,
              properties: properties
                ? { ...item.properties, ...properties }
                : item.properties,
            }
          : item
      ),
    });
  const updateSegments = (segments: any[]) => updateLayer({}, { segments });
  const updateMappings = (mappings: any[]) => updateLayer({}, { mappings });
  const addLayer = (
    type: OverlayLayerType,
    asset?: { id: string; name: string }
  ) => {
    const id = `${type}-${crypto.randomUUID().slice(0, 7)}`;
    const textBackground = {
      fillColor: '#000000',
      fillOpacity: 0,
      borderColor: '#ffffff',
      borderWidth: 0,
      lockCorners: true,
      borderRadiusTopLeft: 0,
    };
    const properties: OverlayLayer['properties'] =
      type === 'text'
        ? {
            text: 'New text',
            fontSize: 60,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#ffffff',
            textAlign: 'left',
            opacity: 100,
            ...textBackground,
          }
        : type === 'tile'
          ? {
              fillColor: '#000000',
              fillOpacity: 70,
              borderColor: '#ffffff',
              borderWidth: 2,
              lockCorners: true,
              borderRadiusTopLeft: 10,
            }
          : type === 'variable'
            ? {
                segments: [{ type: 'variable' as const, field: 'imdbRating' }],
                fontSize: 60,
                fontFamily: 'Inter',
                fontWeight: 'bold',
                fontStyle: 'normal',
                color: '#ffffff',
                textAlign: 'left',
                opacity: 100,
                missingValueBehavior: 'hide',
                missingValueFallback: 'N/A',
                ...textBackground,
              }
            : type === 'mapped-icon'
              ? {
                  field: 'audioLanguages',
                  systemIcon: 'language',
                  mappings: [],
                  layout: 'horizontal',
                  iconSize: 80,
                  iconColor: '#f3ad32',
                  iconOpacity: 100,
                  iconBackgroundColor: '#000000',
                  iconBackgroundOpacity: 0,
                  iconBackgroundShape: 'rounded',
                  iconBackgroundPadding: 12,
                  iconBackgroundBorderColor: '#ffffff',
                  iconBackgroundBorderWidth: 0,
                  valueBackgroundColor: '#000000',
                  valueBackgroundOpacity: 0,
                  valueBackgroundShape: 'rounded',
                  valueBackgroundPadding: 8,
                  valueBackgroundBorderColor: '#ffffff',
                  valueBackgroundBorderWidth: 0,
                  groupBackgroundColor: '#000000',
                  groupBackgroundOpacity: 0,
                  groupBackgroundShape: 'rounded',
                  groupBackgroundPadding: 12,
                  groupBackgroundBorderColor: '#ffffff',
                  groupBackgroundBorderWidth: 0,
                  showValue: true,
                  valueColor: '#ffffff',
                  valueOpacity: 100,
                  valueFontSize: 42,
                  valueFontFamily: 'Inter',
                  valueFontWeight: 'bold',
                  valueFontStyle: 'normal',
                  valueAlign: 'center',
                  valueGap: 12,
                  spacingX: 8,
                  spacingY: 8,
                  maxIcons: 0,
                  gridColumns: 3,
                  grayscale: false,
                  opacity: 100,
                  missingValueBehavior: 'hide',
                  missingValueFallback: 'N/A',
                }
              : type === 'shape'
                ? {
                    shapeId: 'soft-plate',
                    fillColor: '#000000',
                    fillOpacity: 70,
                    borderColor: '#ffffff',
                    borderOpacity: 100,
                    borderWidth: 2,
                    opacity: 100,
                    outlineStyle: 'solid',
                    flipX: false,
                    flipY: false,
                    preserveAspectRatio: false,
                  }
                : type === 'icon'
                  ? {
                      systemIcon: 'play',
                      iconColor: '#ffffff',
                      iconOpacity: 100,
                      iconStrokeWidth: 2,
                      iconFill: false,
                      iconBackgroundColor: '#000000',
                      iconBackgroundOpacity: 0,
                      iconBackgroundShape: 'rounded',
                      iconBackgroundPadding: 0,
                      iconBackgroundRadius: 12,
                      iconBackgroundBorderColor: '#ffffff',
                      iconBackgroundBorderWidth: 0,
                      flipX: false,
                      flipY: false,
                    }
              : type === 'svg'
                ? {
                    assetId: asset?.id,
                    assetName: asset?.name,
                    iconType: 'custom-icon',
                    iconPath: asset ? `asset://${asset.id}` : '',
                    grayscale: false,
                    opacity: 100,
                  }
                : {
                    assetId: asset?.id,
                    assetName: asset?.name,
                    imagePath: asset ? `asset://${asset.id}` : '',
                    opacity: 100,
                  };
    const layer: OverlayLayer = {
      id,
      layerOrder: design.elements.length,
      type,
      x: 100,
      y: 150,
      width: type === 'mapped-icon' ? 500 : 300,
      height:
        type === 'tile' || type === 'shape'
          ? 150
          : type === 'raster' || type === 'svg'
            ? 300
            : type === 'mapped-icon'
              ? 260
              : 120,
      rotation: 0,
      name: asset?.name ?? type.replace('-', ' '),
      properties,
    };
    commit({ ...design, elements: [...design.elements, layer] });
    setSelectedId(id);
  };
  const uploadAsset = async (
    type: 'raster' | 'svg',
    file?: File,
    replace = false
  ) => {
    if (!file) return;
    const expected =
      type === 'svg'
        ? 'image/svg+xml'
        : ['image/jpeg', 'image/png', 'image/webp'];
    if (
      type === 'svg'
        ? file.type !== 'image/svg+xml'
        : !expected.includes(file.type)
    ) {
      setAssetMessage(
        type === 'svg'
          ? 'Choose an SVG file.'
          : 'Choose a JPEG, PNG, or WebP image.'
      );
      return;
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      setAssetMessage('Poster assets must be between 1 byte and 10 MB.');
      return;
    }
    setAssetBusy(type);
    setAssetMessage(`Uploading ${file.name}…`);
    try {
      const result = await api.uploadCollectionPosterAsset(file);
      const asset = result.asset;
      setPosterAssets([...result.workspace.assets]);
      if (replace && selected) {
        updateLayer(
          { name: file.name },
          {
            assetId: asset.id,
            assetName: asset.name,
            ...(type === 'svg'
              ? { iconPath: `asset://${asset.id}` }
              : { imagePath: `asset://${asset.id}` }),
          }
        );
      } else addLayer(type, asset);
      setAssetMessage(
        `${file.name} uploaded${replace ? ' and replaced' : ' and added'}.`
      );
    } catch (error) {
      setAssetMessage(
        error instanceof Error
          ? error.message
          : 'Unable to upload the poster asset.'
      );
    } finally {
      setAssetBusy(undefined);
      if (type === 'svg' && svgInput.current) svgInput.current.value = '';
      if (type === 'raster' && rasterInput.current)
        rasterInput.current.value = '';
    }
  };
  const move = (direction: -1 | 1) => {
    if (!selected) return;
    const sorted = [...design.elements].sort(
      (a, b) => a.layerOrder - b.layerOrder
    );
    const index = sorted.findIndex((item) => item.id === selected.id);
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
    commit({
      ...design,
      elements: sorted.map((item, i) => ({ ...item, layerOrder: i })),
    });
  };
  const duplicateLayer = () => {
    if (!selected) return;
    const id = `${selected.type}-${crypto.randomUUID().slice(0, 7)}`;
    const duplicate = {
      ...structuredClone(selected),
      id,
      name: `${selected.name} copy`,
      layerOrder: design.elements.length,
      x: Math.min(design.width - selected.width, selected.x + 20),
      y: Math.min(design.height - selected.height, selected.y + 20),
    };
    commit({ ...design, elements: [...design.elements, duplicate] });
    setSelectedId(id);
  };
  const copyLayer = () => {
    if (selected) setCopiedLayer(structuredClone(selected));
  };
  const pasteLayer = () => {
    if (!copiedLayer) return;
    const id = `${copiedLayer.type}-${crypto.randomUUID().slice(0, 7)}`;
    const pasted: OverlayLayer = {
      ...structuredClone(copiedLayer),
      id,
      name: `${copiedLayer.name} copy`,
      layerOrder: design.elements.length,
      x: Math.min(design.width - copiedLayer.width, copiedLayer.x + 20),
      y: Math.min(design.height - copiedLayer.height, copiedLayer.y + 20),
    };
    commit({ ...design, elements: [...design.elements, pasted] });
    setSelectedId(id);
  };
  useEffect(() => {
    const handleClipboard = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return;
      if (event.key.toLowerCase() === 'c' && selected) {
        event.preventDefault();
        setCopiedLayer(structuredClone(selected));
      }
      if (event.key.toLowerCase() === 'v' && copiedLayer) {
        event.preventDefault();
        pasteLayer();
      }
    };
    window.addEventListener('keydown', handleClipboard);
    return () => window.removeEventListener('keydown', handleClipboard);
  });
  const addRule = (sectionIndex: number) =>
    setCondition((current) => ({
      sections: current.sections.map((section, index) =>
        index === sectionIndex
          ? {
              ...section,
              rules: [
                ...section.rules,
                {
                  ruleOperator: 'and',
                  field: 'resolution',
                  operator: 'exists',
                  value: true,
                },
              ],
            }
          : section
      ),
    }));
  const addSection = () =>
    setCondition((current) => ({
      sections: [
        ...current.sections,
        {
          sectionOperator: current.sections.length ? 'or' : undefined,
          rules: [{ field: 'resolution', operator: 'exists', value: true }],
        },
      ],
    }));
  const updateRule = (
    sectionIndex: number,
    ruleIndex: number,
    input: Record<string, unknown>
  ) =>
    setCondition((current) => ({
      sections: current.sections.map((section, si) =>
        si === sectionIndex
          ? {
              ...section,
              rules: section.rules.map((rule, ri) =>
                ri === ruleIndex ? { ...rule, ...input } : rule
              ),
            }
          : section
      ),
    }));
  const defaultsForConditionField = (field: string) => {
    if (booleanFields.has(field)) return { field, operator: 'eq', value: true };
    if (field === 'collection') return { field, operator: 'eq', value: '' };
    if (field === 'mediaType') return { field, operator: 'eq', value: 'movie' };
    if (field === 'resolution') return { field, operator: 'eq', value: '4K' };
    if (numericFields.has(field)) return { field, operator: 'gte', value: 0 };
    return { field, operator: 'exists', value: true };
  };
  const save = async () => {
    if (!name.trim() || saving) return;
    const firstField = condition.sections[0]?.rules[0]?.field;
    setSaving(true);
    setSaveStatus('Saving overlay template…');
    try {
      await onSave({
        name: name.trim(), description: description.trim(), type: firstField ?? 'generic',
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), enabled,
        condition: condition.sections.length ? condition : undefined,
        conditionSummary: condition.sections.length ? `${condition.sections.length} condition ${condition.sections.length === 1 ? 'section' : 'sections'}` : 'Always apply',
        accent: template?.accent ?? '#f3ad32', design,
      });
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Unable to save the overlay template.');
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="overlay-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="overlay-editor-title"
      >
        <header>
          <div>
            <p className="eyebrow">
              {template ? 'Edit' : 'Create'} overlay template
            </p>
            <h2 id="overlay-editor-title">
              {template ? template.name : 'New overlay template'}
            </h2>
          </div>
          <div>
            <button
              className="icon-button"
              disabled={historyIndex === 0}
              title="Undo (Ctrl+Z)"
              onClick={() => setHistoryIndex((i) => i - 1)}
            >
              ↶
            </button>
            <button
              className="icon-button"
              disabled={historyIndex === history.length - 1}
              title="Redo (Ctrl+Shift+Z)"
              onClick={() => setHistoryIndex((i) => i + 1)}
            >
              ↷
            </button>
            <button
              className={`icon-button ${snap ? 'active' : ''}`}
              title={snap ? 'Snap: ON' : 'Snap: OFF'}
              onClick={() => setSnap(!snap)}
            >
              ⌗
            </button>
            <button className="icon-button" disabled={zoom <= 50} title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(50, value - 10))}>
              &minus;
            </button>
            <button className="icon-button" title="Reset zoom" onClick={() => setZoom(100)}>
              {zoom}%
            </button>
            <button className="icon-button" disabled={zoom >= 200} title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(200, value + 10))}>
              +
            </button>
            <button
              className="icon-button"
              title="Next synchronized Plex item"
              onClick={() => cyclePreview(1)}
            >
              ↻
            </button>
            <button
              className="icon-button"
              aria-label="Close overlay editor"
              onClick={requestClose}
            >
              ×
            </button>
          </div>
        </header>
        <div className="editor-meta three">
          <label>
            Template name
            <input
              value={name}
              placeholder="Enter a name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Description (optional)
            <input
              value={description}
              placeholder="Enter a description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            Tags
            <input
              value={tags}
              placeholder="Add tags, separated by commas"
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
        </div>
        <div className="overlay-editor-topline">
          <label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />{' '}
            Template active
          </label>
          <details>
            <summary>Preview with other overlays ({previewIds.length})</summary>
            {otherTemplates
              .filter((item) => item.id !== template?.id)
              .map((item) => (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={previewIds.includes(item.id)}
                    onChange={() =>
                      setPreviewIds((ids) =>
                        ids.includes(item.id)
                          ? ids.filter((id) => id !== item.id)
                          : [...ids, item.id]
                      )
                    }
                  />
                  {item.name}
                </label>
              ))}
          </details>
          <label>
            Preview library
            <select
              value={previewLibraryId}
              onChange={(event) => setPreviewLibraryId(event.target.value)}
            >
              <option value="">Exact saved preview</option>
              {compatibleLibraries.map((library) => (
                <option value={library.id} key={library.id}>
                  {library.name} · {library.indexedItems ?? library.itemCount}{' '}
                  indexed
                </option>
              ))}
            </select>
          </label>
          <div className="preview-cycle-controls">
            <button onClick={() => cyclePreview(-1)}>Previous</button>
            <button onClick={() => cyclePreview(1)}>Next</button>
            <button
              disabled={!previewItems.length}
              onClick={() =>
                setPreviewItemIndex(
                  Math.floor(Math.random() * previewItems.length)
                )
              }
            >
              Random
            </button>
          </div>
        </div>
        <div className="overlay-editor-layout">
          <aside>
            <h3>Add layer</h3>
            <div className="add-layer-grid">
              {(
                [
                  'text',
                  'tile',
                  'variable',
                  'raster',
                  'svg',
                  'icon',
                  'shape',
                  'mapped-icon',
                ] as const
              ).map((type) => (
                <button
                  key={type}
                  disabled={assetBusy !== undefined}
                  onClick={() => {
                    if (type === 'raster' || type === 'svg') {
                      setReplaceAsset(false);
                      (type === 'raster'
                        ? rasterInput
                        : svgInput
                      ).current?.click();
                    } else addLayer(type);
                  }}
                >
                  +{' '}
                  {type === 'raster'
                    ? 'Upload image'
                    : type === 'svg'
                      ? 'Upload SVG'
                      : type === 'mapped-icon'
                        ? 'Mapped'
                      : type === 'shape'
                          ? 'Shape library'
                          : type === 'icon'
                            ? 'Icon library'
                        : type}
                </button>
              ))}
            </div>
            <input
              ref={rasterInput}
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) =>
                void uploadAsset(
                  'raster',
                  event.target.files?.[0],
                  replaceAsset
                )
              }
            />
            <input
              ref={svgInput}
              hidden
              type="file"
              accept="image/svg+xml,.svg"
              onChange={(event) =>
                void uploadAsset('svg', event.target.files?.[0], replaceAsset)
              }
            />
            {assetMessage && (
              <p className="field-help" role="status">
                {assetMessage}
              </p>
            )}
            <h3>Layers</h3>
            <div className="layer-order-buttons">
              <button disabled={groupSelection.length<2} onClick={groupLayers}>Group selected</button>
              <button disabled={!groupSelection.length&&!selected?.groupId} onClick={ungroupLayers}>Ungroup</button>
            </div>
            <p className="field-help">Check two or more layers to make them move and resize together.</p>
            <div className="editor-layer-list">
              {[...design.elements]
                .sort((a, b) => b.layerOrder - a.layerOrder)
                .map((layer) => (
                  <button
                    className={selectedId === layer.id ? 'active' : ''}
                    key={layer.id}
                    onClick={() => setSelectedId(layer.id)}
                  >
                    <input type="checkbox" aria-label={`Select ${layer.name} for grouping`} checked={groupSelection.includes(layer.id)} onClick={(event)=>event.stopPropagation()} onChange={(event)=>setGroupSelection((current)=>event.target.checked?[...current,layer.id]:current.filter((id)=>id!==layer.id))}/>
                    <span>{layer.name}</span>
                    <small>{layer.type}{layer.groupId?' · grouped':''}</small>
                  </button>
                ))}
            </div>
            {selected && (
              <div className="layer-order-buttons">
                <button onClick={() => updateLayer({}, { hidden: selected.properties.hidden !== true })}>
                  {selected.properties.hidden === true ? 'Show layer' : 'Hide layer'}
                </button>
                <button onClick={() => updateLayer({}, { locked: selected.properties.locked !== true })}>
                  {selected.properties.locked === true ? 'Unlock layer' : 'Lock layer'}
                </button>
                <button onClick={() => move(1)}>Move up</button>
                <button onClick={() => move(-1)}>Move down</button>
                <button onClick={duplicateLayer}>Duplicate layer</button>
                <button onClick={copyLayer}>Copy</button>
                <button disabled={!copiedLayer} onClick={pasteLayer}>
                  Paste
                </button>
                <button
                  className="danger-text"
                  onClick={() => {
                    commit({
                      ...design,
                      elements: design.elements.filter(
                        (item) => item.id !== selected.id
                      ),
                    });
                    setSelectedId(undefined);
                  }}
                >
                  Delete
                </button>
                <button disabled={!['text','icon','svg','raster'].includes(selected.type)} onClick={saveReusable}>Save reusable</button>
              </div>
            )}
            <h3>Reusable items</h3>
            <div className="editor-layer-list">
              {savedItems.length===0?<p className="field-help">Save a named title, icon, or image to use it in later overlays.</p>:savedItems.map((saved)=><div className="reusable-overlay-item" key={saved.id}><button onClick={()=>insertReusable(saved)}><span>{saved.name}</span><small>{saved.kind}</small></button><button className="danger-text" aria-label={`Remove ${saved.name}`} onClick={()=>persistSavedItems(savedItems.filter((item)=>item.id!==saved.id))}>×</button></div>)}
            </div>
          </aside>
          <main>
            <div
              className="overlay-editor-canvas poster-interaction-canvas"
              style={{ containerType: 'inline-size', zoom: `${zoom}%` }}
              onClick={() => setSelectedId(undefined)}
            >
              <OverlayDesignPreview
                template={editorPreviewTemplate}
                mediaType={effectivePreviewMediaType}
                sampleIndex={sample}
                sampleOverride={previewSample}
                context={effectivePreviewContext}
              />
              <span>
                {previewSample.title} ·{' '}
                {selectedPreviewItem
                  ? `${selectedPreviewItem.libraryName} · ${previewItemIndex + 1} of ${previewItems.length}`
                  : `${effectivePreviewMediaType === 'movie' ? 'Movie' : 'TV show'} example`}
              </span>
              {previewStatus && <em>{previewStatus}</em>}
              {previewIds.map((id) => {
                const previewTemplate = otherTemplates.find(
                  (item) => item.id === id
                );
                return previewTemplate ? (
                  <div className="editor-companion-overlay" key={id}>
                    <OverlayDesignPreview
                      template={previewTemplate}
                      layersOnly
                      mediaType={effectivePreviewMediaType}
                      sampleIndex={sample}
                      context={effectivePreviewContext}
                    />
                  </div>
                ) : null;
              })}
              {[...design.elements]
                .filter((layer) => layer.properties.hidden !== true)
                .sort((a, b) => a.layerOrder - b.layerOrder)
                .map((layer) => {
                  if (layer.properties.locked === true) return null;
                  return (
                    <InteractivePosterLayer
                      key={layer.id}
                      layer={layer}
                      canvasWidth={design.width}
                      canvasHeight={design.height}
                      selected={selectedId === layer.id || Boolean(selected?.groupId&&layer.groupId===selected.groupId)}
                      snap={snap}
                      className={`${layer.type} interaction-only`}
                      onSelect={() => setSelectedId(layer.id)}
                      onPreview={(geometry)=>setLiveGeometry(groupGeometry(layer,geometry))}
                      onCommit={(geometry) => {
                        setSelectedId(layer.id);
                        const geometries=groupGeometry(layer,geometry);
                        commit({
                          ...design,
                          elements: design.elements.map((item) =>
                            geometries[item.id]
                              ? { ...item, ...geometries[item.id] }
                              : item
                          ),
                        });
                      }}
                    >
                      <span aria-hidden="true" />
                    </InteractivePosterLayer>
                  );
                })}
            </div>
            <p>
              1000 × 1500 · Drag layers to move; use handles to resize ·{' '}
              {snap ? 'Snap guides enabled' : 'Free positioning'}
            </p>
          </main>
          <aside>
            <h3>Properties</h3>
            {!selected ? (
              <p className="field-help">
                Select an element to edit its properties.
              </p>
            ) : (
              <>
                <label>
                  Layer name
                  <input
                    value={selected.name}
                    onChange={(e) => updateLayer({ name: e.target.value })}
                  />
                </label>
                {selected.type === 'text' && (
                  <>
                    <label>
                      Text
                      <input
                        value={String(selected.properties.text ?? '')}
                        onChange={(e) =>
                          updateLayer({}, { text: e.target.value })
                        }
                      />
                    </label>
                    <Typography selected={selected} update={updateLayer} assets={posterAssets} />
                  </>
                )}
                {selected.type === 'variable' && (
                  <>
                    <SegmentEditor
                      segments={(selected.properties.segments as any[]) ?? []}
                      onChange={updateSegments}
                    />
                    <Typography selected={selected} update={updateLayer} assets={posterAssets} />
                    <MissingValueControls
                      selected={selected}
                      update={updateLayer}
                    />
                  </>
                )}
                {selected.type === 'tile' && (
                  <>
                    <label>
                      Fill color
                      <input
                        type="color"
                        value={String(
                          selected.properties.fillColor ?? '#000000'
                        )}
                        onChange={(e) =>
                          updateLayer({}, { fillColor: e.target.value })
                        }
                      />
                    </label>
                    <OpacityControl
                      label="Fill opacity"
                      value={Number(selected.properties.fillOpacity ?? 70)}
                      onChange={(value) =>
                        updateLayer({}, { fillOpacity: value })
                      }
                    />
                    <label>
                      Border color
                      <input
                        type="color"
                        value={String(
                          selected.properties.borderColor ?? '#ffffff'
                        )}
                        onChange={(e) =>
                          updateLayer({}, { borderColor: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Border width
                      <input
                        type="number"
                        min="0"
                        value={Number(selected.properties.borderWidth ?? 0)}
                        onChange={(e) =>
                          updateLayer(
                            {},
                            { borderWidth: Number(e.target.value) }
                          )
                        }
                      />
                    </label>
                    <TileCorners selected={selected} update={updateLayer} />
                  </>
                )}
                {selected.type === 'shape' && (
                  <ShapeProperties selected={selected} update={updateLayer} />
                )}
                {selected.type === 'icon' && (
                  <LibraryIconProperties
                    selected={selected}
                    update={updateLayer}
                  />
                )}
                {selected.type === 'mapped-icon' && (
                  <>
                    <MappedIconProperties
                      selected={selected}
                      update={updateLayer}
                      updateMappings={updateMappings}
                      assets={posterAssets}
                    />
                    <MissingValueControls
                      selected={selected}
                      update={updateLayer}
                    />
                  </>
                )}
                {['raster', 'svg'].includes(selected.type) && (
                  <>
                    <div className="asset-selector">
                      <strong>
                        {selected.type === 'svg' ? 'SVG asset' : 'Image asset'}
                      </strong>
                      <small>
                        {String(
                          selected.properties.assetName ??
                            (selected.properties.assetId
                              ? 'Imported asset'
                              : 'No uploaded asset')
                        )}
                      </small>
                      <button
                        className="button secondary"
                        disabled={assetBusy !== undefined}
                        onClick={() => {
                          setReplaceAsset(true);
                          (selected.type === 'svg'
                            ? svgInput
                            : rasterInput
                          ).current?.click();
                        }}
                      >
                        {assetBusy
                          ? 'Uploading…'
                          : `Replace ${selected.type === 'svg' ? 'SVG' : 'image'}`}
                      </button>
                    </div>
                    {selected.type === 'svg' && (
                      <><label>
                        <input
                          type="checkbox"
                          checked={Boolean(selected.properties.grayscale)}
                          onChange={(e) =>
                            updateLayer({}, { grayscale: e.target.checked })
                          }
                        />{' '}
                        Grayscale
                      </label>
                      <label className="inline-check"><input type="checkbox" checked={selected.properties.svgFillEnabled === true} onChange={(e) => updateLayer({}, { svgFillEnabled: e.target.checked })} />Override SVG fill</label>
                      {selected.properties.svgFillEnabled === true && <label>Fill color<input type="color" value={String(selected.properties.svgFillColor ?? '#ffffff')} onChange={(e) => updateLayer({}, { svgFillColor: e.target.value })} /></label>}
                      <div className="two-field"><label>Outline color<input type="color" value={String(selected.properties.svgStrokeColor ?? '#000000')} onChange={(e) => updateLayer({}, { svgStrokeColor: e.target.value })} /></label><label>Outline width<input type="number" min="0" max="40" value={Number(selected.properties.svgStrokeWidth ?? 0)} onChange={(e) => updateLayer({}, { svgStrokeWidth: Number(e.target.value) })} /></label></div></>
                    )}
                    {selected.type === 'raster' && (
                      <label>
                        Image fit
                        <select value={String(selected.properties.fit ?? 'contain')} onChange={(e) => updateLayer({}, { fit: e.target.value })}>
                          <option value="contain">Contain</option>
                          <option value="cover">Cover / crop</option>
                          <option value="fill">Stretch to fill</option>
                        </select>
                      </label>
                    )}
                    <OpacityControl
                      label="Opacity"
                      value={Number(selected.properties.opacity ?? 100)}
                      onChange={(value) => updateLayer({}, { opacity: value })}
                    />
                  </>
                )}
                <div className="geometry-grid">
                  {(['x', 'y', 'width', 'height', 'rotation'] as const).map((key) => (
                    <label key={key}>
                      {key}
                      <input
                        type="number"
                        value={selected[key]}
                        onChange={(e) =>
                          updateLayer({ [key]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
          </aside>
        </div>
        <section className="condition-builder">
          <div>
            <h3>Application condition</h3>
            <p>
              Define when this overlay is applied. Rules inside a section and
              sections themselves can use AND or OR.
            </p>
          </div>
          <div>
            {condition.sections.length === 0 ? (
              <p className="field-help">Always apply (no condition)</p>
            ) : (
              condition.sections.map((section, si) => (
                <article key={si}>
                  {si > 0 && (
                    <select
                      value={section.sectionOperator ?? 'or'}
                      onChange={(e) =>
                        setCondition((current) => ({
                          sections: current.sections.map((item, i) =>
                            i === si
                              ? {
                                  ...item,
                                  sectionOperator: e.target.value as
                                    | 'and'
                                    | 'or',
                                }
                              : item
                          ),
                        }))
                      }
                    >
                      <option value="and">AND</option>
                      <option value="or">OR</option>
                    </select>
                  )}
                  <strong>Section {si + 1}</strong>
                  {section.rules.map((rule, ri) => (
                    <div key={ri}>
                      {ri > 0 && (
                        <select
                          value={rule.ruleOperator ?? 'and'}
                          onChange={(e) =>
                            updateRule(si, ri, { ruleOperator: e.target.value })
                          }
                        >
                          <option value="and">AND</option>
                          <option value="or">OR</option>
                        </select>
                      )}
                      <select
                        value={rule.field}
                        onChange={(e) =>
                          updateRule(si, ri, defaultsForConditionField(e.target.value))
                        }
                      >
                        <VariableOptions />
                      </select>
                      <select
                        value={rule.operator}
                        onChange={(e) =>
                          updateRule(si, ri, { operator: e.target.value })
                        }
                      >
                        {operators.map((operator) => (
                          <option key={operator.value} value={operator.value}>
                            {operator.label}
                          </option>
                        ))}
                      </select>
                      {rule.operator !== 'exists' && (
                        <ConditionValueInput
                          field={rule.field}
                          value={rule.value}
                          collections={collectionOptions}
                          options={conditionValueOptions[rule.field] ?? []}
                          onChange={(value) => updateRule(si, ri, { value })}
                        />
                      )}
                      <button
                        aria-label={`Remove rule ${ri + 1}`}
                        onClick={() =>
                          setCondition((current) => ({
                            sections: current.sections
                              .map((item, i) =>
                                i === si
                                  ? {
                                      ...item,
                                      rules: item.rules.filter(
                                        (_, r) => r !== ri
                                      ),
                                    }
                                  : item
                              )
                              .filter((item) => item.rules.length),
                          }))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {section.rules.some((rule) =>
                    ['radarrTags', 'sonarrTags', 'plexLabels'].includes(
                      rule.field
                    )
                  ) && (
                    <p className="condition-helper">
                      Tag and label conditions use the exact configured label.
                      Multiple values may be comma-separated for the “in”
                      operator.
                    </p>
                  )}
                  <button className="text-button" onClick={() => addRule(si)}>
                    + Add rule
                  </button>
                </article>
              ))
            )}
          </div>
          <button className="button secondary" onClick={addSection}>
            Add section
          </button>
          {condition.sections.length > 0 && (
            <button
              className="text-button danger-text"
              onClick={() => setCondition({ sections: [] })}
            >
              Clear conditions
            </button>
          )}
        </section>
        <footer className="modal-actions">
          {saveStatus && <p className="field-help" role="status">{saveStatus}</p>}
          <button className="button secondary" disabled={saving} onClick={requestClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!name.trim() || saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </footer>
        {confirmDiscard && (
          <div className="modal-backdrop nested-modal">
            <section className="poster-modal reset-modal" role="alertdialog" aria-modal="true" aria-labelledby="discard-overlay-title">
              <h2 id="discard-overlay-title">Discard unsaved changes?</h2>
              <p>Your template changes have not been saved.</p>
              <footer className="modal-actions">
                <button className="button secondary" onClick={() => setConfirmDiscard(false)}>Keep editing</button>
                <button className="button danger" onClick={onClose}>Discard changes</button>
              </footer>
            </section>
          </div>
        )}
      </section>
    </div>
  );
};

const OpacityControl = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
}) => {
  const normalized = Math.min(
    100,
    Math.max(0, Number.isFinite(value) ? value : 0)
  );
  return (
    <div className="opacity-control">
      <label>
        {label}
        <input
          aria-label={`${label} percent`}
          type="number"
          min="0"
          max="100"
          value={normalized}
          onChange={(event) =>
            onChange(Math.min(100, Math.max(0, Number(event.target.value))))
          }
        />
      </label>
      <label>
        Adjust {label.toLowerCase()} <output>{normalized}%</output>
        <input
          aria-label={`${label} slider`}
          type="range"
          min="0"
          max="100"
          value={normalized}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
    </div>
  );
};

const MissingValueControls = ({
  selected: _selected,
  update: _update,
}: {
  selected: OverlayLayer;
  update(input: Partial<OverlayLayer>, properties?: Record<string, any>): void;
}) => {
  return (
    <div className="nested-editor">
      <strong>Missing variable behavior</strong>
      <small>
        If this variable is unavailable for a video, the entire overlay is
        skipped for that video.
      </small>
    </div>
  );
};

const Typography = ({
  selected,
  update,
  assets,
}: {
  selected: OverlayLayer;
  update(input: Partial<OverlayLayer>, properties?: Record<string, any>): void;
  assets: readonly PosterEditorAsset[];
}) => (
  <>
    <label>
      Font size
      <input
        type="number"
        min="8"
        max="400"
        value={Number(selected.properties.fontSize ?? 60)}
        onChange={(e) => update({}, { fontSize: Number(e.target.value) })}
      />
    </label>
    <label>
      Custom font file
      <select value={String(selected.properties.fontPath ?? '')} onChange={(event) => { const asset = assets.find((item) => `asset://${item.id}` === event.target.value); update({}, { fontPath: event.target.value, assetId: asset?.id, fontAssetName: asset?.name }); }}>
        <option value="">Use selected system font</option>
        {assets.filter((asset) => asset.kind === 'font').map((asset) => <option key={asset.id} value={`asset://${asset.id}`}>{asset.name}</option>)}
      </select>
      <input type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const extension = file.name.split('.').pop()?.toLowerCase(); const mime = extension === 'otf' ? 'font/otf' : extension === 'woff' ? 'font/woff' : extension === 'woff2' ? 'font/woff2' : 'font/ttf'; const normalized = new File([file], file.name, { type: mime }); void api.uploadCollectionPosterAsset(normalized).then((result) => { const asset = result.asset; update({}, { fontPath: `asset://${asset.id}`, assetId: asset.id, fontAssetName: asset.name }); }).catch(() => undefined); event.currentTarget.value = ''; }} />
      <small>TTF, OTF, WOFF, or WOFF2 up to 10 MB. The font is embedded into rendered posters.</small>
    </label>
    <label>
      Font family
      <select
        value={String(selected.properties.fontFamily ?? 'Inter')}
        onChange={(e) => update({}, { fontFamily: e.target.value })}
      >
        <option>Inter</option>
        <option>Arial</option>
        <option>Roboto</option>
        <option>Montserrat</option>
      </select>
    </label>
    <div className="two-field">
      <label>
        Weight
        <select
          value={String(selected.properties.fontWeight ?? 'normal')}
          onChange={(e) => update({}, { fontWeight: e.target.value })}
        >
          <option>normal</option>
          <option>bold</option>
        </select>
      </label>
      <label>
        Style
        <select
          value={String(selected.properties.fontStyle ?? 'normal')}
          onChange={(e) => update({}, { fontStyle: e.target.value })}
        >
          <option>normal</option>
          <option>italic</option>
        </select>
      </label>
    </div>
    <label>
      Text color
      <input
        type="color"
        value={String(selected.properties.color ?? '#ffffff')}
        onChange={(e) => update({}, { color: e.target.value })}
      />
    </label>
    <fieldset className="alignment-control">
      <legend>Text alignment</legend>
      <div className="segmented-control three" role="group" aria-label="Text alignment">
        {(['left', 'center', 'right'] as const).map((alignment) => (
          <button
            type="button"
            key={alignment}
            className={String(selected.properties.textAlign ?? 'left') === alignment ? 'active' : ''}
            aria-pressed={String(selected.properties.textAlign ?? 'left') === alignment}
            onClick={() => update({}, { textAlign: alignment })}
          >
            {alignment === 'left' ? 'Left' : alignment === 'center' ? 'Center' : 'Right'}
          </button>
        ))}
      </div>
      <small>Aligns all text and variable segments inside this layer.</small>
    </fieldset>
    <OpacityControl
      label="Text opacity"
      value={Number(selected.properties.opacity ?? 100)}
      onChange={(value) => update({}, { opacity: value })}
    />
    <fieldset className="nested-editor">
      <legend>Text stroke</legend>
      <div className="two-field">
        <label>
          Color
          <input type="color" value={String(selected.properties.textStrokeColor ?? '#000000')} onChange={(e) => update({}, { textStrokeColor: e.target.value })} />
        </label>
        <label>
          Width
          <input type="number" min="0" max="40" value={Number(selected.properties.textStrokeWidth ?? 0)} onChange={(e) => update({}, { textStrokeWidth: Number(e.target.value) })} />
        </label>
      </div>
    </fieldset>
    <fieldset className="nested-editor">
      <legend>Text shadow</legend>
      <label>
        Color
        <input type="color" value={String(selected.properties.textShadowColor ?? '#000000')} onChange={(e) => update({}, { textShadowColor: e.target.value })} />
      </label>
      <OpacityControl label="Shadow opacity" value={Number(selected.properties.textShadowOpacity ?? 0)} onChange={(value) => update({}, { textShadowOpacity: value })} />
      <div className="three-field">
        <label>Horizontal<input type="number" min="-100" max="100" value={Number(selected.properties.textShadowOffsetX ?? 0)} onChange={(e) => update({}, { textShadowOffsetX: Number(e.target.value) })} /></label>
        <label>Vertical<input type="number" min="-100" max="100" value={Number(selected.properties.textShadowOffsetY ?? 0)} onChange={(e) => update({}, { textShadowOffsetY: Number(e.target.value) })} /></label>
        <label>Blur<input type="number" min="0" max="100" value={Number(selected.properties.textShadowBlur ?? 0)} onChange={(e) => update({}, { textShadowBlur: Number(e.target.value) })} /></label>
      </div>
    </fieldset>
    <FillAndShape selected={selected} update={update} />
  </>
);

const SegmentEditor = ({
  segments,
  onChange,
}: {
  segments: any[];
  onChange(segments: any[]): void;
}) => (
  <div className="nested-editor">
    <strong>Text segments</strong>
    {segments.map((segment, index) => (
      <div className="segment-row" key={index}>
        <select
          aria-label={`Segment ${index + 1} type`}
          value={segment.type}
          onChange={(e) =>
            onChange(
              segments.map((item, i) =>
                i === index
                  ? e.target.value === 'text'
                    ? { type: 'text', value: '' }
                    : { type: 'variable', field: 'imdbRating' }
                  : item
              )
            )
          }
        >
          <option value="text">Text</option>
          <option value="variable">Variable</option>
        </select>
        {segment.type === 'text' ? (
          <input
            aria-label={`Segment ${index + 1} text`}
            value={segment.value ?? ''}
            placeholder="Text content"
            onChange={(e) =>
              onChange(
                segments.map((item, i) =>
                  i === index ? { ...item, value: e.target.value } : item
                )
              )
            }
          />
        ) : (
          <>
            <select
              aria-label={`Segment ${index + 1} variable`}
              value={segment.field ?? 'imdbRating'}
              onChange={(e) =>
                onChange(
                  segments.map((item, i) =>
                    i === index ? { ...item, field: e.target.value } : item
                  )
                )
              }
            >
              <VariableOptions />
            </select>
            <small className="field-help">
              {variableDescription(segment.field ?? 'imdbRating')}
            </small>
            {String(segment.field ?? '')
              .toLowerCase()
              .includes('date') ||
            String(segment.field ?? '')
              .toLowerCase()
              .includes('release') ? (
              <input
                aria-label={`Segment ${index + 1} date format`}
                value={segment.format ?? ''}
                placeholder="Date format, e.g. MMM DD"
                onChange={(e) =>
                  onChange(
                    segments.map((item, i) =>
                      i === index ? { ...item, format: e.target.value } : item
                    )
                  )
                }
              />
            ) : null}
          </>
        )}
        <button
          aria-label={`Remove segment ${index + 1}`}
          onClick={() => onChange(segments.filter((_, i) => i !== index))}
        >
          ×
        </button>
      </div>
    ))}
    <div className="nested-actions">
      <button
        onClick={() => onChange([...segments, { type: 'text', value: '' }])}
      >
        + Add text
      </button>
      <button
        onClick={() =>
          onChange([...segments, { type: 'variable', field: 'imdbRating' }])
        }
      >
        + Add variable
      </button>
    </div>
  </div>
);

const MappingEditor = ({
  mappings,
  onChange,
}: {
  mappings: any[];
  onChange(mappings: any[]): void;
}) => (
  <div className="nested-editor">
    <strong>Icon mappings</strong>
    <p className="field-help">
      Map each exact context value to a system or uploaded icon path.
    </p>
    {mappings.map((mapping, index) => (
      <div className="mapping-row" key={index}>
        <input
          aria-label={`Mapping ${index + 1} value`}
          value={mapping.value ?? ''}
          placeholder="Context value"
          onChange={(e) =>
            onChange(
              mappings.map((item, i) =>
                i === index ? { ...item, value: e.target.value } : item
              )
            )
          }
        />
        <input
          aria-label={`Mapping ${index + 1} icon path`}
          value={mapping.iconPath ?? ''}
          placeholder="Icon path"
          onChange={(e) =>
            onChange(
              mappings.map((item, i) =>
                i === index ? { ...item, iconPath: e.target.value } : item
              )
            )
          }
        />
        <button
          aria-label={`Remove mapping ${index + 1}`}
          onClick={() => onChange(mappings.filter((_, i) => i !== index))}
        >
          ×
        </button>
      </div>
    ))}
    <button
      className="text-button"
      onClick={() => onChange([...mappings, { value: '', iconPath: '' }])}
    >
      + Add mapping
    </button>
  </div>
);

const EnhancedMappingEditor = ({
  mappings,
  onChange,
  assets,
}: {
  mappings: any[];
  onChange(mappings: any[]): void;
  assets: readonly PosterEditorAsset[];
}) => {
  const [search, setSearch] = useState('');
  const normalized = search.trim().toLowerCase();
  const iconChoices = dynamicValueIcons.filter((icon) =>
    icon.label.toLowerCase().includes(normalized)
  );
  const shapeChoices = overlayShapes.filter(
    (shape) =>
      shape.label.toLowerCase().includes(normalized) ||
      shape.category.toLowerCase().includes(normalized)
  );
  const assetChoices = assets.filter((asset) =>
    asset.name.toLowerCase().includes(normalized)
  );
  const updateMapping = (index: number, updates: Record<string, string>) =>
    onChange(
      mappings.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...updates } : item
      )
    );
  return (
    <div className="nested-editor">
      <strong>Icon mappings</strong>
      <p className="field-help">
        Map each exact value to any library icon, shape, or uploaded asset.
        Add as many mappings as needed.
      </p>
      {mappings.map((mapping, index) => (
        <div className="mapping-card" key={index}>
          <div className="mapping-row">
            <input
              aria-label={`Mapping ${index + 1} value`}
              value={mapping.value ?? ''}
              placeholder="Exact context value"
              onChange={(event) =>
                updateMapping(index, { value: event.target.value })
              }
            />
            <code>{mapping.iconPath || 'No icon selected'}</code>
            <button
              aria-label={`Remove mapping ${index + 1}`}
              onClick={() => onChange(mappings.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
          <details className="mapping-picker">
            <summary>Choose mapped icon</summary>
            <input
              aria-label={`Search icons for mapping ${index + 1}`}
              value={search}
              placeholder="Search icons, shapes, and uploads"
              onChange={(event) => setSearch(event.target.value)}
            />
            <strong>Icon library</strong>
            <div className="dynamic-icon-picker">
              {iconChoices.map((icon) => (
                <button
                  type="button"
                  className={
                    mapping.iconPath === `icon://${icon.id}` ? 'active' : ''
                  }
                  key={icon.id}
                  onClick={() =>
                    updateMapping(index, {
                      iconPath: `icon://${icon.id}`,
                    })
                  }
                >
                  <DynamicIconSvg icon={icon} size={24} />
                  <small>{icon.label}</small>
                </button>
              ))}
            </div>
            <strong>Shape library</strong>
            <div className="dynamic-icon-picker">
              {shapeChoices.map((shape) => (
                <button
                  type="button"
                  className={
                    mapping.iconPath === `shape://${shape.id}` ? 'active' : ''
                  }
                  key={shape.id}
                  onClick={() =>
                    updateMapping(index, {
                      iconPath: `shape://${shape.id}`,
                    })
                  }
                >
                  <svg viewBox="0 0 120 72" aria-hidden="true">
                    <path d={shape.path} />
                  </svg>
                  <small>{shape.label}</small>
                </button>
              ))}
            </div>
            <strong>Uploaded assets</strong>
            <div className="mapped-upload-grid">
              {assetChoices.map((asset) => (
                <button
                  type="button"
                  className={
                    mapping.iconPath === `asset://${asset.id}` ? 'active' : ''
                  }
                  key={asset.id}
                  onClick={() =>
                    updateMapping(index, {
                      iconPath: `asset://${asset.id}`,
                    })
                  }
                >
                  <img
                    src={`/api/posters/collections/assets/${encodeURIComponent(asset.id)}`}
                    alt=""
                  />
                  <small>{asset.name}</small>
                </button>
              ))}
              {!assetChoices.length && (
                <small className="field-help">
                  Upload an SVG or image layer once to add it to this library.
                </small>
              )}
            </div>
            <label>
              Direct path
              <input
                aria-label={`Mapping ${index + 1} icon path`}
                value={mapping.iconPath ?? ''}
                placeholder="asset://, icon://, shape://, or URL path"
                onChange={(event) =>
                  updateMapping(index, { iconPath: event.target.value })
                }
              />
            </label>
          </details>
        </div>
      ))}
      <button
        className="text-button"
        onClick={() => onChange([...mappings, { value: '', iconPath: '' }])}
      >
        + Add mapping
      </button>
    </div>
  );
};

const previewValueForField = (
  field: string,
  context?: Readonly<Record<string, string | number | boolean | null>>
) => {
  const live = context?.[field];
  if (live !== undefined && live !== null && live !== '') {
    if (typeof live === 'boolean') return live ? 'YES' : 'NO';
    return formatPreviewValue(field, live);
  }
  if (context && Object.keys(context).length) return 'Dynamic value';
  const values: Record<string, string> = {
    resolution: '4K',
    width: '3840',
    height: '2160',
    videoCodec: 'HEVC',
    videoProfile: 'Main 10',
    hdr: 'HDR10',
    dolbyVision: 'Dolby Vision',
    audioFormat: 'TrueHD',
    audioCodec: 'Atmos',
    audioChannels: '7.1',
    audioLanguages: 'EN · ES',
    subtitleLanguages: 'EN',
    dateAdded: 'JUL 27',
    lastPlayed: 'JUL 25',
    daysSinceAdded: '5 DAYS',
    daysSinceLastPlayed: '2 DAYS',
    imdbRating: '8.4',
    imdbVotes: '124,500',
    imdbContentRating: 'PG-13',
    imdbGenres: 'DRAMA · ACTION',
    imdbKeywords: 'FIRST RESPONDER · FIREFIGHTER',
    imdbActors: 'EXAMPLE ACTOR',
    imdbDirectors: 'EXAMPLE DIRECTOR',
    imdbCreators: 'EXAMPLE CREATOR',
    imdbPlot: 'IMDb plot summary',
    imdbAlternateTitle: 'ALTERNATE TITLE',
    imdbReleaseDate: 'JUL 27',
    imdbRuntime: '136',
    rtCriticsScore: '94%',
    rtAudienceScore: '92%',
    plexUserRating: '9.0',
    releaseDate: 'JUL 27',
    nextEpisodeAirDate: 'AUG 03',
    nextSeasonAirDate: 'OCT 12',
    daysUntilRelease: '12 DAYS',
    daysUntilAction: '5 DAYS',
    seasonNumber: 'SEASON 2',
    episodeNumber: 'EPISODE 6',
    episodeCount: '24 EPISODES',
    downloaded: 'DOWNLOADED',
    isMonitored: 'MONITORED',
    hasSubtitles: 'YES',
    rtCertifiedFresh: 'CERTIFIED FRESH',
    rtVerifiedHot: 'VERIFIED HOT',
    inRadarr: 'RADARR',
    inSonarr: 'SONARR',
  streamingProvider: 'Netflix',
    collection: 'COLLECTION',
    fileSize: '18.4 GB',
    title: 'MOVIE TITLE',
    year: '2026',
  };
  return values[field] ?? field.replace(/([A-Z])/g, ' $1').toUpperCase();
};

const previewDateFields = new Set([
  'releaseDate',
  'imdbReleaseDate',
  'nextEpisodeAirDate',
  'nextSeasonAirDate',
  'lastPlayed',
  'dateAdded',
]);
const formatPreviewDate = (value: string | number, format = 'MMM DD') => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return String(value);
  const month = parsed
    .toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
    .toUpperCase();
  const monthLong = parsed
    .toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
    .toUpperCase();
  const weekday = parsed
    .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    .toUpperCase();
  const weekdayLong = parsed
    .toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
    .toUpperCase();
  const year = parsed.getUTCFullYear();
  const numericMonth = parsed.getUTCMonth() + 1;
  const day = parsed.getUTCDate();
  const pad = (input: number) => String(input).padStart(2, '0');
  const values: Record<string, string> = {
    'YYYY-MM-DD': `${year}-${pad(numericMonth)}-${pad(day)}`,
    'YYYY/MM/DD': `${year}/${pad(numericMonth)}/${pad(day)}`,
    'DD-MM-YYYY': `${pad(day)}-${pad(numericMonth)}-${year}`,
    'DD/MM/YYYY': `${pad(day)}/${pad(numericMonth)}/${year}`,
    'MM/DD/YYYY': `${pad(numericMonth)}/${pad(day)}/${year}`,
    'DD/MM': `${pad(day)}/${pad(numericMonth)}`,
    'D/M': `${day}/${numericMonth}`,
    'MM/DD': `${pad(numericMonth)}/${pad(day)}`,
    'M/D': `${numericMonth}/${day}`,
    'DDD DD/MM': `${weekday} ${pad(day)}/${pad(numericMonth)}`,
    'DDD D/M': `${weekday} ${day}/${numericMonth}`,
    'DDD MM/DD': `${weekday} ${pad(numericMonth)}/${pad(day)}`,
    'DDD M/D': `${weekday} ${numericMonth}/${day}`,
    DDDD: weekdayLong,
    DDD: weekday,
    'MMM DD': `${month} ${pad(day)}`,
    'DD MMM': `${pad(day)} ${month}`,
    'MMM DD, YYYY': `${month} ${pad(day)}, ${year}`,
    'DD MMM YYYY': `${pad(day)} ${month} ${year}`,
    'MMMM DD, YYYY': `${monthLong} ${pad(day)}, ${year}`,
    'DD MMMM YYYY': `${pad(day)} ${monthLong} ${year}`,
  };
  return values[format] ?? values['MMM DD']!;
};
const formatPreviewValue = (
  field: string,
  value: string | number | boolean,
  format?: string
) => {
  if (
    previewDateFields.has(field) &&
    (typeof value === 'string' || typeof value === 'number')
  )
    return formatPreviewDate(value, format);
  if (field === 'resolution' && /^\d{3,4}$/i.test(String(value)))
    return `${value}p`;
  return String(value);
};

const previewVariableText = (
  layer: OverlayLayer,
  context: Readonly<Record<string, string | number | boolean | null>>
) => {
  const segments = Array.isArray(layer.properties.segments)
    ? layer.properties.segments
    : [];
  const values = segments.map((segment) => {
    if (!segment || typeof segment !== 'object') return '';
    if (segment.type === 'text') return String(segment.value ?? '');
    const field = String(segment.field ?? '');
    const value = context[field];
    if (value === undefined || value === null || value === '')
      return previewValueForField(field);
    return formatPreviewValue(
      field,
      value,
      typeof segment.format === 'string' ? segment.format : undefined
    );
  });
  return values.join('') || 'Dynamic value';
};

const DynamicIconSvg = ({
  icon,
  size,
  properties = {},
}: {
  icon: DynamicValueIcon;
  size: number;
  properties?: Record<string, any>;
}) => {
  const mode = String(properties.iconStyle ?? 'outline');
  const main = String(properties.iconColor ?? 'currentColor');
  const soft = String(properties.iconSoftColor ?? main);
  const accent = String(properties.iconAccentColor ?? '#f3ad32');
  const strokeWidth = Number(properties.iconStrokeWidth ?? 1.8);
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{
        transform: `scale(${properties.flipX ? -1 : 1}, ${properties.flipY ? -1 : 1})`,
      }}
    >
      {mode === 'badge' && (
        <rect
          x="0.75" y="0.75" width="22.5" height="22.5"
          rx={Number(properties.iconBadgeRadius ?? 12)}
          fill={String(properties.iconBadgeColor ?? main)}
          fillOpacity={Number(properties.iconBadgeOpacity ?? 18) / 100}
          stroke={String(properties.iconBadgeBorderColor ?? main)}
          strokeWidth={Number(properties.iconBadgeBorderWidth ?? 0)}
        />
      )}
      {icon.svgBody ? (
        <g
          transform={
            mode === 'badge'
              ? `translate(2.5 2.5) scale(${19 / 24})`
              : undefined
          }
          style={{
          ['--icon-main' as any]: main,
          ['--icon-soft' as any]: soft,
          ['--icon-accent' as any]: accent,
          ['--icon-stroke' as any]: strokeWidth,
          ['--icon-dash' as any]:
            properties.iconStrokeStyle === 'dashed'
              ? '4 2.5'
              : properties.iconStrokeStyle === 'dotted'
                ? '1 2'
                : 'none',
          ['--icon-soft-opacity' as any]:
            Number(properties.iconSoftOpacity ?? (mode === 'solid' ? 24 : 100)) /
            100,
          ['--icon-accent-opacity' as any]:
            Number(properties.iconAccentOpacity ?? 100) / 100,
          }}
          className={`layered-icon layered-icon-${mode}`}
          dangerouslySetInnerHTML={{ __html: icon.svgBody }}
        />
      ) : (
        <g>
          <path
            d={icon.path}
            fill={properties.iconFill ? main : 'none'}
            stroke={main}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
    </svg>
  );
};

export const MappedIconPreview = ({
  layer,
  context,
}: {
  layer: OverlayLayer;
  context?: Readonly<Record<string, string | number | boolean | null>>;
}) => {
  const field = String(layer.properties.field ?? 'audioLanguages');
  const systemIcon = String(layer.properties.systemIcon ?? '');
  if (!systemIcon) return <b>Mapped icons</b>;
  const icon =
    dynamicValueIcons.find((item) => item.id === systemIcon) ??
    dynamicValueIconForField(field);
  const mappedShape = systemIcon.startsWith('shape:')
    ? overlayShapeById(systemIcon.slice('shape:'.length))
    : undefined;
  const alignment = String(layer.properties.valueAlign ?? 'center');
  const backgroundShape = String(
    layer.properties.iconBackgroundShape ?? 'rounded'
  );
  const backgroundOpacity = Number(layer.properties.iconBackgroundOpacity ?? 0);
  const backgroundPadding =
    Number(layer.properties.iconBackgroundPadding ?? 12) * 0.41;
  const valueBackgroundShape = String(
    layer.properties.valueBackgroundShape ?? 'rounded'
  );
  const groupBackgroundShape = String(
    layer.properties.groupBackgroundShape ?? 'rounded'
  );
  const scaledRadius = (shape: string, padding: number) =>
    shape === 'pill'
      ? '999px'
      : shape === 'rounded'
        ? `${Math.max(6, padding)}px`
        : '0';
  return (
    <div
      className="dynamic-value-layer-preview"
      style={{
        alignItems:
          alignment === 'left'
            ? 'flex-start'
            : alignment === 'right'
              ? 'flex-end'
              : 'center',
        gap: `${Number(layer.properties.valueGap ?? 12) * 0.41}px`,
        backgroundColor: `color-mix(in srgb, ${String(
          layer.properties.groupBackgroundColor ?? '#000000'
        )} ${Number(layer.properties.groupBackgroundOpacity ?? 0)}%, transparent)`,
        borderColor: String(
          layer.properties.groupBackgroundBorderColor ?? '#ffffff'
        ),
        borderStyle: 'solid',
        borderWidth: `${
          Number(layer.properties.groupBackgroundBorderWidth ?? 0) * 0.41
        }px`,
        borderRadius: scaledRadius(
          groupBackgroundShape,
          Number(layer.properties.groupBackgroundPadding ?? 12) * 0.41
        ),
        padding: `${
          Number(layer.properties.groupBackgroundPadding ?? 12) * 0.41
        }px`,
      }}
    >
      <span
        className="dynamic-icon-plate"
        style={{
          backgroundColor: `color-mix(in srgb, ${String(
            layer.properties.iconBackgroundColor ?? '#000000'
          )} ${backgroundOpacity}%, transparent)`,
          borderColor: String(
            layer.properties.iconBackgroundBorderColor ?? '#ffffff'
          ),
          borderStyle: 'solid',
          borderWidth: `${
            Number(layer.properties.iconBackgroundBorderWidth ?? 0) * 0.41
          }px`,
          borderRadius:
            backgroundShape === 'circle'
              ? '50%'
              : backgroundShape === 'rounded'
                ? `${Math.max(6, backgroundPadding)}px`
                : '0',
          padding: `${backgroundPadding}px`,
        }}
      >
        <span
          style={{
            color: String(layer.properties.iconColor ?? '#ffffff'),
            opacity: Number(layer.properties.iconOpacity ?? 100) / 100,
          }}
        >
          {mappedShape ? (
            <svg
              viewBox="0 0 120 72"
              width={Number(layer.properties.iconSize ?? 80) * 0.6}
              height={Number(layer.properties.iconSize ?? 80) * 0.41}
              aria-hidden="true"
            >
              <path
                d={mappedShape.path}
                fill="currentColor"
                fillOpacity={
                  Number(layer.properties.iconFillOpacity ?? 100) / 100
                }
                stroke={String(
                  layer.properties.iconOutlineColor ??
                    layer.properties.iconColor ??
                    '#ffffff'
                )}
                strokeWidth={Number(layer.properties.iconOutlineWidth ?? 0)}
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <DynamicIconSvg
              icon={icon}
              size={Number(layer.properties.iconSize ?? 80) * 0.41}
              properties={layer.properties}
            />
          )}
        </span>
      </span>
      {layer.properties.showValue !== false && (
        <strong
          style={{
            color: String(layer.properties.valueColor ?? '#ffffff'),
            opacity: Number(layer.properties.valueOpacity ?? 100) / 100,
            fontFamily: String(layer.properties.valueFontFamily ?? 'Inter'),
            fontSize: `${Number(layer.properties.valueFontSize ?? 42) * 0.41}px`,
            fontWeight: String(
              layer.properties.valueFontWeight ?? 'bold'
            ) as React.CSSProperties['fontWeight'],
            fontStyle: String(
              layer.properties.valueFontStyle ?? 'normal'
            ) as React.CSSProperties['fontStyle'],
            backgroundColor: `color-mix(in srgb, ${String(
              layer.properties.valueBackgroundColor ?? '#000000'
            )} ${Number(layer.properties.valueBackgroundOpacity ?? 0)}%, transparent)`,
            borderColor: String(
              layer.properties.valueBackgroundBorderColor ?? '#ffffff'
            ),
            borderStyle: 'solid',
            borderWidth: `${
              Number(layer.properties.valueBackgroundBorderWidth ?? 0) * 0.41
            }px`,
            borderRadius: scaledRadius(
              valueBackgroundShape,
              Number(layer.properties.valueBackgroundPadding ?? 8) * 0.41
            ),
            padding: `${
              Number(layer.properties.valueBackgroundPadding ?? 8) * 0.41
            }px`,
          }}
        >
          {previewValueForField(field, context)}
        </strong>
      )}
    </div>
  );
};

const BackgroundAppearance = ({
  title,
  prefix,
  selected,
  update,
  defaultPadding,
}: {
  title: string;
  prefix: 'valueBackground' | 'groupBackground' | 'iconBackground';
  selected: OverlayLayer;
  update(input: Partial<OverlayLayer>, properties?: Record<string, any>): void;
  defaultPadding: number;
}) => {
  const property = (suffix: string) => `${prefix}${suffix}`;
  return (
    <div className="background-appearance">
      <strong>{title}</strong>
      <div className="two-field">
        <label>
          Color
          <input
            type="color"
            value={String(selected.properties[property('Color')] ?? '#000000')}
            onChange={(event) =>
              update({}, { [property('Color')]: event.target.value })
            }
          />
        </label>
        <label>
          Shape
          <select
            value={String(selected.properties[property('Shape')] ?? 'rounded')}
            onChange={(event) =>
              update({}, { [property('Shape')]: event.target.value })
            }
          >
            <option value="square">Square</option>
            <option value="rounded">Rounded</option>
            <option value="pill">Pill</option>
          </select>
        </label>
      </div>
      <OpacityControl
        label={`${title} opacity`}
        value={Number(selected.properties[property('Opacity')] ?? 0)}
        onChange={(value) => update({}, { [property('Opacity')]: value })}
      />
      <div className="two-field">
        <label>
          Padding
          <input
            type="number"
            min="0"
            max="200"
            value={Number(
              selected.properties[property('Padding')] ?? defaultPadding
            )}
            onChange={(event) =>
              update({}, { [property('Padding')]: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Border width
          <input
            type="number"
            min="0"
            max="40"
            value={Number(selected.properties[property('BorderWidth')] ?? 0)}
            onChange={(event) =>
              update(
                {},
                { [property('BorderWidth')]: Number(event.target.value) }
              )
            }
          />
        </label>
      </div>
      <label>
        Border color
        <input
          type="color"
          value={String(
            selected.properties[property('BorderColor')] ?? '#ffffff'
          )}
          onChange={(event) =>
            update({}, { [property('BorderColor')]: event.target.value })
          }
        />
      </label>
    </div>
  );
};

const LibraryIconPreview = ({ layer }: { layer: OverlayLayer }) => {
  const icon =
    dynamicValueIcons.find(
      (item) => item.id === String(layer.properties.systemIcon ?? 'play')
    ) ?? dynamicValueIcons[0]!;
  return (
    <span
      style={{
        display: 'contents',
        opacity: Number(layer.properties.iconOpacity ?? 100) / 100,
        transform: `scale(${layer.properties.flipX ? -1 : 1}, ${layer.properties.flipY ? -1 : 1})`,
      }}
    >
      <DynamicIconSvg icon={icon} size={100} properties={layer.properties} />
    </span>
  );
};

const LibraryIconProperties = ({
  selected,
  update,
}: {
  selected: OverlayLayer;
  update(input: Partial<OverlayLayer>, properties?: Record<string, any>): void;
}) => {
  const current = String(selected.properties.systemIcon ?? 'play');
  const [iconSearch, setIconSearch] = useState('');
  const [iconCategory, setIconCategory] = useState('All');
  const filteredIcons = dynamicValueIcons.filter(
    (icon) =>
      (iconCategory === 'All' ||
        (icon.category ?? 'General') === iconCategory) &&
      icon.label.toLowerCase().includes(iconSearch.trim().toLowerCase())
  );
  return (
    <>
      <div className="nested-editor">
        <strong>Icon library</strong>
        <div className="two-field">
          <label>
            Search
            <input
              value={iconSearch}
              placeholder="Search all icons"
              onChange={(event) => setIconSearch(event.target.value)}
            />
          </label>
          <label>
            Category
            <select
              value={iconCategory}
              onChange={(event) => setIconCategory(event.target.value)}
            >
              {['All', 'Streaming', 'Availability', 'Lifecycle', 'Media', 'Formats', 'Audio', 'General'].map(
                (category) => <option key={category}>{category}</option>
              )}
            </select>
          </label>
        </div>
        <div className="dynamic-icon-picker">
          {filteredIcons.map((icon) => (
            <button
              type="button"
              className={current === icon.id ? 'active' : ''}
              aria-pressed={current === icon.id}
              aria-label={`Use ${icon.label} icon`}
              key={icon.id}
              onClick={() =>
                update(
                  { name: icon.label },
                  {
                    systemIcon: icon.id,
                    iconFill: false,
                    iconStyle: icon.svgBody
                      ? selected.properties.iconStyle ?? 'outline'
                      : 'outline',
                  }
                )
              }
            >
              <DynamicIconSvg icon={icon} size={24} />
              <small>{icon.label}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="nested-editor">
        <strong>Style preset</strong>
        <div className="segmented-control three">
          {[
            ['outline', 'Outline'],
            ['solid', 'Solid accent'],
            ['badge', 'Badge'],
          ].map(([value, label]) => (
            <button
              type="button"
              className={
                String(selected.properties.iconStyle ?? 'outline') === value
                  ? 'active'
                  : ''
              }
              key={value}
              onClick={() => update({}, { iconStyle: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="field-help">
          Presets are starting points. Every layer color and detail remains
          editable below.
        </p>
      </div>
      <div className="two-field">
        <label>
          Icon color
          <input
            type="color"
            value={String(selected.properties.iconColor ?? '#ffffff')}
            onChange={(event) =>
              update({}, { iconColor: event.target.value })
            }
          />
        </label>
        <label>
          Stroke width
          <input
            type="number"
            min="0"
            max="12"
            step="0.25"
            value={Number(selected.properties.iconStrokeWidth ?? 2)}
            onChange={(event) =>
              update({}, { iconStrokeWidth: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Stroke style
          <select
            value={String(selected.properties.iconStrokeStyle ?? 'solid')}
            onChange={(event) =>
              update({}, { iconStrokeStyle: event.target.value })
            }
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </label>
      </div>
      <div className="two-field">
        <label>
          Soft layer color
          <input
            type="color"
            value={String(
              selected.properties.iconSoftColor ??
                selected.properties.iconColor ??
                '#ffffff'
            )}
            onChange={(event) =>
              update({}, { iconSoftColor: event.target.value })
            }
          />
        </label>
        <label>
          Accent color
          <input
            type="color"
            value={String(selected.properties.iconAccentColor ?? '#f3ad32')}
            onChange={(event) =>
              update({}, { iconAccentColor: event.target.value })
            }
          />
        </label>
      </div>
      <div className="two-field">
        <OpacityControl
          label="Soft layer opacity"
          value={Number(selected.properties.iconSoftOpacity ?? 24)}
          onChange={(value) => update({}, { iconSoftOpacity: value })}
        />
        <OpacityControl
          label="Accent opacity"
          value={Number(selected.properties.iconAccentOpacity ?? 100)}
          onChange={(value) => update({}, { iconAccentOpacity: value })}
        />
      </div>
      {String(selected.properties.iconStyle ?? 'outline') === 'badge' && (
        <div className="nested-editor">
          <strong>Badge</strong>
          <div className="two-field">
            <label>
              Badge color
              <input
                type="color"
                value={String(
                  selected.properties.iconBadgeColor ??
                    selected.properties.iconColor ??
                    '#f3ad32'
                )}
                onChange={(event) =>
                  update({}, { iconBadgeColor: event.target.value })
                }
              />
            </label>
            <label>
              Corner radius
              <input
                type="number" min="0" max="12" step="0.5"
                value={Number(selected.properties.iconBadgeRadius ?? 12)}
                onChange={(event) =>
                  update({}, { iconBadgeRadius: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <OpacityControl
            label="Badge opacity"
            value={Number(selected.properties.iconBadgeOpacity ?? 18)}
            onChange={(value) => update({}, { iconBadgeOpacity: value })}
          />
          <div className="two-field">
            <label>
              Border color
              <input
                type="color"
                value={String(
                  selected.properties.iconBadgeBorderColor ??
                    selected.properties.iconColor ??
                    '#ffffff'
                )}
                onChange={(event) =>
                  update({}, { iconBadgeBorderColor: event.target.value })
                }
              />
            </label>
            <label>
              Border width
              <input
                type="number" min="0" max="6" step="0.25"
                value={Number(selected.properties.iconBadgeBorderWidth ?? 0)}
                onChange={(event) =>
                  update(
                    {},
                    { iconBadgeBorderWidth: Number(event.target.value) }
                  )
                }
              />
            </label>
          </div>
        </div>
      )}
      <BackgroundAppearance
        title="Whole icon background"
        prefix="iconBackground"
        selected={selected}
        update={update}
        defaultPadding={0}
      />
      <OpacityControl
        label="Icon opacity"
        value={Number(selected.properties.iconOpacity ?? 100)}
        onChange={(value) => update({}, { iconOpacity: value })}
      />
      <div className="two-field">
        <label>
          <input
            type="checkbox"
            checked={Boolean(selected.properties.iconFill)}
            onChange={(event) =>
              update({}, { iconFill: event.target.checked })
            }
          />{' '}
          Filled
        </label>
        <label>
          <input
            type="checkbox"
            checked={Boolean(selected.properties.flipX)}
            onChange={(event) => update({}, { flipX: event.target.checked })}
          />{' '}
          Flip horizontally
        </label>
        <label>
          <input
            type="checkbox"
            checked={Boolean(selected.properties.flipY)}
            onChange={(event) => update({}, { flipY: event.target.checked })}
          />{' '}
          Flip vertically
        </label>
      </div>
    </>
  );
};

const ShapePreview = ({ layer }: { layer: OverlayLayer }) => {
  const shape = overlayShapeById(String(layer.properties.shapeId ?? 'plate'));
  return (
    <svg
      aria-label={shape.label}
      viewBox="0 0 120 72"
      preserveAspectRatio={
        layer.properties.preserveAspectRatio ? 'xMidYMid meet' : 'none'
      }
      style={{ opacity: Number(layer.properties.opacity ?? 100) / 100 }}
    >
      <path
        d={shape.path}
        transform={`${layer.properties.flipX ? 'translate(120 0) scale(-1 1)' : ''} ${layer.properties.flipY ? 'translate(0 72) scale(1 -1)' : ''}`}
        fill={String(layer.properties.fillColor ?? '#000000')}
        fillOpacity={Number(layer.properties.fillOpacity ?? 100) / 100}
        stroke={String(layer.properties.borderColor ?? '#ffffff')}
        strokeOpacity={Number(layer.properties.borderOpacity ?? 100) / 100}
        strokeWidth={Number(layer.properties.borderWidth ?? 0)}
        strokeDasharray={
          layer.properties.outlineStyle === 'dashed'
            ? '8 5'
            : layer.properties.outlineStyle === 'dotted'
              ? '2 5'
              : undefined
        }
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const ShapeProperties = ({
  selected,
  update,
}: {
  selected: OverlayLayer;
  update(input: Partial<OverlayLayer>, properties?: Record<string, any>): void;
}) => {
  const current = String(selected.properties.shapeId ?? 'soft-plate');
  const categories = [...new Set(overlayShapes.map((shape) => shape.category))];
  return (
    <>
      <div className="nested-editor">
        <strong>Shape library</strong>
        {categories.map((category) => (
          <div key={category}>
            <small>{category}</small>
            <div className="dynamic-icon-picker">
              {overlayShapes
                .filter((shape) => shape.category === category)
                .map((shape) => (
                  <button
                    type="button"
                    className={current === shape.id ? 'active' : ''}
                    aria-pressed={current === shape.id}
                    aria-label={`Use ${shape.label} shape`}
                    key={shape.id}
                    onClick={() =>
                      update({ name: shape.label }, { shapeId: shape.id })
                    }
                  >
                    <svg viewBox="0 0 120 72" aria-hidden="true">
                      <path d={shape.path} />
                    </svg>
                    <small>{shape.label}</small>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="two-field">
        <label>
          Fill color
          <input
            type="color"
            value={String(selected.properties.fillColor ?? '#000000')}
            onChange={(event) =>
              update({}, { fillColor: event.target.value })
            }
          />
        </label>
        <label>
          Outline color
          <input
            type="color"
            value={String(selected.properties.borderColor ?? '#ffffff')}
            onChange={(event) =>
              update({}, { borderColor: event.target.value })
            }
          />
        </label>
      </div>
      <OpacityControl
        label="Fill opacity"
        value={Number(selected.properties.fillOpacity ?? 100)}
        onChange={(value) => update({}, { fillOpacity: value })}
      />
      <OpacityControl
        label="Outline opacity"
        value={Number(selected.properties.borderOpacity ?? 100)}
        onChange={(value) => update({}, { borderOpacity: value })}
      />
      <label>
        Outline width
        <input
          type="number"
          min="0"
          max="80"
          value={Number(selected.properties.borderWidth ?? 0)}
          onChange={(event) =>
            update({}, { borderWidth: Number(event.target.value) })
          }
        />
      </label>
      <label>
        Outline style
        <select
          value={String(selected.properties.outlineStyle ?? 'solid')}
          onChange={(event) =>
            update({}, { outlineStyle: event.target.value })
          }
        >
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </label>
      <div className="two-field">
        <label>
          <input
            type="checkbox"
            checked={Boolean(selected.properties.flipX)}
            onChange={(event) => update({}, { flipX: event.target.checked })}
          />{' '}
          Flip horizontally
        </label>
        <label>
          <input
            type="checkbox"
            checked={Boolean(selected.properties.flipY)}
            onChange={(event) => update({}, { flipY: event.target.checked })}
          />{' '}
          Flip vertically
        </label>
        <label>
          <input
            type="checkbox"
            checked={Boolean(selected.properties.preserveAspectRatio)}
            onChange={(event) =>
              update({}, { preserveAspectRatio: event.target.checked })
            }
          />{' '}
          Preserve proportions
        </label>
      </div>
      <OpacityControl
        label="Whole shape opacity"
        value={Number(selected.properties.opacity ?? 100)}
        onChange={(value) => update({}, { opacity: value })}
      />
    </>
  );
};

const MappedIconProperties = ({
  selected,
  update,
  updateMappings,
  assets,
}: {
  selected: OverlayLayer;
  update(input: Partial<OverlayLayer>, properties?: Record<string, any>): void;
  updateMappings(mappings: any[]): void;
  assets: readonly PosterEditorAsset[];
}) => {
  const field = String(selected.properties.field ?? 'audioLanguages');
  const selectedIcon = String(selected.properties.systemIcon ?? '');
  const usesPerValueMappings = selectedIcon === '';
  const [mappedIconSearch, setMappedIconSearch] = useState('');
  const [mappedIconCategory, setMappedIconCategory] = useState('All');
  const mappedIconChoices = dynamicValueIcons.filter(
    (icon) =>
      (mappedIconCategory === 'All' ||
        (icon.category ?? 'General') === mappedIconCategory) &&
      icon.label.toLowerCase().includes(mappedIconSearch.trim().toLowerCase())
  );
  return (
    <>
      <label>
        Dynamic value
        <select
          value={field}
          onChange={(event) => {
            const nextField = event.target.value;
            if(nextField==='streamingProvider'){
              update({}, {field:nextField,systemIcon:'',mappings:streamingServiceIcons.map((icon)=>({value:icon.label,iconPath:`icon://${icon.id}`}))});
              return;
            }
            update(
              {},
              {
                field: nextField,
                systemIcon: dynamicValueIconForField(nextField).id,
              }
            );
          }}
        >
          <VariableOptions />
        </select>
      </label>
      <p className="field-help">{variableDescription(field)}</p>
      {field === 'streamingProvider' && (
        <div className="nested-editor">
          <strong>Originating-service logos</strong>
          <p className="field-help">
            Automatically match the identified service to its genuine bundled logo.
            You can then change or remove any individual mapping.
          </p>
          <button
            type="button"
            onClick={() => {
              update({}, { systemIcon: '' });
              updateMappings(
                streamingServiceIcons.map((icon) => ({
                  value: icon.label,
                  iconPath: `icon://${icon.id}`,
                }))
              );
            }}
          >
            Map all {streamingServiceIcons.length} services
          </button>
        </div>
      )}
      <div className="nested-editor">
        <strong>Icon source</strong>
        <div className="segmented-control">
          <button
            type="button"
            className={!usesPerValueMappings ? 'active' : ''}
            onClick={() =>
              update({}, { systemIcon: dynamicValueIconForField(field).id })
            }
          >
            One icon for every value
          </button>
          <button
            type="button"
            className={usesPerValueMappings ? 'active' : ''}
            onClick={() => update({}, { systemIcon: '' })}
          >
            Different icon per value
          </button>
        </div>
      </div>
      {!usesPerValueMappings && (
      <div className="nested-editor">
        <strong>Transparent SVG icon</strong>
        <p className="field-help">
          Select the icon only. The text beneath it comes from the media file.
        </p>
        <div className="two-field">
          <input
            aria-label="Search mapped icon library"
            value={mappedIconSearch}
            placeholder="Search icons"
            onChange={(event) => setMappedIconSearch(event.target.value)}
          />
          <select
            aria-label="Mapped icon category"
            value={mappedIconCategory}
            onChange={(event) => setMappedIconCategory(event.target.value)}
          >
            {['All', 'Streaming', 'Availability', 'Lifecycle', 'Media', 'Formats', 'Audio', 'General'].map(
              (category) => <option key={category}>{category}</option>
            )}
          </select>
        </div>
        <div className="dynamic-icon-picker">
          {mappedIconChoices.map((icon) => (
            <button
              type="button"
              className={selectedIcon === icon.id ? 'active' : ''}
              aria-pressed={selectedIcon === icon.id}
              aria-label={`Use ${icon.label} icon`}
              key={icon.id}
              onClick={() => update({}, { systemIcon: icon.id })}
            >
              <DynamicIconSvg icon={icon} size={24} />
              <small>{icon.label}</small>
            </button>
          ))}
          {overlayShapes.map((shape) => (
            <button
              type="button"
              className={selectedIcon === `shape:${shape.id}` ? 'active' : ''}
              aria-pressed={selectedIcon === `shape:${shape.id}`}
              aria-label={`Use ${shape.label} shape`}
              key={`shape-${shape.id}`}
              onClick={() => update({}, { systemIcon: `shape:${shape.id}` })}
            >
              <svg viewBox="0 0 120 72" aria-hidden="true">
                <path d={shape.path} />
              </svg>
              <small>{shape.label}</small>
            </button>
          ))}
        </div>
      </div>
      )}
      <div className="nested-editor">
        <strong>Icon appearance</strong>
        <div className="segmented-control three">
          {[
            ['outline', 'Outline'],
            ['solid', 'Solid accent'],
            ['badge', 'Badge'],
          ].map(([value, label]) => (
            <button
              type="button"
              className={
                String(selected.properties.iconStyle ?? 'outline') === value
                  ? 'active'
                  : ''
              }
              key={value}
              onClick={() => update({}, { iconStyle: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="two-field">
          <label>
            Icon color
            <input
              type="color"
              value={String(selected.properties.iconColor ?? '#f3ad32')}
              onChange={(event) =>
                update({}, { iconColor: event.target.value })
              }
            />
          </label>
          <label>
            Icon size
            <input
              type="number"
              min="8"
              max="500"
              value={Number(selected.properties.iconSize ?? 80)}
              onChange={(event) =>
                update({}, { iconSize: Number(event.target.value) })
              }
            />
          </label>
        </div>
        <div className="two-field">
          <label>
            Soft color
            <input type="color"
              value={String(selected.properties.iconSoftColor ?? selected.properties.iconColor ?? '#f3ad32')}
              onChange={(event) => update({}, { iconSoftColor: event.target.value })}
            />
          </label>
          <label>
            Accent color
            <input type="color"
              value={String(selected.properties.iconAccentColor ?? '#ffffff')}
              onChange={(event) => update({}, { iconAccentColor: event.target.value })}
            />
          </label>
        </div>
        <div className="two-field">
          <label>
            Stroke width
            <input type="number" min="0" max="12" step="0.25"
              value={Number(selected.properties.iconStrokeWidth ?? 1.8)}
              onChange={(event) => update({}, { iconStrokeWidth: Number(event.target.value) })}
            />
          </label>
          <label>
            Badge radius
            <input type="number" min="0" max="12" step="0.5"
              disabled={String(selected.properties.iconStyle ?? 'outline') !== 'badge'}
              value={Number(selected.properties.iconBadgeRadius ?? 12)}
              onChange={(event) => update({}, { iconBadgeRadius: Number(event.target.value) })}
            />
          </label>
        </div>
        <label>
          Stroke style
          <select
            value={String(selected.properties.iconStrokeStyle ?? 'solid')}
            onChange={(event) =>
              update({}, { iconStrokeStyle: event.target.value })
            }
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </label>
        <OpacityControl
          label="Soft layer opacity"
          value={Number(selected.properties.iconSoftOpacity ?? 24)}
          onChange={(value) => update({}, { iconSoftOpacity: value })}
        />
        <OpacityControl
          label="Accent opacity"
          value={Number(selected.properties.iconAccentOpacity ?? 100)}
          onChange={(value) => update({}, { iconAccentOpacity: value })}
        />
        {String(selected.properties.iconStyle ?? 'outline') === 'badge' && (
          <>
            <div className="two-field">
              <label>
                Badge color
                <input type="color"
                  value={String(selected.properties.iconBadgeColor ?? selected.properties.iconColor ?? '#f3ad32')}
                  onChange={(event) => update({}, { iconBadgeColor: event.target.value })}
                />
              </label>
              <label>
                Badge border
                <input type="color"
                  value={String(selected.properties.iconBadgeBorderColor ?? '#ffffff')}
                  onChange={(event) => update({}, { iconBadgeBorderColor: event.target.value })}
                />
              </label>
            </div>
            <div className="two-field">
              <label>
                Badge border width
                <input type="number" min="0" max="6" step="0.25"
                  value={Number(selected.properties.iconBadgeBorderWidth ?? 0)}
                  onChange={(event) => update({}, { iconBadgeBorderWidth: Number(event.target.value) })}
                />
              </label>
              <OpacityControl
                label="Badge opacity"
                value={Number(selected.properties.iconBadgeOpacity ?? 18)}
                onChange={(value) => update({}, { iconBadgeOpacity: value })}
              />
            </div>
          </>
        )}
        <OpacityControl
          label="Icon opacity"
          value={Number(selected.properties.iconOpacity ?? 100)}
          onChange={(value) => update({}, { iconOpacity: value })}
        />
        <div className="two-field">
          <label>
            <input type="checkbox"
              checked={Boolean(selected.properties.flipX)}
              onChange={(event) => update({}, { flipX: event.target.checked })}
            />{' '}Flip horizontally
          </label>
          <label>
            <input type="checkbox"
              checked={Boolean(selected.properties.flipY)}
              onChange={(event) => update({}, { flipY: event.target.checked })}
            />{' '}Flip vertically
          </label>
        </div>
        {(selectedIcon.startsWith('shape:') ||
          ((selected.properties.mappings as any[]) ?? []).some((mapping) =>
            String(mapping?.iconPath ?? '').startsWith('shape://')
          )) && (
          <>
            <OpacityControl
              label="Shape fill opacity"
              value={Number(selected.properties.iconFillOpacity ?? 100)}
              onChange={(value) => update({}, { iconFillOpacity: value })}
            />
            <div className="two-field">
              <label>
                Outline color
                <input
                  type="color"
                  value={String(
                    selected.properties.iconOutlineColor ??
                      selected.properties.iconColor ??
                      '#ffffff'
                  )}
                  onChange={(event) =>
                    update({}, { iconOutlineColor: event.target.value })
                  }
                />
              </label>
              <label>
                Outline width
                <input
                  type="number"
                  min="0"
                  max="40"
                  value={Number(selected.properties.iconOutlineWidth ?? 0)}
                  onChange={(event) =>
                    update(
                      {},
                      { iconOutlineWidth: Number(event.target.value) }
                    )
                  }
                />
              </label>
            </div>
          </>
        )}
        <div className="two-field">
          <label>
            Icon background
            <input
              type="color"
              value={String(
                selected.properties.iconBackgroundColor ?? '#000000'
              )}
              onChange={(event) =>
                update({}, { iconBackgroundColor: event.target.value })
              }
            />
          </label>
        </div>
        <OpacityControl
          label="Icon background opacity"
          value={Number(selected.properties.iconBackgroundOpacity ?? 0)}
          onChange={(value) => update({}, { iconBackgroundOpacity: value })}
        />
        <div className="two-field">
          <label>
            Background shape
            <select
              value={String(
                selected.properties.iconBackgroundShape ?? 'rounded'
              )}
              onChange={(event) =>
                update({}, { iconBackgroundShape: event.target.value })
              }
            >
              <option value="square">Square</option>
              <option value="rounded">Rounded</option>
              <option value="circle">Circle</option>
            </select>
          </label>
          <label>
            Background padding
            <input
              type="number"
              min="0"
              max="200"
              value={Number(selected.properties.iconBackgroundPadding ?? 12)}
              onChange={(event) =>
                update(
                  {},
                  { iconBackgroundPadding: Number(event.target.value) }
                )
              }
            />
          </label>
        </div>
        <div className="two-field">
          <label>
            Background border
            <input
              type="color"
              value={String(
                selected.properties.iconBackgroundBorderColor ?? '#ffffff'
              )}
              onChange={(event) =>
                update({}, { iconBackgroundBorderColor: event.target.value })
              }
            />
          </label>
          <label>
            Border width
            <input
              type="number"
              min="0"
              max="40"
              value={Number(selected.properties.iconBackgroundBorderWidth ?? 0)}
              onChange={(event) =>
                update(
                  {},
                  { iconBackgroundBorderWidth: Number(event.target.value) }
                )
              }
            />
          </label>
        </div>
        <p className="field-help">
          The background sits behind the SVG icon only. Its color, opacity,
          border, shape, and spacing do not change the live value text.
        </p>
      </div>
      <div className="nested-editor">
        <strong>Dynamic value text</strong>
        <label>
          <input
            type="checkbox"
            checked={selected.properties.showValue !== false}
            onChange={(event) =>
              update({}, { showValue: event.target.checked })
            }
          />{' '}
          Show the live value beneath the icon
        </label>
        <div className="two-field">
          <label>
            Text color
            <input
              type="color"
              value={String(selected.properties.valueColor ?? '#ffffff')}
              onChange={(event) =>
                update({}, { valueColor: event.target.value })
              }
            />
          </label>
          <label>
            Font size
            <input
              type="number"
              min="8"
              max="400"
              value={Number(selected.properties.valueFontSize ?? 42)}
              onChange={(event) =>
                update({}, { valueFontSize: Number(event.target.value) })
              }
            />
          </label>
        </div>
        <label>
          Font family
          <select
            value={String(selected.properties.valueFontFamily ?? 'Inter')}
            onChange={(event) =>
              update({}, { valueFontFamily: event.target.value })
            }
          >
            <option>Inter</option>
            <option>Arial</option>
            <option>Roboto</option>
            <option>Montserrat</option>
          </select>
        </label>
        <div className="two-field">
          <label>
            Weight
            <select
              value={String(selected.properties.valueFontWeight ?? 'bold')}
              onChange={(event) =>
                update({}, { valueFontWeight: event.target.value })
              }
            >
              <option>normal</option>
              <option>bold</option>
            </select>
          </label>
          <label>
            Style
            <select
              value={String(selected.properties.valueFontStyle ?? 'normal')}
              onChange={(event) =>
                update({}, { valueFontStyle: event.target.value })
              }
            >
              <option>normal</option>
              <option>italic</option>
            </select>
          </label>
        </div>
        <div className="two-field">
          <label>
            Alignment
            <select
              value={String(selected.properties.valueAlign ?? 'center')}
              onChange={(event) =>
                update({}, { valueAlign: event.target.value })
              }
            >
              <option>left</option>
              <option>center</option>
              <option>right</option>
            </select>
          </label>
          <label>
            Icon-to-text gap
            <input
              type="number"
              min="-200"
              max="500"
              value={Number(selected.properties.valueGap ?? 12)}
              onChange={(event) =>
                update({}, { valueGap: Number(event.target.value) })
              }
            />
          </label>
        </div>
        <OpacityControl
          label="Text opacity"
          value={Number(selected.properties.valueOpacity ?? 100)}
          onChange={(value) => update({}, { valueOpacity: value })}
        />
        <BackgroundAppearance
          title="Text background"
          prefix="valueBackground"
          selected={selected}
          update={update}
          defaultPadding={8}
        />
        <p className="field-help">
          Font size changes only the value text. Icon size remains unchanged;
          the text reflows beneath the icon using the configured gap.
        </p>
      </div>
      <div className="nested-editor">
        <BackgroundAppearance
          title="Whole icon and value background"
          prefix="groupBackground"
          selected={selected}
          update={update}
          defaultPadding={12}
        />
        <p className="field-help">
          This final plate sits behind the complete icon-and-value group.
        </p>
      </div>
      <details className="nested-editor">
        <summary>Advanced per-value icon mappings</summary>
        <EnhancedMappingEditor
          mappings={(selected.properties.mappings as any[]) ?? []}
          onChange={updateMappings}
          assets={assets}
        />
      </details>
    </>
  );
};

const TileCorners = ({
  selected,
  update,
}: {
  selected: OverlayLayer;
  update(input: Partial<OverlayLayer>, properties?: Record<string, any>): void;
}) => {
  const locked = Boolean(selected.properties.lockCorners);
  const topLeft = Number(selected.properties.borderRadiusTopLeft ?? 0);
  const setCorner = (key: string, value: number) =>
    update(
      {},
      locked
        ? {
            borderRadiusTopLeft: value,
            borderRadiusTopRight: value,
            borderRadiusBottomLeft: value,
            borderRadiusBottomRight: value,
          }
        : { [key]: value }
    );
  return (
    <div className="nested-editor">
      <label>
        <input
          type="checkbox"
          checked={locked}
          onChange={(e) =>
            update(
              {},
              {
                lockCorners: e.target.checked,
                ...(e.target.checked
                  ? {
                      borderRadiusTopRight: topLeft,
                      borderRadiusBottomLeft: topLeft,
                      borderRadiusBottomRight: topLeft,
                    }
                  : {}),
              }
            )
          }
        />{' '}
        Lock corners
      </label>
      <div className="geometry-grid">
        <label>
          Top left
          <input
            type="number"
            min="0"
            value={topLeft}
            onChange={(e) =>
              setCorner('borderRadiusTopLeft', Number(e.target.value))
            }
          />
        </label>
        <label>
          Top right
          <input
            type="number"
            min="0"
            disabled={locked}
            value={Number(selected.properties.borderRadiusTopRight ?? topLeft)}
            onChange={(e) =>
              setCorner('borderRadiusTopRight', Number(e.target.value))
            }
          />
        </label>
        <label>
          Bottom left
          <input
            type="number"
            min="0"
            disabled={locked}
            value={Number(
              selected.properties.borderRadiusBottomLeft ?? topLeft
            )}
            onChange={(e) =>
              setCorner('borderRadiusBottomLeft', Number(e.target.value))
            }
          />
        </label>
        <label>
          Bottom right
          <input
            type="number"
            min="0"
            disabled={locked}
            value={Number(
              selected.properties.borderRadiusBottomRight ?? topLeft
            )}
            onChange={(e) =>
              setCorner('borderRadiusBottomRight', Number(e.target.value))
            }
          />
        </label>
      </div>
    </div>
  );
};

const FillAndShape = ({
  selected,
  update,
}: {
  selected: OverlayLayer;
  update(input: Partial<OverlayLayer>, properties?: Record<string, any>): void;
}) => {
  const radius = Number(selected.properties.borderRadiusTopLeft ?? 0);
  const opacity = Number(selected.properties.fillOpacity ?? 0);
  const shape =
    Boolean(selected.properties.lockCorners) && radius === 0
      ? 'square'
      : Boolean(selected.properties.lockCorners) &&
          radius >= Math.min(selected.width, selected.height) / 2
        ? 'pill'
        : 'custom';
  const setShape = (value: string) => {
    if (value === 'square')
      update(
        {},
        {
          lockCorners: true,
          borderRadiusTopLeft: 0,
          borderRadiusTopRight: 0,
          borderRadiusBottomRight: 0,
          borderRadiusBottomLeft: 0,
        }
      );
    else if (value === 'pill') {
      const pill = Math.ceil(Math.min(selected.width, selected.height) / 2);
      update(
        {},
        {
          lockCorners: true,
          borderRadiusTopLeft: pill,
          borderRadiusTopRight: pill,
          borderRadiusBottomRight: pill,
          borderRadiusBottomLeft: pill,
        }
      );
    } else
      update(
        {},
        {
          lockCorners: true,
          borderRadiusTopLeft: 16,
          borderRadiusTopRight: 16,
          borderRadiusBottomRight: 16,
          borderRadiusBottomLeft: 16,
        }
      );
  };
  const setOpacity = (value: number) =>
    update({}, { fillOpacity: Math.min(100, Math.max(0, value)) });
  return (
    <div className="nested-editor">
      <strong>Background fill and shape</strong>
      <p className="field-help">
        The background is part of this layer and appears exactly this way after
        saving and on Plex.
      </p>
      <label>
        Fill color
        <input
          type="color"
          value={String(selected.properties.fillColor ?? '#000000')}
          onChange={(e) => update({}, { fillColor: e.target.value })}
        />
      </label>
      <div className="two-field">
        <label>
          Fill opacity
          <input
            aria-label="Fill opacity percent"
            type="number"
            min="0"
            max="100"
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
        </label>
        <label>
          Preview opacity <output>{opacity}%</output>
          <input
            type="range"
            min="0"
            max="100"
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
        </label>
      </div>
      <label>
        Shape
        <select value={shape} onChange={(e) => setShape(e.target.value)}>
          <option value="square">Square</option>
          <option value="pill">Pill</option>
          <option value="custom">Custom corners</option>
        </select>
      </label>
      <label>
        Border color
        <input
          type="color"
          value={String(selected.properties.borderColor ?? '#ffffff')}
          onChange={(e) => update({}, { borderColor: e.target.value })}
        />
      </label>
      <label>
        Border width
        <input
          type="number"
          min="0"
          value={Number(selected.properties.borderWidth ?? 0)}
          onChange={(e) => update({}, { borderWidth: Number(e.target.value) })}
        />
      </label>
      {shape === 'custom' && (
        <TileCorners selected={selected} update={update} />
      )}
    </div>
  );
};

const booleanFields = new Set([
  'hdr',
  'dolbyVision',
  'hasSubtitles',
  'isImdbTop250',
  'rtCertifiedFresh',
  'rtVerifiedHot',
  'isPlaceholder',
  'isMonitored',
  'inRadarr',
  'inSonarr',
  'downloaded',
  'showHdr',
  'showDolbyVision',
]);
const numericFields = new Set([
  'year',
  'runtime',
  'width',
  'height',
  'aspectRatio',
  'bitDepth',
  'dolbyVisionProfile',
  'audioChannels',
  'bitrate',
  'fileSize',
  'viewCount',
  'daysSinceAdded',
  'daysSinceLastPlayed',
  'imdbRating',
  'imdbVotes',
  'imdbRuntime',
  'imdbTop250Rank',
  'rtCriticsScore',
  'rtAudienceScore',
  'plexUserRating',
  'streamingProviderId',
  'daysUntilRelease',
  'daysAgo',
  'daysUntilNextEpisode',
  'daysUntilNextSeason',
  'daysAgoNextSeason',
  'totalSeasons',
  'seasonsAvailable',
  'seasonNumber',
  'episodeNumber',
  'daysUntilAction',
  'episodeCount',
  'episode4kCount',
  'episode4kPercent',
  'episodeHdrCount',
  'episodeHdrPercent',
  'episodeDvCount',
  'episodeDvPercent',
  'showDolbyVisionProfile',
  'showAudioChannels',
  'showBitDepth',
]);
const ConditionValueInput = ({
  field,
  value,
  collections,
  options,
  onChange,
}: {
  field: string;
  value: any;
  collections: { id: string; title: string; libraryName: string }[];
  options: readonly string[];
  onChange(value: string | number | boolean): void;
}) => {
  if (booleanFields.has(field))
    return (
      <select
        aria-label={`${field} value`}
        value={String(value)}
        onChange={(e) => onChange(e.target.value === 'true')}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  if (field === 'mediaType')
    return (
      <select
        aria-label="Media type value"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="movie">Movie</option>
        <option value="show">TV show</option>
      </select>
    );
  if (field === 'collection')
    return (
      <select
        aria-label="Collection value"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select collection…</option>
        {collections.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title} — {item.libraryName}
          </option>
        ))}
      </select>
    );
  if (field === 'resolution')
    return (
      <select
        aria-label="Resolution value"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="4K">4K</option>
        <option value="1080p">1080p</option>
        <option value="720p">720p</option>
        <option value="SD">SD</option>
      </select>
    );
  const listId = options.length ? `condition-values-${field}` : undefined;
  return (
    <><input
      aria-label={`${field} value`}
      type={numericFields.has(field) ? 'number' : 'text'}
      value={String(value ?? '')}
      list={listId}
      placeholder={
        ['radarrTags', 'sonarrTags'].includes(field)
          ? 'Select or enter tag…'
          : field === 'plexLabels'
            ? 'Select or enter Plex label…'
            : 'Enter value'
      }
      onChange={(e) =>
        onChange(
          numericFields.has(field) ? Number(e.target.value) : e.target.value
        )
      }
    />{listId && <datalist id={listId}>{options.map((option) => <option key={option} value={option} />)}</datalist>}</>
  );
};
