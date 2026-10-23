# Cobbleverse Mystery Auction

Node.js + WebSocket server. Nobody needs an account: players open the link and enter a name.

## Run locally
    npm install
    HOST_KEY=myhostkey CREATOR_KEY=mycreatorkey npm start
    # open http://localhost:3000

## Roles
- Players: open `/`, enter a trainer name (10 players).
- Host: open `/`, expand "Host login" at the bottom right, paste HOST_KEY.
- Pool creator: open `/#creator`, paste CREATOR_KEY, type the 30 Pokémon names, click a picture for each (found automatically via PokéAPI; uploading your own is also possible), then Submit & lock.

## Deploy on Render (free)
1. Push this folder to a GitHub repo.
2. render.com → New → Blueprint → pick the repo (render.yaml is included).
3. After the first deploy, open the service → Environment and copy HOST_KEY and CREATOR_KEY.
4. Share the service URL with players, the key with the host/creator only.

Free instances sleep after ~15 min idle (first load takes ~30 s) and have no persistent disk,
so a restart wipes the draft. Wake it up before you start and don’t let it sit idle mid-draft.
A paid instance with a disk (set DATA_FILE=/data/data.json) avoids this.

## Test run (host)
In the lobby, the host console has "Start a test run". It uses dummy Pokémon (the real secret pool is never touched),
lets you fill the room with dummy trainers, and can make them bid on their own or bid for them by hand.
"Exit test run" removes the dummies and returns to a clean lobby.

## Sound
Built-in original chiptune music and sound effects (synthesized in the browser). Use the 🔊 button bottom-left.
To use your own music instead, add audio files to `public/music/` (see the README.txt in that folder) and redeploy.

## Trainer avatars
Players pick a trainer sprite (632 from Gen 1–7 games) when joining, and can change it later by tapping their own avatar.
Sprites load from the smogon/sprites repo via jsDelivr (pinned to a commit); the list is in `public/trainers.json`.

## Pokémon-specific music
Files in `public/music/pokemon/` named after a Pokémon (e.g. `dialga.mp3`, `dialga+palkia.mp3`) play during that Pokémon's auction.
See the README.txt in that folder.




## Theme music (added by the pool creator)
On the creator page, each Pokémon has an "🎵 Add theme music" button: choose an audio file you own (mp3, ogg, wav, m4a, up to 8 MB).
You can preview it on the page. It is uploaded when the list is locked, kept secret, and only plays when that Pokémon is revealed.
Order during a live auction: creator's theme > file in `public/music/pokemon/` > battle track > built-in chiptune.
Uploaded themes are stored next to the data file (`themes/`), so on Render's free plan they disappear on restart like the rest of the draft.

## Stage music
Files in `public/music/stage/` with `legendary`, `mega` or `uber` in the name play during that stage's live auctions.
Order: creator's uploaded theme > `pokemon/` file > stage file > `battle` file > built-in chiptune.

## Library check on the creator page
The creator page reads the music library (`public/music/pokemon/`). When a Pokémon's name matches a file there
(for example Dialga -> `dialga+palkia.mp3`, or Mega Charizard Y -> `Mega Charizard X and Y.mp3`), it shows
"Already in the library" with a preview and nothing needs to be uploaded. The creator can still pick a different
library track from a dropdown or upload their own file. Order during an auction: uploaded theme > chosen library track >
automatic library match > stage file > battle file > built-in chiptune.
