## Requirements

- **OBS Studio 30+** with the built-in **obs-websocket** enabled.
- A TikTok live connection via **TikFinity** or **IndoFinity** — whichever you use to feed events.
- Now Playing via SMTC bridge (https://github.com/nuttylmao/smtc-bridge)

---

## Installation

The dashboard is loaded into OBS as a **Custom Browser Dock**. From that dock you
configure the OBS connection, then press **Save** — the dashboard creates the
browser source for you in the active scene.

### Step 1 — Add the dashboard dock

1. In OBS, open the top menu **Docks → Custom Browser Docks**.
2. In the dialog, add one row:

   | Field | Value |
   |---|---|
   | **Dock Name** | `Dynamic Island Alert` |
   | **URL** | `https://sekisungkarak.github.io/dynamic-island-alert/dashboard/` |

3. Click **Apply**, then **Close**. The dashboard appears as a dock inside OBS.

![OBS menu → Docks → Custom Browser Docks](docs/assets/install-1-docks-menu.png)

![Add the dock name and dashboard URL, then Apply](docs/assets/install-2-add-dock.png)

### Step 2 — Check the OBS WebSocket port

The dashboard talks to OBS over **obs-websocket**, so the port must match on both
sides.

1. In OBS, open **Tools → WebSocket Server Settings**.
2. Make sure **Enable WebSocket server** is checked, and note the **Server Port**.
3. Click **Apply** to save.

![OBS → Tools → WebSocket Server Settings](docs/assets/install-3-websocket-server-settings.png)

![Enable the server and note the Server Port, then Apply](docs/assets/install-3-same-port.png)

### Step 3 — Fill in the OBS Connection

In the dock, open the **OBS Connection** section and enter the values of your
**own** OBS WebSocket server — the **Port** must be the same number you noted in
Step 2:

| Field | Value |
|---|---|
| **Server IP** | `127.0.0.1` |
| **Port** | the same **Server Port** as in Step 2 (default `4455`) |
| **Password** | the password from the same OBS dialog (leave empty if disabled) |

The status dot turns **green** once the dock connects to OBS. If it stays red,
the port or password does not match your OBS WebSocket settings — fix it here
before continuing.

![OBS Connection — Server IP, Port and Password](docs/assets/install-3-obs-connection.png)

### Step 4 — Press Save

Click **Save** at the bottom of the dock. The dashboard then creates a **Browser
Source** in the **currently active scene**, named after the scene:

```
{Scene} | Dynamic Island Alert
```

It is sized **1080 × 500** and anchored **top-center**. If a source with that
name already exists it is updated in place, so pressing Save again never creates
duplicates.

![Save creates the browser source](docs/assets/install-4-buttons.png)

![The browser source appears in the active scene](docs/assets/install-5-overlay-result.png)

> **Tip** — switch to the scene you want the alert in **before** pressing Save,
> and add it to each scene you stream.

### Step 5 — Load saved settings

**Load** pulls a saved configuration back into the dock for a chosen scene.

1. Click **Load Current Scene** at the bottom of the dock.
2. In the **Load Saved Settings** dialog, pick the **Scene** whose settings you
   want to load.
3. Click **Load**.

![Load Current Scene](docs/assets/install-6-load-buttons.png)

![Pick the scene and click Load](docs/assets/install-6-load-saved-settings.png)

Use **Reset** to return every option to its defaults.
