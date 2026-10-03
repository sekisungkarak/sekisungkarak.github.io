## Requirements

- **OBS Studio 30+** with the built-in **obs-websocket** enabled.
- **Geseki Bridge** for the TikTok live connection — [download](https://github.com/sekisungkarak/geseki-bridge/releases).

---

## Installation

Everything is configured from the **Live Q&A** dock that Geseki Bridge adds to
OBS. Open **Docks** in the menu bar and enable it.

![Enable the Live Q&A dock in OBS](docs/Assets/enable-dock.png)

In the dock, open **OBS Connection**, fill **Server IP** and **Port** (default
`4455`), plus the **Password** if you set one under **Tools → WebSocket Server
Settings**, then press **Save**. Saving adds the widget to the active scene on
its own — the overlay shows up on stream right away, with no Browser source to
add by hand. The status dot turns green once the widget is talking to OBS.

![OBS Connection settings in the dock](docs/Assets/obs-websocket.png)

---

## Queue

Viewers ask from chat; you manage the questions from the **Queue** tab.

![The Queue tab in the dock](docs/Assets/queue.png)

Set the **Question Prefix** (`!q` by default) in the dock's **Questions**
section. A chat message that starts with it becomes a question and is added to
the queue — nothing appears on stream yet.

Click a question in the queue to put it on screen; the overlay shows one question
at a time. Use **Next** and **Previous** to step through the list, and **Hide**
to take the question off screen.

To test without a real chat, press **Sample** to add a random lorem ipsum
question. The badge on the **Queue** tab counts how many questions are waiting,
and a question you have already shown stays in the list tagged `shown`, so you
can show it again.

To require a gift before someone can ask, pick a **Ticket Gift**: the viewer must
send that gift first, and each gift grants one question. Leave it empty and
anyone can ask with just the prefix.

> [!NOTE]
> This widget does not use TikTok's built-in Q&A mode. That mode must be enabled
> by the streamer and its events are not guaranteed to arrive, so the ticket flow
> is built entirely on `gift` and `chat` instead.
