# Plan: cab-ride videos at each station

Status: **proposed 2026-11-22**, waiting for the video list (below).

The maintainer's request: link the YouTube cab-ride videos, with the moment each station appears,
which the maintainer has been building with Cowork.

## The list

The list isn't in this repository: not on any branch, and not in the connected Google Drive
(searched 2026-11-22). To use it, add it to the repository as `refdata/cabrides/<country>.csv`,
with one row per station in a video:

```csv
video,channel,title,station,time
VIDEO_ID,Channel name,"Madrid-Chamartín – Valladolid (AVE)",Madrid-Chamartín,0:00
VIDEO_ID,Channel name,"Madrid-Chamartín – Valladolid (AVE)",Segovia-Guiomar,24:10
VIDEO_ID,Channel name,"Madrid-Chamartín – Valladolid (AVE)",Valladolid-Campo Grande,52:30
```

- `video`: the YouTube id or the full link.
- `time`: from the start of the video, as `m:ss` or `h:mm:ss`.
- Stations go in the order they appear.
- Any other columns (line, direction, date recorded) are kept.
- If Cowork produced another shape, add it as it is; the import is written for it.

## Build

- `refdata-build cabrides` reads the files and matches each station to our station ids:
  - first by exact name;
  - then with the same name rules as search;
  - then with `refdata/cabrides/aliases.csv` for the rest.
- It fails on times that don't increase, and lists the stations it couldn't match.
- It writes `cabrides.json` for each country, a few KB:
  `[{ id, channel, title, stops: [[station, seconds], …] }]`.
- A weekly workflow checks each video still exists, through YouTube's public oEmbed address, which
  needs no key. It drops removed or private videos and lists them in its summary.
- No YouTube API key, no downloads, no copies of the videos: links only.

## App

- **Station sheet:** "Vídeos desde la cabina" lists the videos that pass the station. Each opens at
  that station's moment, `https://www.youtube.com/watch?v=<id>&t=<seconds>s`.
- **Train sheet:** when a video covers part of the train's route, in the same direction, "Ver desde
  la cabina" opens it at the train's next stop.
- **Journeys:** the same link on each leg a video covers.
- **Later:** a map layer that highlights the stretches with a video.
- **Credit:** each link shows the channel's name.

### Links, not an embedded player

- Links open in the YouTube app or the browser.
- An embedded player would need a Content-Security-Policy change (`frame-src` for
  youtube-nocookie.com). It would also load Google content inside the app, which in the EU needs a
  consent prompt.
- A "tap to play here" player can come later, if wanted.

## Decisions for the maintainer

1. **Free or Pro.** Proposed: free, because it brings people to the app.
2. **The channels.** Linking needs no permission, and embedding is allowed by YouTube's terms. A
   note to the channels could still bring links back to TrainRadar.

## Steps

- **V1**, once the list is in the repository:
  - import, station matching and checks;
  - the station, train and journey links;
  - ES and EN strings;
  - tests.
- **For other countries:** add rows; nothing else changes.
