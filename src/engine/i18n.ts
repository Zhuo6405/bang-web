import { CARD_DEFS, CHAR_BY_ID, EVENT_BY_ID, EXPANSIONS, GOLD_DEFS, ROLE_GOAL, ROLE_NAME, SUIT_NAME } from './data'
import type { CardKey, GoldKey, Role, Suit } from './types'

/**
 * 雙語文字：引擎產生的訊息同時帶中文和英文，用 SEP 隔開，畫面依語言挑一邊。
 * 英文一律用英式拼法。
 */
export type Lang = 'zh' | 'en'
export const SEP = '␞'
export const bi = (zh: string, en: string) => `${zh}${SEP}${en}`
export function pick(s: string, lang: Lang): string {
  const i = s.indexOf(SEP)
  if (i < 0) return s
  return lang === 'en' ? s.slice(i + SEP.length) : s.slice(0, i)
}

export const CARD_EN: Record<CardKey, { name: string; desc: string }> = {
  bang: { name: 'BANG!', desc: 'Shoot one player within range. Only once per turn.' },
  missed: { name: 'Missed!', desc: 'Play when shot to dodge the shot.' },
  beer: { name: 'Beer', desc: 'Regain 1 life (not above your maximum). Can be drunk when dying. No effect when only two players remain.' },
  saloon: { name: 'Saloon', desc: 'Every living player regains 1 life.' },
  stagecoach: { name: 'Stagecoach', desc: 'Draw 2 cards.' },
  wellsfargo: { name: 'Wells Fargo', desc: 'Draw 3 cards.' },
  store: { name: 'General Store', desc: 'Reveal as many cards as there are living players; starting with you, everyone takes one.' },
  gatling: { name: 'Gatling', desc: 'Shoot every other player once (ignores distance and the BANG! limit).' },
  indians: { name: 'Indians!', desc: 'Every other player must discard a BANG! or lose 1 life.' },
  duel: { name: 'Duel', desc: 'Challenge any player: starting with them, you take turns discarding BANG!; the first who cannot loses 1 life.' },
  panic: { name: 'Panic!', desc: 'Take one card (from hand or table) from a player at distance 1.' },
  catbalou: { name: 'Cat Balou', desc: 'Make any player discard one card (from hand or table).' },
  barrel: { name: 'Barrel', desc: 'When shot, you may draw! — a Heart counts as a Missed!.' },
  dynamite: { name: 'Dynamite', desc: 'Place in front of yourself. At the start of your turn draw!: a Spade 2–9 explodes for 3 damage, otherwise it passes on.' },
  jail: { name: 'Jail', desc: 'Place in front of anyone except the Sheriff. At the start of their turn they draw!: a Heart escapes, otherwise they skip the turn.' },
  mustang: { name: 'Mustang', desc: 'Others see you at distance +1.' },
  scope: { name: 'Scope', desc: 'You see others at distance −1.' },
  volcanic: { name: 'Volcanic', desc: 'Range 1. You may play any number of BANG! cards.', },
  schofield: { name: 'Schofield', desc: 'Range 2.' },
  remington: { name: 'Remington', desc: 'Range 3.' },
  carabine: { name: 'Rev. Carabine', desc: 'Range 4.' },
  winchester: { name: 'Winchester', desc: 'Range 5.' },
  punch: { name: 'Punch', desc: 'Shoot a player at distance 1 (does not count as your BANG!).' },
  dodge: { name: 'Dodge', desc: 'Counts as a Missed!, then draw 1 card.' },
  ragtime: { name: 'Rag Time', desc: 'Discard another card: take one card from any player (any distance).' },
  brawl: { name: 'Brawl', desc: 'Discard another card: every other player discards one card of your choice (hand or table).' },
  springfield: { name: 'Springfield', desc: 'Discard another card: shoot any player (any distance, does not count as your BANG!).' },
  tequila: { name: 'Tequila', desc: 'Discard another card: any player (yourself included) regains 1 life.' },
  whisky: { name: 'Whisky', desc: 'Discard another card: regain 2 life.' },
  binocular: { name: 'Binocular', desc: 'You see others at distance −1.' },
  hideout: { name: 'Hideout', desc: 'Others see you at distance +1.' },
  bible: { name: 'Bible', desc: 'Green card: discard when shot to count as a Missed!, and draw 1 card.' },
  hat: { name: 'Ten Gallon Hat', desc: 'Green card: discard when shot to count as a Missed!.' },
  ironplate: { name: 'Iron Plate', desc: 'Green card: discard when shot to count as a Missed!.' },
  sombrero: { name: 'Sombrero', desc: 'Green card: discard when shot to count as a Missed!.' },
  knife: { name: 'Knife', desc: 'Green card: discard to shoot a player at distance 1.' },
  derringer: { name: 'Derringer', desc: 'Green card: discard to shoot a player at distance 1, and draw 1 card.' },
  canteen: { name: 'Canteen', desc: 'Green card: discard to regain 1 life.' },
  cancan: { name: 'Can Can', desc: 'Green card: discard to use as a Cat Balou.' },
  conestoga: { name: 'Conestoga', desc: 'Green card: discard to take one card from any player (any distance).' },
  pepperbox: { name: 'Pepperbox', desc: 'Green card: discard to shoot a player within range (does not count as your BANG!).' },
  buffalo: { name: 'Buffalo Rifle', desc: 'Green card: discard to shoot any player (any distance).' },
  howitzer: { name: 'Howitzer', desc: 'Green card: discard to use as a Gatling.' },
  pony: { name: 'Pony Express', desc: 'Green card: discard to draw 3 cards.' },
  ghostcard: { name: 'Ghost', desc: 'Place in front of a dead player: they return as a ghost who cannot be hurt or healed. If the card is removed, they leave again.' },
  lemat: { name: 'Lemat', desc: 'Range 1. On your turn any card in hand can be played as a BANG!.' },
  rattlesnake: { name: 'Rattlesnake', desc: 'Place in front of any player: at the start of their turn they draw! — a Spade costs them 1 life.' },
  shotgun: { name: 'Shotgun', desc: 'Range 1. Each player you wound must discard 1 card from hand.' },
  bounty: { name: 'Bounty', desc: 'Place in front of any player: whoever hits them with a BANG! draws 1 card.' },
  lastcall: { name: 'Last Call', desc: 'Regain 1 life (works even when only two players remain).' },
  tomahawk: { name: 'Tomahawk', desc: 'Attack a player up to distance 2 (only a Missed! avoids it).' },
  tornado: { name: 'Tornado', desc: 'Everyone (you included) discards 1 card, then draws 2.' },
  fanning: { name: 'Fanning', desc: 'Counts as your BANG!: shoot the target, then another player at distance 1 from them.' },
  aim: { name: 'Aim', desc: 'Play together with a BANG!: if it hits, the target loses 2 life.' },
  bandidos: { name: 'Bandidos', desc: 'Every other player discards 2 cards (1 if that is all they have) or loses 1 life.' },
  escape: { name: 'Escape', desc: 'Play out of turn: avoid the effect of a brown card that targets you (except BANG!).' },
  poker: { name: 'Poker', desc: 'Every other player discards 1 card; if there is no Ace among them, you take up to 2 of them.' },
  backfire: { name: 'Backfire', desc: 'Counts as a Missed!, and shoots back at the shooter.' },
}

export const GOLD_EN: Record<GoldKey, { name: string; desc: string }> = {
  shotglass: { name: 'Shot', desc: 'Any player (yourself included) regains 1 life.' },
  bottle: { name: 'Bottle', desc: 'Use as a Panic!, a Beer or a BANG! (does not count as your BANG!).' },
  pardner: { name: 'Pardner', desc: 'Use as a General Store, a Duel or a Cat Balou.' },
  goldrushcard: { name: 'Gold Rush', desc: 'End your turn now, regain all your life, then play another turn.' },
  rum: { name: 'Rum', desc: 'Draw! 4 cards; regain 1 life for each different suit.' },
  unionpacific: { name: 'Union Pacific', desc: 'Draw 4 cards.' },
  calumet: { name: 'Calumet', desc: 'Diamond cards played by others have no effect on you (except Duel).' },
  gunbelt: { name: 'Gun Belt', desc: 'You may keep up to 8 cards at the end of your turn.' },
  horseshoe: { name: 'Horseshoe', desc: 'When you draw!, flip 2 cards and choose the better one.' },
  pickaxe: { name: 'Pickaxe', desc: 'Draw 1 extra card in your draw phase.' },
  wanted: { name: 'Wanted', desc: 'Place in front of another player: whoever kills them draws 2 cards and gets 1 gold nugget.' },
  goldpan: { name: 'Gold Pan', desc: 'On your turn, pay 1 nugget to draw 1 card, at most twice per turn.' },
  boots: { name: 'Boots', desc: 'Draw 1 card for each life you lose (not the last one).' },
  luckycharm: { name: 'Lucky Charm', desc: 'Gain 1 nugget for each life you lose (not the last one).' },
  rucksack: { name: 'Rucksack', desc: 'Pay 2 nuggets to regain 1 life (also when dying).' },
}

export const CHAR_EN: Record<string, { name: string; text: string }> = {
  bart: { name: 'Bart Cassidy', text: 'Each time he loses 1 life, he draws 1 card.' },
  blackjack: { name: 'Black Jack', text: 'In his draw phase he shows the second card: if it is a Heart or Diamond, he draws one more.' },
  calamity: { name: 'Calamity Janet', text: 'She can use BANG! as Missed! and vice versa.' },
  gringo: { name: 'El Gringo', text: 'For each life lost to a player, he takes a random card from that player’s hand.' },
  jesse: { name: 'Jesse Jones', text: 'He may draw his first card at random from any player’s hand.' },
  jourdonnais: { name: 'Jourdonnais', text: 'He always counts as having a Barrel; with a real Barrel he may draw! twice.' },
  kit: { name: 'Kit Carlson', text: 'He looks at the top 3 cards of the deck, keeps 2 and puts the other back on top.' },
  lucky: { name: 'Lucky Duke', text: 'Each time he draws!, he flips 2 cards and chooses the one he likes.' },
  paul: { name: 'Paul Regret', text: 'Others see him at distance +1.' },
  pedro: { name: 'Pedro Ramirez', text: 'He may draw his first card from the top of the discard pile.' },
  rose: { name: 'Rose Doolan', text: 'She sees others at distance −1.' },
  sid: { name: 'Sid Ketchum', text: 'At any time he may discard 2 cards to regain 1 life.' },
  slab: { name: 'Slab the Killer', text: 'His BANG! needs 2 Missed! to be cancelled.' },
  suzy: { name: 'Suzy Lafayette', text: 'As soon as her hand is empty, she draws 1 card.' },
  vulture: { name: 'Vulture Sam', text: 'When a player dies, he takes all their cards in hand and in play.' },
  willy: { name: 'Willy the Kid', text: 'He may play any number of BANG! cards.' },
  pixie: { name: 'Pixie Pete', text: 'He draws 3 cards in his draw phase.' },
  tequilajoe: { name: 'Tequila Joe', text: 'Beer restores 2 life for him.' },
  greg: { name: 'Greg Digger', text: 'When another player dies, he regains 2 life.' },
  herb: { name: 'Herb Hunter', text: 'When another player dies, he draws 2 cards.' },
  elena: { name: 'Elena Fuente', text: 'She can use any card in hand as a Missed!.' },
  bill: { name: 'Bill Noface', text: 'He draws 1 card, plus 1 for each life he is missing.' },
  molly: { name: 'Molly Stark', text: 'Each time she plays a card out of her turn, she draws 1 card.' },
  apache: { name: 'Apache Kid', text: 'Diamond cards played by others have no effect on him (except Duel).' },
  sean: { name: 'Sean Mallory', text: 'He may keep up to 10 cards at the end of his turn.' },
  belle: { name: 'Belle Star', text: 'During her turn, cards in play in front of other players have no effect.' },
  vera: { name: 'Vera Custer', text: 'At the start of her turn she copies the ability of a living player until her next turn.' },
  chuck: { name: 'Chuck Wengam', text: 'On his turn he may lose 1 life to draw 2 cards (not his last life).' },
  pat: { name: 'Pat Brennan', text: 'Instead of drawing, he may take one card in play from any player.' },
  jose: { name: 'José Delgado', text: 'On his turn he may discard a blue card to draw 2 cards, at most twice per turn.' },
  doc: { name: 'Doc Holyday', text: 'Once per turn he may discard 2 cards to shoot a player in range (not counting as his BANG!).' },
  donbell: { name: 'Don Bell', text: 'At the end of his turn he draws!: on a Heart or Diamond he plays another turn (only once).' },
  dutch: { name: 'Dutch Will', text: 'He draws 2 cards, keeps 1, discards the other and gains 1 gold nugget.' },
  jacky: { name: 'Jacky Murieta', text: 'On his turn he may pay 2 nuggets to shoot a player in range without a card.' },
  josh: { name: 'Josh McCloud', text: 'On his turn he may pay 2 nuggets to draw the top equipment card.' },
  yto: { name: 'Madam Yto', text: 'Whenever anyone plays a Beer, she draws 1 card.' },
  luzena: { name: 'Pretty Luzena', text: 'Once per turn she buys one equipment card for 1 nugget less.' },
  raddie: { name: 'Raddie Snake', text: 'On his turn he may pay 1 nugget to draw 1 card, at most twice per turn.' },
  simeon: { name: 'Simeon Picos', text: 'He gains 1 gold nugget for each life he loses.' },
  blackflower: { name: 'Black Flower', text: 'Once per turn she may play a Club card as an extra BANG!.' },
  colorado: { name: 'Colorado Bill', text: 'When he plays a BANG! he draws!: on a Spade it cannot be avoided.' },
  ringer: { name: 'Der Spot – Burst Ringer', text: 'Once per turn he may play a BANG! as a Gatling.' },
  evelyn: { name: 'Evelyn Shebang', text: 'For each card she skips in her draw phase, she shoots a different player in range.' },
  henry: { name: 'Henry Block', text: 'Anyone who takes or discards one of his cards (hand or table) is shot by him.' },
  lemonade: { name: 'Lemonade Jim', text: 'When another player drinks a Beer, he may discard 1 card to regain 1 life too.' },
  mick: { name: 'Mick Defender', text: 'When targeted by a brown card (other than BANG!), he may avoid it with a Missed!.' },
  tuco: { name: 'Tuco Franziskaner', text: 'If he has no blue cards in play, he draws 2 extra cards.' },
  bigspencer: { name: 'Big Spencer', text: 'Starts with only 5 cards in hand. Cannot play Missed!.' },
  flint: { name: 'Flint Westwood', text: 'Once per turn he may swap 1 card from his hand for 2 random cards from another player.' },
  gary: { name: 'Gary Looter', text: 'He takes the excess cards others discard at the end of their turns.' },
  greygory: { name: 'Greygory Deck', text: 'At the start of his turn he draws 2 random characters and has their abilities until his next turn.' },
  johnpain: { name: 'John Pain', text: 'With fewer than 6 cards in hand, he takes every card flipped in a draw!.' },
  lee: { name: 'Lee Van Kliff', text: 'On his turn he may discard a BANG! to repeat the effect of the brown card he just played.' },
  teren: { name: 'Teren Kill', text: 'When he would die, he draws!: unless it is a Spade, he stays at 1 life and draws 1 card.' },
  youl: { name: 'Youl Grinner', text: 'At the start of his turn, everyone with more cards in hand gives him 1 card.' },
}

export const EVENT_EN: Record<string, { name: string; text: string }> = {
  blessing: { name: 'Blessing', text: 'Every card counts as a Heart.' },
  curse: { name: 'Curse', text: 'Every card counts as a Spade.' },
  ghosttown: { name: 'Ghost Town', text: 'Dead players return as ghosts on their turn: they draw 3 cards, cannot be hurt, and leave again at the end of the turn.' },
  goldrush: { name: 'Gold Rush', text: 'Play proceeds anticlockwise.' },
  daltons: { name: 'The Daltons', text: 'When revealed, everyone with blue cards in play discards one of them.' },
  doctor: { name: 'The Doctor', text: 'When revealed, the players with the least life each regain 1 life.' },
  reverend: { name: 'The Reverend', text: 'Beer cannot be played.' },
  train: { name: 'Train Arrival', text: 'Draw 1 extra card in your draw phase.' },
  hangover: { name: 'Hangover', text: 'All characters lose their abilities.' },
  sermon: { name: 'The Sermon', text: 'You cannot play BANG! during your own turn.' },
  thirst: { name: 'Thirst', text: 'Draw only 1 card in your draw phase.' },
  shootout: { name: 'Shootout', text: 'You may play 2 BANG! cards per turn.' },
  handcuffs: { name: 'Handcuffs', text: 'After drawing, name a suit: this turn you may only play cards of that suit.' },
  newidentity: { name: 'New Identity', text: 'At the start of your turn you may switch to your other character; if you do, you restart at 2 life.' },
  highnoon: { name: 'High Noon', text: 'Every player loses 1 life at the start of their turn.' },
  ambush: { name: 'Ambush', text: 'The base distance between any two players is 1.' },
  sniper: { name: 'Sniper', text: 'On your turn you may discard 2 BANG! together: the shot needs 2 Missed! to avoid (counts as your BANG!).' },
  deadman: { name: 'Dead Man', text: 'The first player to die returns on their turn with 2 life and 2 cards.' },
  blood: { name: 'Blood Brothers', text: 'At the start of your turn you may lose 1 life (not your last) so another player regains 1.' },
  judge: { name: 'The Judge', text: 'No cards may be placed in front of anyone (no equipment, no Jail).' },
  lasso: { name: 'Lasso', text: 'Cards in play have no effect.' },
  law: { name: 'Law of the West', text: 'Show the second card you draw; if you can play it, you must play it first this turn.' },
  liquor: { name: 'Hard Liquor', text: 'You may skip drawing to regain 1 life instead.' },
  mine: { name: 'Abandoned Mine', text: 'Draw from the discard pile; cards discarded at the end of your turn go on top of the deck.' },
  peyote: { name: 'Peyote', text: 'Instead of drawing, guess whether the next card is red or black: keep it and guess again if right, stop if wrong.' },
  ranch: { name: 'Ranch', text: 'After drawing, you may discard any number of cards and draw as many.' },
  ricochet: { name: 'Ricochet', text: 'You may play BANG! at a card in play in front of anyone: unless its owner plays a Missed!, that card is discarded.' },
  roulette: { name: 'Russian Roulette', text: 'When revealed, starting with the Sheriff everyone discards a Missed!; the first who cannot loses 2 life.' },
  vendetta: { name: 'Vendetta', text: 'At the end of your turn draw!: on a Heart you play another turn (only once).' },
  fistful: { name: 'A Fistful of Cards', text: 'At the start of your turn you are shot once for each card in your hand.' },
  boneorchard: { name: 'Bone Orchard', text: 'When revealed, every dead player returns with 1 life; roles are reshuffled among them.' },
  darling: { name: 'Darling Valentine', text: 'At the start of your turn, discard your whole hand and draw as many cards.' },
  helena: { name: 'Helena Zontero', text: 'When revealed, draw!: on a Heart or Diamond, the roles of all living players except the Sheriff are reshuffled.' },
  susanna: { name: 'Miss Susanna', text: 'Play at least 3 cards each turn or lose 1 life.' },
  showdown: { name: 'Showdown', text: 'Any card can be played as a BANG!, and BANG! can be played as a Missed!.' },
  sacagaway: { name: 'Sacagaway', text: 'Everyone plays with their hand revealed.' },
  wildwestshow: { name: 'Wild West Show', text: 'Everyone’s goal becomes: be the last one standing!' },
}

export const ROLE_EN: Record<Role, string> = { sheriff: 'Sheriff', deputy: 'Deputy', outlaw: 'Outlaw', renegade: 'Renegade' }
export const ROLE_GOAL_EN: Record<Role, string> = {
  sheriff: 'Eliminate every Outlaw and the Renegade.',
  deputy: 'Protect the Sheriff and eliminate every Outlaw and the Renegade.',
  outlaw: 'Kill the Sheriff.',
  renegade: 'Be the last one standing (finally beating the Sheriff one-on-one).',
}
export const SUIT_EN: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' }
export const EXP_EN: Record<string, string> = {
  base: 'Base game',
  dodge_city: 'Dodge City',
  high_noon: 'High Noon',
  fistful: 'A Fistful of Cards',
  wild_west_show: 'Wild West Show',
  gold_rush: 'Gold Rush',
  valley_of_shadows: 'The Valley of Shadows',
  armed_dangerous: 'Armed & Dangerous',
}
export const AI_NAMES_EN = ['Billy', 'Annie', 'Jack', 'Dorothy', 'Tom', 'Ruby', 'Old Joe', 'Hank', 'Daisy']

// ── 依語言取名稱與說明 ──
export const cardName = (k: CardKey, l: Lang) => (l === 'en' ? CARD_EN[k].name : CARD_DEFS[k].name)
export const cardDesc = (k: CardKey, l: Lang) => (l === 'en' ? CARD_EN[k].desc : CARD_DEFS[k].desc)
export const goldName = (k: GoldKey, l: Lang) => (l === 'en' ? GOLD_EN[k].name : GOLD_DEFS[k].name)
export const goldDesc = (k: GoldKey, l: Lang) => (l === 'en' ? GOLD_EN[k].desc : GOLD_DEFS[k].desc)
export const charName = (id: string, l: Lang) => (l === 'en' ? (CHAR_EN[id]?.name ?? id) : (CHAR_BY_ID[id]?.name ?? id))
export const charText = (id: string, l: Lang) => (l === 'en' ? (CHAR_EN[id]?.text ?? '') : (CHAR_BY_ID[id]?.text ?? ''))
export const eventName = (id: string, l: Lang) => (l === 'en' ? (EVENT_EN[id]?.name ?? id) : (EVENT_BY_ID[id]?.name ?? id))
export const eventText = (id: string, l: Lang) => (l === 'en' ? (EVENT_EN[id]?.text ?? '') : (EVENT_BY_ID[id]?.text ?? ''))
export const roleName = (r: Role, l: Lang) => (l === 'en' ? ROLE_EN[r] : ROLE_NAME[r])
export const roleGoal = (r: Role, l: Lang) => (l === 'en' ? ROLE_GOAL_EN[r] : ROLE_GOAL[r])
export const suitName = (s: Suit, l: Lang) => (l === 'en' ? SUIT_EN[s] : SUIT_NAME[s])
export const expName = (id: string, l: Lang) => (l === 'en' ? (EXP_EN[id] ?? id) : (EXPANSIONS.find((e) => e.id === id)?.name ?? (id === 'base' ? '基本版' : id)))
