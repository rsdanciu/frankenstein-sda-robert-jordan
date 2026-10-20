// Fonts are bundled (no external font CDN) so the site works the same on GitHub Pages.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/unifrakturcook/700.css';
import './styles/main.css';
import { App } from './core/App.js';

const app = new App(document.getElementById('app'));
app.init().catch((err) => {
  console.error(err);
  app.showFatal(err);
});
