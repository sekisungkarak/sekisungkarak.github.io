// Dibangkitkan dari dynamic-island-alert/dashboard/settings.json - jangan diedit manual.
// Salinan skema ini dipakai panel kontrol di dalam overlay supaya widget tidak
// perlu fetch apa pun saat startup (OBS bebas cache, offline tetap jalan).
// Bangkitkan ulang: node shared/tools/build-controls-schema.mjs
window.GESEKI_CONTROLS_SCHEMA = {
 "groups": {
  "Streamer.bot Connection": {
   "open": true,
   "icon": "../../resources/icons/platforms/streamerbot-logo.svg",
   "badge": "streamerbot"
  },
  "OBS Connection": {
   "open": false,
   "icon": "../../resources/icons/platforms/obs-logo.svg",
   "badge": "obs"
  },
  "General": {
   "open": false,
   "icon": "ri-settings-4-fill"
  },
  "Appearance": {
   "open": false,
   "icon": "ri-palette-fill"
  },
  "Live Detection": {
   "open": false,
   "icon": "ri-live-fill",
   "enable": "enableLiveDetect"
  },
  "Follow Alert": {
   "open": false,
   "icon": "ri-user-add-fill",
   "enable": "enableFollow"
  },
  "Subscribe Alert": {
   "open": false,
   "icon": "ri-star-fill",
   "enable": "enableSubscribe"
  },
  "Super Fan Alert": {
   "open": false,
   "icon": "ri-vip-crown-fill",
   "enable": "enableSuperFan"
  },
  "Share Alert": {
   "open": false,
   "icon": "ri-share-forward-fill",
   "enable": "enableShare"
  },
  "Gift Alert": {
   "open": false,
   "icon": "ri-gift-fill",
   "enable": "enableGift"
  },
  "First Chatter": {
   "open": false,
   "icon": "ri-chat-1-fill",
   "enable": "enableFirstChatter",
   "button": {
    "label": "Reset",
    "callFunction": "ResetFirstChatter"
   }
  },
  "Now Playing": {
   "open": false,
   "icon": "ri-music-2-fill",
   "enable": "enableNowPlaying"
  }
 },
 "categories": {
  "TikTok Alerts": {
   "open": false,
   "icon": "ri-tiktok-fill",
   "enable": "enableTikTokAlerts"
  }
 },
 "settings": [
  {
   "id": "address",
   "label": "Server IP",
   "type": "text",
   "defaultValue": "127.0.0.1",
   "group": "Streamer.bot Connection"
  },
  {
   "id": "port",
   "label": "Port",
   "type": "number",
   "defaultValue": 8080,
   "min": 1024,
   "max": 65535,
   "group": "Streamer.bot Connection"
  },
  {
   "id": "obsAddress",
   "label": "Server IP",
   "type": "text",
   "defaultValue": "127.0.0.1",
   "group": "OBS Connection"
  },
  {
   "id": "obsPort",
   "label": "Port",
   "type": "number",
   "defaultValue": 4455,
   "min": 1024,
   "max": 65535,
   "group": "OBS Connection"
  },
  {
   "id": "obsPassword",
   "label": "Password",
   "type": "password",
   "defaultValue": "",
   "group": "OBS Connection"
  },
  {
   "id": "language",
   "label": "Language",
   "type": "select",
   "options": [
    {
     "value": "en",
     "label": "English"
    },
    {
     "value": "id",
     "label": "Indonesia"
    }
   ],
   "defaultValue": "en",
   "group": "General"
  },
  {
   "id": "timeFormat",
   "label": "Time Format",
   "description": "Clock format. Example: HH:mm:ss (24-hour) or hh:mm:ss A (12-hour).",
   "type": "text",
   "defaultValue": "HH:mm:ss A",
   "group": "General"
  },
  {
   "id": "dateFormat",
   "label": "Date Format",
   "description": "Date format. Example: dddd, DD MMMM YYYY (Monday, 31 December 2026).",
   "type": "text",
   "defaultValue": "dddd, DD MMMM YYYY",
   "group": "General"
  },
  {
   "id": "weatherLocation",
   "label": "Weather Location",
   "description": "City name shown on the weather info panel.",
   "type": "text",
   "defaultValue": "Jakarta",
   "group": "General"
  },
  {
   "id": "infoDuration",
   "label": "Info Rotation Duration (seconds)",
   "type": "number",
   "min": 1,
   "max": 30,
   "defaultValue": 4,
   "group": "General"
  },
  {
   "id": "infoRotationOrder",
   "label": "Info Rotation Display (Select Min. 3)",
   "type": "tags",
   "defaultValue": [
    "date",
    "music",
    "duration",
    "weather",
    "viewers"
   ],
   "options": [
    {
     "value": "date",
     "label": "Date"
    },
    {
     "value": "music",
     "label": "Time & Now Playing"
    },
    {
     "value": "duration",
     "label": "Live Duration"
    },
    {
     "value": "weather",
     "label": "Weather"
    },
    {
     "value": "viewers",
     "label": "Viewers"
    }
   ],
   "group": "General",
   "full": true,
   "minTags": 3,
   "placeholder": "No options"
  },
  {
   "id": "alertDuration",
   "label": "Alert Duration (seconds)",
   "type": "number",
   "min": 1,
   "max": 30,
   "defaultValue": 4,
   "group": "General"
  },
  {
   "id": "enableSound",
   "label": "Notification Sound",
   "type": "checkbox",
   "defaultValue": true,
   "group": "General"
  },
  {
   "id": "enableBadgeIcon",
   "label": "Show Badge Icon",
   "description": "Show the TikTok badge (grade / Top Gifter) next to the username on alert cards.",
   "type": "checkbox",
   "defaultValue": true,
   "group": "General"
  },
  {
   "id": "testAlertType",
   "label": "Test Alert",
   "type": "select",
   "options": [
    {
     "value": "all",
     "label": "Test All"
    },
    {
     "value": "follow",
     "label": "Test Follow"
    },
    {
     "value": "subscribe",
     "label": "Test Subscribe"
    },
    {
     "value": "superFan",
     "label": "Test Super Fans"
    },
    {
     "value": "share",
     "label": "Test Share"
    },
    {
     "value": "gift",
     "label": "Test Gift"
    },
    {
     "value": "firstChatter",
     "label": "Test First Chatter"
    },
    {
     "value": "nowPlaying",
     "label": "Test Now Playing"
    }
   ],
   "defaultValue": "",
   "group": "General"
  },
  {
   "id": "widgetStyle",
   "label": "Widget Style",
   "type": "select",
   "options": [
    {
     "value": "solid",
     "label": "Solid Black"
    },
    {
     "value": "glass",
     "label": "Liquid Glass"
    }
   ],
   "defaultValue": "solid",
   "group": "Appearance"
  },
  {
   "id": "solidBgOpacity",
   "label": "Background Opacity",
   "type": "slider",
   "defaultValue": 100,
   "min": 10,
   "max": 100,
   "step": 1,
   "group": "Appearance",
   "showIf": "widgetStyle",
   "showIfValue": "solid"
  },
  {
   "id": "font",
   "label": "Font",
   "type": "font",
   "defaultValue": "",
   "group": "Appearance"
  },
  {
   "id": "widgetScale",
   "label": "Widget Scale (Zoom)",
   "type": "slider",
   "defaultValue": 1,
   "min": 0.5,
   "max": 2,
   "step": 0.1,
   "group": "Appearance"
  },
  {
   "id": "musicStyle",
   "label": "Now Playing Style",
   "type": "select",
   "options": [
    {
     "value": "big",
     "label": "Big"
    },
    {
     "value": "medium",
     "label": "Medium"
    },
    {
     "value": "small",
     "label": "Small"
    }
   ],
   "defaultValue": "big",
   "group": "Appearance",
   "description": "Layout used by the Now Playing panel."
  },
  {
   "id": "accentPaletteRole",
   "label": "Accent Color",
   "type": "select",
   "options": [
    {
     "value": "lightVibrant",
     "label": "Light Vibrant"
    },
    {
     "value": "vibrant",
     "label": "Vibrant"
    },
    {
     "value": "darkVibrant",
     "label": "Dark Vibrant"
    }
   ],
   "defaultValue": "lightVibrant",
   "group": "Appearance"
  },
  {
   "id": "enableNowPlaying",
   "label": "Show Now Playing",
   "type": "checkbox",
   "defaultValue": true,
   "group": "Now Playing",
   "description": "Display the Now Playing panel when a track is detected."
  },
  {
   "id": "includedApplications",
   "label": "Included Apps",
   "description": "Priority apps (comma separated). Leave empty for automatic detection.<br><a href=\"http://127.0.0.1:47800/sessions\" target=\"_blank\">View active sources</a>",
   "type": "text",
   "defaultValue": "",
   "group": "Now Playing"
  },
  {
   "id": "excludedApplications",
   "label": "Excluded Apps",
   "description": "Ignore these apps (comma separated).<br><a href=\"http://127.0.0.1:47800/sessions\" target=\"_blank\">View active sources</a>",
   "type": "text",
   "defaultValue": "",
   "group": "Now Playing"
  },
  {
   "id": "enableTikTokAlerts",
   "label": "TikTok Alerts",
   "description": "Master switch for every TikTok alert (follow, subscribe, super fan, share, gift, first chatter).",
   "type": "checkbox",
   "defaultValue": true,
   "group": "TikTok Alerts",
   "headerOnly": true
  },
  {
   "id": "enableLiveDetect",
   "label": "Enable Live Detection",
   "description": "Automatically detect TikTok Studio and switch the panel to Offline mode when the stream ends.",
   "type": "checkbox",
   "defaultValue": true,
   "group": "Live Detection",
   "category": "TikTok Alerts"
  },
  {
   "id": "liveStudioPort",
   "label": "LIVE Studio Port",
   "description": "Leave 0 to track the internal TikTok LIVE Studio port automatically.",
   "type": "number",
   "min": 0,
   "max": 65535,
   "defaultValue": 0,
   "group": "Live Detection",
   "category": "TikTok Alerts"
  },
  {
   "id": "offlineText",
   "label": "Offline Text",
   "description": "Status label shown while the stream is Offline.",
   "type": "text",
   "defaultValue": "Stream Offline",
   "group": "Live Detection",
   "category": "TikTok Alerts"
  },
  {
   "id": "offlineViewersText",
   "label": "Offline Viewers Text",
   "description": "Viewer count symbol shown while the stream is Offline.",
   "type": "text",
   "defaultValue": "-",
   "group": "Live Detection",
   "category": "TikTok Alerts"
  },
  {
   "id": "enableFollow",
   "label": "Follow Alerts",
   "description": "Play the pop-up animation when someone follows.",
   "type": "checkbox",
   "defaultValue": true,
   "group": "Follow Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "enableFollowIcon",
   "label": "Show Event Icon",
   "type": "checkbox",
   "defaultValue": true,
   "group": "Follow Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "followMessage",
   "label": "Follow Message Text",
   "description": "Message on the follow alert. Write {name} to insert the viewer name.",
   "type": "text",
   "defaultValue": "followed!",
   "group": "Follow Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "enableSubscribe",
   "label": "Subscribe Alerts",
   "description": "Play the pop-up animation when someone subscribes.",
   "type": "checkbox",
   "defaultValue": true,
   "group": "Subscribe Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "enableSubscribeIcon",
   "label": "Show Event Icon",
   "type": "checkbox",
   "defaultValue": true,
   "group": "Subscribe Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "subscribeMessage",
   "label": "Subscribe Message Text",
   "description": "Message on the subscribe alert. Write {name} to insert the viewer name.",
   "type": "text",
   "defaultValue": "subscribed!",
   "group": "Subscribe Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "enableSuperFan",
   "label": "Super Fan Alerts",
   "description": "Play the pop-up animation when someone becomes a Super Fan or a Super Fan joins.",
   "type": "checkbox",
   "defaultValue": true,
   "group": "Super Fan Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "enableSuperFanIcon",
   "label": "Show Event Icon",
   "type": "checkbox",
   "defaultValue": true,
   "group": "Super Fan Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "superFanMessage",
   "label": "Super Fan Message Text",
   "description": "Message on the Super Fan alert. Write {name} to insert the viewer name.",
   "type": "text",
   "defaultValue": "is now a Super Fan!",
   "group": "Super Fan Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "superFanJoinMessage",
   "label": "Super Fan Join Message Text",
   "description": "Message when an existing Super Fan enters. Write {name} to insert the viewer name.",
   "type": "text",
   "defaultValue": "Super Fan joined!",
   "group": "Super Fan Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "enableSuperFanBox",
   "label": "Super Fan Box Alerts",
   "description": "Play the pop-up animation when someone sends a Super Fan Box.",
   "type": "checkbox",
   "defaultValue": true,
   "group": "Super Fan Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "superFanBoxMessage",
   "label": "Super Fan Box Message Text",
   "description": "Message on the Super Fan Box alert. Write {name} for the viewer and {count} for the diamond amount.",
   "type": "text",
   "defaultValue": "sent a Super Fan Box x{count}!",
   "group": "Super Fan Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "enableShare",
   "label": "Share Alerts",
   "description": "Play the pop-up animation when the live is shared.",
   "type": "checkbox",
   "defaultValue": true,
   "group": "Share Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "enableShareIcon",
   "label": "Show Event Icon",
   "type": "checkbox",
   "defaultValue": true,
   "group": "Share Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "shareMessage",
   "label": "Share Message Text",
   "description": "Message on the share alert. Write {name} to insert the viewer name.",
   "type": "text",
   "defaultValue": "shared the live!",
   "group": "Share Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "enableGift",
   "label": "Gift Alerts",
   "description": "Play the celebration pop-up animation when someone sends a gift.",
   "type": "checkbox",
   "defaultValue": true,
   "group": "Gift Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "enableGiftIcon",
   "label": "Show Event Icon",
   "type": "checkbox",
   "defaultValue": true,
   "group": "Gift Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "giftMessage",
   "label": "Gift Message Text",
   "description": "Gift message format using tags: {name}, {gift}, and {count}.",
   "type": "text",
   "defaultValue": "sent {gift} x{count}!",
   "group": "Gift Alert",
   "category": "TikTok Alerts"
  },
  {
   "id": "enableFirstChatter",
   "label": "First Chatter Alerts",
   "description": "Automatically greet viewers who send their first chat in this session.",
   "type": "checkbox",
   "defaultValue": true,
   "group": "First Chatter",
   "category": "TikTok Alerts"
  },
  {
   "id": "enableFirstChatterIcon",
   "label": "Show Event Icon",
   "type": "checkbox",
   "defaultValue": true,
   "group": "First Chatter",
   "category": "TikTok Alerts"
  },
  {
   "id": "firstChatterPermissions",
   "label": "User Permissions",
   "description": "Only greet viewers with these roles. Leave empty to greet everyone.",
   "type": "tags",
   "defaultValue": [
    "fanclub"
   ],
   "options": [
    {
     "value": "follower",
     "label": "Follower"
    },
    {
     "value": "fanclub",
     "label": "Fan Club"
    },
    {
     "value": "moderator",
     "label": "Moderator"
    },
    {
     "value": "subscriber",
     "label": "Subscriber"
    }
   ],
   "group": "First Chatter",
   "category": "TikTok Alerts",
   "full": true,
   "placeholder": "No options"
  }
 ],
 "defaults": {
  "address": "127.0.0.1",
  "port": 8080,
  "obsAddress": "127.0.0.1",
  "obsPort": 4455,
  "obsPassword": "",
  "language": "en",
  "timeFormat": "HH:mm:ss A",
  "dateFormat": "dddd, DD MMMM YYYY",
  "weatherLocation": "Jakarta",
  "infoDuration": 4,
  "infoRotationOrder": [
   "date",
   "music",
   "duration",
   "weather",
   "viewers"
  ],
  "alertDuration": 4,
  "enableSound": true,
  "enableBadgeIcon": true,
  "testAlertType": "",
  "widgetStyle": "solid",
  "solidBgOpacity": 100,
  "font": "",
  "widgetScale": 1,
  "musicStyle": "big",
  "accentPaletteRole": "lightVibrant",
  "enableNowPlaying": true,
  "includedApplications": "",
  "excludedApplications": "",
  "enableTikTokAlerts": true,
  "enableLiveDetect": true,
  "liveStudioPort": 0,
  "offlineText": "Stream Offline",
  "offlineViewersText": "-",
  "enableFollow": true,
  "enableFollowIcon": true,
  "followMessage": "followed!",
  "enableSubscribe": true,
  "enableSubscribeIcon": true,
  "subscribeMessage": "subscribed!",
  "enableSuperFan": true,
  "enableSuperFanIcon": true,
  "superFanMessage": "is now a Super Fan!",
  "superFanJoinMessage": "Super Fan joined!",
  "enableSuperFanBox": true,
  "superFanBoxMessage": "sent a Super Fan Box x{count}!",
  "enableShare": true,
  "enableShareIcon": true,
  "shareMessage": "shared the live!",
  "enableGift": true,
  "enableGiftIcon": true,
  "giftMessage": "sent {gift} x{count}!",
  "enableFirstChatter": true,
  "enableFirstChatterIcon": true,
  "firstChatterPermissions": [
   "fanclub"
  ]
 }
};
