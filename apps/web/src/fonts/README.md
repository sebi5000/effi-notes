# Vendored fonts

These woff2 files are committed to the repo so the Next build never has to
reach Google Fonts at build time — required for air-gapped customer
installs (QA review 2026-05-20, P2) and consumed via `next/font/local` in
`apps/web/src/app/layout.tsx`.

## Files

| File | Family | Subset | Axes | Style | Upstream |
|---|---|---|---|---|---|
| `inter-variable.woff2` | Inter | Latin | weight (100-900) | normal | `@fontsource-variable/inter@5.2.8` (`files/inter-latin-wght-normal.woff2`) |
| `newsreader-variable.woff2` | Newsreader | Latin | weight (100-900) | normal | `@fontsource-variable/newsreader@5.2.10` (`files/newsreader-latin-wght-normal.woff2`) |
| `newsreader-italic-variable.woff2` | Newsreader | Latin | weight (100-900) | italic | `@fontsource-variable/newsreader@5.2.10` (`files/newsreader-latin-wght-italic.woff2`) |

Only the Latin subset is shipped. Customer projects that need additional
scripts (Cyrillic, Greek, Vietnamese, etc.) can re-vendor from the same
Fontsource packages and add another `localFont` entry in `layout.tsx`.

## License

Both Inter and Newsreader are released under the **SIL Open Font License
1.1**. The full license text is reproduced inside each upstream
Fontsource package and at:

- https://github.com/rsms/inter/blob/master/LICENSE.txt
- https://github.com/productiontype/Newsreader/blob/master/OFL.txt

Re-distributing the woff2 in this repository is permitted under SIL OFL §3
("The Font Software may be sold by itself or as part of a larger software
package…"). When customer projects fork this template, the license travels
with the files; no additional attribution is required in the rendered UI.

## Re-vendoring

To refresh the files from a newer Fontsource release:

```sh
bun add -D @fontsource-variable/inter @fontsource-variable/newsreader
cp node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2 apps/web/src/fonts/inter-variable.woff2
cp node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2 apps/web/src/fonts/newsreader-variable.woff2
cp node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-italic.woff2 apps/web/src/fonts/newsreader-italic-variable.woff2
bun remove @fontsource-variable/inter @fontsource-variable/newsreader
```

Update the version pins in the table above as part of the same commit so
the provenance stays accurate.
