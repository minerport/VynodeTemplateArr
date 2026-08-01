import type { PlexDiscoveredItemDraft } from '@vynode/contracts';

const weekdays = [
  ['monday', 'Mon'],
  ['tuesday', 'Tue'],
  ['wednesday', 'Wed'],
  ['thursday', 'Thu'],
  ['friday', 'Fri'],
  ['saturday', 'Sat'],
  ['sunday', 'Sun'],
] as const;

export function DiscoveredScheduleFields({
  draft,
  onChange,
}: {
  draft: PlexDiscoveredItemDraft;
  onChange: (draft: PlexDiscoveredItemDraft) => void;
}) {
  const schedule = draft.timeRestriction;
  const update = (next: Partial<typeof schedule>) =>
    onChange({
      ...draft,
      timeRestriction: {
        ...schedule,
        ...next,
        removeFromPlexWhenInactive: false,
      },
    });

  return (
    <fieldset className="discovered-schedule">
      <legend>Active schedule</legend>
      <label className="check-row">
        <input
          type="checkbox"
          checked={schedule.alwaysActive}
          onChange={(event) => update({ alwaysActive: event.target.checked })}
        />
        <span>
          <strong>Always active</strong>
          <small>Turn this off to use seasonal dates or selected weekdays.</small>
        </span>
      </label>
      {!schedule.alwaysActive && (
        <>
          <p className="field-help">
            Built-in hubs and existing Plex collections remain in Plex while inactive. Vynode applies the inactive visibility below.
          </p>
          <div className="inactive-visibility">
            <strong>Visibility while inactive</strong>
            {([
              ['usersHome', 'Users Home'],
              ['serverOwnerHome', 'Server Owner Home'],
              ['libraryRecommended', 'Library Recommended'],
            ] as const).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={schedule.inactiveVisibility[key]}
                  onChange={(event) =>
                    update({
                      inactiveVisibility: {
                        ...schedule.inactiveVisibility,
                        [key]: event.target.checked,
                      },
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <div className="date-ranges">
            <div>
              <strong>Seasonal date ranges</strong>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  update({
                    dateRanges: [
                      ...schedule.dateRanges,
                      { startDate: '01-01', endDate: '31-12' },
                    ],
                  })
                }
              >
                Add date range
              </button>
            </div>
            {schedule.dateRanges.length === 0 && (
              <small>No date restriction. Weekday selections still apply.</small>
            )}
            {schedule.dateRanges.map((range, index) => (
              <div className="date-range" key={`${index}-${range.startDate}-${range.endDate}`}>
                <label>
                  Start
                  <input
                    aria-label={`Date range ${index + 1} start`}
                    placeholder="DD-MM"
                    maxLength={5}
                    value={range.startDate}
                    onChange={(event) =>
                      update({
                        dateRanges: schedule.dateRanges.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, startDate: event.target.value }
                            : item
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  End
                  <input
                    aria-label={`Date range ${index + 1} end`}
                    placeholder="DD-MM"
                    maxLength={5}
                    value={range.endDate}
                    onChange={(event) =>
                      update({
                        dateRanges: schedule.dateRanges.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, endDate: event.target.value }
                            : item
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="text-button danger-text"
                  onClick={() =>
                    update({
                      dateRanges: schedule.dateRanges.filter(
                        (_item, itemIndex) => itemIndex !== index
                      ),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <small>Use DD-MM. Ranges may wrap across the end of the year, such as 15-12 to 05-01.</small>
          </div>
          <div className="weekday-grid">
            {weekdays.map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={schedule.weeklySchedule[key]}
                  onChange={(event) =>
                    update({
                      weeklySchedule: {
                        ...schedule.weeklySchedule,
                        [key]: event.target.checked,
                      },
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <small>At least one enabled date range and weekday must match for the item to be active.</small>
        </>
      )}
    </fieldset>
  );
}
