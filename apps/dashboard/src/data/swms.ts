/**
 * A Safe Work Method Statement, as the shape a real one actually has.
 *
 * This is modelled off the client's own S812.0267 rather than off what a SWMS
 * "generally" contains, because the document a builder accepts is the one his
 * safety consultant wrote, not a tidier version of it. Everything optional
 * here is optional because his has it and the next trade's might not.
 *
 * The five-column register is the substance. A task row carries what the work
 * is, what can go wrong, the risk rating BEFORE controls, the controls
 * themselves, the rating AFTER, and who is accountable — and the pair of
 * ratings is the whole argument: 3H before and 1L after is the claim that the
 * controls do something. An inspector reads that pair first.
 */

/** "3H" — a score 1-4 and its band. 4 Acute, 3 High, 2 Moderate, 1 Low. */
export type RiskRating = string

export interface SwmsControlGroup {
  /** "Manual handling:", "Mixing and applying:" — often absent. */
  heading?: string
  items: string[]
}

export interface SwmsTask {
  task: string
  hazards: string[]
  riskBefore: RiskRating
  controls: SwmsControlGroup[]
  riskAfter: RiskRating
  responsible: string[]
}

export interface SwmsContent {
  /** What the statement covers. Stamped on every page of the printed copy. */
  activity: string
  /** The client's own document number, e.g. S812.0267. */
  documentNo?: string

  /** Who approved the statement, as distinct from who issues a copy of it. */
  approvedByName?: string
  approvedByRole?: string
  approvedOn?: string

  /** Page 1's undertakings — inspections, toolbox talks, when work stops. */
  monitoring: string[]
  /** 4 Acute / 3 High / 2 Moderate / 1 Low, in his words. */
  riskLegend: Array<{ code: string; label: string }>

  ppe: {
    general: string
    whereRequired?: string
    /** Caption per PPE symbol. Drawn as labelled chips, not as clip art. */
    icons: string[]
  }

  /** Cement, sand, adhesives, grout — the substance notes, verbatim. */
  safetyNotes: Array<{ substance: string; text: string }>

  tasks: SwmsTask[]

  part2?: {
    trainingRequired?: string
    duties?: string[]
    trainingModules?: string[]
    supervision?: string[]
    permits?: string
    legislation?: string[]
    plant?: string[]
    maintenance?: string
  }

  /**
   * The jurisdiction's own statutes, which are not the same list as part2's.
   * His document cites the model WHS Act 2011 in Part 2 and the South
   * Australian WHS Act 2012 in a sidebar — and for a tiler in Adelaide the
   * second is the one that binds. Both print.
   */
  jurisdiction?: string[]

  riskAssessment?: {
    likelihood: Array<{ criteria: string; description: string }>
    consequence: Array<{ level: string; example: string }>
    matrixNote?: string
  }

  signOff: {
    preparedByName?: string
    preparedByPosition?: string
    preamble?: string
    /** The numbered undertakings each worker signs against. */
    acknowledgement: string[]
    registerColumns?: string[]
  }
}

/**
 * Whether a template has structure to render from. A row without it falls back
 * to `body`, which is what every statement typed into the app by hand still
 * uses.
 */
export function isStructured(content: unknown): content is SwmsContent {
  if (!content || typeof content !== 'object') return false
  const c = content as Partial<SwmsContent>
  return Array.isArray(c.tasks) && c.tasks.length > 0
}
