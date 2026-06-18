> **First public release**
Bugs are expected. If you find something broken or have ideas for improvement, please [open an issue](https://github.com/StromCinema/issues) — all feedback is appreciated and helps Strøm Cinema better.



Two things are required before anything will run or play:

Node.js — powers the server. Download the LTS version from nodejs.org and install it, then open a terminal in the project folder and run:

npm install
mpv — required to play video on Windows. Download the latest Windows build from mpv.io, extract it, and place mpv.exe in the project folder next to plexus-server.cjs.

Without mpv.exe in the project folder, clicking play on Windows will do nothing — no error, it just won't launch a player.

Double-click start-server.bat in the project folder. A terminal window opens and shows your local IP address and a confirmation that the server is running on port 5000.

Keep this window open the whole time you're using the app. If it closes, the app loses connection to your library.
If the server crashes, the window stays open and shows an error message rather than disappearing.


Open a browser on the PC and navigate to the setup page:

http://localhost:5000/setup
Fill in your TMDB API key (free at themoviedb.org) and your library paths — the folders on the PC where your video files live, e.g. D:\Movies.

Save. This writes plexus-config.json and the server picks it up immediately — no restart needed.


When start-server.bat runs it prints your local IP directly in the terminal — no need to run ipconfig yourself. It'll look like:

192.168.x.xxx:5000
Keep this visible — you'll type it into the app on the next step.

The PC and TV must be on the same Wi-Fi network. This address is only reachable from inside your LAN.

Install the APK on your Android TV and launch Strøm Cinema. At the connection gate, enter the address shown in the server window:

192.168.x.xxx:5000
Tick Remember host connection so the app auto-connects on next launch. Hit Connect Server — you should reach the main library view within a few seconds.

If it fails: check the PC firewall allows inbound traffic on port 5000, and confirm both devices are on the same network.
