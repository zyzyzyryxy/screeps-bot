# Screeps.com bot

## Screeps introduction

Screeps.com is a programming MMO - players write code that will run 24/7 on the server, controlling various game entities (mostly creeps - mobile agents and structures - stationary ones) to gather resources, build and maintain bases (rooms) and interact with other players (mostly trade or fight).

What differs from most MMOs is that there is almost no way to control units manually. It is possible to send commands through the console, but it allows only to execute one basic command (eg move one square) per tick. To be successful in the game, player needs to issue hundreds or thousands of orders per game tick. The way to do it is to write code that will analyze state of all objects and give orders automatically.

See screeps.com to get more information or to try it yourself :-)

## My bot

I found this game when looking for a way to learn javascript. Ended up playing it for almost nine months, actively coding this bot for about 4 months (april - july 2017), achieving rank 171 out of 2017 active players. Then felt the urge to rewrite my code from scratch (this is almost never a good idea :-) ), tried doing it for another two or three months, then lost interest in the game.

I wasn't using any version control for the game code back then, so this repository only contains the final version. Probably prettier than the initial version, but also far from clean, polished code I'd like to achieve, as the game doesn't allow for radical changes - any error on "production" will cause the empire to quickly collapse and there is hardly any staging or testing environment :-)
