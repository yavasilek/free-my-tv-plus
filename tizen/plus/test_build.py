"""Build the actual source tree and verify the Plus integration stays isolated."""
from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
import webapp
from overlay import apply, replace_once


class BuildTests(unittest.TestCase):
    def test_missing_or_duplicate_anchor_fails_closed(self):
        for text in ('changed', 'anchor anchor'):
            with self.assertRaises(ValueError):
                replace_once(text, 'anchor', 'new', 'test')

    def test_source_overlay_and_manifest(self):
        original = webapp.files(dict(webapp.GENERIC), 'test')
        original['config.xml'] = (ROOT / 'tizen/config.xml').read_bytes()
        before = dict(original)
        app = apply(original)
        self.assertEqual(original, before, 'Default builds must remain untouched')
        ns = {'t': 'http://tizen.org/ns/widgets', 'w': 'http://www.w3.org/ns/widgets'}
        manifest = ET.fromstring(app['config.xml'])
        self.assertEqual(manifest.find('w:name', ns).text, 'Free My TV Plus')
        self.assertEqual(manifest.find('t:application', ns).get('required_version'), '6.0')
        self.assertEqual(manifest.find('t:setting', ns).get('background-support'), 'disable')
        service = manifest.find('t:service', ns)
        self.assertEqual(service.get('id'), 'FreeMyTVio.Autostart')
        self.assertEqual(service.get('on-boot'), 'true')
        self.assertIn('VoKinoSearch.restore(saved.search)', app['home.js'].decode())
        self.assertIn("'История', 'Избранное'", app['home.js'].decode())
        self.assertLess(app['index.html'].index(b'vokino-adapter.js'), app['index.html'].index(b'home.js'))
        self.assertIn(b'VoKinoBridge.turnPage', app['home.js'])
        self.assertIn(b'class="lite"', app['index.html'])
        self.assertIn(b'favorites.js', app['index.html'])
        self.assertIn(b'VoKinoBridge.setFavorites', app['home.js'])
        self.assertIn(b'function openShelfEdit(selectedId)', app['home.js'])
        with self.assertRaises(ValueError):
            apply(app)


if __name__ == '__main__':
    unittest.main()
