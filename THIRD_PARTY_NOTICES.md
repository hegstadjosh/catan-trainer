# Third-party notices

The project MIT license applies to project-authored code. The following components retain their own licenses and attribution. The linked local files contain the complete license texts; keep them with redistributed source or generated bundles.

| Component | Use in this repository | License and notice | Upstream source |
| --- | --- | --- | --- |
| Viral Doshi's Catan implementation, commit `3a0a6b815ff999adf5fd5802fa3df9b99833fc2d` | Adapted game engine and rules in `web/game/` | [MIT and attribution](web/game/LICENSE) | [Viral-Doshi/catan](https://github.com/Viral-Doshi/catan/tree/3a0a6b815ff999adf5fd5802fa3df9b99833fc2d) |
| D3 7.9.0 | `vendor/d3.min.js`, copied into the hosted browser bundle | [ISC license](vendor/d3-LICENSE.txt) | [d3/d3 v7.9.0](https://github.com/d3/d3/tree/v7.9.0) |
| Vega 6.4.0 | Hosted browser visualization bundle | [BSD-3-Clause license](vendor/vega-LICENSE.txt) | [vega/vega](https://github.com/vega/vega) |
| Vega-Lite 6.4.3 | Hosted browser visualization bundle | [BSD-3-Clause license](vendor/vega-lite-LICENSE.txt) | [vega/vega-lite](https://github.com/vega/vega-lite) |
| Vega Interpreter 2.3.2 | Hosted browser visualization bundle | [BSD-3-Clause license](vendor/vega-interpreter-LICENSE.txt) | [vega/vega](https://github.com/vega/vega) |

`web/build.mjs` copies the installed Vega-family license texts into the generated browser asset `web/public/vega-LICENSE.txt` and copies the engine notice into `web/public/catan-engine-LICENSE.txt`. If you redistribute generated assets, preserve those generated notices as well. The `web/package-lock.json` also resolves additional npm packages; their own licenses accompany installed packages and are not superseded by this file.

These software licenses do not grant rights to CATAN trademarks, official artwork, published game text, or any other third-party assets. See [Licensing and publication scope](LICENSING.md).
