"""Build an optional, unsigned TizenTube+ starter from the official Cobalt 2.1.1 WGT.

The generated WGT includes TizenTube's GPL-3.0 service, not part of the MIT launcher.
The installed TizenTube stays in place; the starter waits for the proxy before opening it.
"""
import argparse
from pathlib import Path
import re
import zipfile
from overlay import replace_once

ROOT = Path(__file__).resolve().parent

HEALTH = """
app.get('/fmtv/ready', (req, res) => {
    const socket = require('net').connect(8101, '127.0.0.2');
    let ended = false;
    function finish(code) {
        if (ended) return; ended = true; socket.destroy(); res.status(code).end();
    }
    socket.setTimeout(2500, () => finish(503));
    socket.on('error', () => finish(503));
    socket.on('connect', () => {
        // Reuse the original proxy's verified HTTPS fetch; no account data.
        fetch('https://www.youtube.com/generate_204', {timeout: 2500, redirect: 'manual'})
            .then(r => { if (r.body) r.body.resume(); finish(r.status === 204 || r.status === 200 ? 204 : 503); })
            .catch(() => finish(503));
    });
});

"""


def prepare(files):
    files = dict(files)
    manifest = files['config.xml'].decode('utf-8')
    if 'id="xvvl3S1TT1.TizenTubeStandalone"' not in manifest or 'version="2.1.1"' not in manifest:
        raise ValueError('Expected official TizenTube Cobalt 2.1.1')
    manifest = manifest.replace('id="https://tizentube.app"', 'id="https://freemytv.io/tizentube-starter"')
    manifest = manifest.replace('xvvl3S1TT1.TizenTubeStandalone', 'FMTVTube01.Starter')
    manifest = manifest.replace('xvvl3S1TT1.StandaloneService', 'FMTVTube01.StandaloneService')
    manifest = manifest.replace('package="xvvl3S1TT1"', 'package="FMTVTube01"')
    manifest = manifest.replace('<name>TizenTube</name>', '<name>TizenTube+</name>')
    # The starter is a web page; Samsung must not bypass it to open Cobalt.
    for name in ('pkgid', 'nativeID', 'native.userdata'):
        manifest, count = re.subn(r'\s*<tizen:metadata key="http://samsung.com/tv/metadata/' + re.escape(name) + r'"[^>]*/>', '', manifest)
        if count != 1:
            raise ValueError('Unexpected native metadata: ' + name)
    manifest = manifest.replace('key="http://samsung.com/tv/metadata/prelaunch.support" value="true"',
                                'key="http://samsung.com/tv/metadata/prelaunch.support" value="false"')
    manifest = manifest.replace('on-boot="true"', 'on-boot="false"')
    files['config.xml'] = manifest.encode()
    files['index.html'] = (ROOT / 'tizentube-starter.html').read_bytes()
    files['starter.js'] = (ROOT / 'tizentube-starter.js').read_bytes()
    preferences = '<script>' + (ROOT / 'tizentube-preferences.js').read_text(encoding='utf-8') + '</script>'
    import json
    for name in ('service/index.js', 'service/dist/index.js'):
        code = files[name].decode('utf-8')
        declaration = 'var' if name == 'service/dist/index.js' else 'const'
        code = replace_once(code, declaration + ' PORT = 8100;', declaration + ' PORT = 8102;', name + ': starter control port')
        code = replace_once(code, "app.get('/tizentube/getState'", HEALTH + "app.get('/tizentube/getState'", name + ': readiness')
        anchor = 'text += `<script src="https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?ver=${Date.now()}"></script>`;'
        code = replace_once(code, anchor, 'text += ' + json.dumps(preferences) + ';\n' + anchor, name + ': preferences')
        files[name] = code.encode()
    for name in ('service/utils/cobaltProxyServer.js', 'service/dist/index.js'):
        code = files[name].decode('utf-8')
        # Bind before the costly RSA generation. Certificates are generated on the
        # first YouTube handshake, while the socket already accepts connections.
        cert_anchor = "const ytCertWWW = createHostCertificate('www.youtube.com');\n    const ytCert = createHostCertificate('youtube.com');"
        if name == 'service/dist/index.js':
            cert_anchor = "var ytCertWWW = createHostCertificate('www.youtube.com');\n  var ytCert = createHostCertificate('youtube.com');"
        code = replace_once(code, cert_anchor,
            "let ytCertWWW, ytCert;", name + ': defer certificates')
        code = replace_once(code, "hostname === 'www.youtube.com' ? ytCertWWW : ytCert",
            "hostname === 'www.youtube.com' ? (ytCertWWW || (ytCertWWW = createHostCertificate('www.youtube.com'))) : (ytCert || (ytCert = createHostCertificate('youtube.com')))",
            name + ': lazy certificates')
        code = replace_once(code, "proxyServer.listen(proxyPort, '0.0.0.0');",
            "proxyServer.on('error', error => { if (error.code !== 'EADDRINUSE') throw error; });\n    proxyServer.listen(proxyPort, '0.0.0.0');",
            name + ': coexist with installed proxy')
        anchor = "body = body.replace('</body>', `<script src=\"https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?ver=${Date.now()}\"></script></body>`);"
        code = replace_once(code, anchor, "body = body.replace('</body>', " + json.dumps(preferences) + " + `<script src=\"https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?ver=${Date.now()}\"></script></body>`);", name + ': cobalt preferences')
        files[name] = code.encode()
    for name in ('icon.png', 'icon_16b9.png'):
        files[name] = (ROOT / 'tizentube-icons' / name).read_bytes()
    files['SOURCE-NOTICE.txt'] = (
        'Includes TizenTube Cobalt 2.1.1 by reisxd, GPL-3.0.\n'
        'Original source: https://github.com/reisxd/TizenTube/tree/v2.1.1\n'
        'Starter source and build: https://github.com/yavasilek/free-my-tv-plus/tree/main/tizen/plus\n'
        'Local starter source files: index.html, starter.js; service source is included.\n'
        'Starts only on explicit launch, not at TV power-on.\n').encode()
    return files


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', type=Path)
    p.add_argument('output', type=Path)
    args = p.parse_args()
    if args.source.resolve() == args.output.resolve():
        p.error('Preserve the original package; choose a separate output.')
    with zipfile.ZipFile(args.source) as z:
        files = {n: z.read(n) for n in z.namelist() if n not in ('author-signature.xml', 'signature1.xml')}
    files = prepare(files)
    with zipfile.ZipFile(args.output, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in sorted(files):
            z.writestr(name, files[name])
    print('Built unsigned starter:', args.output)


if __name__ == '__main__':
    main()
