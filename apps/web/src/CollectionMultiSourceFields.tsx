import { useEffect, useMemo, useState } from 'react';
import type { CollectionDraft, CollectionMultiSourceEntry, CollectionMultiSourceSettings } from '@vynode/contracts';
import { api } from './api';
import { collectionCustomUrlPlaceholders, collectionSourceOptions, collectionSubtypes } from './CollectionSourceFields';
import { createClientId } from './clientId';

export const defaultMultiSourceSettings: CollectionMultiSourceSettings = {
  combineMode: 'interleaved',
  sources: [],
};

const allowedTypes = collectionSourceOptions.filter((item) => !['manual', 'multi-source', 'filtered-hub', 'plex'].includes(item.value));

export function CollectionMultiSourceFields({ draft, onChange, onMessage }: { draft: CollectionDraft; onChange: (draft: CollectionDraft) => void; onMessage: (message: string) => void }) {
  const settings = draft.multiSourceSettings;
  const [validating, setValidating] = useState<string>();
  const update = (value: Partial<CollectionMultiSourceSettings>) => onChange({ ...draft, multiSourceSettings: { ...settings, ...value } });
  const updateSource = (id: string, value: Partial<CollectionMultiSourceEntry>) =>
    update({ sources: settings.sources.map((source) => source.id === id ? { ...source, ...value, validation: value.validation ?? (Object.keys(value).some((key) => ['type', 'subtype', 'customUrl'].includes(key)) ? { state: 'unvalidated' as const } : source.validation) } : source) });
  const normalizedSources = settings.sources.map((source, index) => ({ ...source, priority: index }));
  const contentTypes = [...new Set(settings.sources.map((source) => source.validation?.contentType).filter(Boolean))];
  const mixedContent = contentTypes.includes('mixed') || (contentTypes.includes('movie') && contentTypes.includes('show'));
  const allComingSoon = settings.sources.length > 0 && settings.sources.every((source) => source.type === 'comingsoon');
  useEffect(() => {
    if (mixedContent && settings.combineMode !== 'cycle-lists') update({ combineMode: 'cycle-lists' });
  }, [mixedContent, settings.combineMode]);
  const combineOptions = useMemo(() => [
    { value: 'interleaved' as const, label: allComingSoon ? 'Release date' : 'Interleaved', help: allComingSoon ? 'Combine every source and sort upcoming items by nearest release.' : 'Take the first item from each source, then the second from each, continuing in priority order.' },
    { value: 'list-order' as const, label: 'List order', help: 'Append all items from the first source, then all items from the second, removing duplicates by first appearance.' },
    { value: 'randomized' as const, label: 'Randomized', help: 'Combine unique items and shuffle them on every synchronization.' },
    { value: 'cycle-lists' as const, label: 'Cycle lists', help: 'Activate one source per synchronization and rotate through sources in priority order.' },
  ], [allComingSoon]);
  const validate = async (source: CollectionMultiSourceEntry) => {
    setValidating(source.id);
    try {
      const result = await api.validateCollectionSource(source.type, source.subtype, source.customUrl);
      updateSource(source.id, { validation: { state: 'valid', title: result.title, contentType: result.contentType } });
      onMessage(`${result.title ?? 'Source'} validated as ${result.contentType ?? 'supported'} content.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Source validation failed.';
      updateSource(source.id, { validation: { state: 'invalid', message } });
      onMessage(message);
    } finally {
      setValidating(undefined);
    }
  };
  if (draft.sourceType !== 'multi-source') return null;
  return <fieldset className="multi-source-settings"><legend>Multiple sources</legend>
    <p className="field-help">Combine provider lists into one collection. Sources are evaluated in the priority shown below and duplicate media is retained only once.</p>
    <div className="multi-source-list">{normalizedSources.map((source, index) => {
      const subtypeOptions = collectionSubtypes[source.type] ?? [];
      const customPlaceholder = collectionCustomUrlPlaceholders[source.type];
      const needsUrl = !!customPlaceholder && (source.subtype === 'custom' || (source.type === 'letterboxd' && source.subtype === 'watchlist'));
      const usesPeriod = source.type === 'trakt' && ['played', 'watched', 'collected', 'favorited'].includes(source.subtype);
      return <article className="multi-source-card" key={source.id}><header><div><strong>Source {index + 1}</strong><small>Priority {index + 1}</small></div><div className="source-order-actions"><button type="button" aria-label={`Move source ${index + 1} up`} disabled={index === 0} onClick={() => { const next = [...settings.sources]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; update({ sources: next }); }}>↑</button><button type="button" aria-label={`Move source ${index + 1} down`} disabled={index === settings.sources.length - 1} onClick={() => { const next = [...settings.sources]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; update({ sources: next }); }}>↓</button><button type="button" className="text-button danger-text" onClick={() => update({ sources: settings.sources.filter((item) => item.id !== source.id).map((item, itemIndex) => ({ ...item, priority: itemIndex })) })}>Remove</button></div></header><div className="field-grid"><label>Source type<select value={source.type} onChange={(event) => updateSource(source.id, { type: event.target.value as CollectionMultiSourceEntry['type'], subtype: '', customUrl: '' })}>{allowedTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{subtypeOptions.length > 0 && <label>Collection subtype<select required value={source.subtype} onChange={(event) => updateSource(source.id, { subtype: event.target.value, customUrl: '' })}><option value="">Select subtype…</option>{subtypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}</div>{needsUrl && <label>Custom URL<input required type="url" placeholder={customPlaceholder} value={source.customUrl ?? ''} onChange={(event) => updateSource(source.id, { customUrl: event.target.value })} /><small>Validate the URL to resolve its title and detect movie, show, or mixed content.</small></label>}{usesPeriod && <label>Time period<select value={source.timePeriod ?? 'weekly'} onChange={(event) => updateSource(source.id, { timePeriod: event.target.value as NonNullable<CollectionMultiSourceEntry['timePeriod']> })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="all">All time</option></select></label>}{source.type === 'tautulli' && <div className="field-grid"><label>Statistics days<input required type="number" min={1} max={365} value={source.customDays ?? 30} onChange={(event) => updateSource(source.id, { customDays: Number(event.target.value) })} /><small>Measure the most recent 1 through 365 days.</small></label><label>Minimum plays<input required type="number" min={1} max={100} value={source.minimumPlays ?? 3} onChange={(event) => updateSource(source.id, { minimumPlays: Number(event.target.value) })} /><small>Exclude titles below this play count.</small></label></div>}{source.type === 'networks' && <label>Country or region<select value={source.networkCountry ?? 'US'} onChange={(event) => updateSource(source.id, { networkCountry: event.target.value })}><option value="US">United States</option><option value="GB">United Kingdom</option><option value="CA">Canada</option><option value="AU">Australia</option><option value="JP">Japan</option><option value="KR">South Korea</option></select><small>The streaming-platform list is resolved for this country.</small></label>}<footer><span className={`validation-chip ${source.validation?.state ?? 'unvalidated'}`}>{source.validation?.state === 'valid' ? `${source.validation.title} · ${source.validation.contentType}` : source.validation?.state === 'invalid' ? source.validation.message : 'Not validated'}</span><button type="button" className="button secondary" disabled={validating === source.id || !source.subtype} onClick={() => void validate(source)}>{validating === source.id ? 'Validating…' : 'Validate source'}</button></footer></article>;
    })}</div>
    {!settings.sources.length && <div className="empty-inline"><strong>No sources configured.</strong><span>Add at least two sources to build a combined collection.</span></div>}
    <button type="button" className="button secondary" onClick={() => update({ sources: [...settings.sources, { id: `source-${createClientId()}`, type: 'trakt', subtype: '', priority: settings.sources.length, validation: { state: 'unvalidated' } }] })}>Add source</button>
    {mixedContent && <div className="dependency-notice missing"><strong>Conflicting movie and show lists detected</strong><span>Only Cycle lists is available because Plex collections cannot contain movies and shows together. Each source will be active separately.</span></div>}
    <div className="combine-modes"><strong>Combine mode</strong>{combineOptions.map((option) => { const disabled = mixedContent && option.value !== 'cycle-lists'; return <label className={disabled ? 'disabled' : ''} key={option.value}><input type="radio" name="combine-mode" value={option.value} checked={(mixedContent ? 'cycle-lists' : settings.combineMode) === option.value} disabled={disabled} onChange={() => update({ combineMode: option.value })} /><span><strong>{option.label}</strong><small>{option.help}</small></span></label>; })}</div>
  </fieldset>;
}
