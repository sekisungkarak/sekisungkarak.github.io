## Requirements

- **OBS Studio 30+** with the built-in **obs-websocket** enabled.
- **Geseki Bridge** for the TikTok live connection and Now Playing, [download](https://github.com/sekisungkarak/geseki-bridge/releases).

---

## Installation

Everything is configured from the **Dynamic Island Alert** dock that Geseki
Bridge adds to OBS. Open **Docks** in the menu bar and enable it.

![Enable the Dynamic Island Alert dock in OBS](docs/assets/enable-dock.png)

In the dock, fill the **OBS Connection** card: **Server IP** and **Port**
(default `4455`), plus the **Password** if you set one under **Tools →
WebSocket Server Settings**, then press **Save**. Saving adds the widget to the
active scene on its own, the overlay shows up on stream right away, with no
Browser source to add by hand. The status dot turns green once the widget is
talking to OBS.

![OBS Connection settings in the dock](docs/assets/obs-websocket.png)

---

## Customization

Everything is tuned from the **Dynamic Island Alert** dock, on its **Settings**
tab. Options are grouped into cards (**General**, **Appearance**, **Now
Playing**, **TikTok Alerts**); the header keeps **Save**, **Load** and
**Reset**, and the pill at the top shows the TikTok connection. **Simulator**
sends test events so you can preview an alert without a real chat, and
**Interact** opens the overlay's OBS Interact dialog.

![The Settings tab in the dock](docs/assets/install-panel.png)

![](docs/assets/interact-conrol-panel.png)
