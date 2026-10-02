## Requirements

- **OBS Studio 30+** with the built-in **obs-websocket** enabled.
- A TikTok live connection from **Geseki Bridge** — the widget reads the same
  `gift` and `chat` events the alerts use, so no extra bridge is needed.

---

## How it works

A viewer types your **question prefix** (`!q` by default) followed by their
question in chat. The question goes into a **queue** — nothing appears on
stream yet.

Open the **Queue** tab in the dashboard to see the list, then click a
question to put it on screen. The overlay shows **one** question at a time and
keeps it there until you pick another one or press **Hide**. Questions you have
already shown stay in the list, marked `sudah`, so you can bring them back
whenever you want.

If you pick a **Ticket Gift** in the dashboard, a ticket becomes required: a
viewer must send that gift first, and one gift grants exactly one question.
Leave the gift empty (the default) and anyone can ask with just the prefix.

> [!NOTE]
> This widget does **not** use TikTok's built-in Q&A mode. That mode has to be
> enabled by the streamer and its events are not guaranteed to arrive, so the
> ticket flow is built entirely on `gift` and `chat` instead.

---

## Installation

Everything is configured from a **Dashboard** inside OBS. Add a **Browser**
source to the scene you want the question in and use this URL:

| Field | Value |
|---|---|
| URL | https://sekisungkarak.web.id/live-qa/ |

Then position the source in OBS as you like — the widget draws nothing until
you show a question, so an empty source is normal.

---

## Dashboard dock

Add it via **Docks → Custom Browser Docks** with this URL:

| Field | Value |
|---|---|
| URL | https://sekisungkarak.web.id/live-qa/dashboard/ |

The dock has two tabs:

- **Settings** — everything in the table below.
- **Queue** — the question list. Click a question to show it, press
  **Hide** to take it off screen, and use **Sample** to add a random lorem
  ipsum question for testing without a real chat.
  for testing without a real chat.

The badge on the **Queue** tab shows how many questions are waiting.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| Server IP / Port / Password | `127.0.0.1` / `4455` | OBS WebSocket, used by the dock. |
| Bridge Host / Port | `127.0.0.1` / `47800` | Where Geseki Bridge listens. |
| Ticket Gift | empty | Gift required before asking. The dropdown lists every TikTok gift with its icon, coin price and id, and is searchable. Empty = no ticket needed. |
| Question Prefix | `!q` | Chat starting with this counts as a question. |
| Show Avatar | on | Show the asker's profile picture. |
| Show Ticket Hint | on | Show the hint line under the question card. |
| Hint Text | `Send {gift}, then type {prefix} your question` | Used only when a ticket gift is set. `{gift}` and `{prefix}` are filled in. Without a gift the widget says `Type !q to ask a question`. |

### About the gift list

The dropdown reads `gifts.json`, a snapshot of TikTok's own gift catalogue
(id, name, coin price, icon) stored next to `settings.json`. Matching is done by
**id**, never by name, because TikTok localises gift names — Galaxy shows as
**Galaksi** in Indonesian. Regenerate the snapshot with
`_tools/make_gifts_json.py` when TikTok adds new gifts.
