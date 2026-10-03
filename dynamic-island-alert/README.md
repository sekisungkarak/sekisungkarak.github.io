## Requirements

- **OBS Studio 30+** with the built-in **obs-websocket** enabled.
- **Geseki Bridge** for the TikTok live connection and Now Playing — [download](https://github.com/sekisungkarak/geseki-bridge/releases).

---

## Installation

Everything is configured from the **Dynamic Island Alert** dock that Geseki
Bridge adds to OBS. Open **Docks** in the menu bar and enable it.

![Enable the Dynamic Island Alert dock in OBS](docs/assets/enable-dock.png)

In the dock, fill the **OBS Connection** card: **Server IP** and **Port**
(default `4455`), plus the **Password** if you set one under **Tools →
WebSocket Server Settings**, then press **Save**. Saving adds the widget to the
active scene on its own — the overlay shows up on stream right away, with no
Browser source to add by hand. The status dot turns green once the widget is
talking to OBS.

![OBS Connection settings in the dock](docs/assets/obs-websocket.png)

---

## Customization

The **Controls Panel** opens on top of the overlay itself, so you tune the
alert while looking at it. Select the source, click **Interact** and press
**S**, or click the small gear that appears in the top-left corner while you
move your mouse (it never shows on stream). You can drag the panel by its
title bar to move it anywhere, and double-click the title bar to send it back
to the bottom-left corner.

![The Controls Panel, Alerts tab](docs/assets/install-panel.png)
