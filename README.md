# Cobbleverse Mystery Auction

Node.js + WebSocket server. Nobody needs an account: players open the link and enter a name.

## Run locally
    npm install
    HOST_KEY=myhostkey CREATOR_KEY=mycreatorkey npm start
    # open http://localhost:3000

## Roles
- Players: open `/`, enter a trainer name (10 players).
- Host: open `/`, expand "Host login" at the bottom right, paste HOST_KEY.
- Pool creator: open `/#creator`, paste CREATOR_KEY, fill in 30 Pokémon + images, Submit & lock.

## Deploy on Render (free)
1. Push this folder to a GitHub repo.
2. render.com → New → Blueprint → pick the repo (render.yaml is included).
3. After the first deploy, open the service → Environment and copy HOST_KEY and CREATOR_KEY.
4. Share the service URL with players, the key with the host/creator only.

Free instances sleep after ~15 min idle (first load takes ~30 s) and have no persistent disk,
so a restart wipes the draft. Wake it up before you start and don’t let it sit idle mid-draft.
A paid instance with a disk (set DATA_FILE=/data/data.json) avoids this.
