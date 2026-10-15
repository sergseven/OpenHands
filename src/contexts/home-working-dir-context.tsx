import React from "react";

/**
 * The host workspace picked in the home launcher, which the next conversation
 * will open. Null outside the launcher and while no workspace is picked.
 */
export const HomeWorkingDirContext = React.createContext<string | null>(null);
