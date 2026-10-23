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

ORDER during a live auction:
   pool creator's uploaded theme > file in pokemon/ > stage file > battle file > built-in chiptune
Outside auctions (lobby, between lots):  lobby file > built-in chiptune
