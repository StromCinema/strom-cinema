Changelog: 

2026-06-21 Fix: Library not loading on first launch (Android) On first launch, the app failed to display movies and TV series even when library-cache.json was present on the backend. A restart was required before content appeared.

2026-06-24 Fix: ExoPlayer settings for Android TV to improve , navigation, and overall user experience.

2026-06-25 Fix: Added a ConnectionGate handshake process to improve Android TV client initialization and backend connectivity.




**First public release**
Bugs are expected. If you find something broken or have ideas for improvement, please open an issue — all feedback is appreciated and helps Strøm Cinema better.



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

<img width="683" height="444" alt="image" src="https://github.com/user-attachments/assets/2c11d1f3-a1d8-41a0-9978-428f9019d081" />
<img width="804" height="474" alt="image" src="https://github.com/user-attachments/assets/1457013a-d541-4727-baa7-0d742f4db262" />

<img width="2242" height="1240" alt="Screenshot 2026-06-18 223712" src="https://github.com/user-attachments/assets/2e3d9344-75f8-4f80-b9f0-cc3ca35506d3" />
<img width="1581" height="1245" alt="Screenshot 2026-06-18 223930" src="https://github.com/user-attachments/assets/f45840ef-16cc-4e35-9a42-224bb46015d2" />
<img width="2366" height="1232" alt="Screenshot 2026-06-18 223843" src="https://github.com/user-attachments/assets/4c74eec4-2c7a-4f72-b89f-ce82b5847c91" />
<img width="2329" height="1237" alt="Screenshot 2026-06-18 223827" src="https://github.com/user-attachments/assets/872dead5-2933-4a94-a996-d95ab6d081b9" />
<img width="1939" height="1242" alt="Screenshot 2026-06-18 223808" src="https://github.com/user-attachments/assets/018bf927-6a94-4753-b1be-38f19004e0c4" />
<img width="2400" height="1248" alt="Screenshot 2026-06-18 223753" src="https://github.com/user-attachments/assets/e689a102-7ac8-402d-9364-de1c68072870" />
<img width="2243" height="1253" alt="Screenshot 2026-06-18 223734" src="https://github.com/user-attachments/assets/e441d0da-7b53-422e-8cc0-5d4797450c46" />
<img width="2242" height="1240" alt="Screenshot 2026-06-18 223712" src="https://github.com/user-attachments/assets/9ca3302c-68ec-433d-bebe-c3aa1b6e361f" />

Changelog:
2026-06-21
Fix: Library not loading on first launch (Android)
On first launch, the app failed to display movies and TV series even when library-cache.json was present on the backend. A restart was required before content appeared.

