import type {
  CollectionBehaviorSettings,
  CollectionDraft,
  CollectionVisibilitySettings,
} from '@vynode/contracts';

export const defaultCollectionBehavior: CollectionBehaviorSettings = {
  visibility: {
    usersHome: true,
    serverOwnerHome: true,
    libraryRecommended: true,
  },
  excludedTitles: [],
  mutuallyExclusiveCollectionIds: [],
  randomizeHomeOrder: false,
  showUnwatchedOnly: false,
  smartCollectionSort: 'titleAsc',
  timeRestriction: {
    alwaysActive: true,
    removeFromPlexWhenInactive: false,
    inactiveVisibility: {
      usersHome: false,
      serverOwnerHome: false,
      libraryRecommended: false,
    },
    dateRanges: [],
    weeklySchedule: {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: true,
      sunday: true,
    },
  },
  syncSchedule: {
    enabled: false,
    scheduleType: 'preset',
    preset: '1d',
    customCron: '',
    startNow: true,
    startDate: '01-01',
    startTime: '09:00',
  },
};

const VisibilityChoices = ({
  value,
  onChange,
  prefix,
}: {
  value: CollectionVisibilitySettings;
  onChange: (value: CollectionVisibilitySettings) => void;
  prefix: string;
}) => (
  <div className="visibility-choices">
    <label>
      <input
        type="checkbox"
        checked={value.usersHome}
        onChange={(event) =>
          onChange({ ...value, usersHome: event.target.checked })
        }
      />{' '}
      Users Home
    </label>
    <label>
      <input
        type="checkbox"
        checked={value.serverOwnerHome}
        onChange={(event) =>
          onChange({ ...value, serverOwnerHome: event.target.checked })
        }
      />{' '}
      Server Owner Home
    </label>
    <label>
      <input
        type="checkbox"
        checked={value.libraryRecommended}
        onChange={(event) =>
          onChange({ ...value, libraryRecommended: event.target.checked })
        }
      />{' '}
      Library Recommended
    </label>
    {!value.usersHome &&
      !value.serverOwnerHome &&
      !value.libraryRecommended && (
        <small className="warning-text">
          No visibility options are selected. The collection will only appear on
          the Library tab.
        </small>
      )}
    <span className="sr-only">{prefix} visibility options</span>
  </div>
);

export function CollectionBehaviorFields({
  draft,
  onChange,
}: {
  draft: CollectionDraft;
  onChange: (draft: CollectionDraft) => void;
}) {
  const behavior = draft.behaviorSettings;
  const update = (value: Partial<CollectionBehaviorSettings>) =>
    onChange({ ...draft, behaviorSettings: { ...behavior, ...value } });
  const restriction = behavior.timeRestriction;
  const schedule = behavior.syncSchedule;
  const restrictedLibraryOnly =
    (draft.sourceType === 'tmdb' &&
      draft.sourceSettings.subtype === 'auto_franchise') ||
    (draft.sourceType === 'plex' &&
      ['actors', 'directors'].includes(draft.sourceSettings.subtype));
  const updateRestriction = (value: Partial<typeof restriction>) =>
    update({ timeRestriction: { ...restriction, ...value } });
  const updateSchedule = (value: Partial<typeof schedule>) =>
    update({ syncSchedule: { ...schedule, ...value } });
  const days = Object.keys(
    restriction.weeklySchedule
  ) as (keyof typeof restriction.weeklySchedule)[];
  return (
    <fieldset className="behavior-settings">
      <legend>Visibility and scheduling</legend>
      {restrictedLibraryOnly ? (
        <div className="dependency-notice missing">
          <strong>Library tab only</strong>
          <span>
            Automatic franchise, actor, and director collection families cannot
            be promoted to Home or Recommended because they can create many
            collections.
          </span>
        </div>
      ) : (
        <>
          <strong className="field-heading">Active visibility</strong>
          <VisibilityChoices
            prefix="Active"
            value={behavior.visibility}
            onChange={(visibility) => update({ visibility })}
          />
        </>
      )}
      <label>
        Excluded titles
        <textarea
          rows={4}
          value={(behavior.excludedTitles ?? []).join('\n')}
          placeholder={
            'One title per line\nExact matching ignores capitalization'
          }
          onChange={(event) =>
            update({
              excludedTitles: [
                ...new Set(
                  event.target.value
                    .split(/\r?\n/)
                    .map((value) => value.trim())
                    .filter(Boolean)
                ),
              ],
            })
          }
        />
        <small>
          These titles are removed from both previews and synchronization
          results after provider matching.
        </small>
      </label>
      <label>
        Mutually exclusive collection IDs
        <textarea
          rows={3}
          value={(behavior.mutuallyExclusiveCollectionIds ?? []).join('\n')}
          placeholder="One managed collection ID per line"
          onChange={(event) =>
            update({
              mutuallyExclusiveCollectionIds: [
                ...new Set(
                  event.target.value
                    .split(/\r?\n/)
                    .map((value) => value.trim())
                    .filter(Boolean)
                ),
              ],
            })
          }
        />
        <small>
          Items already present in these managed Plex collections are removed by
          verified Plex rating key.
        </small>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={behavior.randomizeHomeOrder}
          onChange={(event) =>
            update({ randomizeHomeOrder: event.target.checked })
          }
        />
        <span>
          <strong>Randomize Home position</strong>
          <small>
            Choose and verify a new Plex Home position after every successful
            synchronization. This applies only while the collection is visible
            on a Home screen.
          </small>
        </span>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          disabled={draft.itemType === 'season' || draft.itemType === 'episode'}
          checked={behavior.showUnwatchedOnly}
          onChange={(event) =>
            update({ showUnwatchedOnly: event.target.checked })
          }
        />
        <span>
          <strong>Show unwatched items only</strong>
          <small>
            {draft.itemType === 'season' || draft.itemType === 'episode'
              ? 'Unwatched-only filtering is not available for season or episode collections.'
              : 'Maintain this as a Plex smart collection that dynamically shows unwatched source members for the server owner. Vynode uses an isolated ownership label and preserves unrelated Plex labels.'}
          </small>
        </span>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={restriction.alwaysActive}
          onChange={(event) =>
            updateRestriction({ alwaysActive: event.target.checked })
          }
        />
        <span>
          <strong>Always active</strong>
          <small>
            Turn this off to limit when the collection appears in Plex.
          </small>
        </span>
      </label>
      {!restriction.alwaysActive && (
        <>
          <label className="check-row">
            <input
              type="checkbox"
              checked={restriction.removeFromPlexWhenInactive}
              onChange={(event) =>
                updateRestriction({
                  removeFromPlexWhenInactive: event.target.checked,
                })
              }
            />
            <span>
              <strong>Remove from Plex when inactive</strong>
              <small>
                Delete the Plex collection outside its active window. The Vynode
                definition and artwork remain available.
              </small>
            </span>
          </label>
          {!restriction.removeFromPlexWhenInactive && (
            <div className="inactive-visibility">
              <strong className="field-heading">
                Visibility while inactive
              </strong>
              <VisibilityChoices
                prefix="Inactive"
                value={restriction.inactiveVisibility}
                onChange={(inactiveVisibility) =>
                  updateRestriction({ inactiveVisibility })
                }
              />
              <small>
                These placements replace the active visibility settings outside
                the schedule.
              </small>
            </div>
          )}
          <div>
            <strong className="field-heading">Date ranges</strong>
            {restriction.dateRanges.map((range, index) => (
              <div className="date-range" key={`${index}-${range.startDate}`}>
                <input
                  aria-label={`Date range ${index + 1} start`}
                  required
                  pattern="\\d{2}-\\d{2}"
                  maxLength={5}
                  placeholder="DD-MM"
                  value={range.startDate}
                  onChange={(event) =>
                    updateRestriction({
                      dateRanges: restriction.dateRanges.map(
                        (item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, startDate: event.target.value }
                            : item
                      ),
                    })
                  }
                />
                <span>to</span>
                <input
                  aria-label={`Date range ${index + 1} end`}
                  required
                  pattern="\\d{2}-\\d{2}"
                  maxLength={5}
                  placeholder="DD-MM"
                  value={range.endDate}
                  onChange={(event) =>
                    updateRestriction({
                      dateRanges: restriction.dateRanges.map(
                        (item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, endDate: event.target.value }
                            : item
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="text-button danger-text"
                  onClick={() =>
                    updateRestriction({
                      dateRanges: restriction.dateRanges.filter(
                        (_, itemIndex) => itemIndex !== index
                      ),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              onClick={() =>
                updateRestriction({
                  dateRanges: [
                    ...restriction.dateRanges,
                    { startDate: '', endDate: '' },
                  ],
                })
              }
            >
              + Add date range
            </button>
            <small>
              Use DD-MM ranges. Leave this empty for year-round scheduling by
              weekday.
            </small>
          </div>
          <div>
            <strong className="field-heading">Days of the week</strong>
            <div className="weekday-grid">
              {days.map((day) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    checked={restriction.weeklySchedule[day]}
                    onChange={(event) =>
                      updateRestriction({
                        weeklySchedule: {
                          ...restriction.weeklySchedule,
                          [day]: event.target.checked,
                        },
                      })
                    }
                  />{' '}
                  {day.slice(0, 3)}
                </label>
              ))}
            </div>
            <small>At least one day must remain selected.</small>
          </div>
        </>
      )}
      {draft.sourceType !== 'filtered-hub' && (
        <div className="sync-schedule">
          <label className="check-row">
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(event) =>
                updateSchedule({ enabled: event.target.checked })
              }
            />
            <span>
              <strong>Enable custom sync timing</strong>
              <small>
                Override the global collection synchronization interval for this
                collection.
              </small>
            </span>
          </label>
          {schedule.enabled && (
            <>
              <label>
                Schedule
                <select
                  value={
                    schedule.scheduleType === 'custom'
                      ? 'custom'
                      : schedule.preset
                  }
                  onChange={(event) =>
                    event.target.value === 'custom'
                      ? updateSchedule({ scheduleType: 'custom' })
                      : updateSchedule({
                          scheduleType: 'preset',
                          preset: event.target.value as typeof schedule.preset,
                        })
                  }
                >
                  <option value="1h">Every hour</option>
                  <option value="3h">Every 3 hours</option>
                  <option value="6h">Every 6 hours</option>
                  <option value="12h">Every 12 hours</option>
                  <option value="1d">Daily</option>
                  <option value="3d">Every 3 days</option>
                  <option value="7d">Weekly</option>
                  <option value="custom">Custom cron expression</option>
                </select>
                <small>
                  Choose a preset interval or enter a standard five-part cron
                  expression.
                </small>
              </label>
              {schedule.scheduleType === 'custom' ? (
                <label>
                  Custom cron expression
                  <input
                    required
                    value={schedule.customCron}
                    placeholder="0 9 * * MON"
                    onChange={(event) =>
                      updateSchedule({ customCron: event.target.value })
                    }
                  />
                  <small>
                    Example: 0 9 * * MON runs every Monday at 9:00 AM in the
                    server timezone.
                  </small>
                </label>
              ) : (
                <>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={schedule.startNow}
                      onChange={(event) =>
                        updateSchedule({ startNow: event.target.checked })
                      }
                    />
                    <span>
                      <strong>Start on next sync</strong>
                      <small>
                        Turn this off to anchor the recurring cycle to a
                        specific date and time.
                      </small>
                    </span>
                  </label>
                  {!schedule.startNow && (
                    <div className="field-grid">
                      <label>
                        Start date
                        <input
                          required
                          pattern="\\d{2}-\\d{2}"
                          value={schedule.startDate}
                          placeholder="01-01"
                          onChange={(event) =>
                            updateSchedule({ startDate: event.target.value })
                          }
                        />
                        <small>DD-MM format</small>
                      </label>
                      <label>
                        Start time
                        <input
                          required
                          type="time"
                          value={schedule.startTime}
                          onChange={(event) =>
                            updateSchedule({ startTime: event.target.value })
                          }
                        />
                        <small>Server-local time</small>
                      </label>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}
