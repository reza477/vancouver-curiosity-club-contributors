# Self-hosted typefaces

These WOFF2 files are unmodified variable-weight subsets from the official
Google Fonts distribution. Only the normal styles used by the public site's
core type tokens are shipped. The four files total 203,924 bytes and remain
below the project's 210 KB font budget.

| Local file | Official distribution | CSS weight range | Coverage |
| --- | --- | --- | --- |
| `fraunces-72pt-latin-400-600.woff2` | [Fraunces v38, 72pt, Latin](https://fonts.gstatic.com/s/fraunces/v38/6NUu8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nhr1Ic7qv8.woff2) | 400–600 | Latin |
| `fraunces-72pt-latin-ext-400-600.woff2` | [Fraunces v38, 72pt, Latin Extended](https://fonts.gstatic.com/s/fraunces/v38/6NUu8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nhr1Ic1qv86Rg.woff2) | 400–600 | Latin Extended |
| `inter-latin-400-700.woff2` | [Inter v20, Latin](https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2) | 400–700 | Latin |
| `inter-latin-ext-400-700.woff2` | [Inter v20, Latin Extended](https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2) | 400–700 | Latin Extended |

The family metadata and source CSS were obtained from the official Google Fonts
CSS2 API queries for Fraunces `opsz,wght@72,400;72,600` and Inter
`wght@400;500;600;700`. The CSS descriptors deliberately expose only those
weight ranges. Fraunces and Inter are licensed under the SIL Open Font License
1.1; their authoritative copyright notices and license texts are preserved in
`Fraunces-OFL.txt` and `Inter-OFL.txt` beside the binaries.
