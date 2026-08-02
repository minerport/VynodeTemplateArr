import { useEffect, useMemo, useRef, useState } from 'react';
import type { OverlayLibraryConfiguration, OverlayTemplateSummary, PosterSource } from '@vynode/contracts';
import { api } from './api';
import { OverlayTemplateEditor } from './OverlayTemplateEditor';
import { CopyOverlayElementsModal } from './CopyOverlayElementsModal';
import { OverlayDesignPreview } from './OverlayDesignPreview';
import {
  posterPreviewSample,
  posterPreviewSamples,
  templatePreviewMediaType,
} from './posterPreviewSamples';

const sourceCopy: Record<PosterSource, { name: string; description: string }> = {
  plex: {
    name: 'Plex posters',
    description: 'Download the current Plex poster as the clean base. Vynode detects later poster changes before the next overlay run.',
  },
  local: {
    name: 'Local posters',
    description: 'Use organized custom poster files. Missing files fall back to TMDB.',
  },
  tmdb: {
    name: 'TMDB posters',
    description: 'Use the most popular TMDB poster on every run, using the language selected for each library.',
  },
};

export const PosterOverlaysPage = () => {
  const [workspace, setWorkspace] = useState<Awaited<ReturnType<typeof api.posterOverlays>>>();
  const [view, setView] = useState<'templates' | 'libraries'>('templates');
  const [message, setMessage] = useState('Loading poster overlays…');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<PosterSource>('plex');
  const [hideInactive, setHideInactive] = useState(() => localStorage.getItem('vynode.hideInactiveOverlays') === 'true');
  const [density, setDensity] = useState(() => localStorage.getItem('vynode.overlayGridDensity') ?? 'comfortable');
  const [selectedLibrary, setSelectedLibrary] = useState<OverlayLibraryConfiguration>();
  const [resetLibrary, setResetLibrary] = useState<OverlayLibraryConfiguration>();
  const [draftTemplateIds, setDraftTemplateIds] = useState<string[]>([]);
  const [hiddenPreviewIds, setHiddenPreviewIds] = useState<string[]>([]);
  const [draftLanguage, setDraftLanguage] = useState('');
  const [draftEpisodeScanning, setDraftEpisodeScanning] = useState(false);
  const [draftMaintainerr, setDraftMaintainerr] = useState(false);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [testOpen, setTestOpen] = useState(false);
  const [testQuery, setTestQuery] = useState('');
  const [testItems, setTestItems] = useState<Awaited<ReturnType<typeof api.searchPosterTestItems>>['results']>([]);
  const [selectedTestItem, setSelectedTestItem] = useState<string>();
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof api.testPosterItem>>>();
  const [testBusy, setTestBusy] = useState(false);
  const [testApplied, setTestApplied] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<OverlayTemplateSummary | null | undefined>();
  const [deleteOverlayId, setDeleteOverlayId] = useState<string>();
  const [copySource, setCopySource] = useState<OverlayTemplateSummary>();
  const importInput = useRef<HTMLInputElement>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [libraryMutationBusy, setLibraryMutationBusy] = useState<string>();
  const [localUtilityBusy, setLocalUtilityBusy] = useState<'folders' | 'populate'>();
  const [replacePlexBases, setReplacePlexBases] = useState(false);
  const [cleanPosterConfirmation, setCleanPosterConfirmation] = useState('');
  const exportTemplate = (template: OverlayTemplateSummary) => {
    const anchor = document.createElement('a');
    anchor.href = `/api/posters/overlays/templates/${encodeURIComponent(template.id)}/export`;
    anchor.download = '';
    anchor.click();
    setMessage(`${template.name} ZIP export started.`);
  };
  const load = async () => {
    try {
      const result = await api.posterOverlays();
      setWorkspace(result);
      setSelectedSource(result.source.source);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load poster overlays.');
    }
  };
  useEffect(() => { void load(); }, []);
  const templates = useMemo(
    () => workspace?.templates.filter((template) => !hideInactive || template.enabled) ?? [],
    [workspace, hideInactive]
  );
  const baseDownloadProgress = useMemo(() => {
    const active = workspace?.libraries.some((library) => library.operation === 'download-base-posters');
    if (!active || !workspace) return undefined;
    const downloading = workspace.libraries.filter((library) => library.operation === 'download-base-posters');
    const total = downloading.reduce((sum, library) => sum + library.itemCount, 0);
    const completed = downloading.reduce((sum, library) => sum + library.processedItems + library.failedItems, 0);
    return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 };
  }, [workspace]);
  useEffect(() => {
    if (!workspace?.libraries.some((library) => ['queued', 'processing', 'cancelling'].includes(library.status))) return;
    const timer = window.setInterval(() => void load(), 800);
    return () => window.clearInterval(timer);
  }, [workspace]);
  if (!workspace) return <section className="main-panel"><p className="source-feedback" role="status">{message}</p></section>;
  const saveSource = async () => {
    setMessage('Saving poster source…');
    try {
      let result = await api.savePosterSource(workspace.source.revision, selectedSource);
      if (selectedSource === 'plex' && replacePlexBases) {
        result = await api.downloadCleanPlexBasePosters(cleanPosterConfirmation);
      }
      setWorkspace(result);
      setSourceOpen(false);
      setReplacePlexBases(false);
      setCleanPosterConfirmation('');
      setMessage(selectedSource === 'plex' && replacePlexBases ? 'Clean Plex poster download started. Progress is shown on each library.' : 'Poster source saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save poster source.');
    }
  };
  const runLocalUtility = async (kind: 'folders' | 'populate') => {
    setLocalUtilityBusy(kind);
    setMessage(kind === 'folders' ? 'Generating local poster folders…' : 'Downloading Plex posters…');
    try {
      const result = kind === 'folders'
        ? await api.generateLocalPosterFolders()
        : await api.populateLocalPosters();
      const skipped = result.skippedExisting + result.skippedMissingTmdb;
      setMessage(
        `${kind === 'folders' ? 'Folder generation' : 'Poster population'} complete: ${result.created} created, ${skipped} skipped${result.failed ? `, ${result.failed} failed` : ''}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The local poster operation failed.');
    } finally {
      setLocalUtilityBusy(undefined);
    }
  };
  const openLibrary = (library: OverlayLibraryConfiguration) => {
    setSelectedLibrary(library);
    setDraftTemplateIds([...library.enabledTemplateIds]);
    setHiddenPreviewIds([]);
    setDraftLanguage(library.tmdbLanguage);
    setDraftEpisodeScanning(library.enableEpisodeScanning);
    setDraftMaintainerr(library.maintainerrSeasonOverlays);
    setSampleIndex(0);
  };
  const saveLibrary = async (applyAfterSave = false) => {
    if (!selectedLibrary || libraryMutationBusy) return;
    setLibraryMutationBusy(selectedLibrary.id);
    setMessage(`Saving ${selectedLibrary.name} overlay configuration…`);
    try {
      const saved = await api.updatePosterLibrary(selectedLibrary.id, {
        enabledTemplateIds: draftTemplateIds,
        tmdbLanguage: draftLanguage,
        enableEpisodeScanning: draftEpisodeScanning,
        maintainerrSeasonOverlays: draftMaintainerr,
      });
      const result = applyAfterSave
        ? await api.applyPosterLibrary(selectedLibrary.id)
        : saved;
      setWorkspace(result);
      setSelectedLibrary(undefined);
      const activated = saved.templates.filter(
        (template) =>
          draftTemplateIds.includes(template.id) &&
          !workspace.templates.find((current) => current.id === template.id)
            ?.enabled &&
          template.enabled
      );
      setMessage(
        applyAfterSave
          ? `${selectedLibrary.name} configuration saved and overlay application started.${activated.length ? ` Activated ${activated.map((template) => template.name).join(', ')}.` : ''}`
          : `${selectedLibrary.name} configuration saved.${activated.length ? ` Activated ${activated.map((template) => template.name).join(', ')} because it is selected for this library.` : ''}`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save library configuration.');
    } finally {
      setLibraryMutationBusy(undefined);
    }
  };
  const runLibraryAction = async (library: OverlayLibraryConfiguration, action: 'apply' | 'cancel' | 'reset') => {
    if (libraryMutationBusy) return;
    setLibraryMutationBusy(library.id);
    setMessage(`${action === 'apply' ? 'Starting overlays for' : action === 'cancel' ? 'Stopping' : 'Resetting'} ${library.name}…`);
    try {
      const result = action === 'apply' ? await api.applyPosterLibrary(library.id) : action === 'cancel' ? await api.cancelPosterLibrary(library.id) : await api.resetPosterLibrary(library.id);
      setWorkspace(result);
      setResetLibrary(undefined);
      setMessage(action === 'cancel' ? 'Cancellation requested. The current item will finish safely.' : `${action === 'reset' ? 'Poster reset' : 'Overlay application'} started. You can leave this page while it runs.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start poster operation.');
      await load();
    } finally {
      setLibraryMutationBusy(undefined);
    }
  };
  const applyAllLibraries = async () => {
    const eligible = workspace.libraries.filter((library) => !['queued', 'processing', 'cancelling'].includes(library.status));
    if (!eligible.length) {
      setMessage('No libraries are ready to start.');
      return;
    }
    setMessage(`Starting overlays for ${eligible.length} ${eligible.length === 1 ? 'library' : 'libraries'}…`);
    try {
      const result = await api.applyAllPosterLibraries();
      setWorkspace(result);
      setMessage('Overlay jobs started. Progress continues in the background.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start all overlay jobs.');
      await load();
    }
  };
  const searchTestItems = async () => {
    if (!testQuery.trim()) return;
    setTestBusy(true);
    setMessage('Searching Plex libraries…');
    try {
      const result = await api.searchPosterTestItems(testQuery);
      setTestItems(result.results);
      setMessage(result.results.length ? '' : 'No matching Plex items were found.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to search Plex.');
    } finally {
      setTestBusy(false);
    }
  };
  const runTest = async () => {
    if (!selectedTestItem) return;
    setTestBusy(true);
    try {
      setTestResult(await api.testPosterItem(selectedTestItem));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to render overlay test.');
    } finally {
      setTestBusy(false);
    }
  };
  const importOverlayTemplate = async (file?: File) => {
    if (!file) return;
    const isJson = file.name.toLowerCase().endsWith('.json');
    if (
      (!file.name.toLowerCase().endsWith('.zip') && !isJson) ||
      file.size > 50 * 1024 * 1024
    ) {
      setMessage('Choose a Vynode overlay JSON or Agregarr ZIP up to 50 MB.');
      if (importInput.current) importInput.current.value = '';
      return;
    }
    setImportBusy(true);
    setMessage(isJson ? 'Validating Vynode overlay template…' : 'Validating and adapting Agregarr overlay archive…');
    try {
      if (isJson) {
        if (file.size > 5 * 1024 * 1024)
          throw new Error('Vynode overlay JSON files must be 5 MB or smaller.');
        const payload = JSON.parse(await file.text()) as {
          format?: unknown;
          version?: unknown;
          template?: unknown;
        };
        if (
          payload.format !== 'vynode-overlay-template' ||
          payload.version !== 1 ||
          !payload.template ||
          typeof payload.template !== 'object'
        )
          throw new Error('This is not a supported Vynode overlay template.');
        const template = payload.template as Parameters<typeof api.saveOverlayTemplate>[1];
        const result = await api.saveOverlayTemplate(undefined, {
          ...template,
          enabled: false,
        });
        setWorkspace(result);
        setMessage(`${template.name} imported as an inactive Vynode overlay. Review it before enabling it for a library.`);
        return;
      }
      const result = await api.importAgregarrOverlayTemplate(file);
      setWorkspace(result.workspace);
      setMessage(
        `${result.name} imported from Agregarr as an inactive overlay with ${result.importedLayers} ${result.importedLayers === 1 ? 'layer' : 'layers'} and ${result.importedAssets} ${result.importedAssets === 1 ? 'asset' : 'assets'}.${result.renamed ? ' The name was changed to protect the existing template.' : ''}${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''} Review its preview and condition before enabling it for a library.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to import the overlay template.'
      );
    } finally {
      setImportBusy(false);
      if (importInput.current) importInput.current.value = '';
    }
  };
  return (
    <div className="poster-workspace">
      <section className="poster-toolbar">
        <div className="segmented" aria-label="Overlay workspace view">
          <button className={view === 'templates' ? 'active' : ''} onClick={() => setView('templates')}>Templates <span>{workspace.templates.length}</span></button>
          <button className={view === 'libraries' ? 'active' : ''} onClick={() => setView('libraries')}>Libraries <span>{workspace.libraries.length}</span></button>
        </div>
        <div className="toolbar-actions">
          <button className="button secondary" onClick={() => setSourceOpen(true)}>Base source: {sourceCopy[workspace.source.source].name}</button>
          {view === 'templates' ? <><button className="button secondary" onClick={() => { setTestOpen(true); setTestResult(undefined); setTestApplied(false); }}>Test item</button><button className="button secondary" disabled={importBusy} onClick={() => importInput.current?.click()}>{importBusy ? 'Importing…' : 'Import template'}</button><input ref={importInput} hidden type="file" accept="application/json,.json,application/zip,.zip" onChange={(event) => void importOverlayTemplate(event.target.files?.[0])} /><button className="button primary" onClick={() => setEditingTemplate(null)}>Create template</button></> : <button className="button primary" onClick={() => void applyAllLibraries()}>Apply all libraries</button>}
        </div>
      </section>
      {message && <p className="source-feedback" role="status">{message}</p>}
      {baseDownloadProgress && <section className="source-feedback" role="status" aria-live="polite"><strong>Downloading clean Plex base posters</strong><p>{baseDownloadProgress.completed} of {baseDownloadProgress.total} processed ({baseDownloadProgress.percent}%). Downloads continue in the background; use Stop safely on a library to cancel it.</p><progress max={Math.max(1, baseDownloadProgress.total)} value={baseDownloadProgress.completed}>{baseDownloadProgress.percent}%</progress></section>}
      {view === 'templates' ? (
        <>
          <section className="poster-filterbar">
            <div><strong>Overlay templates</strong><p>Reusable layers are applied in each library’s configured order.</p></div>
            <div>
              <label><input type="checkbox" checked={hideInactive} onChange={(event) => { setHideInactive(event.target.checked); localStorage.setItem('vynode.hideInactiveOverlays', String(event.target.checked)); }} /> Hide inactive</label>
              <label>Grid size <select value={density} onChange={(event) => { setDensity(event.target.value); localStorage.setItem('vynode.overlayGridDensity', event.target.value); }}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="large">Large</option></select></label>
            </div>
          </section>
          <div className={`overlay-grid ${density}`}>
            {templates.map((template, index) => (
              <article className={`overlay-template-card ${template.enabled ? '' : 'inactive'}`} key={template.id}>
                <OverlayDesignPreview
                  template={template}
                  mediaType={templatePreviewMediaType(template)}
                  sampleIndex={index}
                />
                <div className="overlay-card-body"><div className="card-title-row"><h3>{template.name}</h3><span className={template.enabled ? 'enabled-pill' : 'disabled-pill'}>{template.enabled ? 'Active' : 'Inactive'}</span></div><p>{template.description}</p><small>{template.elementCount} {template.elementCount === 1 ? 'layer' : 'layers'} · {template.conditionSummary}</small><div className="tag-row">{template.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>
                <footer><button onClick={() => setEditingTemplate(template)}>Edit</button><button onClick={() => void api.duplicateOverlayTemplate(template.id).then(setWorkspace)}>Duplicate</button><button onClick={() => setCopySource(template)}>Copy elements</button><button title="Download a portable Vynode overlay template." aria-label={`Export ${template.name}`} onClick={() => exportTemplate(template)}>Export</button><button className="danger-text" onClick={() => setDeleteOverlayId(template.id)}>Delete</button></footer>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="poster-library-grid">
          {workspace.libraries.map((library) => {
            const progress = library.itemCount ? Math.round((library.processedItems / library.itemCount) * 100) : 0;
            return <article className="poster-library-card" key={library.id}>
              <div className="library-card-heading"><span className="library-mark">{library.type === 'movie' ? 'M' : 'TV'}</span><div><h3>{library.name}</h3><p>{library.type === 'movie' ? 'Movies' : 'TV Shows'} · {library.itemCount} items</p></div><span className={`job-state ${library.status}`}>{library.status}</span></div>
              <div className="library-summary"><span><strong>{library.enabledTemplateIds.length}</strong><small>enabled overlays</small></span><span><strong>{library.failedItems}</strong><small>failed items</small></span><span><strong>{library.lastAppliedAt ? new Date(library.lastAppliedAt).toLocaleString() : 'Never'}</strong><small>last applied</small></span></div>
              {library.status !== 'idle' && <><div className="progress-heading"><span>{library.processedItems} of {library.itemCount}</span><strong>{progress}%</strong></div><div className="job-progress"><span style={{ width: `${progress}%` }} /></div></>}
              {library.lastAppliedAt && (
                <p className="helper-text">
                  Last run: {library.lastAppliedItems ?? 0} updated, {library.lastUnchangedItems ?? 0} already current, {library.lastRestoredItems ?? 0} restored, {library.lastNoMatchItems ?? 0} with no matching overlay, and {library.failedItems} failed.
                </p>
              )}
              {library.lastError && <p className="helper-text error-text">Last error: {library.lastError}</p>}
              {!library.enabledTemplateIds.length && (
                <p className="helper-text">No overlays are selected for this library. Choose one or more overlays before applying.</p>
              )}
              <footer><button className="button secondary" disabled={libraryMutationBusy === library.id} onClick={() => openLibrary(library)}>Configure overlays</button><button className="button secondary danger" disabled={libraryMutationBusy === library.id} onClick={() => setResetLibrary(library)}>Reset library</button>{['queued', 'processing', 'cancelling'].includes(library.status) ? <button className="button danger" disabled={library.status === 'cancelling' || libraryMutationBusy === library.id} onClick={() => void runLibraryAction(library, 'cancel')}>Stop safely</button> : library.enabledTemplateIds.length ? <button className="button primary" disabled={libraryMutationBusy === library.id} onClick={() => void runLibraryAction(library, 'apply')}>{libraryMutationBusy === library.id ? 'Starting…' : 'Apply overlays'}</button> : <button className="button primary" disabled={libraryMutationBusy === library.id} onClick={() => openLibrary(library)}>Choose overlays</button>}</footer>
            </article>;
          })}
        </div>
      )}
      {sourceOpen && <div className="modal-backdrop" role="presentation"><section className="poster-modal" role="dialog" aria-modal="true" aria-labelledby="source-title">
        <div className="modal-heading"><div><p className="eyebrow">Overlay foundation</p><h2 id="source-title">Choose poster source</h2><p>Select the clean base poster Vynode should use before applying overlays.</p></div><button className="icon-button" aria-label="Close poster source dialog" onClick={() => setSourceOpen(false)}>×</button></div>
        <div className="source-choice-list">{(['plex', 'local', 'tmdb'] as const).map((source) => <label className={selectedSource === source ? 'selected' : ''} key={source}><input type="radio" name="poster-source" checked={selectedSource === source} onChange={() => setSelectedSource(source)} /><span><strong>{sourceCopy[source].name}</strong><small>{sourceCopy[source].description}</small>{source === 'local' && <code>/config/plex-base-posters/&#123;LibraryName&#125;-&#123;ID&#125;/&#123;Title&#125; (&#123;Year&#125;) tmdb-&#123;TMDBID&#125;/poster.jpg</code>}</span>{workspace.source.source === source && <em>Current</em>}</label>)}</div>
        {selectedSource === 'local' && <div className="utility-panel"><strong>Local poster utilities</strong><p>Supported: poster.jpg, poster.png, and any JPG, PNG, or WebP image. Existing images are never overwritten.</p><button className="button secondary" disabled={Boolean(localUtilityBusy)} onClick={() => void runLocalUtility('folders')}>{localUtilityBusy === 'folders' ? 'Generating…' : 'Generate folder structure'}</button><button className="button secondary" disabled={Boolean(localUtilityBusy)} onClick={() => void runLocalUtility('populate')}>{localUtilityBusy === 'populate' ? 'Populating…' : 'Populate from Plex'}</button></div>}
        {selectedSource === 'plex' && <div className="utility-panel"><label><input type="checkbox" checked={replacePlexBases} onChange={(event) => { setReplacePlexBases(event.target.checked); if (!event.target.checked) setCleanPosterConfirmation(''); }} /> <strong>Re-download clean Plex posters</strong></label><p>This replaces every preserved base with the poster currently in Plex. Remove overlays in Plex first; otherwise they become part of the new base.</p>{replacePlexBases && <label><span>Type <strong>I HAVE CLEAN POSTERS</strong> to confirm</span><input value={cleanPosterConfirmation} onChange={(event) => setCleanPosterConfirmation(event.target.value)} autoComplete="off" /></label>}</div>}
        <footer className="modal-actions"><button className="button secondary" onClick={() => setSourceOpen(false)}>Cancel</button><button className="button primary" disabled={selectedSource === 'plex' && replacePlexBases && cleanPosterConfirmation !== 'I HAVE CLEAN POSTERS'} onClick={() => void saveSource()}>{selectedSource === 'plex' && replacePlexBases ? 'Save and re-download' : 'Save source'}</button></footer>
      </section></div>}
      {selectedLibrary && <div className="modal-backdrop" role="presentation"><section className="poster-modal library-config-modal" role="dialog" aria-modal="true" aria-labelledby="library-config-title">
        <div className="modal-heading"><div><p className="eyebrow">{selectedLibrary.type === 'movie' ? 'Movie library' : 'TV library'}</p><h2 id="library-config-title">Configure overlays — {selectedLibrary.name}</h2><p>Choose overlays and their render order. The top overlay renders above every overlay below it.</p></div><button className="icon-button" aria-label="Close library configuration" onClick={() => setSelectedLibrary(undefined)}>×</button></div>
        <div className="library-config-layout">
          <section className="combined-preview-panel"><div className="preview-title"><strong>Combined preview</strong><button className="text-button" onClick={() => setSampleIndex((value) => (value + 1) % posterPreviewSamples[selectedLibrary.type].length)}>Cycle poster</button></div><div className="combined-poster"><img className="poster-preview-backdrop" src={posterPreviewSample(selectedLibrary.type, sampleIndex).imageUrl} alt={`${posterPreviewSample(selectedLibrary.type, sampleIndex).title} example poster`} /><span>{posterPreviewSample(selectedLibrary.type, sampleIndex).title}</span>{draftTemplateIds.filter((id) => !hiddenPreviewIds.includes(id)).map((id, index) => { const template = workspace.templates.find((item) => item.id === id); return template ? <div className="combined-template-layer" key={id} style={{zIndex:draftTemplateIds.length-index}}><OverlayDesignPreview template={template} layersOnly mediaType={selectedLibrary.type} sampleIndex={sampleIndex} /></div> : null; })}{!draftTemplateIds.filter((id) => !hiddenPreviewIds.includes(id)).length && <em>Select overlays to see preview</em>}</div><p className="field-help">This combines the saved layers in render order on an example {selectedLibrary.type === 'movie' ? 'movie' : 'TV show'} poster. Preview visibility does not change which overlays are saved or applied.</p></section>
          <section className="overlay-order-panel"><p className="field-help">Use the arrow controls to reorder. Expand an item for its description and application condition. Selecting an inactive imported template activates it when you save this library.</p>{workspace.templates.map((template) => {
            const enabled = draftTemplateIds.includes(template.id);
            const order = draftTemplateIds.indexOf(template.id);
            const hidden = hiddenPreviewIds.includes(template.id);
            return <article className={enabled ? 'selected' : ''} key={template.id}><input aria-label={`Enable ${template.name}`} type="checkbox" checked={enabled} onChange={() => setDraftTemplateIds((ids) => enabled ? ids.filter((id) => id !== template.id) : [...ids, template.id])} /><details><summary>{template.name}{!template.enabled && <small className="inactive-selection-note">Inactive · activates on save</small>}</summary><p>{template.description}</p><small>{template.conditionSummary || 'Always apply'}</small></details>{enabled && <div className="order-actions"><button aria-label={`Move ${template.name} up`} disabled={order === 0} onClick={() => setDraftTemplateIds((ids) => { const next=[...ids]; [next[order-1],next[order]]=[next[order],next[order-1]]; return next; })}>↑</button><button aria-label={`Move ${template.name} down`} disabled={order === draftTemplateIds.length - 1} onClick={() => setDraftTemplateIds((ids) => { const next=[...ids]; [next[order],next[order+1]]=[next[order+1],next[order]]; return next; })}>↓</button><button className={hidden ? 'preview-hidden' : ''} aria-label={`${hidden ? 'Show' : 'Hide'} ${template.name} in preview`} onClick={() => setHiddenPreviewIds((ids) => hidden ? ids.filter((id) => id !== template.id) : [...ids, template.id])}>{hidden ? 'Show' : 'Hide'}</button></div>}</article>;
          })}</section>
        </div>
        {selectedLibrary.type === 'show' && <div className="library-options"><label><input type="checkbox" checked={draftEpisodeScanning} onChange={(event) => setDraftEpisodeScanning(event.target.checked)} /><span><strong>Use episode files for quality badges</strong><small>Scans individual episode files to determine show resolution, HDR, and audio. This is more accurate than Plex’s default show metadata.</small></span></label><label className={!selectedLibrary.maintainerrConfigured ? 'disabled' : ''}><input type="checkbox" disabled={!selectedLibrary.maintainerrConfigured} checked={draftMaintainerr} onChange={(event) => setDraftMaintainerr(event.target.checked)} /><span><strong>Season deletion countdown</strong><small>Applies deletion-countdown overlays to seasons in Maintainerr collections. Requires a Maintainerr connection, a Season collection with a deletion schedule, and an enabled countdown template. Season collections trigger a full-library Maintainerr scan.</small>{!selectedLibrary.maintainerrConfigured && <em>Connect Maintainerr in Settings to enable this.</em>}</span></label></div>}
        {workspace.source.source === 'tmdb' && <div className="language-option"><label htmlFor="library-tmdb-language">TMDB poster language</label><select id="library-tmdb-language" value={draftLanguage} onChange={(event) => setDraftLanguage(event.target.value)}><option value="">Use global setting</option><option value="en-US">English (United States)</option><option value="en-GB">English (United Kingdom)</option><option value="es-ES">Spanish (Spain)</option><option value="fr-FR">French (France)</option><option value="de-DE">German (Germany)</option><option value="ja-JP">Japanese</option></select><small>Language for fetching poster metadata from TMDB.</small></div>}
        <footer className="modal-actions"><button className="button secondary" disabled={libraryMutationBusy === selectedLibrary.id} onClick={() => setSelectedLibrary(undefined)}>Cancel</button><button className="button secondary" disabled={libraryMutationBusy === selectedLibrary.id} onClick={() => void saveLibrary()}>Save only</button><button className="button primary" disabled={libraryMutationBusy === selectedLibrary.id} onClick={() => void saveLibrary(true)}>{libraryMutationBusy === selectedLibrary.id ? 'Starting…' : 'Save and apply'}</button></footer>
      </section></div>}
      {resetLibrary && <div className="modal-backdrop" role="presentation"><section className="poster-modal reset-modal" role="alertdialog" aria-modal="true" aria-labelledby="reset-title"><div className="modal-heading"><div><p className="eyebrow danger-text">Destructive operation</p><h2 id="reset-title">Confirm poster reset</h2></div><button className="icon-button" aria-label="Close poster reset confirmation" onClick={() => setResetLibrary(undefined)}>×</button></div><p>This will reset <strong>all posters in “{resetLibrary.name}”</strong> to their base versions without overlays. The current {sourceCopy[workspace.source.source].name} source will be respected.</p><div className="warning-panel"><strong>This operation cannot be undone.</strong><p>Every overlay-modified poster in this library will be replaced.</p></div><footer className="modal-actions"><button className="button secondary" onClick={() => setResetLibrary(undefined)}>Cancel</button><button className="button danger" onClick={() => void runLibraryAction(resetLibrary, 'reset')}>Reset all posters</button></footer></section></div>}
      {testOpen && <div className="modal-backdrop" role="presentation"><section className="poster-modal test-item-modal" role="dialog" aria-modal="true" aria-labelledby="test-title"><div className="modal-heading"><div><p className="eyebrow">Diagnostic preview</p><h2 id="test-title">{testResult ? 'Test item — Results' : 'Test item — Search'}</h2><p>{testResult ? 'See which templates matched and inspect the exact context used by the renderer.' : 'Search for a movie or TV show in the connected Plex libraries.'}</p></div><button className="icon-button" aria-label="Close test item dialog" onClick={() => setTestOpen(false)}>×</button></div>
        {!testResult ? (
          <>
            <div className="test-search">
              <input aria-label="Search for a movie or TV show" placeholder="Search for a movie or TV show…" value={testQuery} onChange={(event) => setTestQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchTestItems(); }} />
              <button className="button primary" disabled={!testQuery.trim() || testBusy} onClick={() => void searchTestItems()}>{testBusy ? 'Searching…' : 'Search'}</button>
            </div>
            <div className="test-result-grid">
              {testItems.map((item) => (
                <button className={selectedTestItem === item.ratingKey ? 'selected' : ''} key={item.ratingKey} onClick={() => setSelectedTestItem(item.ratingKey)}>
                  <span className={`test-poster ${item.type}`}>{item.type === 'movie' ? 'M' : 'TV'}</span>
                  <strong>{item.title}</strong>
                  <small>{item.year} · {item.libraryName}</small>
                  <em>Test this item</em>
                </button>
              ))}
            </div>
            <footer className="modal-actions">
              <button className="button secondary" onClick={() => setTestOpen(false)}>Cancel</button>
              <button className="button primary" disabled={!selectedTestItem || testBusy} onClick={() => void runTest()}>{testBusy ? 'Rendering…' : 'Test overlay'}</button>
            </footer>
          </>
        ) : (
          <div className="test-output">
            <section>
              <h3>Rendered poster</h3>
              <div className="rendered-test-poster"><img src={`/api/posters/overlays/items/${encodeURIComponent(testResult.item.ratingKey)}/preview`} alt={`Rendered overlay preview for ${testResult.item.title}`} /></div>
              {!testApplied ? (
                <button className="button primary" disabled={testBusy} onClick={() => {
                  setTestBusy(true);
                  void api.applyPosterItem(testResult.item.ratingKey)
                    .then((result) => {
                      setWorkspace(result);
                      setTestApplied(true);
                      setMessage(`Overlay applied to ${testResult.item.title} in Plex.`);
                    })
                    .catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to apply this poster.'))
                    .finally(() => setTestBusy(false));
                }}>{testBusy ? 'Applying…' : 'Apply to this item in Plex'}</button>
              ) : (
                <button className="button danger" disabled={testBusy} onClick={() => {
                  setTestBusy(true);
                  void api.resetPosterItem(testResult.item.ratingKey)
                    .then((result) => {
                      setWorkspace(result);
                      setTestApplied(false);
                      setMessage(`Original poster restored for ${testResult.item.title}.`);
                    })
                    .catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to restore this poster.'))
                    .finally(() => setTestBusy(false));
                }}>{testBusy ? 'Restoring…' : 'Restore original poster'}</button>
              )}
            </section>
            <section>
              <h3>Template results</h3>
              {testResult.templates.map((template) => <details key={template.id}><summary><span className={template.matched ? 'test-pass' : 'test-fail'}>{template.matched ? '✓' : '×'}</span><strong>{template.name}</strong><em>{template.matched ? 'Matched' : 'Not matched'}</em></summary><p>{template.conditionSummary || 'No conditions (always applies)'}</p>{template.actualValue && <small>Actual value: {template.actualValue}</small>}</details>)}
              <details><summary><strong>Context variables ({Object.keys(testResult.context).length})</strong></summary><dl className="context-list">{Object.entries(testResult.context).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value ?? 'undefined')}</dd></div>)}</dl></details>
              {testResult.errors.length > 0 && <div className="error-panel">{testResult.errors.join(' · ')}</div>}
            </section>
          </div>
        )}
        {testResult && <footer className="modal-actions"><button className="button secondary" onClick={() => { setTestResult(undefined); setTestApplied(false); }}>Back to search</button><button className="button secondary" onClick={() => setTestOpen(false)}>Close</button></footer>}
      </section></div>}
      {editingTemplate !== undefined && <OverlayTemplateEditor template={editingTemplate ?? undefined} previewSampleIndex={editingTemplate ? Math.max(0, workspace.templates.findIndex((item) => item.id === editingTemplate.id)) : 0} otherTemplates={workspace.templates} libraries={workspace.libraries} onClose={() => setEditingTemplate(undefined)} onSave={async (input) => { const result = await api.saveOverlayTemplate(editingTemplate?.id, input); setWorkspace(result); setEditingTemplate(undefined); setMessage('Overlay template saved.'); }} />}
      {deleteOverlayId && <div className="modal-backdrop"><section className="poster-modal reset-modal" role="alertdialog" aria-modal="true"><h2>Delete overlay template?</h2><p>The template will be removed from every library configuration. Existing rendered Plex posters are unchanged until the next apply or reset operation.</p><footer className="modal-actions"><button className="button secondary" onClick={() => setDeleteOverlayId(undefined)}>Cancel</button><button className="button danger" onClick={() => void api.deleteOverlayTemplate(deleteOverlayId).then((result) => { setWorkspace(result); setDeleteOverlayId(undefined); })}>Delete template</button></footer></section></div>}
      {copySource && <CopyOverlayElementsModal source={copySource} templates={workspace.templates} onClose={() => setCopySource(undefined)} onCopy={async (elementIds,targetIds) => { const result=await api.copyOverlayElements(copySource.id,targetIds,elementIds); setWorkspace(result.workspace); setMessage(`${result.copiedElements} ${result.copiedElements===1?'element':'elements'} copied to ${result.copiedTargets} ${result.copiedTargets===1?'template':'templates'}.`); }} />}
    </div>
  );
};
