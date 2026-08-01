import type { CollectionAssetReference, CollectionDraft, CollectionMetadataSettings } from '@vynode/contracts';

export const defaultCollectionMetadata: CollectionMetadataSettings = {
  enableCustomSummary: false,
  customSummary: '',
  enableCustomWallpaper: false,
  enableCustomTheme: false,
};

export function CollectionMetadataFields({ draft, onChange, onMessage }: { draft: CollectionDraft; onChange: (draft: CollectionDraft) => void; onMessage: (message: string) => void }) {
  const settings = draft.metadataSettings;
  const update = (value: Partial<typeof settings>) => onChange({ ...draft, metadataSettings: { ...settings, ...value } });
  const upload = (kind: 'wallpaper' | 'theme', file?: File) => {
    if (!file) return;
    const allowed = kind === 'wallpaper'
      ? ['image/jpeg', 'image/png', 'image/webp']
      : ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/ogg', 'audio/aac', 'audio/x-m4a', 'audio/mp4'];
    if (!allowed.includes(file.type)) {
      onMessage(kind === 'wallpaper' ? 'Only JPEG, PNG, and WebP wallpaper files are allowed.' : 'Only MP3, WAV, FLAC, OGG, AAC, and M4A theme files are allowed.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      onMessage(`${kind === 'wallpaper' ? 'Wallpaper' : 'Theme'} files must be smaller than 10 MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const asset: CollectionAssetReference = {
        id: `${kind}-${crypto.randomUUID()}`,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        previewDataUrl: String(reader.result),
      };
      update({ [kind]: asset });
      onMessage(`${kind === 'wallpaper' ? 'Wallpaper' : 'Theme'} uploaded successfully. It will be applied during the next collection sync.`);
    };
    reader.onerror = () => onMessage(`Unable to read the selected ${kind} file.`);
    reader.readAsDataURL(file);
  };
  return <fieldset className="metadata-settings"><legend>Wallpapers, summary, and theme</legend>
    <label className="check-row"><input type="checkbox" checked={settings.enableCustomWallpaper} onChange={(event) => update({ enableCustomWallpaper: event.target.checked })} /><span><strong>Custom wallpaper</strong><small>Replace the Plex collection background artwork during synchronization.</small></span></label>
    {settings.enableCustomWallpaper && <div className="asset-row">{settings.wallpaper ? <><img src={settings.wallpaper.previewDataUrl} alt={`Wallpaper preview ${settings.wallpaper.name}`} /><div><strong>{settings.wallpaper.name}</strong><small>{(settings.wallpaper.size / 1024 / 1024).toFixed(2)} MB · applied on next sync</small></div><label className="button secondary file-button">Change<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => upload('wallpaper', event.target.files?.[0])} /></label><button type="button" className="text-button danger-text" onClick={() => { const { wallpaper: _wallpaper, ...rest } = settings; onChange({ ...draft, metadataSettings: rest }); onMessage('Wallpaper will be removed during the next collection sync.'); }}>Remove</button></> : <label className="asset-drop">Upload wallpaper<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => upload('wallpaper', event.target.files?.[0])} /><small>JPEG, PNG, or WebP up to 10 MB. Wide 16:9 artwork is recommended.</small></label>}</div>}
    <label className="check-row"><input type="checkbox" checked={settings.enableCustomSummary} onChange={(event) => update({ enableCustomSummary: event.target.checked })} /><span><strong>Custom summary</strong><small>Override provider text with a description synchronized directly to Plex.</small></span></label>
    {settings.enableCustomSummary && <label>Collection summary<textarea required rows={4} maxLength={5000} value={settings.customSummary} placeholder="Enter a custom description for this collection…" onChange={(event) => update({ customSummary: event.target.value })} /><small>{settings.customSummary.length.toLocaleString()} / 5,000 characters. Plain text is sent to Plex.</small></label>}
    <label className="check-row"><input type="checkbox" checked={settings.enableCustomTheme} onChange={(event) => update({ enableCustomTheme: event.target.checked })} /><span><strong>Custom theme music</strong><small>Upload collection theme audio for Plex clients that support theme playback.</small></span></label>
    {settings.enableCustomTheme && <div className="asset-row theme-asset">{settings.theme ? <><div className="theme-mark" aria-hidden="true">♫</div><div><strong>{settings.theme.name}</strong><small>{(settings.theme.size / 1024 / 1024).toFixed(2)} MB · applied on next sync</small></div><audio controls preload="metadata" src={settings.theme.previewDataUrl}><track kind="captions" /></audio><label className="button secondary file-button">Change<input type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/flac,audio/ogg,audio/aac,audio/x-m4a,audio/mp4" onChange={(event) => upload('theme', event.target.files?.[0])} /></label><button type="button" className="text-button danger-text" onClick={() => { const { theme: _theme, ...rest } = settings; onChange({ ...draft, metadataSettings: rest }); onMessage('Theme music will be removed during the next collection sync.'); }}>Remove</button></> : <label className="asset-drop">Upload theme music<input type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/flac,audio/ogg,audio/aac,audio/x-m4a,audio/mp4" onChange={(event) => upload('theme', event.target.files?.[0])} /><small>MP3, WAV, FLAC, OGG, AAC, or M4A up to 10 MB.</small></label>}</div>}
    <p className="field-help">Disabling an option keeps its uploaded asset in Vynode but stops applying it. Remove deletes the assignment on the next sync.</p>
  </fieldset>;
}
