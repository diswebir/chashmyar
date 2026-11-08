# License texts absent from published crate archives

These copies are used only when the pinned crate archive lacks its own license
file. Package versions are checked by `scripts/generate-notices.mjs`.

- `alloc-stdlib-0.3.0.txt`: [repository license at the crate's commit](https://github.com/dropbox/rust-alloc-no-stdlib/blob/0a81fd6928ea3b33c8cd484aa4575d50ffb98012/LICENSE).
- `webview2-com.txt` and `webview2-com-sys.txt`: [repository license at the crate's commit](https://github.com/wravery/webview2-rs/blob/edc2caf886175ccaebe86078c9cfe1ae2a187328/LICENSE).
- `webview2-com-macros.txt`: [repository license at its crate commit](https://github.com/wravery/webview2-rs/blob/dffa41a8a46d3f5565eefbff2de57d38d399f158/LICENSE).
- `tauri-plugin-mit.txt` and `tauri-plugin-apache.txt`: [Tauri repository MIT license](https://github.com/tauri-apps/tauri/blob/59b63ab500da9859f12d8888c3298bc29bba0b92/LICENSE-MIT) and [Apache 2.0 license](https://github.com/tauri-apps/tauri/blob/59b63ab500da9859f12d8888c3298bc29bba0b92/LICENSE-APACHE-2.0) at the crate's commit.
- `selectors-mpl-2.0.txt`: [MPL 2.0 official text](https://www.mozilla.org/en-US/MPL/2.0/); [selectors source at the crate's commit](https://github.com/servo/stylo/tree/572ecba2d1600e7c3d490586692a209faf703baa/selectors).

When updating dependencies, review the generated notices and update these
pinned copies as needed. MIT for ChashmYar does not change upstream licenses.
