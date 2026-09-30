## Requirements

- **OBS Studio 30+** with the built-in **obs-websocket** enabled.
- A TikTok live connection and Now Playing, both from **Geseki Bridge** — one
  WebSocket feeds live events and the current track, so no TikFinity, IndoFinity
  or SMTC bridge is needed.

---

## Installation

Everything is configured from a **Controls Panel** that opens on top of the
overlay itself, so you tune the alert while looking at it. No separate
dashboard and no long URL. Add a **Browser** source to the scene you want the
alert in and use this URL:

| Field | Value |
|---|---|
| URL | https://sekisungkarak.web.id/dynamic-island-alert/ |

Then select the source, click **Interact** and press **S**, or click the small
gear that appears in the top-left corner while you move your mouse (it never
shows on stream), to open the panel. On first run the **Connect OBS** dialog
opens on its own: enter the **Port** (default `4455`) and **Password** from
**Tools → WebSocket Server Settings**, then press **Connect**. The dot turns
green once the overlay is talking to OBS. You can drag the panel by its title
bar to move it anywhere, and double-click the title bar to send it back to the
bottom-left corner.

![The Controls Panel, Alerts tab](docs/assets/install-panel.png)

![Connect OBS, Port and Password](docs/assets/install-obs-connect.png)

> [!WARNING]
> **One widget per scene**: keep a single widget in each scene, and turn the
> notification sound on for one source only, so the sounds do not clash.

---

## Alternative: the dashboard dock

If you would rather configure everything in a dock inside OBS, the older
dashboard still works and reads the same saved profiles as the panel, so you
can switch between them at any time without losing anything. Add it via
**Docks → Custom Browser Docks** with this URL:

| Field | Value |
|---|---|
| URL | https://sekisungkarak.web.id/dynamic-island-alert/dashboard/ |
