import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import scheduleSrc from '../../worker/simple/Schedule.tsx?raw'
import pageSrc from './SchedulePage.tsx?raw'

/**
 * SchedulePage tells whether a copy of the phone's schedule has loaded by
 * reading the phone's own output: the heading of the chart's job column
 * (CHART_HEAD), with the job rows drawn beside it, and what the chart says
 * once it has loaded and no job falls in the window (CHART_EMPTY). Reword
 * either on the phone and nothing fails to compile, but no copy ever counts
 * as loaded: a first open turns to "Did not load" after 30 s, and a quiet
 * reload never goes on screen. This pins both words, and the shape the page
 * reads them in, against the phone's source.
 */

const constant = (name: string) => {
  const m = new RegExp(`const ${name} = '([^']+)'`).exec(pageSrc)
  if (!m) throw new Error(`SchedulePage.tsx no longer declares ${name}`)
  return m[1]!
}
const CHART_HEAD = constant('CHART_HEAD')
const CHART_EMPTY = constant('CHART_EMPTY')

const phone = ts.createSourceFile('Schedule.tsx', scheduleSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

/** Every JSX element in the phone's schedule whose text, trimmed as JSX trims it, is all it holds. */
function textElements(): Array<{ el: ts.JsxElement; text: string }> {
  const out: Array<{ el: ts.JsxElement; text: string }> = []
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) && n.children.length > 0 && n.children.every((c) => ts.isJsxText(c))) {
      out.push({ el: n, text: n.children.map((c) => c.getText().trim()).join(' ').trim() })
    }
    ts.forEachChild(n, visit)
  }
  visit(phone)
  return out
}

describe("the phone schedule's words that SchedulePage reads", () => {
  it(`draws "${CHART_HEAD}" as a span, alone, with the job rows mapped right beside it`, () => {
    const heads = textElements().filter((x) => x.text === CHART_HEAD)
    expect(heads.map((x) => x.el.openingElement.tagName.getText())).toEqual(['span'])
    // projectColumn() takes the span's parent, and chartLoaded() counts that parent's children past the span.
    const column = heads[0]!.el.parent
    expect(ts.isJsxElement(column)).toBe(true)
    const kids = (column as ts.JsxElement).children.filter((c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces))
    expect(kids[0]).toBe(heads[0]!.el)
    expect(kids.slice(1).map((c) => c.getText().replace(/\s+/g, ' ').slice(0, 20))).toEqual(['{geometry.map(({ r }'])
  })

  it(`says "${CHART_EMPTY}" only once it has loaded`, () => {
    const empty = textElements().filter((x) => x.text.startsWith(CHART_EMPTY))
    expect(empty).toHaveLength(1)
    let n: ts.Node = empty[0]!.el
    while (!ts.isJsxExpression(n)) n = n.parent
    // While it loads it shows neither the rows nor this: that is how a copy still loading is told apart.
    expect(n.getText()).toMatch(/!loading/)
  })
})
