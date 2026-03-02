# 🎬 Watch Party — Local Setup Guide

A real-time synced video watching app with live chat. No internet needed after setup — runs 100% on your local network. 
To view over internet use <b>ngrok<b> 

---

## Requirements
- **Node.js** installed on the host's computer (https://nodejs.org)
- All friends on the **same Wi-Fi network** (or use ngrok for internet)

---

## Step 1 — Start the Server (Host only does this)

1. Open a terminal / command prompt
2. Navigate to the `watchparty` folder:
   ```
   cd watchparty
   ```
3. Start the server:
   ```
   node server.js
   ```
4. You'll see:
   ```
   🎬 Watch Party Server running!
      Open: http://localhost:3000
   ```

---

## Step 2 — Find your local IP (Host only)

You need to share your computer's local IP with friends.

**Windows:** Open CMD → type `ipconfig` → look for `IPv4 Address` (e.g. `192.168.1.5`)

**Mac/Linux:** Open Terminal → type `ifconfig` or `ip addr` → look for `inet` under your Wi-Fi adapter

Your server address will be: `http://192.168.1.5:3000` (replace with your actual IP)

---

## Step 3 — Everyone Opens the App

- **Host:** Open `http://localhost:3000` in your browser
- **Friend 1 & 2:** Open `http://YOUR_HOST_IP:3000` in their browser (e.g. `http://192.168.1.5:3000`)

---

## Step 4 — Join the Room

On the join screen:
1. Enter your **name**
2. Enter the same **Room ID** (e.g. `movienight`) — everyone must use the same one!
3. **Host** selects "🎬 Host" role, **friends** select "👀 Guest"
4. Click **Join Watch Party**

---

## Step 5 — Load Videos

- Each person clicks the video area and **loads the same video file from their own computer**
- The video stays local — it's never uploaded anywhere
- Once loaded, the Host can press **Play** and everyone's video syncs!

---

## Features

| Feature | Details |
|---|---|
| ▶ Synchronized playback | Host plays/pauses for everyone |
| ⏮ Skip controls | Host can skip ±10 seconds for all |
| 📍 Progress bar | Host can click to seek anywhere |
| 💬 Live chat | Everyone can chat in real time |
| 👥 Member list | See who's in the room (top right) |
| 🔄 Auto-reconnect | Reconnects if connection drops |

---

## Troubleshooting

**Friends can't connect?**
- Make sure everyone is on the same Wi-Fi
- Check Windows Firewall isn't blocking port 3000
- Try: Windows Firewall → Allow an app → Add Node.js

**Video out of sync?**
- Host can seek the progress bar to re-sync
- Guests should load the exact same video file

**Want to use over the internet?**
- Install ngrok: https://ngrok.com
- Run: `ngrok http 3000`
- Share the ngrok URL with friends

---

## Using Over the Internet (ngrok)

Everyone can join from anywhere — different cities, different networks.

### Step 1 — Install ngrok
Download from https://ngrok.com/download (free account, no credit card)

After installing, authenticate once:
```
ngrok config add-authtoken YOUR_TOKEN_HERE
```

### Step 2 — Start your server as normal
```
node server.js
```

### Step 3 — Start ngrok tunnel
In a **second** terminal window:
```
ngrok http 3000
```

You'll see something like:
```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:3000
```

### Step 4 — Share the ngrok URL
Share `https://abc123.ngrok-free.app` with your friends.
- **You (host):** can use either `http://localhost:3000` or the ngrok URL
- **Friends:** use the ngrok URL

The URL changes every time you restart ngrok (free plan). Paid ngrok gives a fixed URL.

---

## Mode compatibility over ngrok

| Mode | Works over ngrok? | Notes |
|---|---|---|
| 📂 Everyone's File | ✅ Perfect | WebSocket only |
| ▶ YouTube | ✅ Perfect | WebSocket only |
| 📡 WebRTC P2P | ✅ Yes* | Uses TURN relay if direct connection fails |

*WebRTC P2P over the internet uses TURN relay servers (open-relay.metered.ca) as fallback. This means the video data routes through a relay instead of peer-to-peer directly. For large files this may be slower than local network — YouTube mode is recommended for internet watch parties.
