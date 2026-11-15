// Tailwind build for app.html and login.html. It replaces the cdn.tailwindcss.com runtime script,
// which is not meant for production and left the app unusable whenever the CDN failed to load.
// styles/tailwind.css is generated and committed. After adding a new Tailwind class, regenerate it:
//   npm run build:css
module.exports = {
  content: [
    './app.html', './login.html',
    './*.js', './planning/*.js', './dashboard/*.js', './history/*.js',
    './orders/*.js', './dispatch/*.js', './settings/*.js', './driver/*.js'
  ],
  theme: { extend: {} },
  plugins: []
};
