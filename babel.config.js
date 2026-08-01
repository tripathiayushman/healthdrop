// NativeWind is intentionally INERT.
// The app uses zero `className=` props and nothing imports the Tailwind
// scaffolding, so the global JSX transform (`jsxImportSource: 'nativewind'`)
// and the `nativewind/babel` preset only bought a per-component wrapper on
// every RN primitive plus a Tailwind preflight reset. Both are removed.
// package.json / global.css / tailwind.config.js stay on disk, so re-enabling
// is these two lines plus the `./global.css` import in App.tsx.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
