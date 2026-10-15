#!/usr/bin/env bash
# Phone fingerprint: would this change alter what ships inside the iOS app?
#
# The App Store binary carries apps/dashboard built with VITE_SURFACE=worker
# (ios-testflight.yml "Build the worker web bundle", apps/mobile build:web).
# The website lives in the same codebase, so web work can reach phones by
# accident through any module the two share. Reading diffs does not catch
# that reliably; the bundle itself does. The build is deterministic, so the
# same source and the same env give the same bytes, file for file. Building
# the phone bundle at two commits and hashing every file therefore answers
# "did the phone change?" exactly. Measured before this gate existed: a whole
# desktop app added behind officeSurface(), and the old office deleted
# outright, both left every hash alone. A default-valued prop added to one
# phone component, a change that looks like a no-op, renamed 7 of 11 files.
#
# The env is fixed and fake on purpose. The values are compiled into the
# bundle, so they only have to be the same on both sides, and this way the
# real Supabase URL and key never need to be in CI.
#
# Usage
#   scripts/phone-fingerprint.sh build <checkout> <out-dir>
#       Build the phone bundle from <checkout> into <out-dir>/dist, write
#       <out-dir>/manifest.txt ("<sha256>  ./<path>" per file) and print it.
#
#   scripts/phone-fingerprint.sh compare <base-checkout> <head-checkout> [<work-dir>]
#       Build both, list every file that differs, and check the head bundle
#       for text the phone must never carry. Manifests, bundles and the diff
#       are kept in <work-dir> when one is given, else in a temp dir that is
#       removed afterwards.
#
# A checkout is a repo root, the directory that holds apps/dashboard. It
# builds with `npm run build:phone` when its package.json has that script
# (the phone-only typecheck), else `npm run build`, the same command the
# iOS workflow runs. node_modules is installed with `npm ci` if missing.
# The bundle goes to <out-dir>, never to the checkout's own dist, so
# pointing this at a working tree does not overwrite a web build there.
#
# Environment
#   LABEL  Labels on the change, comma or space separated. ships-to-ios
#          turns a bundle difference from a failure into a notice, because
#          the change is meant to reach phones. It never excuses forbidden
#          text: that is a promise made to App Review, not a judgement call.
#
# Exit status
#   0   phone bundle identical (or different but labelled ships-to-ios)
#   1   phone bundle changed and the change is not labelled ships-to-ios
#   2   the phone bundle contains text it must never carry
#   3   a build failed
#   64  usage
set -euo pipefail

# What the phone bundle must never contain, labelled or not.
FORBIDDEN=(
  # App Review was told a company is created on the website and nowhere
  # else, and that the phone binary carries no company sign-up. These are
  # the two places SignIn.tsx offers it, behind CAN_CREATE_COMPANY.
  'Create a company account'
  'Set up a new company'
  # The new website's marker (src/web/marker.ts). Every web build contains
  # it, so finding it here means the website itself leaked into the app.
  'crewline-web-surface'
)

# Exactly what the iOS build sets, with dummy values for the two secrets.
PINNED_ENV=(
  VITE_SURFACE=worker
  VITE_BRAND=Proven
  VITE_API_BASE=https://construction-opal-three.vercel.app
  VITE_SUPABASE_URL=https://example.supabase.co
  VITE_SUPABASE_ANON_KEY=dummy
)

in_actions() { [ "${GITHUB_ACTIONS:-}" = true ]; }
say() { printf '%s\n' "$*" >&2; }
# GitHub turns ::error:: lines into annotations on the run; locally they are
# just prefixed messages.
annotate() {
  if in_actions; then printf '::%s::%s\n' "$1" "$2"; else printf '%s: %s\n' "$1" "$2" >&2; fi
}
summary() {
  if in_actions && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; fi
}
usage() { sed -n '/^# Usage/,/^# Exit status/p' "$0" | sed '$d; s/^# \{0,1\}//' >&2; exit 64; }

# sha256sum on Linux, shasum on a Mac. Both print "<hash>  <path>".
if command -v sha256sum >/dev/null 2>&1; then
  hash_file() { sha256sum "$1"; }
else
  hash_file() { shasum -a 256 "$1"; }
fi

# build_phone <checkout> <out-dir>: returns 0, or 3 when the bundle did not
# build. Every step checks its own status, because callers run this inside
# `if`, where bash ignores `set -e`.
build_phone() {
  local checkout="$1" out="$2" app script var f leaks
  app="$checkout/apps/dashboard"
  if [ ! -f "$app/package.json" ]; then
    annotate error "$checkout has no apps/dashboard/package.json"
    return 3
  fi
  mkdir -p "$out" || return 3
  out="$(cd "$out" && pwd)" || return 3
  # Only what this function writes is cleared, never <out-dir> itself.
  rm -rf "$out/dist" "$out/manifest.txt" "$out/build.log" || return 3

  # The bundle is sent to <out-dir> by appending --outDir to the npm script,
  # which only lands on Vite if `vite build` is the last command in it.
  # shellcheck disable=SC2016  # the ${} below is JavaScript, not shell
  if ! script="$(cd "$app" && node -e '
      const scripts = require("./package.json").scripts || {}
      const name = scripts["build:phone"] ? "build:phone" : "build"
      if (!/\bvite build\s*$/.test(scripts[name] || "")) {
        console.error(`the "${name}" script is "${scripts[name] || ""}"; it must end with "vite build"`)
        process.exit(1)
      }
      console.log(name)
    ')"; then
    annotate error "Cannot build the phone bundle in $checkout: see the message above."
    return 3
  fi

  if [ ! -d "$app/node_modules" ]; then
    say "Installing dependencies in $app (npm ci)"
    if ! (cd "$app" && npm ci --no-audit --no-fund >&2); then
      annotate error "npm ci failed in $app"
      return 3
    fi
  fi

  # Any other VITE_* in this shell is dropped, so the bundle depends only on
  # the source and PINNED_ENV. Vite also reads .env files: committed ones are
  # source and count, but a gitignored .env*.local is not, and anything in it
  # beyond the pinned keys would make this bundle differ from CI's.
  local unset_args=()
  for var in $(compgen -e); do
    case "$var" in VITE_*) unset_args+=(-u "$var") ;; esac
  done
  for f in "$app/.env.local" "$app/.env.production.local"; do
    [ -f "$f" ] || continue
    leaks="$(sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?(VITE_[A-Za-z0-9_]+)[[:space:]]*=.*/\2/p' "$f" \
      | grep -vxE 'VITE_(SURFACE|BRAND|API_BASE|SUPABASE_URL|SUPABASE_ANON_KEY)' || true)"
    if [ -n "$leaks" ]; then
      annotate warning "$f sets $(printf '%s' "$leaks" | tr '\n' ' ')and Vite will bundle it. Fingerprint a clean checkout to compare with CI."
    fi
  done

  say "Building the phone bundle from $checkout (npm run $script)"
  if ! (cd "$app" && env ${unset_args[@]+"${unset_args[@]}"} "${PINNED_ENV[@]}" \
        npm run "$script" -- --outDir "$out/dist" --emptyOutDir > "$out/build.log" 2>&1); then
    tail -n 40 "$out/build.log" >&2
    annotate error "The phone bundle did not build from $checkout (npm run $script). Full log: $out/build.log"
    return 3
  fi
  if [ ! -f "$out/dist/index.html" ]; then
    annotate error "The phone build from $checkout produced no index.html."
    return 3
  fi

  # "./"-relative and byte-sorted, so manifests from any machine line up.
  if ! (cd "$out/dist" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do hash_file "$f"; done) > "$out/manifest.txt"; then
    annotate error "Could not hash the phone bundle in $out/dist"
    return 3
  fi
}

# diff_manifests <base-manifest> <head-manifest>: one line per difference.
diff_manifests() {
  # shellcheck disable=SC2016  # the ${} below is JavaScript, not shell
  node -e '
    const fs = require("fs")
    const read = (file) => new Map(fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
      const m = /^([0-9a-f]{64}) [ *](.*)$/.exec(line)
      if (!m) throw new Error(`${file}: not a manifest line: ${line}`)
      return [m[2].replace(/^\.\//, ""), m[1]]
    }))
    const base = read(process.argv[1])
    const head = read(process.argv[2])
    // Vite names a chunk <name>-<8-character hash>.<ext>, and the hash moves
    // whenever the chunk or anything it imports changes. An edited chunk so
    // shows up as one file removed and another added. Pair those back up by
    // name, so the report reads "WorkerApp changed" rather than as two
    // unrelated lines.
    const stem = (p) => p.replace(/-[A-Za-z0-9_-]{8}(\.[^./]+)$/, "-*$1")
    const out = []
    const gone = new Map()
    const fresh = new Map()
    const add = (map, p) => map.set(stem(p), [...(map.get(stem(p)) || []), p])
    for (const [p, h] of base) {
      if (!head.has(p)) add(gone, p)
      else if (head.get(p) !== h) out.push([p, `changed  ${p}`])
    }
    for (const p of head.keys()) if (!base.has(p)) add(fresh, p)
    for (const [s, olds] of gone) {
      const news = fresh.get(s) || []
      if (olds.length === 1 && news.length === 1) {
        out.push([olds[0], `changed  ${olds[0]} -> ${news[0]}`])
        fresh.delete(s)
      } else {
        for (const p of olds) out.push([p, `removed  ${p}`])
      }
    }
    for (const news of fresh.values()) for (const p of news) out.push([p, `added    ${p}`])
    out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    for (const [, line] of out) console.log(line)
  ' "$1" "$2"
}

compare() {
  local base="$1" head="$2" work="${3:-}" exempt=false base_built=true
  if [ -z "$work" ]; then
    work="$(mktemp -d)"
    # shellcheck disable=SC2064  # expand now: $work is local
    trap "rm -rf '$work'" EXIT
  fi
  mkdir -p "$work"
  work="$(cd "$work" && pwd)"

  case ",$(printf '%s' "${LABEL:-}" | tr -s '[:space:],' ',')," in
    *,ships-to-ios,*) exempt=true ;;
  esac

  build_phone "$head" "$work/head" || exit 3
  if ! build_phone "$base" "$work/base"; then
    # A base that does not build cannot be compared with. That only blocks a
    # change that is not meant to reach phones; a labelled one still gets
    # the forbidden-text check below.
    if ! $exempt; then
      annotate error "The base does not build, so there is nothing to compare with. If this change is the fix and is meant to reach phones, label it ships-to-ios."
      exit 3
    fi
    annotate warning "The base does not build; skipping the comparison because the change is labelled ships-to-ios."
    base_built=false
  fi

  # Forbidden text first: no label excuses it.
  local text count files forbidden_hit=false
  for text in "${FORBIDDEN[@]}"; do
    count="$( (grep -roF -- "$text" "$work/head/dist" || true) | wc -l | tr -d '[:space:]')"
    if [ "$count" -gt 0 ]; then
      forbidden_hit=true
      files="$( (grep -rlF -- "$text" "$work/head/dist" || true) | sed "s|^$work/head/dist/||" | paste -sd ' ' -)"
      annotate error "The phone bundle contains '$text' (found $count times, in $files). It must never ship to iOS."
      summary "- :x: The phone bundle contains \`$text\` (found $count times, in $files)"
    else
      echo "ok: 0 hits for '$text' in the phone bundle"
    fi
  done

  if ! $base_built; then
    $forbidden_hit && exit 2
    exit 0
  fi

  diff_manifests "$work/base/manifest.txt" "$work/head/manifest.txt" > "$work/diff.txt"
  local files_head changed
  files_head="$(wc -l < "$work/head/manifest.txt" | tr -d '[:space:]')"
  changed="$(wc -l < "$work/diff.txt" | tr -d '[:space:]')"

  if [ "$changed" -eq 0 ]; then
    echo "Phone bundle identical: all $files_head files have the same sha256 at base and head."
    summary "Phone bundle identical: all $files_head files have the same sha256 at base and head."
  else
    echo "Phone bundle differs, $changed of $files_head files:"
    sed 's/^/  /' "$work/diff.txt"
    summary "### Phone bundle differs: $changed of $files_head files" '```' "$(cat "$work/diff.txt")" '```'
  fi

  $forbidden_hit && exit 2
  if [ "$changed" -gt 0 ]; then
    if $exempt; then
      annotate notice "The phone bundle changed and the change is labelled ships-to-ios. Run the /worker smoke test on the phone rig before the next TestFlight."
      summary "Labelled ships-to-ios, so this is expected. Smoke-test /worker on the phone rig before the next TestFlight."
      exit 0
    fi
    annotate error "The phone bundle changed ($changed files), so this change would alter the iOS app. If that is not intended, find the shared module the change touched. If it is, label the pull request ships-to-ios (for a direct push, put [ships-to-ios] in a commit message)."
    exit 1
  fi
  exit 0
}

case "${1:-}" in
  build)
    [ $# -eq 3 ] || usage
    build_phone "$2" "$3" || exit 3
    cat "$3/manifest.txt"
    ;;
  compare)
    [ $# -eq 3 ] || [ $# -eq 4 ] || usage
    compare "$2" "$3" "${4:-}"
    ;;
  *) usage ;;
esac
