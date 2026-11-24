/**
 * The Coach library: videos, books and tools worth knowing. Links are the public home pages of channels and sites, or
 * Open Library searches for books, so no link can point to a page that moved. No prices. No storage here.
 */

export type LibraryGroup = 'videos' | 'books' | 'tools';

export interface LibraryEntry {
  id: string;
  group: LibraryGroup;
  title: string;
  /** One short line on what it is good for. */
  note: string;
  url: string;
}

export const LIBRARY_GROUPS: readonly { id: LibraryGroup; title: string }[] = [
  { id: 'videos', title: 'Videos' },
  { id: 'books', title: 'Books' },
  { id: 'tools', title: 'Tools' },
];

const yt = (handle: string) => `https://www.youtube.com/@${handle}`;
const book = (title: string) => `https://openlibrary.org/search?q=${encodeURIComponent(title).replace(/%20/g, '+')}`;

export const LIBRARY: readonly LibraryEntry[] = [
  { id: 'v-naroditsky', group: 'videos', title: 'Daniel Naroditsky speedruns', note: 'Open the 1600 to 2000 segments. Pause before each move and predict it.', url: yt('DanielNaroditskyGM') },
  { id: 'v-bartholomew', group: 'videos', title: 'John Bartholomew', note: 'Try Climbing the Rating Ladder and Standard Chess. Calm, clear games.', url: yt('JohnBartholomewChess') },
  { id: 'v-hangingpawns', group: 'videos', title: 'Hanging Pawns', note: 'Opening primers. Watch one before you pick a new line.', url: yt('HangingPawns') },
  { id: 'v-stlchess', group: 'videos', title: 'Saint Louis Chess Club', note: 'Lectures by Seirawan and Finegold.', url: yt('STLChessClub') },
  { id: 'v-gothamchess', group: 'videos', title: 'GothamChess', note: 'Game breakdowns and opening ideas.', url: yt('GothamChess') },
  { id: 'v-chessnetwork', group: 'videos', title: 'ChessNetwork', note: 'Slow walkthroughs of whole games.', url: yt('ChessNetwork') },
  { id: 'v-chessvibes', group: 'videos', title: 'Chess Vibes', note: 'Plain explanations of ideas and games.', url: yt('ChessVibesOfficial') },
  { id: 'v-ericrosen', group: 'videos', title: 'Eric Rosen', note: 'Game stories and opening ideas.', url: yt('EricRosen') },

  { id: 'b-woodpecker', group: 'books', title: 'The Woodpecker Method', note: 'The idea behind your sets: the same puzzles again, faster each cycle.', url: book('The Woodpecker Method') },
  { id: 'b-thinker', group: 'books', title: 'The Improving Chess Thinker', note: 'A way to choose moves, one step at a time.', url: book('The Improving Chess Thinker') },
  { id: 'b-antenna', group: 'books', title: 'Tune Your Chess Tactics Antenna', note: 'Learn to notice tactical signs before you calculate.', url: book('Tune Your Chess Tactics Antenna') },
  { id: 'b-endgames100', group: 'books', title: '100 Endgames You Must Know', note: 'The endgames worth knowing by heart.', url: book('100 Endgames You Must Know') },
  { id: 'b-silman', group: 'books', title: "Silman's Complete Endgame Course", note: 'Endgames sorted by rating level.', url: book("Silman's Complete Endgame Course") },
  { id: 'b-logical', group: 'books', title: 'Logical Chess: Move by Move', note: 'Every move of each game explained in plain words.', url: book('Logical Chess: Move by Move') },
  { id: 'b-positional', group: 'books', title: 'Mastering Positional Chess', note: 'Positional ideas, step by step.', url: book('Mastering Positional Chess') },

  { id: 't-lichess-puzzles', group: 'tools', title: 'Lichess puzzles', note: 'Free puzzles with a rating.', url: 'https://lichess.org/training' },
  { id: 't-lichess-storm', group: 'tools', title: 'Lichess Puzzle Storm', note: 'Fast puzzles against the clock.', url: 'https://lichess.org/storm' },
  { id: 't-lichess-practice', group: 'tools', title: 'Lichess Practice', note: 'Guided lessons on basic checkmates and endgames.', url: 'https://lichess.org/practice' },
  { id: 't-lichess-study', group: 'tools', title: 'Lichess Studies', note: 'Shared lessons and annotated games.', url: 'https://lichess.org/study' },
  { id: 't-lichess-analysis', group: 'tools', title: 'Lichess analysis board', note: 'Set up any position and try ideas.', url: 'https://lichess.org/analysis' },
  { id: 't-chesstempo', group: 'tools', title: 'ChessTempo', note: 'Tactics training and game databases.', url: 'https://www.chesstempo.com/' },
  { id: 't-listudy', group: 'tools', title: 'Listudy', note: 'Opening repertoires you can study move by move.', url: 'https://listudy.org/en' },
  { id: 't-chessable', group: 'tools', title: 'Chessable', note: 'Courses with spaced repetition.', url: 'https://www.chessable.com/' },
  { id: 't-chessbook', group: 'tools', title: 'Chessbook', note: 'Build and drill your own opening repertoire.', url: 'https://chessbook.com/' },
  { id: 't-aimchess', group: 'tools', title: 'Aimchess', note: 'Reports on your habits from your online games.', url: 'https://aimchess.com/' },
  { id: 't-chessly', group: 'tools', title: 'Chessly', note: 'Opening and tactics practice.', url: 'https://chessly.com/' },
  { id: 't-chessdojo', group: 'tools', title: 'ChessDojo', note: 'A training program by rating level, with a community.', url: 'https://www.chessdojo.club/' },
  { id: 't-chesscom-review', group: 'tools', title: 'chess.com Game Review', note: 'The analysis board of chess.com, where its game review starts.', url: 'https://www.chess.com/analysis' },
];

const KNOWN: ReadonlySet<string> = new Set(LIBRARY.map((e) => e.id));

/** Ticked entries from storage: known ids only, once each, in library order. */
export function sanitizeLibraryTicks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const have = new Set(raw.filter((x): x is string => typeof x === 'string' && KNOWN.has(x)));
  return LIBRARY.filter((e) => have.has(e.id)).map((e) => e.id);
}

/** The ticks with `id` switched. An unknown id changes nothing. */
export function toggleLibraryTick(ticks: readonly string[], id: string): string[] {
  const clean = sanitizeLibraryTicks(ticks);
  if (!KNOWN.has(id)) return clean;
  return sanitizeLibraryTicks(clean.includes(id) ? clean.filter((t) => t !== id) : [...clean, id]);
}

export function entriesOf(group: LibraryGroup): LibraryEntry[] {
  return LIBRARY.filter((e) => e.group === group);
}
