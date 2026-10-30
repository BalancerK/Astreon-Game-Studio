// The kinds of match: deathmatch (everyone for themselves), team deathmatch (two teams, kills count) and control points (two teams, holding the points counts). One place says which are team
// matches, what they are called and what their score limit starts at, so the lobby, the server, the match and the screens agree.

/** Every kind of match and what it is called. */
export const MODE_NAMES = Object.freeze({ tdm: 'Team deathmatch', cp: 'Control points', dm: 'Deathmatch' });

/** Two teams play (rather than every mecha for itself). @param {string} mode */
export const isTeamMode = (mode) => mode === 'tdm' || mode === 'cp';

/** The mode a room or an address asks for, or team deathmatch if it is not one we know. @param {unknown} mode */
export const cleanMode = (mode) => (typeof mode === 'string' && Object.hasOwn(MODE_NAMES, mode) ? mode : 'tdm');

/** The score the match is played to when nothing else is asked for: kills, or points held for a second each in control points. @param {string} mode */
export const defaultLimit = (mode) => (mode === 'dm' ? 15 : mode === 'cp' ? 200 : 25);

/** What the limit counts, for the screens. @param {string} mode */
export const limitWord = (mode) => (mode === 'cp' ? 'points' : 'kills');
