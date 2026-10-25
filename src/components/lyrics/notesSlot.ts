import React from 'react';

/** Where Genius notes open. The full player gives its left column (the lyrics move right, under the track);
 * without a slot (the track page, phones) the notes float over the lyrics as before. */
export const NotesSlotContext=React.createContext<{slot:HTMLElement|null;setOpen:(open:boolean)=>void}|null>(null);
