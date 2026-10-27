#!/usr/bin/env bash
# Stand-ins for the three hand-made documents (case 2's phone photo, case 3's scan, case 11's image), made from their
# print sources with ImageMagick instead of a printer, a phone and a scanner. Same seed, same files.
#
#   npx tsx eval/quotes/build-documents.ts   # writes the *.print.pdf sources first
#   bash eval/quotes/make-supplied.sh
#
# A real photo or scan of the printed page reads harder than these, so replace a stand-in with one when you have it:
# each case.json's howTo says how. Needs ImageMagick 7 (`magick`) and Ghostscript, which it uses to read PDFs.
set -euo pipefail

DOCS="$(cd "$(dirname "$0")" && pwd)/documents"
SEED=47
# What the app does to an image before upload (prepare-quote-file.ts): longest edge 2048 px, JPEG at quality 85.
UPLOAD=(-resize '2048x2048>' -strip -quality 85)

for src in 02-phone-photo 03-scanned-dop 11-embedded-instructions-image; do
  [[ -f "$DOCS/$src.print.pdf" ]] || { echo "missing $DOCS/$src.print.pdf: run build-documents.ts first" >&2; exit 1; }
done
command -v magick >/dev/null || { echo "needs ImageMagick 7 (magick)" >&2; exit 1; }

# Case 2: the page photographed on a desk, at an angle, darker on one side, with sensor noise.
magick -seed "$SEED" -density 300 "$DOCS/02-phone-photo.print.pdf[0]" -background white -alpha remove -alpha off \
  -bordercolor '#7a6a58' -border 240 \
  -virtual-pixel background -background '#7a6a58' \
  -distort Perspective '0,0 210,330  %[fx:w-1],0 %[fx:w-140],170  0,%[fx:h-1] 90,%[fx:h-120]  %[fx:w-1],%[fx:h-1] %[fx:w-260],%[fx:h-60]' \
  \( +clone -sparse-color Barycentric '0,0 gray62  %[fx:w-1],%[fx:h-1] white' \) -compose multiply -composite \
  -blur 0x0.7 -attenuate 0.35 +noise Gaussian \
  "${UPLOAD[@]}" "$DOCS/02-phone-photo.jpg"

# Case 3: three pages scanned in grey at 200 dpi, each a little crooked, into one PDF with no text layer.
magick -seed "$SEED" -density 200 "$DOCS/03-scanned-dop.print.pdf" -background white -alpha remove -alpha off \
  -background white -rotate 0.6 -attenuate 0.2 +noise Gaussian -colorspace Gray -type Grayscale -level 4%,96% \
  -compress jpeg -quality 70 "$DOCS/03-scanned-dop.pdf"

# Case 11: the page exported as an image at 200 pixels per inch, its pale 4 pt footer kept readable.
magick -density 200 "$DOCS/11-embedded-instructions-image.print.pdf[0]" -background white -alpha remove -alpha off \
  "${UPLOAD[@]}" "$DOCS/11-embedded-instructions-image.jpg"

ls -l "$DOCS/02-phone-photo.jpg" "$DOCS/03-scanned-dop.pdf" "$DOCS/11-embedded-instructions-image.jpg"
