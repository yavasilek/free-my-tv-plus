/* Applied once before TizenTube's userscript initializes. No account fields. */
(function () {
  try {
    if (localStorage.getItem('haalee.tizentube.settings.rev') === '20261102-1') return;
    var config = JSON.parse(localStorage.getItem('ytaf-configuration') || '{}');
    var desired = {
      enableAdBlock: true, enableSponsorBlock: true,
      enableSponsorBlockSponsor: true, enableSponsorBlockInteraction: true,
      enableSponsorBlockSelfPromo: true, sponsorBlockManualSkips: ['intro', 'outro', 'filler'],
      enableDeArrow: true, enableDeArrowThumbnails: true, enableHqThumbnails: false
    };
    Object.keys(desired).forEach(function (key) { config[key] = desired[key]; });
    localStorage.setItem('ytaf-configuration', JSON.stringify(config));
    localStorage.setItem('haalee.tizentube.settings.rev', '20261102-1');
  } catch (e) {}
})();
