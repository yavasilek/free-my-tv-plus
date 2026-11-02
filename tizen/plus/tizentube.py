"""Optional TizenTube Cobalt 2.1.1 customization. Outputs an unsigned package."""
import argparse
import json
from pathlib import Path
import zipfile
from overlay import replace_once

ROOT = Path(__file__).resolve().parent

def personalize(files):
    files = dict(files)
    if 'xvvl3S1TT1.TizenTubeStandalone' not in files['config.xml'].decode():
        raise ValueError('Unexpected TizenTube application id')
    snippet = (ROOT / 'tizentube-preferences.js').read_text(encoding='utf-8')
    html = '<script>' + snippet + '</script>'
    anchor = 'text += `<script src="https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?ver=${Date.now()}"></script>`;'
    for name in ('service/index.js', 'service/dist/index.js'):
        code = files[name].decode('utf-8')
        files[name] = replace_once(code, anchor, 'text += ' + json.dumps(html, ensure_ascii=True) + ';\n          ' + anchor, name).encode()
    cobalt_anchor = "body = body.replace('</body>', `<script src=\"https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?ver=${Date.now()}\"></script></body>`);"
    cobalt_new = "body = body.replace('</body>', " + json.dumps(html, ensure_ascii=True) + " + `<script src=\"https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?ver=${Date.now()}\"></script></body>`);"
    for name in ('service/utils/cobaltProxyServer.js', 'service/dist/index.js'):
        files[name] = replace_once(files[name].decode('utf-8'), cobalt_anchor, cobalt_new, 'Cobalt preferences: ' + name).encode()
    for name in ('icon.png', 'icon_16b9.png'):
        files[name] = (ROOT / 'tizentube-icons' / name).read_bytes()
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        parser.error('Use a separate output file; preserve the original package.')
    with zipfile.ZipFile(args.source) as archive:
        files = {n: archive.read(n) for n in archive.namelist()
                 if n not in ('author-signature.xml', 'signature1.xml')}
    files = personalize(files)
    with zipfile.ZipFile(args.output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            archive.writestr(name, files[name])
    print('Built unsigned package:', args.output)


if __name__ == '__main__':
    main()
