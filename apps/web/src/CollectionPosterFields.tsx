import { useEffect, useState } from 'react';
import type { CollectionDraft, CollectionPosterWorkspace } from '@vynode/contracts';
import { api } from './api';

export function CollectionPosterFields({
  draft,
  onChange,
  onMessage,
}: {
  draft: CollectionDraft;
  onChange: (draft: CollectionDraft) => void;
  onMessage: (message: string) => void;
}) {
  const [workspace, setWorkspace] = useState<CollectionPosterWorkspace>();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'saved' | 'upload'>('saved');
  useEffect(() => {
    void api.collectionPosters().then(setWorkspace).catch(() => undefined);
  }, []);
  const settings = draft.posterSettings;
  const update = (value: Partial<typeof settings>) =>
    onChange({ ...draft, posterSettings: { ...settings, ...value } });
  const upload = (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      onMessage('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      onMessage('Poster files must be 10 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      update({ autoGenerate: false, customPoster: { kind: 'upload', id: `upload-${Date.now()}`, name: file.name, previewDataUrl: String(reader.result) } });
      setOpen(false);
      onMessage('Poster uploaded successfully. It will be applied during the next collection sync.');
    };
    reader.readAsDataURL(file);
  };
  return <>
    <fieldset className="poster-settings"><legend>Collection poster</legend>
      <label className="check-row"><input type="checkbox" checked={settings.autoGenerate} onChange={(event) => update({ autoGenerate: event.target.checked })} /><span><strong>Auto-generate collection posters</strong><small>Automatically generate posters using the collection name during sync. Turn this off to select or upload a custom poster.</small></span></label>
      {settings.autoGenerate && <label>Poster template<select value={settings.templateId ?? workspace?.templates.find((item) => item.isDefault)?.id ?? ''} onChange={(event) => update({ templateId: event.target.value })}>{workspace?.templates.map((item) => <option key={item.id} value={item.id}>{item.name}{item.isDefault ? ' — Default' : ''}</option>)}</select><small>Choose the template used to generate this collection’s poster.</small></label>}
      <label className="check-row"><input type="checkbox" checked={settings.applyOverlaysDuringSync} onChange={(event) => update({ applyOverlaysDuringSync: event.target.checked })} /><span><strong>Apply item overlays during sync</strong><small>Apply overlays immediately after collection sync. Otherwise they are applied by the regular overlays job.</small></span></label>
      <label className="check-row"><input type="checkbox" checked={settings.useTmdbFranchisePoster} onChange={(event) => update({ useTmdbFranchisePoster: event.target.checked })} /><span><strong>Use TMDB franchise poster</strong><small>Use official TMDB artwork when available. This overrides auto-generation for that collection.</small></span></label>
      <label className="check-row"><input type="checkbox" checked={settings.hideIndividualItems} onChange={(event) => update({ hideIndividualItems: event.target.checked })} /><span><strong>Hide individual items in collection</strong><small>Hide items from the Library tab and show only the collection. Items in another collection may remain visible.</small></span></label>
      {!settings.autoGenerate && <div className="custom-poster-row">{settings.customPoster ? <div className="selected-poster">{settings.customPoster.previewDataUrl ? <img src={settings.customPoster.previewDataUrl} alt={`Selected poster ${settings.customPoster.name}`} /> : <span aria-hidden="true">POSTER</span>}<div><strong>{settings.customPoster.name}</strong><small>Applied during the next collection sync.</small></div><button type="button" className="text-button danger-text" onClick={() => update({ customPoster: undefined })}>Remove</button></div> : <p className="field-help">No custom poster selected. Choose an existing poster or upload a new image.</p>}<button type="button" className="button secondary" onClick={() => setOpen(true)}>{settings.customPoster ? 'Replace poster' : 'Select poster'}</button></div>}
    </fieldset>
    {open && <div className="modal-backdrop poster-picker-backdrop"><section className="folder-modal poster-picker" role="dialog" aria-modal="true" aria-labelledby="poster-picker-title"><div className="modal-heading"><div><p className="eyebrow">Poster library</p><h3 id="poster-picker-title">Select poster</h3></div><button type="button" className="icon-button" aria-label="Close poster selection" onClick={() => setOpen(false)}>×</button></div><div className="tab-row"><button type="button" className={tab === 'saved' ? 'active' : ''} onClick={() => setTab('saved')}>Saved posters</button><button type="button" className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>Upload new</button></div>{tab === 'saved' ? <><div className="poster-choice-grid">{workspace?.savedPosters.map((poster) => <button type="button" key={poster.id} className="poster-choice" onClick={() => { update({ autoGenerate: false, customPoster: { kind: 'saved', id: poster.id, name: poster.name } }); setOpen(false); onMessage('Poster selected. It will be applied during the next collection sync.'); }}><span style={{ background: `linear-gradient(145deg, ${poster.design.background.color}, ${poster.design.background.secondaryColor ?? '#101820'})` }}>V</span><strong>{poster.name}</strong><small>{poster.description || 'Saved collection poster'}</small></button>)}</div>{!workspace?.savedPosters.length && <p className="field-help">No posters available. Create one in Posters → Collections or upload a file here.</p>}</> : <label className="poster-drop">Upload poster<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => upload(event.target.files?.[0])} /><small>Choose a JPEG, PNG, or WebP image up to 10 MB. Portrait artwork near a 2:3 ratio works best.</small></label>}<div className="actions"><button type="button" className="button secondary" onClick={() => setOpen(false)}>Cancel</button><a className="button secondary" href="/posters/collections">Create new poster</a></div></section></div>}
  </>;
}
