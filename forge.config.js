module.exports = {
  packagerConfig: {
    icon: './assets/icon.ico'
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        // An URL to an ICO file to use as the application icon (displayed in Control Panel > Programs and Features).
        icon: './assets/icon.ico',
        // The ICO file to use as the icon for the generated Setup.exe
        setupIcon: './assets/icon.ico'
      },
    }
  ]
};
