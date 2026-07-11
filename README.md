Changelog: 

2026-07-11 NEW: TV episodes now show their `S00E00` label everywhere instead of just the show title:

2026-07-11 Fix: (Android-APK) Continue Watching resume on Android TV Resuming playback from Continue Watching / the Resume button always restarted from 0:00 on Android (ExoPlayer), even though the same session data resumed correctly via MPV on Windows. Continue Watching, the Resume button, and D-pad resume all now correctly seek to the last saved position on Android TV.

2026-07-07 NEW: Resume playback & Continue Watching. Strøm Cinema now tracks playback position and surfaces a Continue Watching shelf on the home screen, plus a
Resume button on the movie details modal, so you can pick up where you
left off instead of starting over.

2026-06-28 NEW: Movie Editing & Poster ManagementMovies in your local library can now be manually edited directly from the UI.
What you can do:- Rename any movie title with a local override- Replace the poster with a custom image via URL or file upload
Browse and select from all available TMDB posters for a title, sorted by language and community rating - Reset any movie back to its original TMDB metadata at any time

2026-06-25 NEW: Added a ConnectionGate handshake process to improve Android TV client initialization and backend connectivity.

2026-06-24 Fix: ExoPlayer settings for Android TV to improve , navigation, and overall user experience.

2026-06-21 Fix: Library not loading on first launch (Android) On first launch, the app failed to display movies and TV series even when library-cache.json was present on the backend. A restart of the tv-app was required before content appeared.








How overrides work:
Edits are stored locally and keyed by file path, so they are unique per file
and survive library rescans, server restarts, and metadata re-enrichment.
TMDB data is always fetched fresh in the background, but your manual edits
always take priority over the result


------------------------------------------------------------------------------------------------------

**First public release**
Bugs are expected. If you find something broken or have ideas for improvement, please open an issue — all feedback is appreciated and helps Strøm Cinema better.

------------------------------------------------------------------------------------------------------
------------------------------------------------------------------------------------------------------
Installation guide @ https://stromcinema.github.io/
------------------------------------------------------------------------------------------------------
------------------------------------------------------------------------------------------------------

<img width="732" height="291" alt="image" src="https://github.com/user-attachments/assets/4a3150ee-9923-427d-99f4-5f78b56a060f" />


<img width="878" height="565" alt="image" src="https://github.com/user-attachments/assets/6544bcbd-cd46-4daa-ab74-150c105349bf" />

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
<img width="638" height="406" alt="image" src="https://github.com/user-attachments/assets/07628519-015d-4778-8f36-25d3ee0c3b1f" />



