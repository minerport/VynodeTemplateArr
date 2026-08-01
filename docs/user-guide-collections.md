# Collections: User Guide

Collections let Vynode turn Plex library items and external lists into organized,
self-maintaining shelves. A collection can be a hand-picked list, a live list
from a connected service, a Plex smart filter, or a combination of multiple
sources.

This guide explains what collections can do, how to create them, and what each
setting changes.

## What you can do

With Vynode Collections, you can:

- create regular Plex collections from titles you select;
- create Plex smart collections whose membership changes automatically;
- build collections from Trakt, MDBList, IMDb, MyAnimeList, Tautulli, Plex, and
  other supported sources;
- generate an entire family of collections from one configuration, such as one
  collection for every selected genre or decade;
- preview source results and Plex matches before synchronization;
- control collection order and visibility on Plex Home, Recommended, and
  Library screens;
- generate or upload collection posters, wallpapers, summaries, and theme
  music;
- apply item overlays as part of synchronization;
- request missing titles through Seerr or send them directly to Radarr or
  Sonarr;
- schedule automatic refreshes;
- link equivalent configurations across compatible Plex libraries; and
- manage pre-existing Plex collections and built-in Plex hubs without replacing
  their membership.

## How a collection works

Every managed collection follows the same basic workflow:

1. **Source:** Vynode reads a manual selection, provider list, Plex metadata, or
   another configured source.
2. **Match:** Source identities are matched against the selected Plex library.
3. **Missing-media policy:** Unmatched titles can be reported, requested, sent
   to Radarr or Sonarr, or ignored.
4. **Plex synchronization:** Vynode creates or updates the appropriate regular
   or smart collection.
5. **Presentation:** Visibility, order, summary, artwork, and optional item
   overlays are applied.
6. **Refresh:** A manual or scheduled run repeats the process as source and
   library data change.

## Before you begin

Confirm the following:

- Plex is connected and the intended server and libraries appear under
  **Settings → Plex**.
- Any list provider you plan to use is configured and tested under
  **Settings → Sources**.
- Seerr, Radarr, or Sonarr is configured under **Settings → Downloads** if the
  collection should acquire missing media.
- Poster or overlay templates have been reviewed if the collection should use
  custom artwork.

Vynode only searches the Plex library selected in the collection editor. A
movie source must use a Movies library, and a television source must use a TV
Shows library.

## Create a collection

1. Open **All Collections**.
2. Select **Create collection**.
3. Choose a starting template or leave **Blank collection** selected.
4. Enter a collection name and optional description.
5. Choose **Movies** or **TV shows**.
6. Select the destination Plex library.
7. Choose a source and complete its source-specific settings.
8. Configure artwork, visibility, scheduling, and missing-media behavior.
9. Save the collection.
10. Select **Preview** to inspect the current source results.
11. Select **Sync** when the preview is correct.

Saving stores the configuration. Synchronizing performs the Plex and connected
service work.

## Starting templates

Templates are tested starting points. Selecting one fills the relevant fields,
but every setting remains editable before saving.

| Template | Result |
| --- | --- |
| **Genre Library** | One smart collection for each selected Plex genre. |
| **Through the Decades** | One smart collection for each selected decade. |
| **Video Quality** | Smart collections such as `4K Quality` and `1080p Quality`. |
| **Content Rating Guide** | Smart collections for selected content ratings. |
| **Genre Nights** | Genre collections with friendly names such as `Comedy Night`. |
| **Cinema by Era** | Decade collections such as `1990s Cinema`. |
| **Family Viewing Guide** | Rating collections focused on TV and numeric-age certifications. |

Choose the media type before selecting a template when you want its suggested
title pattern to say `Movies` or `TV Shows`. You can edit that pattern afterward.

## Plex Library value generators

A Plex Library generator creates multiple smart collections from one Vynode
configuration. Plex already knows the values; Vynode discovers them from the
selected library and presents them as checkboxes.

### Available generators

- **Genre:** Action, Comedy, Drama, Documentary, and other genres present in the
  library.
- **Decade:** Groups item years into values such as 1980s, 1990s, and 2020s.
- **Resolution:** Uses the video resolutions Plex reports, such as 720p, 1080p,
  and 4K.
- **Content rating:** Uses certifications such as TV-14, TV-MA, PG, M, MA15+,
  or numeric age ratings.

### Include selected

This is the default mode.

1. Start with no values selected.
2. Check each value that should have a collection.
3. Use **Select all shown** or **Clear shown** for faster selection.

Only checked values are maintained.

### Exclude unchecked

Use this when you want nearly every value:

1. Change the selection mode to **Exclude unchecked**.
2. Vynode checks the currently discovered values.
3. Uncheck the few values that should not have collections.

The saved checkbox list remains explicit, so a later preview shows exactly what
will be managed.

### Content-rating groups

Content ratings are grouped to keep mixed certification systems understandable:

- Australian ratings;
- television ratings;
- numeric age ratings; and
- other ratings.

Turn a group off to hide its values from the selection list and exclude them
from the generator.

### Collection title templates

Use `{value}` wherever the Plex value should appear:

- `{value}` produces `Comedy`.
- `{value} Movies` produces `Comedy Movies`.
- `{value} Quality` produces `1080p Quality`.
- `{value} Family Guide` produces `TV-14 Family Guide`.

The title must include `{value}` so every generated collection has a distinct
name.

### Automatic membership and cleanup

Generated collections are Plex smart filters. Plex automatically adds and
removes matching items as the library grows or metadata changes.

When **Remove generated collections whose values disappear** is enabled,
Vynode removes a collection that was created by that generator when:

- its value no longer exists in the library;
- the value is unchecked; or
- a changed title pattern replaces its old generated name.

Cleanup only targets collections recorded as owned by that generator. It does
not delete media files or unrelated Plex collections.

## Choosing a source

The source determines where collection membership comes from.

### Manual

Search the selected Plex library, add exact titles, reorder them, and save.
Manual collections are useful for editorial lists that should not depend on an
external provider.

### Plex Library

Create actor or director collections, or use the genre, decade, resolution, and
content-rating generators described above.

### Trakt

Use trending, popular, recommendations, watchlist, played, watched, collected,
favorited, box office, custom lists, or a random pool of lists. Personalized and
private sources require the connected Trakt account.

### MDBList

Paste a list URL and fetch its details before saving. Vynode retains source
order, matches provider identities to Plex, and can route missing titles.

### IMDb

Use supported charts or an IMDb list URL. Preview the result to confirm that the
selected chart and media type match the destination library.

### MyAnimeList and AniList

Use anime rankings or supported lists. Vynode maps anime identities to the IDs
available in Plex and keeps only titles compatible with the selected Movies or
TV library.

### Tautulli

Build activity collections from unique-viewer popularity or total watching,
measured by play count or watch duration. Set the statistics window and minimum
play count.

### Other source choices

The editor also exposes Seerr requests, Letterboxd, TMDB, networks, network
originals, Radarr or Sonarr tags, Coming Soon, filtered Plex hubs, and
multi-source composition. Availability depends on the connected services and
the implementation status shown in the application. Always use **Preview**
before enabling synchronization for a newly configured source.

## Source result controls

Most sources share these controls:

- **Maximum items:** Caps the number of source results considered.
- **Item order:** Keeps source order, reverses it, randomizes it, or sorts by
  rating, release date, or title.
- **Time period:** Controls the provider statistics window where applicable.
- **Region or country:** Selects localized provider results where supported.
- **Random list pool:** Chooses one configured list during each run.

These settings affect source planning before Plex membership is synchronized.

## Preview before synchronization

Select **Preview** from the collection row.

A standard preview shows:

- source items returned;
- items matched in the selected Plex library;
- missing items; and
- warnings or provider errors.

A Plex value-generator preview instead shows:

- Plex values discovered;
- generated collections selected; and
- values not selected.

Preview is read-only. It does not modify Plex, Radarr, Sonarr, or another
connected service.

## Synchronize a collection

Select **Sync** from the collection row when the preview is correct.

During synchronization, Vynode may:

- create or update the Plex collection;
- reconcile membership and ordering;
- create or remove owned smart collections;
- apply visibility and placement;
- update summary, collection mode, artwork, wallpaper, or theme;
- apply item overlays when enabled; and
- process missing-media actions.

The collection row reports **Needs Sync**, **Syncing**, **Ready**, or **Error**.
Review the Dashboard and Jobs pages for progress and outcomes.

## Visibility and placement

Each collection can be visible in:

- **Users Home**;
- **Server Owner Home**; and
- **Library Recommended**.

Home and Recommended share an ordering relationship in Plex, while visibility
can differ. Library order is managed independently.

You can also:

- randomize Home placement;
- restrict activation by date or weekday;
- keep a collection always active; and
- configure a custom synchronization schedule.

Use the Home, Recommended, and Library pages to review and reorder the resulting
placement.

## Posters, metadata, and overlays

### Collection poster

Choose one of the following:

- automatically generate a poster from a collection-poster template;
- select a saved poster;
- upload custom artwork; or
- use TMDB franchise artwork where available.

### Additional metadata

A collection can also synchronize:

- a custom summary;
- a custom wallpaper;
- theme music; and
- collection visibility behavior.

Disabling an asset stops applying it without necessarily deleting its saved
copy. Use the explicit removal action when the Plex assignment should be
removed on the next synchronization.

### Item overlays

Enable **Apply item overlays during sync** to render the library's configured
overlay templates onto matching collection items immediately after collection
synchronization. Otherwise, overlays run through the regular overlay job.

Overlay conditions are evaluated for each media item. If one variable is
missing, that variable segment can be omitted while the rest of the matching
overlay remains applicable.

## Missing media

When a source contains titles not present in Plex, you can:

- leave them as preview-only missing results;
- request them through Seerr;
- add movies directly to Radarr;
- add series directly to Sonarr; or
- create supported Plex-visible placeholders.

Depending on the selected route, you can choose:

- destination server;
- quality profile;
- root folder;
- tags;
- monitoring behavior; and
- whether to begin a search immediately.

Preview first, especially when a source is large. Missing-media actions can
change external applications even when no Plex media file exists yet.

## Multi-source collections

Multi-source mode combines multiple provider definitions. Use it when a single
collection should merge lists, apply source priority, remove duplicates, or
filter one source with another.

After configuring the sources:

1. preview the combined result;
2. confirm deduplication and ordering;
3. review the missing count; and
4. synchronize only after the combined output is correct.

## Link collections across libraries

Linking shares compatible settings between related collection configurations
while retaining each collection's independent Plex library identity.

Use linking when equivalent Movies or TV libraries should follow the same
source, schedule, artwork, and behavior. Unlink a member before changing a
setting that must remain library-specific.

## Existing Plex collections and hubs

Run Plex discovery to find:

- built-in Plex hubs; and
- collections already present in Plex.

Vynode can manage supported visibility, order, schedule, sort title, and
artwork settings without taking ownership of the collection's membership.
Importing or managing an existing Plex item is different from creating a new
Vynode-managed collection.

## Copy, edit, and delete

- **Copy** creates a separate Vynode configuration that you can modify.
- **Edit** changes the saved configuration and normally marks it for a new
  synchronization.
- **Delete** removes the Vynode configuration after confirmation.

Deletion behavior depends on collection type and ownership. Generator cleanup
may remove smart collections that generator owns. A regular collection's Plex
content is not silently deleted unless an explicit synchronization or deletion
policy calls for it. Read the confirmation dialog before proceeding.

## Recommended first tests

For a new installation:

1. Create a manual collection with two Plex items.
2. Preview and synchronize it.
3. Create a Genre Library generator with one genre selected.
4. Preview and synchronize it.
5. Confirm both collections in Plex.
6. Deselect the generator value and synchronize again to validate cleanup.
7. Configure one external list source and repeat the preview/sync process.
8. Add scheduling, artwork, missing-media routing, and overlays only after the
   basic lifecycle works.

## Troubleshooting

### No values appear in a Plex generator

- Confirm the correct Plex library is selected.
- Refresh or rescan Plex metadata.
- Confirm the items actually contain the selected metadata type.
- Reopen the editor after Plex finishes scanning.

### Preview returns zero source items

- Test the provider under Settings.
- Verify the list URL and privacy settings.
- Confirm the source supports the selected media type.
- Check provider rate limits and application logs.

### Source items appear but do not match Plex

- Confirm the title is in the selected library.
- Refresh Plex metadata and GUIDs.
- Check whether the source returned Movies while the collection targets TV, or
  the reverse.
- Review the missing-media list for provider IDs and routing options.

### A collection says Needs Sync

Its configuration changed after the last successful run. Preview it, then
synchronize again.

### A scheduled collection did not run

- Confirm the collection is active.
- Check its custom schedule and date restrictions.
- Check **Settings → Jobs** for a disabled, running, cancelled, or failed job.
- Review application logs for missing provider or Plex dependencies.

### Artwork or overlays did not update

- Confirm the appropriate template is active.
- Preview the template with real library metadata.
- Check whether the poster fingerprint indicates no content change.
- Confirm the collection is configured to apply overlays during sync, or run the
  regular overlays job.

## Safety checklist

Before enabling a large or scheduled workflow:

- use Preview;
- verify the destination Plex server and library;
- review the selected values or source URL;
- inspect the missing-media count;
- verify Radarr, Sonarr, or Seerr destinations;
- confirm cleanup settings;
- test one small collection first; and
- check the first completed job before enabling repetition.
