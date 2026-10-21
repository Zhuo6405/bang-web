# BANG! web edition — specification

## Goal

Play BANG! with friends in the browser: online multiplayer or solo against computer players, with chat and voice, a Traditional Chinese, English (UK spelling) or Vietnamese interface, and a 3D saloon table.

## Scope

| Phase | Content | Status |
|---|---|---|
| Phase 1 | Base game: 80 cards, 16 characters, 4–7 players | Done |
| Phase 2 | Dodge City (40 cards, 15 characters, 8 players), High Noon (14 events + finale), A Fistful of Cards (14 events + finale) | Done |
| Phase 3 | Gold Rush (24 equipment cards, 8 characters, nugget shop), The Valley of Shadows (15 cards, 8 characters), Wild West Show (8 characters, 7 events + finale) | Done |
| Phase 4 | Armed & Dangerous (ammunition, 28 cards, 8 characters) | Waiting for the full card texts |

Expansions are ticked when setting up a game or room.

## Architecture

- **Front end**: React + Vite; the 3D table uses three.js (@react-three/fiber).
- **Rules engine**: pure TypeScript functions shared by the browser and the server. `applyAction(state, seat, action)` returns the new state; `viewFor(state, seat)` builds what each player may see (other hands and roles hidden).
- **Server**: Cloudflare Workers + Durable Objects. One object per room holds the authoritative game state and pushes each player's view over WebSocket; the state is saved so a server restart can resume the game.
- **Voice**: WebRTC, with signalling relayed through the room server.
- **AI**: sees only its own view (no cheating). The engine records every public targeted interaction in `src/engine/reputation.ts` (weights listed in the guide's "How the computer guesses roles"). `src/ai/mind.ts` lets each computer start from the role counts and use the interactions as evidence to estimate everyone's role probabilities (including who shot whom, who shot me, role counting, and recalculation when the dead are revealed). It turns those into a certainty that someone is an enemy and only shoots when that passes a threshold and is clearly above the odds for a player who has shown nothing, adding grudges, finishing-off and random noise. Three levels: Easy (no chained reasoning, very random, slips), Normal and Hard (fullest reasoning, least random, keen to finish off).
- **Three languages**: logs, prompts and error messages produced by the engine carry Chinese, English and Vietnamese (`bi()` in `src/engine/i18n.ts`), and each player sees their chosen language. Card, character and event names follow the official English edition; Vietnamese keeps those names and translates the descriptions.

## Rules implementation

- Turn: Dynamite check → Jail check → draw → play → discard down to your life.
- One BANG! per turn (except Volcanic and Willy the Kid); one copy of each card in play; one weapon.
- Distance = the shorter way round (skipping the dead) + Mustang/Paul Regret − Scope/Rose Doolan, at least 1.
- Beer can be drunk when dying (no effect with two players left); Sid Ketchum can discard 2 cards to heal.
- Victory: when the Sheriff dies, the Renegade wins if alone, otherwise the Outlaws win; when every Outlaw and Renegade is dead, the Sheriff's side wins.
- Killing an Outlaw draws 3; a Sheriff who kills a Deputy discards every card in hand and in play.

## Character selection

- The pool is the base characters plus those of the ticked expansions.
- Each round every unassigned player submits one pick at the same time (locked once sent); picks are visible to everyone.
- When all have picked: unique picks are assigned; for a clash between two players each tosses 1 coin and the only heads wins; with three or more each tosses 3 coins, the most heads wins and ties toss again (with one coin once two remain).
- Those who miss out play another round, choosing only from characters not yet assigned.
- Seats are shuffled in both solo and online games.
- Once everyone has a character: life = character life (+1 for the Sheriff), hand = life (Big Spencer 5). Each player also gets a random spare character nobody uses, for the New Identity event.

## Expansion details

- **Green cards**: the turn they enter play is recorded and they cannot be used that turn; afterwards they are discarded to use them, on your turn (attack, heal, draw) or when shot (defence). Lasso and Belle Star switch them off.
- **Cards with a cost**: the extra card to discard is chosen when playing; for the Sniper event the cost must be a second BANG!.
- **Events**: ticking High Noon or A Fistful of Cards builds an event deck (14 cards mixed when both are ticked) with a finale at the bottom. From the Sheriff's second turn one card is revealed at the start of each of the Sheriff's turns. Events that act when revealed (The Doctor, The Daltons, Russian Roulette) resolve at once; others last until the next card.
- **Ghost Town**: dead players return as ghosts on their turn, cannot be hurt, do not count for victory, and leave at the end of the turn.
- **Dead Man**: the first player to die returns on their turn with 2 life and 2 cards (once only).

### Phase 3 notes

- **Gold Rush**: 1 nugget per point of damage dealt; three shop cards face up, refilled when bought; brown items are used at once and go to the bottom of the equipment deck; black items stay in front of you, one of each; paying "price + 1" discards someone's item.
- **The Valley of Shadows**: Ghost brings a dead player back (no damage, no healing) until the card is removed; Lemat lets any card be a BANG!; Bounty and Shotgun resolve on damage.
- **Wild West Show**: once the finale is active, the game ends only when one player is left and kill rewards and penalties no longer apply.
- **Not included yet**: Saved! from The Valley of Shadows (needs an instant interrupt whenever anyone is hurt), and Gag (no talking), Dorothy Rage (forcing others to play) and Lady Rose of Texas (swapping seats) from Wild West Show.

## Characters (base game)

| Character | Life | Ability |
|---|---|---|
| Bart Cassidy | 4 | Draws 1 card for each life lost |
| Black Jack | 4 | Shows the second card drawn; red means one more card |
| Calamity Janet | 4 | BANG! and Missed! are interchangeable |
| El Gringo | 3 | Takes a card from the attacker's hand for each damage |
| Jesse Jones | 4 | May draw the first card from another player's hand |
| Jourdonnais | 4 | Always has a Barrel effect |
| Kit Carlson | 4 | Looks at 3 cards and keeps 2 |
| Lucky Duke | 4 | Flips 2 cards for every draw! and chooses one |
| Paul Regret | 3 | Others see him at distance +1 |
| Pedro Ramirez | 4 | May take the first card from the discard pile |
| Rose Doolan | 4 | She sees others at distance −1 |
| Sid Ketchum | 4 | Discards 2 cards to regain 1 life |
| Slab the Killer | 4 | His BANG! needs 2 Missed! |
| Suzy Lafayette | 4 | Draws 1 card when her hand is empty |
| Vulture Sam | 4 | Takes all the cards of anyone who dies |
| Willy the Kid | 4 | Unlimited BANG! |

## Characters (Dodge City)

| Character | Life | Ability |
|---|---|---|
| Pixie Pete | 3 | Draws 3 cards |
| Tequila Joe | 4 | Beer heals 2 |
| Greg Digger | 4 | Regains 2 life when someone dies |
| Herb Hunter | 4 | Draws 2 cards when someone dies |
| Elena Fuente | 3 | Any card can be a Missed! |
| Bill Noface | 4 | Draws 1 card plus 1 per missing life |
| Molly Stark | 4 | Draws 1 card when she plays a card out of turn |
| Apache Kid | 3 | Others' Diamond cards have no effect on him (except Duel) |
| Sean Mallory | 3 | Hand limit 10 |
| Belle Star | 4 | On her turn others' cards in play have no effect |
| Vera Custer | 3 | Copies a player's ability at the start of her turn |
| Chuck Wengam | 4 | Loses 1 life to draw 2 cards |
| Pat Brennan | 4 | Instead of drawing, takes one card in play |
| José Delgado | 4 | Discards a blue card to draw 2 (twice per turn) |
| Doc Holyday | 4 | Once per turn discards 2 cards to shoot |

## Online play

- Creating a room gives a 5-character invite code; a link with `?room=CODE` joins directly.
- Seats are shuffled when the game starts (humans and computers mixed); the host sets the computer difficulty. Computer names follow the host's language at the time.
- A disconnected player is replaced by the computer after 15 seconds and takes over again on return; the game pauses when everyone is offline, and rooms unused for 7 days are deleted.
- Time limits per decision: 60 seconds to pick a character, 90 to play, 30 to respond; when time runs out the computer decides.

## Results

- The results screen lets you read the full game log (from character selection to the end), or close the results to look at the final table and reopen them later.

## Testing

- Unit tests: card counts, shooting and dodging, BANG! limit, Slab the Killer, Jail targets, Beer with two players, view secrecy, green-card timing, cards with a cost, defensive green cards in play, The Sermon, The Judge, Lasso, event decks.
- Character selection: coin tosses on clashes, only characters from ticked expansions, +1 life for the Sheriff, life per character.
- AI simulations: many games at 4–8 players, every expansion mix and all three levels, checking that every game ends, card counts are conserved, and every event, prompt and card appears; plus statistics on how often each role shoots its own side, and win rates.
