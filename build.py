from pathlib import Path
import sys

root = Path(__file__).resolve().parent
markup = (root / 'src/app.html').read_text()
for page in ['play', 'reference', 'dev', 'paths']:
    markup = markup.replace('<!-- PAGE:' + page + ' -->', (root / ('src/pages/' + page + '.html')).read_text())
css = (root / 'src/style.css').read_text() + '\n' + '\n'.join(p.read_text() for p in sorted((root / 'src/pages').glob('*.css')))
scripts = '\n'.join((root / path).read_text() for path in ['vendor/d3.min.js', 'src/quant-math.js', 'src/model.js', 'src/practice-model.js', 'src/forecast-model.js', 'src/uncertainty-drills.js', 'src/opponents.js', 'src/practice.js', 'src/app.js'])
fragment = markup + '\n<style>\n' + css + '\n</style>\n<script>\n' + scripts + '\n</script>\n'
if '--artifact' in sys.argv:
    index = sys.argv.index('--artifact')
    if index + 1 >= len(sys.argv):
        raise SystemExit('Pass an output path after --artifact.')
    artifact = Path(sys.argv[index + 1]).expanduser()
    artifact.parent.mkdir(parents=True, exist_ok=True)
    artifact.write_text(fragment)
head = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Catan field guide</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27%3E%3Crect width=%2764%27 height=%2764%27 rx=%2712%27 fill=%27%23292925%27/%3E%3Ctext x=%2732%27 y=%2747%27 text-anchor=%27middle%27 font-size=%2747%27 fill=%27white%27%3E6%3C/text%3E%3C/svg%3E"><style>html{color-scheme:light;background:#faf9f6;color:#252522}body{margin:0}body>div{max-width:1160px;margin:0 auto}</style></head><body>
'''
(root / 'index.html').write_text(head + fragment + '\n</body></html>\n')
flash_script = '\n'.join((root / p).read_text() for p in ['src/flash-model.js', 'src/flashcards.js'])
flash_markup = '<div id="catan-lab" class="mf-standalone"><a class="mf-back" href="index.html">← Catan field guide</a><main id="math-flashcards"></main></div>'
flash = head.replace('<title>Catan field guide</title>', '<title>Catan Math — flashcards</title>') + flash_markup + '<style>' + css + (root / 'src/flashcards.css').read_text() + '</style><script>' + flash_script + '\nCatanFlashcards.init(document.getElementById("math-flashcards"));</script></body></html>'
(root / 'flashcards.html').write_text(flash)
print('Built local field guide and math flashcards.')
