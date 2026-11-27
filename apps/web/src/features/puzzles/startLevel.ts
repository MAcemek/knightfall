import { DEFAULT_GLICKO, type Glicko } from '@knightfall/core';

/** Pure rules for the one-time "choose a starting level" prompt on the rated Puzzles page. */

export interface StartLevel {
  id: 'beginner' | 'club' | 'strong';
  label: string;
  rating: number;
}

export const START_LEVELS: StartLevel[] = [
  { id: 'beginner', label: 'Beginner', rating: 800 },
  { id: 'club', label: 'Club player', rating: 1200 },
  { id: 'strong', label: 'Strong', rating: 1600 },
];

/** Only a player with no rated attempts and a still untouched default rating is asked. */
export function shouldOfferStartLevel(ratedAttempts: number, rating: Glicko): boolean {
  return ratedAttempts === 0 && rating.rating === DEFAULT_GLICKO.rating && rating.rd === DEFAULT_GLICKO.rd;
}

/** The rating stored for a choice: that rating with the default RD and volatility. */
export function startRating(level: StartLevel): Glicko {
  return { ...DEFAULT_GLICKO, rating: level.rating };
}
