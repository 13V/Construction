/**
 * Whether the phone asks the office for things the office has to answer:
 * time off, and fixing a punch.
 *
 * Both went to the old office dashboard, which approved them, and it is
 * gone. The website has no inbox for them (the owner uses neither), so a
 * request sent now would sit unanswered while the worker waited. Off, every
 * way in is hidden: the clock screen's tiles, Me > Hours (its "Time off"
 * half and each shift's "Not right? Fix this"), "Not right? Fix this" after
 * clocking on, and old notices that pointed at those screens. The screens
 * themselves stay, for the day there is somewhere to approve them.
 */
export const STAFF_REQUESTS = false
