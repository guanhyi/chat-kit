module.exports = {
  plugins: {
    // "postcss-import": {},
    "tailwindcss/nesting": {},
    tailwindcss: {},
    "postcss-preset-env": {
      autoprefixer: true,
    },
    // "@csstools/postcss-is-pseudo-class": {
    //   onComplexSelector: "warning",
    //   preserve: true,
    // },
    // "css-has-pseudo": {
    //   preserve: false,
    // },
  },
};
