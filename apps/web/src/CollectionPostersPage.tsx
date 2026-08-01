import {
  dynamicValueIcons,
  type CollectionPosterDesign,
  type CollectionPosterLayer,
  type CollectionPosterTemplate,
  type SavedCollectionPoster,
} from '@vynode/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { createClientId } from './clientId';
import { InteractivePosterLayer } from './InteractivePosterLayer';
import {
  posterPreviewSamples,
  type PosterPreviewMediaType,
} from './posterPreviewSamples';

const blankDesign = (): CollectionPosterDesign => ({
  width: 1000,
  height: 1500,
  background: {
    type: 'radial',
    color: '#f3ad32',
    secondaryColor: '#17262d',
    intensity: 50,
    useSourceColors: false,
  },
  elements: [],
  migrated: true,
});

const PosterPreview = ({
  design,
  title,
  selectedLayerId,
  snap = true,
  zoom = 100,
  mediaType = 'movie',
  onSelectLayer,
  onCommitLayer,
}: {
  design: CollectionPosterDesign;
  title: string;
  selectedLayerId?: string;
  snap?: boolean;
  zoom?: number;
  mediaType?: PosterPreviewMediaType;
  onSelectLayer?(id: string): void;
  onCommitLayer?(
    id: string,
    geometry: Pick<CollectionPosterLayer, 'x' | 'y' | 'width' | 'height'>
  ): void;
}) => {
  const background =
    design.background.type === 'color'
      ? design.background.color
      : design.background.type === 'gradient'
        ? `linear-gradient(${design.background.color},${design.background.secondaryColor})`
        : `radial-gradient(circle at 55% 35%,${design.background.color},${design.background.secondaryColor} 70%)`;
  return (
    <div
      className={`collection-poster-preview ${onSelectLayer ? 'poster-interaction-canvas' : ''}`}
      style={{ background, containerType: 'inline-size', zoom: `${zoom}%` }}
      aria-label={`${title} poster preview`}
    >
      <span>
        {design.background.useSourceColors ? 'Source colors' : 'Vynode'}
      </span>
      {[...design.elements]
        .filter((item) => item.properties.hidden !== true)
        .sort((left, right) => left.layerOrder - right.layerOrder)
        .map((item) => {
          const style = {
            left: `${item.x / 10}%`,
            top: `${item.y / 15}%`,
            width: `${item.width / 10}%`,
            height: `${item.height / 15}%`,
            transform: `rotate(${item.rotation}deg)`,
          };
          if (item.type === 'content-grid') {
            const columns = Math.max(
              1,
              Math.min(8, Number(item.properties.columns ?? 3))
            );
            const rows = Math.max(
              1,
              Math.min(8, Number(item.properties.rows ?? 2))
            );
            return (
              <div
                className="mini-grid preview-layer"
                key={item.id}
                style={{
                  ...style,
                  gridTemplateColumns: `repeat(${columns}, 1fr)`,
                  gap: `${Math.min(8, Number(item.properties.spacing ?? 24) / 8)}px`,
                  padding: `${Math.min(20, Number(item.properties.padding ?? 0) / 6)}px`,
                }}
              >
                {Array.from({ length: Math.min(64, columns * rows) }).map(
                  (_, index) => (
                    <i
                      key={index}
                      style={{
                        borderRadius: `${Math.min(20, Number(item.properties.cornerRadius ?? 20) / 4)}px`,
                        backgroundImage: `url("${posterPreviewSamples[mediaType][index % posterPreviewSamples[mediaType].length]!.imageUrl}")`,
                      }}
                      aria-label={`${posterPreviewSamples[mediaType][index % posterPreviewSamples[mediaType].length]!.title} example poster`}
                    >{item.properties.showItemText === true ? <b style={{ color: String(item.properties.itemTextColor ?? '#ffffff'), fontSize: `${Math.max(6, Number(item.properties.itemTextSize ?? 28) / 6)}px` }}>#{index + 1}</b> : null}</i>
                  )
                )}
              </div>
            );
          }
          if (item.type === 'text') {
            const text =
              item.properties.elementType === 'collection-title'
                ? title
                : String(item.properties.text ?? item.name);
            return (
              <strong
                className="preview-layer preview-text"
                key={item.id}
                style={{
                  ...style,
                  color: String(item.properties.color ?? '#ffffff'),
                  fontFamily: String(item.properties.fontFamily ?? 'Inter'),
                  fontWeight: String(item.properties.fontWeight ?? 'bold') as React.CSSProperties['fontWeight'],
                  fontStyle: String(item.properties.fontStyle ?? 'normal') as React.CSSProperties['fontStyle'],
                  opacity: Number(item.properties.opacity ?? 100) / 100,
                  WebkitTextStrokeColor: String(item.properties.textStrokeColor ?? '#000000'),
                  WebkitTextStrokeWidth: `${Number(item.properties.textStrokeWidth ?? 0) / 10}px`,
                  textShadow: Number(item.properties.textShadowOpacity ?? 0) > 0
                    ? `${Number(item.properties.textShadowOffsetX ?? 0) / 10}px ${Number(item.properties.textShadowOffsetY ?? 0) / 10}px ${Number(item.properties.textShadowBlur ?? 0) / 10}px color-mix(in srgb, ${String(item.properties.textShadowColor ?? '#000000')} ${Number(item.properties.textShadowOpacity ?? 0)}%, transparent)`
                    : undefined,
                  fontSize: `${Math.max(8, Number(item.properties.fontSize ?? 72)) / 10}px`,
                  textAlign: String(item.properties.textAlign ?? 'left') as
                    | 'left'
                    | 'center'
                    | 'right',
                }}
              >
                {text}
              </strong>
            );
          }
          const assetPath = String(
            item.properties.imagePath ?? item.properties.iconPath ?? ''
          );
          if (item.type === 'svg' && item.properties.systemIcon) {
            const icon = dynamicValueIcons.find((entry) => entry.id === String(item.properties.systemIcon));
            if (icon) return <svg className="preview-layer preview-image svg" key={item.id} viewBox="0 0 24 24" style={{ ...style, opacity: Number(item.properties.opacity ?? 100) / 100 }} aria-label={`${icon.label} icon`}><path d={icon.path} fill={String(item.properties.iconFillColor ?? 'none')} stroke={String(item.properties.iconColor ?? '#ffffff')} strokeWidth={Number(item.properties.iconStrokeWidth ?? 2)} strokeLinecap="round" strokeLinejoin="round" /></svg>;
          }
          if (assetPath) {
            return (
              <img
                className={`preview-layer preview-image ${item.type}`}
                key={item.id}
                src={assetPath}
                alt=""
                style={{ ...style, opacity: Number(item.properties.opacity ?? 100) / 100, objectFit: String(item.properties.fit ?? (item.type === 'raster' ? 'cover' : 'contain')) as React.CSSProperties['objectFit'] }}
              />
            );
          }
          return (
            <b
              className={`preview-layer preview-asset ${item.type}`}
              key={item.id}
              style={style}
            >
              {item.type === 'raster'
                ? 'Image'
                : item.type === 'svg'
                  ? 'Icon'
                  : 'Person'}
            </b>
          );
        })}
      {onSelectLayer &&
        onCommitLayer &&
        [...design.elements]
          .filter((layer) => layer.properties.hidden !== true && layer.properties.locked !== true)
          .sort((left, right) => left.layerOrder - right.layerOrder)
          .map((layer) => (
            <InteractivePosterLayer
              key={`interactive-${layer.id}`}
              layer={layer}
              canvasWidth={design.width}
              canvasHeight={design.height}
              selected={selectedLayerId === layer.id}
              snap={snap}
              className={`collection-layer ${layer.type}`}
              onSelect={() => onSelectLayer(layer.id)}
              onCommit={(geometry) => onCommitLayer(layer.id, geometry)}
            >
              <span className="collection-layer-drag-label">
                {layer.name}
              </span>
            </InteractivePosterLayer>
          ))}
      <small>
        {design.elements.length}{' '}
        {design.elements.length === 1 ? 'layer' : 'layers'}
      </small>
    </div>
  );
};

export const CollectionPostersPage = () => {
  const [workspace, setWorkspace] =
    useState<Awaited<ReturnType<typeof api.collectionPosters>>>();
  const [tab, setTab] = useState<'templates' | 'saved'>(() =>
    new URLSearchParams(location.search).get('tab') === 'saved'
      ? 'saved'
      : 'templates'
  );
  const [message, setMessage] = useState('Loading collection posters…');
  const [editor, setEditor] = useState<{
    kind: 'template' | 'poster';
    id?: string;
    name: string;
    description: string;
    design: CollectionPosterDesign;
  }>();
  const [selectedLayerId, setSelectedLayerId] = useState<string>();
  const [selectedPosters, setSelectedPosters] = useState<string[]>([]);
  const [deleteTemplate, setDeleteTemplate] =
    useState<CollectionPosterTemplate>();
  const [blockedPosters, setBlockedPosters] = useState<
    readonly SavedCollectionPoster[]
  >([]);
  const [busy, setBusy] = useState('');
  const [pendingAssetLayer, setPendingAssetLayer] = useState<
    'raster' | 'svg'
  >();
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [editorZoom, setEditorZoom] = useState(100);
  const [collectionIconSearch, setCollectionIconSearch] = useState('');
  const [editorPreviewMediaType, setEditorPreviewMediaType] =
    useState<PosterPreviewMediaType>('movie');
  const [undoStack, setUndoStack] = useState<CollectionPosterDesign[]>([]);
  const [redoStack, setRedoStack] = useState<CollectionPosterDesign[]>([]);
  const [metadataUndoStack, setMetadataUndoStack] = useState<Array<{ name: string; description: string }>>([]);
  const [metadataRedoStack, setMetadataRedoStack] = useState<Array<{ name: string; description: string }>>([]);
  const [editorBaseline, setEditorBaseline] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const loadGeneration = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);
  const sourceColorsInput = useRef<HTMLInputElement>(null);
  const assetInput = useRef<HTMLInputElement>(null);
  const editorCloseButton = useRef<HTMLButtonElement>(null);
  const load = async () => {
    const generation = ++loadGeneration.current;
    try {
      const next = await api.collectionPosters();
      if (generation !== loadGeneration.current) return;
      setWorkspace(next);
      setSelectedPosters((selected) =>
        selected.filter((id) =>
          next.savedPosters.some((item) => item.id === id)
        )
      );
      setMessage('');
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load collection posters.'
      );
    }
  };
  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, []);
  useEffect(() => {
    if (!editor) return;
    editorCloseButton.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmDiscard) {
        setConfirmDiscard(false);
        return;
      }
      if (JSON.stringify(editor) !== editorBaseline) {
        setConfirmDiscard(true);
        return;
      }
      setEditor(undefined);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [editor, editorBaseline, confirmDiscard]);
  useEffect(() => {
    if (!deleteTemplate && blockedPosters.length === 0) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      setDeleteTemplate(undefined);
      setBlockedPosters([]);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [deleteTemplate, blockedPosters.length, busy]);
  const changeTab = (next: 'templates' | 'saved') => {
    setTab(next);
    const url = new URL(location.href);
    url.searchParams.set('tab', next);
    history.replaceState({}, '', url);
  };
  const selectedLayer = useMemo(
    () => editor?.design.elements.find((item) => item.id === selectedLayerId),
    [editor, selectedLayerId]
  );
  if (!workspace)
    return (
      <section className="main-panel">
        <p className="source-feedback">{message}</p>
      </section>
    );
  const openEditor = (
    kind: 'template' | 'poster',
    item?: CollectionPosterTemplate | SavedCollectionPoster
  ) => {
    const nextEditor: NonNullable<typeof editor> = {
      kind,
      id: item?.id,
      name: item ? item.name : '',
      description: item ? item.description : '',
      design: item ? structuredClone(item.design) : blankDesign(),
    };
    setEditor(nextEditor);
    setEditorBaseline(JSON.stringify(nextEditor));
    setConfirmDiscard(false);
    setSelectedLayerId(item?.design.elements[0]?.id);
    setUndoStack([]);
    setRedoStack([]);
    setMetadataUndoStack([]);
    setMetadataRedoStack([]);
  };
  const updateMetadata = (input: Partial<Pick<NonNullable<typeof editor>, 'name' | 'description'>>) => {
    if (!editor) return;
    setMetadataUndoStack((stack) => [...stack.slice(-49), { name: editor.name, description: editor.description }]);
    setMetadataRedoStack([]);
    setEditor({ ...editor, ...input });
  };
  const undoMetadata = () => {
    const previous = metadataUndoStack.at(-1);
    if (!previous || !editor) return;
    setMetadataUndoStack((stack) => stack.slice(0, -1));
    setMetadataRedoStack((stack) => [...stack.slice(-49), { name: editor.name, description: editor.description }]);
    setEditor({ ...editor, ...previous });
  };
  const redoMetadata = () => {
    const next = metadataRedoStack.at(-1);
    if (!next || !editor) return;
    setMetadataRedoStack((stack) => stack.slice(0, -1));
    setMetadataUndoStack((stack) => [...stack.slice(-49), { name: editor.name, description: editor.description }]);
    setEditor({ ...editor, ...next });
  };
  const requestEditorClose = () => {
    if (!editor) return;
    if (JSON.stringify(editor) !== editorBaseline) {
      setConfirmDiscard(true);
      return;
    }
    setEditor(undefined);
  };
  const updateDesign = (
    updater: (design: CollectionPosterDesign) => CollectionPosterDesign
  ) =>
    setEditor((current) => {
      if (!current) return current;
      const next = updater(current.design);
      if (next === current.design) return current;
      setUndoStack((stack) => [
        ...stack.slice(-49),
        structuredClone(current.design),
      ]);
      setRedoStack([]);
      return { ...current, design: next };
    });
  const undoDesign = () => {
    const previous = undoStack.at(-1);
    if (!previous || !editor) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [
      ...stack.slice(-49),
      structuredClone(editor.design),
    ]);
    setEditor({ ...editor, design: previous });
    if (!previous.elements.some((item) => item.id === selectedLayerId))
      setSelectedLayerId(previous.elements[0]?.id);
  };
  const redoDesign = () => {
    const next = redoStack.at(-1);
    if (!next || !editor) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [
      ...stack.slice(-49),
      structuredClone(editor.design),
    ]);
    setEditor({ ...editor, design: next });
    if (!next.elements.some((item) => item.id === selectedLayerId))
      setSelectedLayerId(next.elements[0]?.id);
  };
  const updateLayer = (
    input: Partial<CollectionPosterLayer>,
    properties?: Record<string, string | number | boolean | undefined>
  ) =>
    updateDesign((design) => ({
      ...design,
      elements: design.elements.map((item) =>
        item.id === selectedLayerId
          ? {
              ...item,
              ...input,
              properties: properties
                ? { ...item.properties, ...properties }
                : item.properties,
            }
          : item
      ),
    }));
  const updateGeometry = (
    key: 'x' | 'y' | 'width' | 'height' | 'rotation',
    value: number
  ) =>
    updateLayer({
      [key]: snapEnabled ? Math.round(value / 10) * 10 : value,
    } as Partial<CollectionPosterLayer>);
  const selectAsset = (assetId: string) => {
    const asset = workspace.assets.find((item) => item.id === assetId);
    if (!asset || !selectedLayer) return;
    const path = `/api/posters/collections/assets/${encodeURIComponent(asset.id)}`;
    updateLayer(
      {},
      selectedLayer.type === 'svg'
        ? { assetId: asset.id, iconPath: path }
        : { assetId: asset.id, imagePath: path }
    );
  };
  const uploadAsset = async (file?: File) => {
    const targetType =
      pendingAssetLayer ??
      (selectedLayer?.type === 'raster' || selectedLayer?.type === 'svg'
        ? selectedLayer.type
        : undefined);
    if (!file || !targetType) return;
    const allowed =
      targetType === 'svg'
        ? ['image/svg+xml']
        : ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setMessage(
        targetType === 'svg'
          ? 'Choose an SVG file for an icon layer.'
          : 'Choose a JPEG, PNG, or WebP file for an image layer.'
      );
      if (assetInput.current) assetInput.current.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMessage('Poster assets must be 10 MB or smaller.');
      if (assetInput.current) assetInput.current.value = '';
      return;
    }
    setBusy('Uploading poster asset');
    try {
      const result = await api.uploadCollectionPosterAsset(file);
      setWorkspace(result.workspace);
      const path = `/api/posters/collections/assets/${encodeURIComponent(result.asset.id)}`;
      if (pendingAssetLayer) {
        addLayer(targetType, {
          id: result.asset.id,
          name: result.asset.name,
          path,
        });
        setMessage(`${result.asset.name} uploaded and added.`);
      } else {
        updateLayer(
          { name: result.asset.name },
          targetType === 'svg'
            ? { assetId: result.asset.id, iconPath: path }
            : { assetId: result.asset.id, imagePath: path }
        );
        setMessage(`${result.asset.name} uploaded and selected.`);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to upload the asset.'
      );
    } finally {
      setBusy('');
      setPendingAssetLayer(undefined);
      if (assetInput.current) assetInput.current.value = '';
    }
  };
  const addLayer = (
    type: CollectionPosterLayer['type'],
    asset?: { id: string; name: string; path: string }
  ) => {
    const id = `${type}-${createClientId().slice(0, 7)}`;
    const properties =
      type === 'text'
        ? {
            elementType: 'custom-text',
            text: 'New text',
            fontSize: 72,
            fontFamily: 'Inter',
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#ffffff',
            textAlign: 'center',
            maxLines: 2,
            textTransform: 'none',
          }
        : type === 'content-grid'
          ? { columns: 3, rows: 2, spacing: 24, cornerRadius: 20 }
          : type === 'svg'
            ? {
                assetId: asset?.id,
                iconType: 'svg-icon',
                iconPath: asset?.path ?? '',
                grayscale: false,
              }
            : type === 'person'
              ? { imagePath: '', overlayColor: '#000000', overlayOpacity: 0.2 }
              : { assetId: asset?.id, imagePath: asset?.path ?? '' };
    const layer: CollectionPosterLayer = {
      id,
      layerOrder: editor?.design.elements.length ?? 0,
      type,
      x: 100,
      y: 220,
      width: type === 'text' ? 800 : 500,
      height: type === 'text' ? 180 : 500,
      rotation: 0,
      name:
        type === 'content-grid'
          ? 'Content grid'
          : type === 'svg'
            ? asset?.name ?? 'Icon'
            : type === 'person'
              ? 'Person'
              : type === 'raster'
                ? asset?.name ?? 'Image'
                : 'Text',
      properties,
    };
    updateDesign((design) => ({
      ...design,
      elements: [...design.elements, layer],
    }));
    setSelectedLayerId(id);
  };
  const moveSelectedLayer = (direction: -1 | 1) => {
    if (!selectedLayerId) return;
    updateDesign((design) => {
      const ordered = [...design.elements].sort(
        (left, right) => left.layerOrder - right.layerOrder
      );
      const index = ordered.findIndex((item) => item.id === selectedLayerId);
      const neighbor = ordered[index + direction];
      const selected = ordered[index];
      if (!neighbor || !selected) return design;
      return {
        ...design,
        elements: design.elements.map((item) =>
          item.id === selected.id
            ? { ...item, layerOrder: neighbor.layerOrder }
            : item.id === neighbor.id
              ? { ...item, layerOrder: selected.layerOrder }
              : item
        ),
      };
    });
  };
  const duplicateSelectedLayer = () => {
    if (!selectedLayer || !editor) return;
    const id = `${selectedLayer.type}-${createClientId().slice(0, 7)}`;
    const duplicate: CollectionPosterLayer = {
      ...structuredClone(selectedLayer),
      id,
      name: `${selectedLayer.name} copy`,
      layerOrder: editor.design.elements.length,
      x: Math.min(
        editor.design.width - selectedLayer.width,
        selectedLayer.x + 20
      ),
      y: Math.min(
        editor.design.height - selectedLayer.height,
        selectedLayer.y + 20
      ),
    };
    updateDesign((design) => ({
      ...design,
      elements: [...design.elements, duplicate],
    }));
    setSelectedLayerId(id);
  };
  const saveEditor = async () => {
    if (!editor?.name.trim()) {
      setMessage('Enter a name before saving.');
      return;
    }
    setBusy('Saving poster design');
    setMessage('Saving poster design…');
    try {
      const result =
        editor.kind === 'template'
          ? await api.saveCollectionPosterTemplate(editor.id, {
              name: editor.name.trim(),
              description: editor.description.trim(),
              design: editor.design,
            })
          : await api.saveCollectionPoster(editor.id, {
              name: editor.name.trim(),
              description: editor.description.trim(),
              design: editor.design,
            });
      setWorkspace(result);
      setEditor(undefined);
      setMessage('Poster design saved.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to save poster design.'
      );
    } finally {
      setBusy('');
    }
  };
  const runWorkspaceAction = async (
    label: string,
    action: () => Promise<Awaited<ReturnType<typeof api.collectionPosters>>>,
    success: string
  ) => {
    setBusy(label);
    setMessage(`${label}…`);
    try {
      setWorkspace(await action());
      setMessage(success);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : `Unable to ${label.toLowerCase()}.`
      );
    } finally {
      setBusy('');
    }
  };
  const downloadJson = (fileName: string, value: unknown) => {
    const blob = new Blob([JSON.stringify(value, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };
  const exportTemplate = (template: CollectionPosterTemplate) => {
    downloadJson(
      `${template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'collection-poster'}.json`,
      {
        schema: 'vynode.collection-poster-template',
        version: 1,
        template: {
          name: template.name,
          description: template.description,
          design: template.design,
        },
      }
    );
    setMessage(`${template.name} exported.`);
  };
  const importTemplate = async (file?: File) => {
    if (!file) return;
    const isZip = file.name.toLowerCase().endsWith('.zip');
    if (
      (!isZip && file.size > 2 * 1024 * 1024) ||
      (isZip && file.size > 50 * 1024 * 1024) ||
      (!isZip && !file.name.toLowerCase().endsWith('.json'))
    ) {
      setMessage(
        'Choose a Vynode JSON file up to 2 MB or an Agregarr ZIP up to 50 MB.'
      );
      return;
    }
    setBusy('Importing template');
    setMessage('Validating template import…');
    try {
      if (isZip) {
        const result =
          await api.importAgregarrCollectionPosterTemplate(file);
        setWorkspace(result.workspace);
        setMessage(
          `${result.name} imported from Agregarr with ${result.importedLayers} ${result.importedLayers === 1 ? 'layer' : 'layers'} and ${result.importedAssets} ${result.importedAssets === 1 ? 'asset' : 'assets'}.${result.renamed ? ' The name was changed to avoid overwriting an existing template.' : ''}${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`
        );
        return;
      }
      const parsed = JSON.parse(await file.text()) as {
        schema?: string;
        version?: number;
        template?: {
          name: string;
          description: string;
          design: CollectionPosterDesign;
        };
      };
      if (
        parsed.schema !== 'vynode.collection-poster-template' ||
        parsed.version !== 1 ||
        !parsed.template
      )
        throw new Error(
          'This is not a supported Vynode collection-poster template.'
        );
      setWorkspace(
        await api.saveCollectionPosterTemplate(undefined, parsed.template)
      );
      setMessage(`${parsed.template.name} imported.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to import the template.'
      );
    } finally {
      setBusy('');
      if (importInput.current) importInput.current.value = '';
    }
  };
  const importSourceColors = async (file?: File) => {
    if (!file) return;
    if (file.size > 512 * 1024) {
      setMessage('Source-colors JSON files must be 512 KB or smaller.');
      if (sourceColorsInput.current) sourceColorsInput.current.value = '';
      return;
    }
    setBusy('Importing source colors');
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const result = await api.importCollectionPosterSourceColors(parsed);
      setWorkspace(result.workspace);
      setMessage(
        `${result.importCount} source color ${result.importCount === 1 ? 'scheme' : 'schemes'} imported. Existing matching sources were updated.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to import source colors.'
      );
    } finally {
      setBusy('');
      if (sourceColorsInput.current) sourceColorsInput.current.value = '';
    }
  };
  const deleteSaved = async (ids: readonly string[], force = false) => {
    setBusy('Deleting saved posters');
    try {
      const result = await api.deleteCollectionPosters(ids, force);
      setWorkspace(result.workspace);
      setSelectedPosters([]);
      setBlockedPosters([]);
      setMessage(
        `${ids.length} saved ${ids.length === 1 ? 'poster' : 'posters'} deleted.`
      );
    } catch (error) {
      const responseMessage =
        error instanceof Error
          ? error.message
          : 'Some posters are still in use.';
      const blockers = workspace.savedPosters.filter(
        (item) => ids.includes(item.id) && item.usedBy.length
      );
      setBlockedPosters(blockers);
      setMessage(
        blockers.length
          ? `${blockers.length} saved ${blockers.length === 1 ? 'poster is' : 'posters are'} still assigned. Review the affected collections before deleting.`
          : responseMessage
      );
    } finally {
      setBusy('');
    }
  };
  const confirmDeleteTemplate = async () => {
    if (!deleteTemplate) return;
    const deleting = deleteTemplate;
    setBusy('Deleting template');
    setMessage(`Deleting ${deleting.name}…`);
    try {
      setWorkspace(await api.deleteCollectionPosterTemplate(deleting.id));
      setDeleteTemplate(undefined);
      setMessage(`${deleting.name} deleted.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to delete the template.'
      );
    } finally {
      setBusy('');
    }
  };
  const exportSourceColors = () => {
    downloadJson('source_colors.json', {
      schema: 'vynode.source-colors',
      version: 1,
      exportedAt: new Date().toISOString(),
      sourceColors: workspace.sourceColors,
    });
    setMessage('Source colors exported.');
  };
  return (
    <div className="collection-posters-page">
      <section className="poster-toolbar">
        <div
          className="segmented"
          role="tablist"
          aria-label="Collection poster views"
        >
          <button
            id="collection-template-tab"
            type="button"
            role="tab"
            aria-selected={tab === 'templates'}
            aria-controls="collection-template-panel"
            tabIndex={tab === 'templates' ? 0 : -1}
            className={tab === 'templates' ? 'active' : ''}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'End') {
                event.preventDefault();
                changeTab('saved');
                document.getElementById('saved-poster-tab')?.focus();
              }
            }}
            onClick={() => changeTab('templates')}
          >
            Collection templates
          </button>
          <button
            id="saved-poster-tab"
            type="button"
            role="tab"
            aria-selected={tab === 'saved'}
            aria-controls="saved-poster-panel"
            tabIndex={tab === 'saved' ? 0 : -1}
            className={tab === 'saved' ? 'active' : ''}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'Home') {
                event.preventDefault();
                changeTab('templates');
                document.getElementById('collection-template-tab')?.focus();
              }
            }}
            onClick={() => changeTab('saved')}
          >
            Saved posters <span>{workspace.savedPosters.length}</span>
          </button>
        </div>
        <div className="toolbar-actions">
          {tab === 'templates' ? (
            <>
              <button
                className="button secondary"
                type="button"
                onClick={exportSourceColors}
              >
                Export source colors
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={!!busy}
                onClick={() => sourceColorsInput.current?.click()}
              >
                Import source colors
              </button>
              <input
                ref={sourceColorsInput}
                hidden
                type="file"
                accept="application/json,.json"
                onChange={(event) =>
                  void importSourceColors(event.target.files?.[0])
                }
              />
              <button
                className="button secondary"
                type="button"
                disabled={!!busy}
                onClick={() => importInput.current?.click()}
              >
                Import template
              </button>
          <input
            ref={importInput}
            hidden
            type="file"
            accept="application/json,application/zip,.json,.zip"
            onChange={(event) =>
                  void importTemplate(event.target.files?.[0])
                }
              />
              <button
                className="button primary"
                type="button"
                disabled={!!busy}
                onClick={() => openEditor('template')}
              >
                Create template
              </button>
            </>
          ) : (
            <button
              className="button primary"
              type="button"
              disabled={!!busy}
              onClick={() => openEditor('poster')}
            >
              Create saved poster
            </button>
          )}
        </div>
      </section>
      <p className="field-help">
        {tab === 'templates'
          ? 'Design reusable poster templates for your collections.'
          : 'View and manage generated, uploaded, and saved collection posters.'}
      </p>
      {message && (
        <p className="source-feedback" role="status">
          {message}
        </p>
      )}
      {tab === 'templates' ? (
        <div
          className="collection-template-grid"
          id="collection-template-panel"
          role="tabpanel"
          aria-labelledby="collection-template-tab"
        >
          {workspace.templates.length === 0 && (
            <p className="empty-state">
              No collection poster templates exist yet. Create or import one to
              begin.
            </p>
          )}
          {workspace.templates.map((template) => (
            <article key={template.id}>
              <PosterPreview design={template.design} title={template.name} />
              <div>
                <div className="card-title-row">
                  <h3>{template.name}</h3>
                  {template.isDefault && (
                    <span className="enabled-pill">Default</span>
                  )}
                </div>
                <p>{template.description || 'No description provided.'}</p>
                <small>
                  Last updated {new Date(template.updatedAt).toLocaleString()}
                </small>
              </div>
              <footer>
                <button
                  type="button"
                  disabled={!!busy}
                  aria-label={`Edit ${template.name}`}
                  onClick={() => openEditor('template', template)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  aria-label={`Duplicate ${template.name}`}
                  onClick={() =>
                    void runWorkspaceAction(
                      'Duplicating template',
                      () => api.duplicateCollectionPosterTemplate(template.id),
                      `${template.name} duplicated.`
                    )
                  }
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  aria-label={`Export ${template.name}`}
                  onClick={() => exportTemplate(template)}
                >
                  Export JSON
                </button>
                {!template.isDefault && (
                  <button
                    type="button"
                    disabled={!!busy}
                    aria-label={`Set ${template.name} as default`}
                    onClick={() =>
                      void runWorkspaceAction(
                        'Changing default template',
                        () =>
                          api.setDefaultCollectionPosterTemplate(template.id),
                        `${template.name} is now the default template.`
                      )
                    }
                  >
                    Set default
                  </button>
                )}
                <button
                  type="button"
                  className="danger-text"
                  disabled={template.isDefault || !!busy}
                  title={
                    template.isDefault
                      ? 'Choose another default template before deleting this one.'
                      : undefined
                  }
                  aria-label={`Delete ${template.name}`}
                  onClick={() => setDeleteTemplate(template)}
                >
                  Delete
                </button>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div
          id="saved-poster-panel"
          role="tabpanel"
          aria-labelledby="saved-poster-tab"
        >
          <div className="bulk-poster-toolbar">
            <button
              className="text-button"
              type="button"
              disabled={!workspace.savedPosters.length || !!busy}
              onClick={() =>
                setSelectedPosters(
                  workspace.savedPosters.map((item) => item.id)
                )
              }
            >
              Select all
            </button>
            <button
              className="text-button"
              type="button"
              disabled={!selectedPosters.length || !!busy}
              onClick={() => setSelectedPosters([])}
            >
              Deselect all
            </button>
            <span aria-live="polite">{selectedPosters.length} selected</span>
            <button
              className="button danger"
              type="button"
              disabled={!selectedPosters.length || !!busy}
              onClick={() => void deleteSaved(selectedPosters)}
            >
              Delete selected
            </button>
          </div>
          <div className="saved-poster-grid">
            {workspace.savedPosters.length === 0 && (
              <p className="empty-state">
                No saved posters exist yet. Create one or generate artwork from
                a collection.
              </p>
            )}
            {workspace.savedPosters.map((poster) => (
              <article key={poster.id}>
                <label>
                  <input
                    type="checkbox"
                    disabled={!!busy}
                    checked={selectedPosters.includes(poster.id)}
                    onChange={() =>
                      setSelectedPosters((ids) =>
                        ids.includes(poster.id)
                          ? ids.filter((id) => id !== poster.id)
                          : [...ids, poster.id]
                      )
                    }
                  />
                  <span className="sr-only">Select {poster.name}</span>
                </label>
                <PosterPreview design={poster.design} title={poster.name} />
                {!poster.isEditable && (
                  <span className="file-source-pill">File source</span>
                )}
                <h3 title={poster.name}>{poster.name}</h3>
                <footer>
                  {poster.isEditable && (
                    <>
                      <button
                        type="button"
                        disabled={!!busy}
                        aria-label={`Edit ${poster.name}`}
                        onClick={() => openEditor('poster', poster)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        aria-label={`Duplicate ${poster.name}`}
                        onClick={() =>
                          void runWorkspaceAction(
                            'Duplicating saved poster',
                            () => api.duplicateCollectionPoster(poster.id),
                            `${poster.name} duplicated.`
                          )
                        }
                      >
                        Duplicate
                      </button>
                    </>
                  )}
                  <a
                    className="text-button"
                    href={`/api/posters/collections/saved/${encodeURIComponent(poster.id)}/download`}
                    download
                  >
                    Download
                  </a>
                  <button
                    type="button"
                    className="danger-text"
                    disabled={!!busy}
                    aria-label={`Delete ${poster.name}`}
                    onClick={() => void deleteSaved([poster.id])}
                  >
                    Delete
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </div>
      )}
      {deleteTemplate && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy)
              setDeleteTemplate(undefined);
          }}
        >
          <section
            className="poster-modal reset-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-template-title"
            aria-describedby="delete-template-description"
          >
            <h2 id="delete-template-title">Delete template?</h2>
            <p id="delete-template-description">
              “{deleteTemplate.name}” will be permanently removed. Existing
              saved posters are not deleted, and collections using it will fall
              back to the default template.
            </p>
            <footer className="modal-actions">
              <button
                className="button secondary"
                type="button"
                disabled={!!busy}
                onClick={() => setDeleteTemplate(undefined)}
              >
                Cancel
              </button>
              <button
                className="button danger"
                type="button"
                disabled={!!busy}
                onClick={() => void confirmDeleteTemplate()}
              >
                {busy ? 'Deleting…' : 'Delete template'}
              </button>
            </footer>
          </section>
        </div>
      )}
      {blockedPosters.length > 0 && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy)
              setBlockedPosters([]);
          }}
        >
          <section
            className="poster-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="used-posters-title"
            aria-describedby="used-posters-description"
          >
            <h2 id="used-posters-title">
              {blockedPosters.length === 1
                ? 'Poster is in use'
                : 'Posters are in use'}
            </h2>
            <p id="used-posters-description">
              Deleting these posters removes their assignments from the
              collections listed below and marks those collections for
              synchronization.
            </p>
            {blockedPosters.map((poster) => (
              <div className="usage-block" key={poster.id}>
                <strong>{poster.name}</strong>
                {poster.usedBy.map((usage) => (
                  <span key={usage.id}>
                    {usage.name} · {usage.libraryName}
                    {usage.type === 'pre-existing' ? ' · Pre-existing' : ''}
                  </span>
                ))}
              </div>
            ))}
            <footer className="modal-actions">
              <button
                className="button secondary"
                type="button"
                disabled={!!busy}
                onClick={() => setBlockedPosters([])}
              >
                Cancel
              </button>
              {selectedPosters.some(
                (id) => !blockedPosters.some((poster) => poster.id === id)
              ) && (
                <button
                  className="button secondary"
                  type="button"
                  disabled={!!busy}
                  onClick={() =>
                    void deleteSaved(
                      selectedPosters.filter(
                        (id) =>
                          !blockedPosters.some((poster) => poster.id === id)
                      )
                    )
                  }
                >
                  Delete unused only
                </button>
              )}
              <button
                className="button danger"
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void deleteSaved(
                    blockedPosters.map((item) => item.id),
                    true
                  )
                }
              >
                {busy ? 'Deleting…' : 'Delete and unassign'}
              </button>
            </footer>
          </section>
        </div>
      )}
      {editor && (
        <div className="modal-backdrop">
          <section
            className="poster-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="poster-editor-title"
          >
            <header>
              <div>
                <p className="eyebrow">
                  {editor.id ? 'Edit' : 'Create'} {editor.kind}
                </p>
                <h2 id="poster-editor-title">
                  {editor.id ? `Edit ${editor.name}` : `Create ${editor.kind}`}
                </h2>
              </div>
              <div>
                <button
                  className="icon-button"
                  type="button"
                  title="Undo"
                  aria-label="Undo poster change"
                  disabled={!undoStack.length}
                  onClick={undoDesign}
                >
                  ↶
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="Redo"
                  aria-label="Redo poster change"
                  disabled={!redoStack.length}
                  onClick={redoDesign}
                >
                  ↷
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title={`Snap: ${snapEnabled ? 'ON' : 'OFF'}`}
                  aria-label={`Turn snapping ${snapEnabled ? 'off' : 'on'}`}
                  aria-pressed={snapEnabled}
                  onClick={() => setSnapEnabled((enabled) => !enabled)}
                >
                  ⌗
                </button>
                <button className="icon-button" type="button" disabled={editorZoom <= 50} aria-label="Zoom collection poster out" onClick={() => setEditorZoom((value) => Math.max(50, value - 10))}>&minus;</button>
                <button className="icon-button" type="button" title="Reset poster zoom" onClick={() => setEditorZoom(100)}>{editorZoom}%</button>
                <button className="icon-button" type="button" disabled={editorZoom >= 200} aria-label="Zoom collection poster in" onClick={() => setEditorZoom((value) => Math.min(200, value + 10))}>+</button>
                <div
                  className="poster-preview-media-toggle"
                  role="group"
                  aria-label="Preview poster media type"
                >
                  <button
                    type="button"
                    className={editorPreviewMediaType === 'movie' ? 'active' : ''}
                    aria-pressed={editorPreviewMediaType === 'movie'}
                    onClick={() => setEditorPreviewMediaType('movie')}
                  >
                    Movie
                  </button>
                  <button
                    type="button"
                    className={editorPreviewMediaType === 'show' ? 'active' : ''}
                    aria-pressed={editorPreviewMediaType === 'show'}
                    onClick={() => setEditorPreviewMediaType('show')}
                  >
                    TV
                  </button>
                </div>
                <button
                  ref={editorCloseButton}
                  className="icon-button"
                  type="button"
                  aria-label="Close poster editor"
                  onClick={requestEditorClose}
                >
                  ×
                </button>
              </div>
            </header>
            <div className="editor-meta">
              <div className="layer-order-buttons" aria-label="Metadata history">
                <button type="button" disabled={!metadataUndoStack.length} onClick={undoMetadata}>Undo metadata</button>
                <button type="button" disabled={!metadataRedoStack.length} onClick={redoMetadata}>Redo metadata</button>
              </div>
              <label>
                {editor.kind === 'template' ? 'Template name' : 'Poster name'}
                <input
                  value={editor.name}
                  maxLength={120}
                  required
                  placeholder="Enter a name"
                  onChange={(event) => updateMetadata({ name: event.target.value })}
                />
                <small>{editor.name.length}/120 characters</small>
              </label>
              <label>
                Description (optional)
                <input
                  value={editor.description}
                  maxLength={500}
                  placeholder="Enter a description"
                  onChange={(event) => updateMetadata({ description: event.target.value })}
                />
                <small>{editor.description.length}/500 characters</small>
              </label>
            </div>
            <div className="poster-editor-layout">
              <aside>
                <h3>Background</h3>
                <label>
                  Type
                  <select
                    value={editor.design.background.type}
                    onChange={(event) =>
                      updateDesign((design) => ({
                        ...design,
                        background: {
                          ...design.background,
                          type: event.target
                            .value as CollectionPosterDesign['background']['type'],
                        },
                      }))
                    }
                  >
                    <option value="color">Color</option>
                    <option value="gradient">Linear gradient</option>
                    <option value="radial">Radial gradient</option>
                  </select>
                </label>
                <label>
                  Primary color
                  <input
                    type="color"
                    value={editor.design.background.color}
                    onChange={(event) =>
                      updateDesign((design) => ({
                        ...design,
                        background: {
                          ...design.background,
                          color: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
                {editor.design.background.type !== 'color' && (
                  <>
                    <label>
                      Secondary color
                      <input
                        type="color"
                        value={editor.design.background.secondaryColor}
                        onChange={(event) =>
                          updateDesign((design) => ({
                            ...design,
                            background: {
                              ...design.background,
                              secondaryColor: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Intensity ({editor.design.background.intensity})
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={editor.design.background.intensity}
                        onChange={(event) =>
                          updateDesign((design) => ({
                            ...design,
                            background: {
                              ...design.background,
                              intensity: Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                  </>
                )}
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={editor.design.background.useSourceColors}
                    onChange={(event) =>
                      updateDesign((design) => ({
                        ...design,
                        background: {
                          ...design.background,
                          useSourceColors: event.target.checked,
                        },
                      }))
                    }
                  />{' '}
                  Use source colors
                </label>
                <h3>Add layer</h3>
                <div className="add-layer-grid">
                  {(
                    ['text', 'raster', 'person', 'svg', 'content-grid'] as const
                  ).map((type) => (
                    <button
                      type="button"
                      key={type}
                      disabled={!!busy}
                      onClick={() => {
                        if (type === 'raster' || type === 'svg') {
                          setPendingAssetLayer(type);
                          if (assetInput.current) {
                            assetInput.current.accept =
                              type === 'svg'
                                ? 'image/svg+xml,.svg'
                                : 'image/jpeg,image/png,image/webp';
                            assetInput.current.click();
                          }
                        } else {
                          addLayer(type);
                        }
                      }}
                    >
                      +{' '}
                      {type === 'raster'
                        ? 'Upload image'
                        : type === 'svg'
                          ? 'Upload SVG'
                        : type === 'content-grid'
                          ? 'Content grid'
                          : type}
                    </button>
                  ))}
                </div>
                <input
                  ref={assetInput}
                  hidden
                  type="file"
                  accept={
                    pendingAssetLayer === 'svg' ||
                    (!pendingAssetLayer && selectedLayer?.type === 'svg')
                      ? 'image/svg+xml,.svg'
                      : 'image/jpeg,image/png,image/webp'
                  }
                  onChange={(event) =>
                    void uploadAsset(event.target.files?.[0])
                  }
                />
              </aside>
              <main>
                <div className="editor-canvas-wrap">
                  <PosterPreview
                    design={editor.design}
                    title={editor.name || 'Sample Collection'}
                    mediaType={editorPreviewMediaType}
                    selectedLayerId={selectedLayerId}
                    snap={snapEnabled}
                    zoom={editorZoom}
                    onSelectLayer={setSelectedLayerId}
                    onCommitLayer={(id, geometry) => {
                      setSelectedLayerId(id);
                      updateDesign((design) => ({
                        ...design,
                        elements: design.elements.map((layer) =>
                          layer.id === id ? { ...layer, ...geometry } : layer
                        ),
                      }));
                    }}
                  />
                </div>
                <p>
                  1000 × 1500 · Drag layers to move; use handles to resize
                </p>
              </main>
              <aside>
                <h3>Layers</h3>
                <div className="editor-layer-list">
                  {[...editor.design.elements]
                    .sort((a, b) => b.layerOrder - a.layerOrder)
                    .map((layer) => (
                      <button
                        type="button"
                        className={selectedLayerId === layer.id ? 'active' : ''}
                        key={layer.id}
                        onClick={() => setSelectedLayerId(layer.id)}
                      >
                        <span>{layer.name}</span>
                        <small>{layer.type}{layer.properties.hidden === true ? ' · hidden' : ''}{layer.properties.locked === true ? ' · locked' : ''}</small>
                      </button>
                    ))}
                </div>
                {selectedLayer && (
                  <div className="layer-properties">
                    <h3>Properties</h3>
                    <label>
                      Layer name
                      <input
                        value={selectedLayer.name}
                        maxLength={120}
                        onChange={(event) =>
                          updateLayer({ name: event.target.value })
                        }
                      />
                    </label>
                    <div className="layer-order-buttons">
                      <button type="button" onClick={() => updateLayer({}, { hidden: selectedLayer.properties.hidden !== true })}>
                        {selectedLayer.properties.hidden === true ? 'Show layer' : 'Hide layer'}
                      </button>
                      <button type="button" onClick={() => updateLayer({}, { locked: selectedLayer.properties.locked !== true })}>
                        {selectedLayer.properties.locked === true ? 'Unlock layer' : 'Lock layer'}
                      </button>
                      <button
                        type="button"
                        disabled={
                          selectedLayer.layerOrder ===
                          Math.max(
                            ...editor.design.elements.map(
                              (item) => item.layerOrder
                            )
                          )
                        }
                        onClick={() => moveSelectedLayer(1)}
                      >
                        Raise layer
                      </button>
                      <button
                        type="button"
                        disabled={
                          selectedLayer.layerOrder ===
                          Math.min(
                            ...editor.design.elements.map(
                              (item) => item.layerOrder
                            )
                          )
                        }
                        onClick={() => moveSelectedLayer(-1)}
                      >
                        Lower layer
                      </button>
                      <button type="button" onClick={duplicateSelectedLayer}>
                        Duplicate layer
                      </button>
                    </div>
                    {selectedLayer.type === 'text' && (
                      <>
                        <label>
                          Text
                          <input
                            value={String(selectedLayer.properties.text ?? '')}
                            disabled={
                              selectedLayer.properties.elementType ===
                              'collection-title'
                            }
                            onChange={(event) =>
                              updateLayer({}, { text: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          Font size
                          <input
                            type="number"
                            min="8"
                            max="400"
                            value={Number(
                              selectedLayer.properties.fontSize ?? 72
                            )}
                            onChange={(event) =>
                              updateLayer(
                                {},
                                { fontSize: Number(event.target.value) }
                              )
                            }
                          />
                        </label>
                        <label>
                          Font family
                          <select
                            value={String(
                              selectedLayer.properties.fontFamily ?? 'Inter'
                            )}
                            onChange={(event) =>
                              updateLayer(
                                {},
                                { fontFamily: event.target.value }
                              )
                            }
                          >
                            <option>Inter</option>
                            <option>Arial</option>
                            <option>Roboto</option>
                            <option>Montserrat</option>
                          </select>
                        </label>
                        <label>
                          Color
                          <input
                            type="color"
                            value={String(
                              selectedLayer.properties.color ?? '#ffffff'
                            )}
                            onChange={(event) =>
                              updateLayer({}, { color: event.target.value })
                            }
                          />
                        </label>
                        <div className="two-field">
                          <label>Weight<select value={String(selectedLayer.properties.fontWeight ?? 'bold')} onChange={(event) => updateLayer({}, { fontWeight: event.target.value })}><option value="normal">Normal</option><option value="bold">Bold</option></select></label>
                          <label>Style<select value={String(selectedLayer.properties.fontStyle ?? 'normal')} onChange={(event) => updateLayer({}, { fontStyle: event.target.value })}><option value="normal">Normal</option><option value="italic">Italic</option></select></label>
                        </div>
                        <label>Alignment<select value={String(selectedLayer.properties.textAlign ?? 'left')} onChange={(event) => updateLayer({}, { textAlign: event.target.value })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
                        <label>Opacity ({Number(selectedLayer.properties.opacity ?? 100)}%)<input type="range" min="0" max="100" value={Number(selectedLayer.properties.opacity ?? 100)} onChange={(event) => updateLayer({}, { opacity: Number(event.target.value) })} /></label>
                        <div className="two-field">
                          <label>Stroke color<input type="color" value={String(selectedLayer.properties.textStrokeColor ?? '#000000')} onChange={(event) => updateLayer({}, { textStrokeColor: event.target.value })} /></label>
                          <label>Stroke width<input type="number" min="0" max="40" value={Number(selectedLayer.properties.textStrokeWidth ?? 0)} onChange={(event) => updateLayer({}, { textStrokeWidth: Number(event.target.value) })} /></label>
                        </div>
                        <label>Shadow color<input type="color" value={String(selectedLayer.properties.textShadowColor ?? '#000000')} onChange={(event) => updateLayer({}, { textShadowColor: event.target.value })} /></label>
                        <label>Shadow opacity ({Number(selectedLayer.properties.textShadowOpacity ?? 0)}%)<input type="range" min="0" max="100" value={Number(selectedLayer.properties.textShadowOpacity ?? 0)} onChange={(event) => updateLayer({}, { textShadowOpacity: Number(event.target.value) })} /></label>
                        <div className="three-field">
                          <label>Shadow X<input type="number" min="-100" max="100" value={Number(selectedLayer.properties.textShadowOffsetX ?? 0)} onChange={(event) => updateLayer({}, { textShadowOffsetX: Number(event.target.value) })} /></label>
                          <label>Shadow Y<input type="number" min="-100" max="100" value={Number(selectedLayer.properties.textShadowOffsetY ?? 0)} onChange={(event) => updateLayer({}, { textShadowOffsetY: Number(event.target.value) })} /></label>
                          <label>Blur<input type="number" min="0" max="100" value={Number(selectedLayer.properties.textShadowBlur ?? 0)} onChange={(event) => updateLayer({}, { textShadowBlur: Number(event.target.value) })} /></label>
                        </div>
                      </>
                    )}
                    {selectedLayer.type === 'content-grid' && (
                      <>
                        <label>
                          Columns
                          <input
                            type="number"
                            min="1"
                            max="8"
                            value={Number(
                              selectedLayer.properties.columns ?? 3
                            )}
                            onChange={(event) =>
                              updateLayer(
                                {},
                                { columns: Number(event.target.value) }
                              )
                            }
                          />
                        </label>
                        <label>
                          Rows
                          <input
                            type="number"
                            min="1"
                            max="8"
                            value={Number(selectedLayer.properties.rows ?? 2)}
                            onChange={(event) =>
                              updateLayer(
                                {},
                                { rows: Number(event.target.value) }
                              )
                            }
                          />
                        </label>
                        <label>
                          Spacing
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={Number(
                              selectedLayer.properties.spacing ?? 24
                            )}
                            onChange={(event) =>
                              updateLayer(
                                {},
                                { spacing: Number(event.target.value) }
                              )
                            }
                          />
                        </label>
                        <label>
                          Corner radius
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={Number(
                              selectedLayer.properties.cornerRadius ?? 20
                            )}
                            onChange={(event) =>
                              updateLayer(
                                {},
                                { cornerRadius: Number(event.target.value) }
                              )
                            }
                          />
                        </label>
                        <label>Source<select value={String(selectedLayer.properties.source ?? 'collection-members')} onChange={(event) => updateLayer({}, { source: event.target.value })}><option value="collection-members">Collection members</option></select></label>
                        <label>Padding<input type="number" min="0" max="200" value={Number(selectedLayer.properties.padding ?? 0)} onChange={(event) => updateLayer({}, { padding: Number(event.target.value) })} /></label>
                        <label>Item image fit<select value={String(selectedLayer.properties.imageFit ?? 'cover')} onChange={(event) => updateLayer({}, { imageFit: event.target.value })}><option value="cover">Cover / crop</option><option value="contain">Contain</option></select></label>
                        <label className="inline-check"><input type="checkbox" checked={selectedLayer.properties.showItemText === true} onChange={(event) => updateLayer({}, { showItemText: event.target.checked })} />Show item position text</label>
                        {selectedLayer.properties.showItemText === true && <div className="two-field"><label>Text color<input type="color" value={String(selectedLayer.properties.itemTextColor ?? '#ffffff')} onChange={(event) => updateLayer({}, { itemTextColor: event.target.value })} /></label><label>Text size<input type="number" min="8" max="100" value={Number(selectedLayer.properties.itemTextSize ?? 28)} onChange={(event) => updateLayer({}, { itemTextSize: Number(event.target.value) })} /></label></div>}
                      </>
                    )}
                    {selectedLayer.type === 'raster' && (
                      <div className="asset-selector">
                        <label>
                          Stored image
                          <select
                            value={String(
                              selectedLayer.properties.assetId ?? ''
                            )}
                            onChange={(event) =>
                              selectAsset(event.target.value)
                            }
                          >
                            <option value="">Choose an uploaded image…</option>
                            {workspace.assets
                              .filter((asset) => asset.kind === 'raster')
                              .map((asset) => (
                                <option key={asset.id} value={asset.id}>
                                  {asset.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button
                          className="button secondary"
                          type="button"
                          disabled={!!busy}
                          onClick={() => {
                            setPendingAssetLayer(undefined);
                            if (assetInput.current) {
                              assetInput.current.accept =
                                'image/jpeg,image/png,image/webp';
                              assetInput.current.click();
                            }
                          }}
                        >
                          {busy === 'Uploading poster asset'
                            ? 'Uploading…'
                            : 'Replace image'}
                        </button>
                        <small>
                          JPEG, PNG, or WebP; maximum 10 MB. Files are verified
                          by content and stored with opaque server filenames.
                        </small>
                        <label>
                          Image fit
                          <select value={String(selectedLayer.properties.fit ?? 'cover')} onChange={(event) => updateLayer({}, { fit: event.target.value })}>
                            <option value="contain">Contain</option>
                            <option value="cover">Cover / crop</option>
                            <option value="fill">Stretch to fill</option>
                          </select>
                        </label>
                      </div>
                    )}
                    {selectedLayer.type === 'person' && (
                      <>
                        <label>
                          Overlay color
                          <input
                            type="color"
                            value={String(
                              selectedLayer.properties.overlayColor ?? '#000000'
                            )}
                            onChange={(event) =>
                              updateLayer(
                                {},
                                { overlayColor: event.target.value }
                              )
                            }
                          />
                        </label>
                        <label>
                          Overlay opacity (
                          {Math.round(
                            Number(
                              selectedLayer.properties.overlayOpacity ?? 0.2
                            ) * 100
                          )}
                          %)
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={Number(
                              selectedLayer.properties.overlayOpacity ?? 0.2
                            )}
                            onChange={(event) =>
                              updateLayer(
                                {},
                                { overlayOpacity: Number(event.target.value) }
                              )
                            }
                          />
                        </label>
                      </>
                    )}
                    {selectedLayer.type === 'svg' && (
                      <>
                        <div className="nested-editor">
                          <strong>Built-in icon catalog</strong>
                          <input placeholder="Search icons" value={collectionIconSearch} onChange={(event) => setCollectionIconSearch(event.target.value)} />
                          <select value={String(selectedLayer.properties.systemIcon ?? '')} onChange={(event) => updateLayer({}, { systemIcon: event.target.value, assetId: event.target.value ? '' : selectedLayer.properties.assetId, iconPath: event.target.value ? '' : selectedLayer.properties.iconPath })}>
                            <option value="">Use uploaded SVG</option>
                            {dynamicValueIcons.filter((icon) => `${icon.label} ${icon.category}`.toLowerCase().includes(collectionIconSearch.trim().toLowerCase())).map((icon) => <option key={icon.id} value={icon.id}>{icon.category} · {icon.label}</option>)}
                          </select>
                          {selectedLayer.properties.systemIcon && <><label>Icon color<input type="color" value={String(selectedLayer.properties.iconColor ?? '#ffffff')} onChange={(event) => updateLayer({}, { iconColor: event.target.value })} /></label><label>Fill color<input type="color" value={String(selectedLayer.properties.iconFillColor ?? '#000000')} onChange={(event) => updateLayer({}, { iconFillColor: event.target.value })} /></label><label>Stroke width<input type="number" min="0" max="12" value={Number(selectedLayer.properties.iconStrokeWidth ?? 2)} onChange={(event) => updateLayer({}, { iconStrokeWidth: Number(event.target.value) })} /></label></>}
                        </div>
                        <div className="asset-selector">
                          <label>
                            Stored icon
                            <select
                              value={String(
                                selectedLayer.properties.assetId ?? ''
                              )}
                              onChange={(event) =>
                                selectAsset(event.target.value)
                              }
                            >
                              <option value="">Choose an uploaded SVG…</option>
                              {workspace.assets
                                .filter((asset) => asset.kind === 'svg')
                                .map((asset) => (
                                  <option key={asset.id} value={asset.id}>
                                    {asset.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <button
                            className="button secondary"
                            type="button"
                            disabled={!!busy}
                            onClick={() => {
                              setPendingAssetLayer(undefined);
                              if (assetInput.current) {
                                assetInput.current.accept =
                                  'image/svg+xml,.svg';
                                assetInput.current.click();
                              }
                            }}
                          >
                            {busy === 'Uploading poster asset'
                              ? 'Uploading…'
                              : 'Replace SVG'}
                          </button>
                          <small>
                            SVG only; maximum 10 MB. Scripts, event handlers,
                            external references, and embedded active content are
                            rejected.
                          </small>
                        </div>
                        <label className="inline-check">
                          <input
                            type="checkbox"
                            checked={
                              selectedLayer.properties.grayscale === true
                            }
                            onChange={(event) =>
                              updateLayer(
                                {},
                                { grayscale: event.target.checked }
                              )
                            }
                          />
                          Render in grayscale
                        </label>
                      </>
                    )}
                    {['raster', 'svg'].includes(selectedLayer.type) && (
                      <label>
                        Opacity ({Number(selectedLayer.properties.opacity ?? 100)}%)
                        <input type="range" min="0" max="100" value={Number(selectedLayer.properties.opacity ?? 100)} onChange={(event) => updateLayer({}, { opacity: Number(event.target.value) })} />
                      </label>
                    )}
                    <div className="geometry-grid">
                      {(['x', 'y', 'width', 'height', 'rotation'] as const).map(
                        (key) => (
                          <label key={key}>
                            {key}
                            <input
                              type="number"
                              min={
                                key === 'rotation'
                                  ? -360
                                  : key === 'width' || key === 'height'
                                    ? 1
                                    : 0
                              }
                              max={
                                key === 'x'
                                  ? editor.design.width - selectedLayer.width
                                  : key === 'y'
                                    ? editor.design.height -
                                      selectedLayer.height
                                    : key === 'width'
                                      ? editor.design.width - selectedLayer.x
                                      : key === 'height'
                                        ? editor.design.height - selectedLayer.y
                                        : 360
                              }
                              value={selectedLayer[key]}
                              onChange={(event) =>
                                updateGeometry(key, Number(event.target.value))
                              }
                            />
                          </label>
                        )
                      )}
                    </div>
                    <p className="field-help">
                      Coordinates and dimensions must stay inside the 1000 ×
                      1500 canvas.{' '}
                      {snapEnabled
                        ? 'Values snap to 10-pixel increments.'
                        : 'Snapping is off.'}
                    </p>
                    <button
                      className="button danger align-start"
                      type="button"
                      onClick={() => {
                        updateDesign((design) => ({
                          ...design,
                          elements: design.elements.filter(
                            (item) => item.id !== selectedLayer.id
                          ),
                        }));
                        setSelectedLayerId(undefined);
                      }}
                    >
                      Delete layer
                    </button>
                  </div>
                )}
              </aside>
            </div>
            <footer className="modal-actions">
              <button
                className="button secondary"
                type="button"
                disabled={!!busy}
                onClick={requestEditorClose}
              >
                Cancel
              </button>
              <button
                className="button primary"
                type="button"
                disabled={!!busy || !editor.name.trim()}
                onClick={() => void saveEditor()}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </footer>
          </section>
        </div>
      )}
      {confirmDiscard && editor && (
        <div className="modal-backdrop">
          <section
            className="poster-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="discard-poster-title"
            aria-describedby="discard-poster-description"
          >
            <h2 id="discard-poster-title">Discard unsaved changes?</h2>
            <p id="discard-poster-description">
              Your changes to {editor.name.trim() || `this ${editor.kind}`} have
              not been saved.
            </p>
            <footer className="modal-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setConfirmDiscard(false)}
              >
                Keep editing
              </button>
              <button
                className="button danger"
                type="button"
                onClick={() => {
                  setConfirmDiscard(false);
                  setEditor(undefined);
                }}
              >
                Discard changes
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
};
