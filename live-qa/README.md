## Requirements

- **OBS Studio 30+** with the built-in **obs-websocket** enabled.
- **Geseki Bridge** for the TikTok live connection, [download](https://github.com/sekisungkarak/geseki-bridge/releases).

---

## Installation

Everything is configured from the **Live Q&A** dock that Geseki Bridge adds to
OBS. Open **Docks** in the menu bar and enable it.

![Enable the Live Q&A dock in OBS](docs/Assets/enable-dock.png)

In the dock, open **OBS Connection**, fill **Server IP** and **Port** (default
`4455`), plus the **Password** if you set one under **Tools → WebSocket Server
Settings**, then press **Save**. Saving adds the widget to the active scene on
its own, the overlay shows up on stream right away, with no Browser source to
add by hand. The status dot turns green once the widget is talking to OBS.

![OBS Connection settings in the dock](docs/Assets/obs-websocket.png)

---

## Queue

Viewers ask from chat; you manage the questions from the **Queue** tab.

![The Queue tab in the dock](docs/Assets/queue.png)

Set the **Question Prefix** (`!q` by default) in the dock's **Questions**
section: a chat starting with it joins the queue, nothing shows on stream yet.
Click a question to put it on screen, then use **Next** / **Previous** or
**Hide**. The **Queue** badge counts the waiting questions, one you already
showed stays tagged `shown`, and **Sample** adds a test question.

You can require a **Ticket** first (gift, follower, likes, and more), so only
viewers who meet it may ask. Leave it empty and anyone can ask with just the
prefix.
