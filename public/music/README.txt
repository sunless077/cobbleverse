MUSIC GUIDE
===========
How it works: one standard BATTLE track plays during every live auction, one standard LOBBY track plays
the rest of the time, and a Pokémon with its own theme switches the music when it appears.
Put audio files (.mp3 .ogg .wav .m4a) in these places, then redeploy.

STANDARD TRACKS (public/music/)
   battle-anything.mp3      plays during every live auction     (file name contains "battle")
   lobby-anything.mp3       plays in the lobby / between lots   (file name contains "lobby" or "route")
   Several files with the same word = one is picked at random.
   Files with neither word play in both places.

POKÉMON THEMES (public/music/pokemon/)
   dialga.mp3               plays for Dialga
   dialga+palkia.mp3        plays for Dialga or Palkia (+ shares one file)
   mewtwo.mp3               plays for Mewtwo, not Mew
   mega-charizard-y.mp3     plays for Mega Charizard Y; charizard.mp3 would cover any Charizard form
   Names ignore capitals and punctuation ("mr-mime.mp3" = Mr. Mime). A dedicated file beats a shared one.

STAGE MUSIC (public/music/stage/)
   Put files here with "legendary", "mega" or "uber" in the name. They play during every auction in that stage.
   (See the README.txt in that folder.)

The battle/stage music starts the moment the host presses Start Stage 1 and keeps playing between lots; a Pokémon's own theme takes over only while that Pokémon is being auctioned.

TROUBLESHOOTING: open  /api/music  on your site. "files" must list your battle file. If it is empty, the file is in the wrong folder
(it must be directly in public/music/) or the site hasn't redeployed yet. Hover the 🔊 button to see what is playing.

LIBRARY CHECK: the pool creator's page checks this library. A Pokémon whose name matches a file in pokemon/ is marked
"Already in the library" and needs no upload. File names may use "and" for X/Y forms ("Mega Charizard X and Y.mp3").

ORDER during a live auction:
   pool creator's uploaded theme > library track chosen by the creator > matching file in pokemon/ > stage file > battle file > built-in chiptune
Outside auctions (lobby, between lots):  lobby file > built-in chiptune
